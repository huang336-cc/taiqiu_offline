import { Ball } from "../../../model/ball"
import { Respot } from "../../../utils/respot"
import { AimCalculator } from "../aimcalculator"
import { BotShotContext } from "../botstrategy"
import { TheFarJaw } from "./thefarjaw"
import { Vector3 } from "three"
import { R } from "../../../model/physics/constants"
import { TableGeometry } from "../../../view/tablegeometry"
import { AimEvent } from "../../../events/aimevent"
import { GameEvent } from "../../../events/gameevent"
import { DifficultyProfile, DIFFICULTY, jitterPower } from "../difficulty"
import {
  cueSpeedFor,
  POCKET_RADIUS_CORNER,
  POCKET_RADIUS_MIDDLE,
} from "../powerphysics"

/**
 * v1.3.68：AI 用的袋口是内缩点（aimcalculator.ts 的私有常量 POCKET_INSET_FACTOR）。
 * 物理反解需要把它换算回真实袋心，这里重新声明一份（与 aimcalculator 保持同步）。
 */
const POCKET_INSET_FACTOR = 0.94

/**
 * v1.3.74：力度反解安全余量。
 * 1.05 是 potcalib 标定的「刚好进袋」下界 —— 实战观感全是轻推，且没进袋时
 * 物体球短停 + 母球被深低杆拉停 → 「击球后无球碰库」犯规。抬到 1.2：
 * 距离上等效 +44% 余量（v² 关系），仍远低于进袋速度区间上界（4.8~5.0 m/s），
 * 超供的副作用（母球多跑）由 scratchRisk 收力与深低杆压制。
 */
const POWER_MARGIN = 1.2

/**
 * 专业难度 AI（Professional）：在激进策略（TheFarJaw）之上强化「决策质量」，
 * 是三档电脑里最强的一档。
 *
 * v1.3.58 修复了一个致命 bug：旧版 aim() 返回的事件序列是
 *   [aimEvent, farKnuckleAimEvent, farKnuckleHit]
 * 而真正出杆的是序列**最后一个 HitEvent**，也就是 farKnuckleHit —— 满力
 * (MAX_SHOT_POWER) 打「远袋角」。本类里那一整套精密计算（候选枚举、切球角
 * 排序、防摔袋、力度自适应）只作用在前两个 AimEvent 上，而 AimEvent 在游戏
 * 里只是给玩家看的瞄准预览、并不真的击球（Controller.handleAim 是空实现）。
 * 结果：专业档的实际出杆与激进档完全一样，且永远是满力，这才是它频繁低级
 * 失误（大力乱冲、母球失控摔袋）的真正原因。现在改为用 pocketHit 出杆，
 * 远袋角降级为「AI 比选过的备选线路」展示。
 *
 * 本档能力由 DifficultyProfile 逐项开关（见 difficulty.ts）：
 *  1. 候选过滤：剔除「被其它球遮挡」与「切球角过薄（minCutCos）」的球-袋组合；
 *  2. 防摔袋（avoidScratch）：估算击球后母球停位，会摔袋的方案降权并收力；
 *  3. 走位（positionPlay）：奖励「打进后母球停位靠近剩余球群、且不贴库」；
 *  4. 旋转控制（useSpin）：用高低杆主动决定母球撞完目标球后走多远；
 *  5. 力度自适应（adaptivePower）：按距离选力度，薄球收力，避免满力乱冲；
 *  6. 安全球（safetyPlay）：无球可进时把母球留在对手难打的位置。
 */

/**
 * v1.3.75：ghost 退化阈值（单位 R）。
 * 「母球→ghost」的距离小于此值时，出杆方向由浮点残差决定，实测会偏离
 * 100°~340° 直接空杆。与 AimCalculator.MIN_AIM_DISTANCE 同义，独立常量
 * 是为了让候选枚举（剔除）与出杆兜底（退化成直击）两条路径各取所需。
 */
const MIN_GHOST_DISTANCE = 1.2 * R

