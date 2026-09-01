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

/** 一个候选打法：目标球 + 袋口 + 各项几何评估 */
interface Plan {
  ball: Ball
  pocket: Vector3
  /** 余弦切球角（越大越正，越易进） */
  cutCos: number
  /** 母球→目标→袋 的总距离 */
  cuePocketDist: number
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
  readonly name = "Professional"

  /** 母球停位到袋口小于该距离即视为有摔袋风险 */
  private static readonly SCRATCH_SAFE = 1.6 * R

  constructor(profile: DifficultyProfile = DIFFICULTY.Professional) {
    super(profile)
  }

  /** 出杆主入口：返回 [备选瞄准, 主瞄准, 实际出杆]，最后一个才是真打出去的。 */
  aim(context: BotShotContext, calculator: AimCalculator): GameEvent[] {
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
      this.profile.minCutCos
    )
    if (plans.length === 0) {
      // 没有任何几何上可进的球
      return this.safetyOrFallback(context, calculator, cue, balls)
    }

    const best = this.rankPlans(plans)
    const power = this.choosePower(best)
    const spin = this.chooseSpin(best)

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

    return [
      AimEvent.fromJson(farKnuckleHit.tablejson.aim),
      AimEvent.fromJson(pocketHit.tablejson.aim),
      pocketHit,
    ]
  }

  /**
   * 从候选中挑最好的一个。优先级：不摔袋 > 切球角正 > 走位好 > 不贴库 > 距离近。
   * 走位相关的两项只在 positionPlay 打开时生效（仅专业档）。
   */
  private rankPlans(plans: Plan[]): Plan {
    const p = this.profile
    const sorted = plans.slice().sort((a, b) => {
      if (p.avoidScratch) {
        const safeA = a.scratchRisk > Professional.SCRATCH_SAFE ? 0 : 1
        const safeB = b.scratchRisk > Professional.SCRATCH_SAFE ? 0 : 1
        if (safeA !== safeB) return safeA - safeB
      }
      if (b.cutCos !== a.cutCos) return b.cutCos - a.cutCos
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
   * 力度自适应：近距小力、远距大力；薄球收力（薄切时母球带走大部分速度，
   * 再给大力极易失控）；有摔袋风险时强制收力，减小母球穿透。
   */
  private choosePower(best: Plan): number {
    if (!this.profile.adaptivePower) return AimCalculator.DEFAULT_SHOT_POWER
    let power = AimCalculator.DEFAULT_SHOT_POWER
    if (best.cuePocketDist < 1.2) power = 55 * R
    else if (best.cuePocketDist < 2.2) power = 80 * R
    else if (best.cuePocketDist < 3.5) power = 100 * R
    else power = AimCalculator.MAX_SHOT_POWER
    // 薄球：切球角余弦 < 0.5（约 60° 以上）时收 15%
    if (best.cutCos < 0.5) power *= 0.85
    if (
      this.profile.avoidScratch &&
      best.scratchRisk < Professional.SCRATCH_SAFE
    ) {
      power = Math.min(power, 70 * R)
    }
    return power
  }

  /**
   * v1.3.58 母球控制：用高低杆主动决定母球撞完目标球后走多远。
   * offset.y > 0 为高杆（跟进、走得远），< 0 为低杆（缩杆、走得近）。
   * 判断依据是本杆的估算停位与「剩余球群中心」的关系：
   * 停位离球群还远就跟进，已经够近或过头就收住，有摔袋风险则直接拉回来。
   */
  private chooseSpin(best: Plan): Vector3 {
    if (!this.profile.useSpin) return new Vector3(0, 0, 0)
    const spin = new Vector3(0, 0, 0)
    // 有摔袋风险：低杆把母球拉住，优先级最高
    if (best.scratchRisk < Professional.SCRATCH_SAFE) {
      spin.y = -0.35
      return spin
    }
    if (this.profile.positionPlay) {
      if (best.stopToNext > 6 * R) spin.y = 0.3
      else if (best.stopToNext < 2 * R) spin.y = -0.15
    }
    // 薄球母球天然跑得远，用低杆压一下，避免走位过头
    if (best.cutCos < 0.45) spin.y = Math.min(spin.y, -0.2)
    return spin
  }

  /**
   * 无球可进时的处理。
   * - 安全球（专业档）：在所有合法目标球里挑「碰完之后母球离对手球最远」的
   *   那颗，把难题丢回去。力度沿用默认力度，保证球有足够动能碰库，不会因为
   *   轻碰未碰库而白白犯规送自由球。
   * - 其余档位：退化为稳健的「碰最近的一颗」，只求不空杆犯规。
   */
  private safetyOrFallback(
    context: BotShotContext,
    calculator: AimCalculator,
    cue: Ball,
    balls: Ball[]
  ): GameEvent[] {
    const p = this.profile
    const fallback = Respot.closest(cue, balls)
    if (!fallback) return super.aim(context, calculator)

    let target = fallback
    if (p.safetyPlay) {
      const mine = new Set<Ball>(balls)
      const theirs = context.table.balls.filter(
        (b) => b !== cue && b.onTable() && !mine.has(b)
      )
      if (theirs.length > 0) {
        let bestD = -Infinity
        for (const ball of balls) {
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
    }

    const aimPoint = calculator.getAimPoint(cue.pos, target.pos)
    const hit = calculator.generateShot(
      context.table,
      p.aimNoise,
      jitterPower(AimCalculator.DEFAULT_SHOT_POWER, p.powerJitter),
      aimPoint,
      new Vector3(0, 0, 0)
    )
    return [AimEvent.fromJson(hit.tablejson.aim), hit]
  }
}

/**
 * 枚举所有「目标球 × 袋口」组合，计算几何可行性与走位评分。
 * 剔除视线被挡与切球角过薄（cutCos <= minCutCos）的组合。
 */
function enumeratePlans(
  cue: Ball,
  balls: Ball[],
  pockets: Vector3[],
  minCutCos: number
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

      // 视线遮挡：母球→目标 直线是否被其它球挡
      if (lineBlocked(cue.pos, ball.pos, balls, ball)) continue

      const cueToBall = cue.pos.distanceTo(ball.pos)
      const ballToPocket = ball.pos.distanceTo(pocket)
      const stop = estimateStop(
        cue.pos,
        ball.pos,
        pocket,
        cutCos,
        cueToBall
      )

      let min = Infinity
      for (const p of pockets) {
        const d = stop.distanceTo(p)
        if (d < min) min = d
      }

      plans.push({
        ball,
        pocket,
        cutCos,
        cuePocketDist: cueToBall + ballToPocket,
        stop,
        scratchRisk: min,
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

/** 母球→目标 直线是否被其它球遮挡（点到线段距离 < 2R 视为挡） */
function lineBlocked(
  from: Vector3,
  to: Vector3,
  balls: Ball[],
  target: Ball
): boolean {
  const dir = to.clone().sub(from)
  const len = dir.length()
  if (len < 1e-4) return false
  dir.multiplyScalar(1 / len)
  for (const b of balls) {
    if (b === target) continue
    const w = b.pos.clone().sub(from)
    const t = Math.max(0, Math.min(len, w.dot(dir)))
    const proj = from.clone().add(dir.clone().multiplyScalar(t))
    if (proj.distanceTo(b.pos) < 2 * R) return true
  }
  return false
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