/** 一个候选打法：目标球 + 袋口 + 各项几何评估 */
interface Plan {
  ball: Ball
  pocket: Vector3
  /** 余弦切球角（越大越正，越易进） */
  cutCos: number
  /** 母球→目标→袋 的总距离 */
  cuePocketDist: number
  /** 母球→目标 球心距离（米），choosePower 反解所需 */
  cueToBall: number
  /**
   * 目标 → AI 内缩袋点 的距离（米）。注意这是**内缩点**距离，不是真实袋心。
   * aimcalculator.ts 的 POCKET_INSET_FACTOR=0.94 把袋心往台心缩了
   * 角袋 3.00R / 中袋 1.44R，物理反解必须换算回真实袋心距离。
   */
  ballToPocket: number
  /** 目标 → 真实袋心 的距离（米）= ballToPocket + 内缩偏移 */
  ballToPocketTrue: number
  /** 该袋口的有效半径（米）：角袋 2.1R / 中袋 1.64R */
  pocketRadius: number
  /** 母球估算停位 */
  stop: Vector3
  /** 停位到最近袋口的距离，越小越有摔袋风险 */
  scratchRisk: number
  /** 停位到剩余球群中心的距离，越小走位越好 */
  stopToNext: number
  /** 停位贴库程度 0~1，越大越贴库（下一杆越难打） */
  railHug: number
}

export class Professional extends TheFarJaw {
  override readonly name = "Professional"

  /** 母球停位到袋口小于该距离即视为有摔袋风险 */
  private static readonly SCRATCH_SAFE = 1.6 * R

  constructor(profile: DifficultyProfile = DIFFICULTY.Professional) {
    super(profile)
  }

  /** 出杆主入口：返回 [备选瞄准, 主瞄准, 实际出杆]，最后一个才是真打出去的。 */
  override aim(context: BotShotContext, calculator: AimCalculator): GameEvent[] {
    if (!TableGeometry.hasPockets) {
      // 无袋玩法（开伦/沙孤）沿用父类逻辑
      return super.aim(context, calculator)
    }

    const cue = context.cueBall
    const balls = context.validTargetBalls
    const pockets = calculator.pockets
    if (balls.length === 0 || pockets.length === 0) {
      return super.aim(context, calculator)
    }

    const plans = enumeratePlans(
      cue,
      balls,
      pockets,
      this.profile.minCutCos,
      calculator,
      // v1.3.65：遮挡检测必须看**全桌**（含对方球与黑8），理由见 enumeratePlans 注释
      context.table.balls.filter((b) => b.onTable() && b !== cue)
    )
    if (plans.length === 0) {
      // 没有任何几何上可进的球
      return this.safetyOrFallback(context, calculator, cue, balls)
    }

    const best = this.rankPlans(plans)
    // v1.3.67：choosePower 现在依赖 spin 决定"补多少力"，需先算 spin
    const spin = this.chooseSpin(best)
    const power = this.choosePower(best, spin)

    const aimPoint = calculator.getAimPoint(cue.pos, best.ball.pos, [
      best.pocket,
    ])
    // v1.3.58 P0 修复：用精密算出的主方案出杆，而不是满力打远袋角。
    const pocketHit = calculator.generateShot(
      context.table,
      this.profile.aimNoise,
      jitterPower(power, this.profile.powerJitter),
      aimPoint,
      spin
    )

    // 远袋角只用于展示「AI 还比选过这条线」，不再作为实际出杆。
    const knuckles = calculator.closestKnuckles(best.pocket)
    const farKnuckle =
      best.ball.pos.distanceTo(knuckles[0]) >
      best.ball.pos.distanceTo(knuckles[1])
        ? knuckles[0]
        : knuckles[1]
    const farKnuckleAimPoint = calculator.getAimPoint(cue.pos, best.ball.pos, [
      farKnuckle,
    ])
    const farKnuckleHit = calculator.generateShot(
      context.table,
      this.profile.aimNoise,
      jitterPower(power, this.profile.powerJitter),
      farKnuckleAimPoint,
      spin
    )

    // v1.3.75 最后一道保险：沿**实际出杆角度**做一次射线检测，确认母球真能
    // 擦到目标球。ghost 法在贴球/球堆挤压等边界情形下仍可能给出打飞的方向
    // （见 MIN_GHOST_DISTANCE 注释），这里兜底：改为直击目标球心。
    // 直击最多打厚进不去，但绝不会空杆送对手自由球。
    let finalHit = pocketHit
    const hitAngle = (pocketHit.tablejson?.aim as { angle?: number } | undefined)
      ?.angle
    if (
      typeof hitAngle === "number" &&
      rayMissDistance(cue.pos, hitAngle, best.ball.pos) > 1.9 * R
    ) {
      finalHit = calculator.generateShot(
        context.table,
        this.profile.aimNoise,
        jitterPower(power, this.profile.powerJitter),
        best.ball.pos.clone(),
        spin
      )
    }

    const out: GameEvent[] = [
      AimEvent.fromJson(farKnuckleHit.tablejson.aim),
      AimEvent.fromJson(finalHit.tablejson.aim),
      finalHit,
    ]
    return out
  }

  /**
   * 从候选中挑最好的一个。优先级：不摔袋 > 切球角正 > 走位好 > 不贴库 > 距离近。
   * 走位相关的两项只在 positionPlay 打开时生效（仅专业档）。
   */
  private rankPlans(plans: Plan[]): Plan {
    const p = this.profile
    const sorted = plans.slice().sort((a, b) => {
      // v1.3.66 防摔袋：把「母球轨迹明显会掠过袋口」的线路（路径离袋 < 2.4R）
      // 整体压到后面，优先选离袋更远的线路；但在「安全线路」内部，仍以切球角
      // 为主排序（直线球更易进），只在切球角相当时才用摔袋风险微调。
      // 这样既把摔袋率大幅压下来，又不至于为了绝对安全去挑过薄的球、牺牲进球率。
      if (p.avoidScratch) {
        const riskyA = a.scratchRisk < 2.4 * R ? 1 : 0
        const riskyB = b.scratchRisk < 2.4 * R ? 1 : 0
        if (riskyA !== riskyB) return riskyA - riskyB
      }
      if (b.cutCos !== a.cutCos) return b.cutCos - a.cutCos
      if (p.avoidScratch) {
        if (a.scratchRisk !== b.scratchRisk) {
          return b.scratchRisk - a.scratchRisk
        }
      }
      if (p.positionPlay) {
        // 停位离剩余球群越近，下一杆越好打
        if (a.stopToNext !== b.stopToNext) return a.stopToNext - b.stopToNext
        // 同等条件下别把母球留在库边
        if (a.railHug !== b.railHug) return a.railHug - b.railHug
      }
      return a.cuePocketDist - b.cuePocketDist
    })
    return sorted[0]
  }

  /**
   * 力度自适应（v1.3.68 完全物理化，v1.3.74 补「合法性保险」）：
   *
   * v1.3.67 只做了经验微调（上限 90R→72R + 低杆补偿 5-10%），摔袋率 11.5%→10.6%，
   * 收益有限。v1.3.68 改为**基于真实物理模型反解**，见 powerphysics.ts：
   *
   *   vCue = margin · vRoll / f(spin) / (1 − 0.25·|offset|²)
   *   vRoll = sqrt( vContact² + 2·a_roll·cueToBall )
   *   vContact = vObj / (0.9625 · cutCos)
   *   vObj = sqrt( 2 · a_obj · D ),  D = ballToPocketTrue − pocketRadius
   *
   * 三处关键修正（v1.3.67 物理化失败的元凶）：
   *  1. a_obj ≠ a_roll：物体球撞后强制 Sliding，等效减速 **1.84×** 于纯滚动；
   *  2. f(spin) 实测拟合：低杆 −0.45 只剩 **48%** 滚动速度（不是 85%）；
   *  3. ballToPocket 是**内缩点**距离，须换算回真实袋心（角袋 +3.00R）。
   *
   * v1.3.74 两处修正（用户实测「全是轻推 + 力度不够没撞库犯规」）：
   *  A. **合法性保险**：八球规则——没进球时首撞后必须有球碰库，否则直接犯规送
   *     自由球（eightball.ts foulReason 第 3 条）。旧反解只给「物体球刚好够到
   *     袋口边界」的最小力度，一旦没进（呲框/薄切 throw 打偏，实测 ~17%），
   *     物体球在袋口前短停、母球又被深低杆拉回原地，两球都够不到库 → 必犯规。
   *     现在把反解的有效距离延长 2×pocketRadius（物体球到袋口边界时仍保有滚
   *     过袋心、撞上袋口库边的余速）：进了袋照样合法，没进也必然撞库。
   *  B. **余量 1.05 → 1.2**：1.05 是「贴着最小进袋速度」的下界，harness 实测
   *     平均出杆仅 27R（0.88 m/s）、78% 的杆 <30R，观感全是轻推且短停率高。
   *     1.2 距离上等效 +44% 余量（v² 关系），仍远低于「超供只会摔袋」的上界
   *     （potcalib 实测进袋速度区间上界 4.8~5.0 m/s，而反解典型值 ~1 m/s），
   *     摔袋由 scratchRisk 收力 + 深低杆继续压制。
   */
  private choosePower(best: Plan, spin: Vector3): number {
    if (!this.profile.adaptivePower) return AimCalculator.DEFAULT_SHOT_POWER
    let power = cueSpeedFor(
      best.cueToBall,
      best.ballToPocketTrue + 2 * best.pocketRadius,
      best.pocketRadius,
      best.cutCos,
      spin.y,
      spin.length(),
      POWER_MARGIN
    )
    // 薄球：切向 throw 会让物体球偏离袋心，多给 8% 余量
    if (best.cutCos < 0.5) power *= 1.08
    // 摔袋风险强制收力（母球轨迹离袋口 < 3.6R）
    if (
      this.profile.avoidScratch &&
      best.scratchRisk < Professional.SCRATCH_SAFE
    ) {
      power = Math.min(power, 56 * R)
    }
    // 上下限：物理反解典型给 25~60R，下限防"打不到"、上限防异常值。
    return Math.min(Math.max(power, 22 * R), 90 * R)
  }

  /**
   * v1.3.66 母球控制：用高低杆主动决定母球撞完目标球后走多远。
   * offset.y > 0 为高杆（跟进、走得远），< 0 为低杆（缩杆、走得近）。
   *
   * 关键改动：默认带一点低杆把母球「收住」，避免满场乱跑撞库后摔袋；
   * 一旦估算有摔袋风险，直接给接近极限的低杆把母球拉住。薄切同样压低杆。
   * 低杆打点限制在 offCenterLimit(0.45) 内，超出物理上等价于无效击打。
   */
  private chooseSpin(best: Plan): Vector3 {
    if (!this.profile.useSpin) return new Vector3(0, 0, 0)
    const spin = new Vector3(0, 0, 0)
    // 摔袋风险最高优先：接近极限的低杆把母球拉住，避免跟进球袋
    if (best.scratchRisk < Professional.SCRATCH_SAFE) {
      spin.y = -0.45
      return spin
    }
    // v1.3.66：中等摔袋风险（母球轨迹离袋口不远）用明显低杆把母球拉回，
    // 直接压住「撞库后跟进袋口」的线路；仅在确需大范围走位（停位离球群远）
    // 时减弱低杆、保留部分跟进。这是降摔袋的核心手段，且不改选球、不伤进球率。
    if (best.scratchRisk < 4 * R) {
      spin.y = best.stopToNext > 6 * R ? -0.3 : -0.45
      return spin
    }
    if (this.profile.positionPlay) {
      if (best.stopToNext > 6 * R) spin.y = 0.26
      else if (best.stopToNext < 2 * R) spin.y = -0.28
      else spin.y = -0.22 // 默认带低杆收住母球，避免满场乱跑
    } else {
      spin.y = -0.25
    }
    // 薄球母球天然跑得远，再压低杆，避免走位过头摔袋
    if (best.cutCos < 0.5) spin.y = Math.min(spin.y, -0.38)
    // 低杆打点不得超出球心极限
    spin.y = Math.max(-0.45, Math.min(0.45, spin.y))
    return spin
  }

  /**
   * 无球可进时的处理。
   * - 安全球（专业档）：在所有合法目标球里挑「碰完之后母球离对手球最远」的
   *   那颗，把难题丢回去。力度反解为「物体球滚到袋口、没进也必撞库边」
   *   （v1.3.74）：先保证不犯「击球后无球碰库」的规，再谈防守。
   * - 其余档位：退化为稳健的「碰最近的一颗」，只求不空杆犯规。
   *
   * v1.3.65：候选池先做**视线畅通过滤**（对全桌球，含对方球与黑8）。
   * 被挡的球打出去首撞非本方球 = 直接犯规送自由球，比不进还糟；完全被挡死
   * 时才退回全量候选里最近的一颗（此时至少方向对，运气好能蹭到）。
   */
  private safetyOrFallback(
    context: BotShotContext,
    calculator: AimCalculator,
    cue: Ball,
    balls: Ball[]
  ): GameEvent[] {
    const p = this.profile
    const allBalls = context.table.balls.filter(
      (b) => b.onTable() && b !== cue
    )
    const open = balls.filter(
      (b) => !lineBlocked(cue.pos, b.pos, allBalls, cue, b)
    )
    // v1.3.66：没有任何球视线完全畅通时，不无脑取最近的一颗（最近那颗往往
    // 正被挡死、首撞错球直接犯规），而是挑「遮挡最轻」的一颗当 fallback，
    // 尽量降低首撞错球送自由球的概率。
    let pool: Ball[]
    if (open.length > 0) {
      pool = open
    } else {
      const cb = clearestBall(cue.pos, balls, allBalls, cue)
      pool = cb ? [cb] : balls
    }
    const fallback = Respot.closest(cue, pool)
    if (!fallback) return super.aim(context, calculator)

    let target = fallback
    let powerOverride: number | null = null
    if (p.safetyPlay) {
      const mine = new Set<Ball>(balls)
      const theirs = context.table.balls.filter(
        (b) => b !== cue && b.onTable() && !mine.has(b)
      )
      if (theirs.length > 0) {
        let bestD = -Infinity
        for (const ball of pool) {
          const aimPoint = calculator.getAimPoint(cue.pos, ball.pos)
          const dir = aimPoint.clone().sub(cue.pos).normalize()
          const travel = Math.min(
            6 * R,
            cue.pos.distanceTo(ball.pos) * 0.6 + R
          )
          const stop = ball.pos.clone().addScaledVector(dir, travel)
          let d = Infinity
          for (const t of theirs) {
            d = Math.min(d, stop.distanceTo(t.pos))
          }
          if (d > bestD) {
            bestD = d
            target = ball
          }
        }
      }
      // v1.3.68 引入、v1.3.74 修正：安全球必须先保证**合法性**。
      // 八球规则：没进球时首撞后必须有球碰库，否则「击球后无球碰库」直接犯规
      // 送自由球（eightball.ts foulReason 第 3 条）。旧版推「0.4×dToPocket」的
      // 极轻球：物体球停在袋口途中、母球直线轻碰后原地停住 —— 两球都够不到库，
      // 安全球一打出去就是必犯规送对手自由球（旧注释把「空杆」与「无碰库」混为
      // 一谈了：轻碰碰到了球，不算空杆，照样犯无碰库的规）。
      // 现在改为反解「物体球滚到袋口、没进也撞上袋口库边」所需的力度：
      // 距离必须沿**实际出杆方向**算 —— getAimPoint 内部 findBestPocket 按
      // 「切角最小」选袋，不是最近袋；v1.3.74 首版用最近袋距离反解，方向偏远
      // 时余速不够仍会短停。这里直接取 best pocket 的真实距离，物体球要么
      // 落袋、要么撞上袋口周围的库边 → 必合法，同时保留安全球本意。
      if (target && theirs.length > 0) {
        const aimPocket = calculator.findBestPocket(
          cue.pos,
          target.pos,
          calculator.pockets
        )
        const dPocket = target.pos.distanceTo(aimPocket)
        const railPower = cueSpeedFor(
          cue.pos.distanceTo(target.pos),
          dPocket + POCKET_RADIUS_CORNER, // 袋心后再留一整个袋半径的撞库余速
          POCKET_RADIUS_CORNER,           // 内部 D = dPocket（到袋心仍有余速）
          1, // 直线轻推，切球角余弦取 1
          0, // 不打旋转
          0,
          1.3 // 余量给足，保证物体球真的能撞上库边
        )
        powerOverride = Math.min(Math.max(railPower, 22 * R), 60 * R)
      }
    }

    const aimPoint = calculator.getAimPoint(cue.pos, target.pos)
    const hit = calculator.generateShot(
      context.table,
      p.aimNoise,
      jitterPower(
        powerOverride ?? AimCalculator.DEFAULT_SHOT_POWER,
        p.powerJitter
      ),
      aimPoint,
      new Vector3(0, 0, 0)
    )
    return [AimEvent.fromJson(hit.tablejson.aim), hit]
  }
}

/**
 * v1.3.75：出杆方向到目标球的**垂距**（射线与球心的最近距离）。
 * 用于判断「沿这个方向打出去到底能不能碰到这颗球」：
 *   - ≤ 2R：会碰上（球心到射线垂距小于两球半径和）；
 *   - > 2R：擦着飞过去，空杆。
 * 目标球在母球背后时返回 Infinity。
 */
function rayMissDistance(
  cuePos: Vector3,
  angle: number,
  targetPos: Vector3
): number {
  const dir = new Vector3(Math.cos(angle), Math.sin(angle), 0)
  const rel = targetPos.clone().sub(cuePos)
  const along = rel.dot(dir)
  if (along <= 0) return Infinity
  return Math.sqrt(Math.max(0, rel.lengthSq() - along * along))
}

/**
 * 枚举所有「目标球 × 袋口」组合，计算几何可行性与走位评分。
 * 剔除视线被挡与切球角过薄（cutCos <= minCutCos）的组合。
 *
 * v1.3.65：新增 `allBalls`（全桌在桌球）参数。旧版遮挡检测只拿 `balls`
 * （= validTargetBalls，本方球组）当障碍物集合 —— 对方 7 颗球与黑8 对 AI
 * 完全隐形，于是两条致命线路畅通无阻：
 *   1. 母球→目标的路上站着对方球：打出去首撞非本方球 = 直接犯规。这就是
 *      用户反馈「击球线路被挡时直接选择犯规」的根因 —— AI 不是"选择"犯规，
 *      是根本看不见挡路的球，以为自己选的是一条好球。
 *   2. 目标→袋的路上站着别的球：目标球撞到半路，白丢一杆球权。
 * 另外补上第 2 条路段的检测（旧版只查母球→目标一段）。
 */
function enumeratePlans(
  cue: Ball,
  balls: Ball[],
  pockets: Vector3[],
  minCutCos: number,
  calculator: AimCalculator,
  allBalls: Ball[]
): Plan[] {
  const plans: Plan[] = []
  const nextCenter = remainingCenter(cue, balls)

  for (const ball of balls) {
    for (const pocket of pockets) {
      // 切球角：母球→目标 与 目标→袋 的方向夹角余弦
      const toTarget = ball.pos.clone().sub(cue.pos).normalize()
      const toPocket = pocket.clone().sub(ball.pos).normalize()
      const cutCos = toTarget.dot(toPocket)
      if (cutCos <= minCutCos) continue // 球太薄，几乎不可能进

      // v1.3.67 修薄切首撞错球：母球实际打的是 ghost（目标球的"虚拟击球点"，
      // 偏离球心 2.001R），不是球心。薄切时偏离最大可达 2R，叠 2R 判定阈值
      // 等于障碍球离检查线 4R 也可能先撞。改用 ghost 终点检查线段遮挡。
      const ghost = calculator.ghostBallFor(cue.pos, ball.pos, [pocket])
      // v1.3.75：ghost 退化线路直接剔除。母球贴在目标球袋口侧时 ghost 就落在
      // 母球脚边，「母球→ghost」方向被浮点残差放大成随机角度 → 空杆送自由球。
      // 这种组合整个丢掉，让 AI 去打别的球/别的袋口，而不是硬着头皮打飞。
      if (cue.pos.distanceTo(ghost) < MIN_GHOST_DISTANCE) continue
      if (lineBlocked(cue.pos, ghost, allBalls, cue, ball)) continue
      if (lineBlocked(ball.pos, pocket, allBalls, ball)) continue

      const cueToBall = cue.pos.distanceTo(ball.pos)
      const ballToPocket = ball.pos.distanceTo(pocket)
      // v1.3.68：pocket 是**内缩点**（×0.94）。物理反解需要真实袋心距离与袋半径：
      //   - 真实袋心 = pocket / 0.94（内缩是沿"袋心→台心"方向乘 0.94，可逆）
      //   - 内缩偏移 = |真实袋心| × 0.06（角袋 3.00R、中袋 1.44R）
      //   - 袋半径：角袋 2.1R、中袋 1.64R，用真实袋心的 x/y 是否都接近台边判定。
      const trueCenter = pocket.clone().divideScalar(POCKET_INSET_FACTOR)
      const insetOffset = trueCenter.length() * (1 - POCKET_INSET_FACTOR)
      const ballToPocketTrue = ballToPocket + insetOffset
      const isCorner =
        Math.abs(Math.abs(trueCenter.x) - TableGeometry.X) < 1e-6 &&
        Math.abs(Math.abs(trueCenter.y) - TableGeometry.Y) < 1e-6
      const pocketRadius = isCorner
        ? POCKET_RADIUS_CORNER
        : POCKET_RADIUS_MIDDLE
      const stop = estimateStop(
        cue.pos,
        ball.pos,
        pocket,
        cutCos,
        cueToBall
      )

      // v1.3.66 路径级防摔袋：母球撞完目标球后沿切线飞向 stop，若这段轨迹
      // （cuePos→stop）贴近某个袋口，母球极可能跟着进袋。只看「停位点离袋多远」
      // 不够——停点离袋远、但中途掠过袋口的线路同样会摔袋。故取整条轨迹到各
      // 袋口的最近距离作为摔袋风险。
      let pathMin = Infinity
      for (const p of pockets) {
        const d = segDistToPoint(cue.pos, stop, p)
        if (d < pathMin) pathMin = d
      }

      plans.push({
        ball,
        pocket,
        cutCos,
        cuePocketDist: cueToBall + ballToPocket,
        cueToBall,
        ballToPocket,
        ballToPocketTrue,
        pocketRadius,
        stop,
        scratchRisk: pathMin,
        stopToNext: nextCenter ? stop.distanceTo(nextCenter) : 0,
        railHug: railHug(stop),
      })
    }
  }
  return plans
}

/** 剩余目标球的群体中心（用于评估走位） */
function remainingCenter(cue: Ball, balls: Ball[]): Vector3 | null {
  if (balls.length <= 1) return null
  const c = new Vector3()
  let n = 0
  for (const b of balls) {
    if (b === cue) continue
    c.add(b.pos)
    n++
  }
  if (n === 0) return null
  c.multiplyScalar(1 / n)
  return c
}

/**
 * from→to 直线是否被其它球遮挡（点到线段距离 < 2R 视为挡）。
 *
 * v1.3.65：excludes 改为变参 —— 调用方必须把线段两端的球都排除（母球、目标球），
 * 否则起点重叠距离为 0 必误判。障碍物集合一律传全桌球（见 enumeratePlans 注释）。
 */
function lineBlocked(
  from: Vector3,
  to: Vector3,
  balls: Ball[],
  ...excludes: Ball[]
): boolean {
  const dir = to.clone().sub(from)
  const len = dir.length()
  if (len < 1e-4) return false
  dir.multiplyScalar(1 / len)
  for (const b of balls) {
    if (excludes.indexOf(b) !== -1) continue
    const w = b.pos.clone().sub(from)
    const t = Math.max(0, Math.min(len, w.dot(dir)))
    const proj = from.clone().add(dir.clone().multiplyScalar(t))
    if (proj.distanceTo(b.pos) < 2 * R) return true
  }
  return false
}

/**
 * v1.3.66：线段 a→b 到点 p 的最近距离（XY 平面，z 恒为 0）。
 * 用于「路径级防摔袋」——把母球轨迹近似成 cuePos→stop 一段，求它到各袋口
 * 的最近距离，比只看停位点更准。
 */
function segDistToPoint(a: Vector3, b: Vector3, p: Vector3): number {
  const abx = b.x - a.x
  const aby = b.y - a.y
  const len2 = abx * abx + aby * aby
  let t = len2 > 1e-9 ? ((p.x - a.x) * abx + (p.y - a.y) * aby) / len2 : 0
  t = Math.max(0, Math.min(1, t))
  const cx = a.x + t * abx
  const cy = a.y + t * aby
  return Math.hypot(p.x - cx, p.y - cy)
}

/**
 * v1.3.66：从候选球里挑「母球→该球」视线最不被遮挡的一颗。
 * 返回让母球首撞点离其他球最远的那颗（lineClarity 越大越畅通），
 * 用于「没有任何球视线完全畅通」时的安全球兜底，降低首撞错球犯规。
 */
function clearestBall(
  from: Vector3,
  balls: Ball[],
  allBalls: Ball[],
  cue: Ball
): Ball | undefined {
  let best: Ball | undefined
  let bestC = -Infinity
  for (const b of balls) {
    const c = lineClarity(from, b.pos, allBalls, cue, b)
    if (c > bestC) {
      bestC = c
      best = b
    }
  }
  return best
}

/** 母球→目标 视线被其他球遮挡的最近距离（越大越畅通）；复用 lineBlocked 的几何 */
function lineClarity(
  from: Vector3,
  to: Vector3,
  balls: Ball[],
  ...excludes: Ball[]
): number {
  const dir = to.clone().sub(from)
  const len = dir.length()
  if (len < 1e-4) return 0
  dir.multiplyScalar(1 / len)
  let minD = Infinity
  for (const b of balls) {
    if (excludes.indexOf(b) !== -1) continue
    const w = b.pos.clone().sub(from)
    const t = Math.max(0, Math.min(len, w.dot(dir)))
    const proj = from.clone().add(dir.clone().multiplyScalar(t))
    const d = proj.distanceTo(b.pos)
    if (d < minD) minD = d
  }
  return minD
}

/**
 * 母球停位估算。
 *
 * 旧版 travel 写死 `min(6R, 母球→目标距离 ×1.5 + R)`，完全不区分厚薄 ——
 * 可直球时母球动量几乎全部传给目标球、会停在撞击点附近，而薄切时母球带走
 * 大部分速度、会跑很远。用「1 - cutCos」作为厚薄因子修正后，防摔袋与走位
 * 评分才真的靠谱，这也是「母球控制要精确」的地基。
 */
function estimateStop(
  cuePos: Vector3,
  targetPos: Vector3,
  pocket: Vector3,
  cutCos: number,
  cueToBall: number
): Vector3 {
  const toPocket = pocket.clone().sub(targetPos).normalize()
  const ghost = targetPos.clone().addScaledVector(toPocket, -2 * R)
  const tangent = AimCalculator.getTangentVector(cuePos, targetPos, ghost)
  const thin = 1 - Math.max(0, cutCos) // 0=直球，1=极薄
  const travel = Math.min(8 * R, (cueToBall * 1.1 + R) * (0.25 + 0.9 * thin))
  return cuePos.clone().addScaledVector(tangent, travel)
}

/** 停位贴库程度：离库边越近越接近 1（4R 以内开始计入） */
function railHug(pos: Vector3): number {
  const dist = Math.min(
    TableGeometry.X - Math.abs(pos.x),
    TableGeometry.Y - Math.abs(pos.y)
  )
  return Math.max(0, 1 - dist / (4 * R))
}
