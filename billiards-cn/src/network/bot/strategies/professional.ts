import { Ball } from "../../../model/ball"
import { Respot } from "../../../utils/respot"
import { OutcomeType } from "../../../model/outcome"
import { AimCalculator } from "../aimcalculator"
import { BotShotContext } from "../botstrategy"
import { TheFarJaw } from "./thefarjaw"
import { Vector3 } from "three"
import { R, maxPower } from "../../../model/physics/constants"
import { TableGeometry } from "../../../view/tablegeometry"
import { AimEvent } from "../../../events/aimevent"
import { GameEvent } from "../../../events/gameevent"
import { DifficultyProfile, DIFFICULTY, jitterPower } from "../difficulty"
import { cueSpeedFor, POCKET_RADIUS_CORNER } from "../powerphysics"
import { cueIntersectsAnything } from "../../../utils/cueintersect"
import { Table } from "../../../model/table"
import { Cue } from "../../../view/cue"

// ── v1.3.91：专业级决策层（新增） ──
import {
  DecisionContext,
  buildDecisionContext,
} from "../decision/shotcontext"
import {
  OffenseCandidate,
  enumerateCandidates,
  pocketValue,
  refineStopsPhysics,
  remainingCenter,
} from "../decision/offense"
import { choosePowerTier } from "../decision/power"
import { installPhysicsHooks } from "../decision/physicshooks"
import { errorBudget } from "../decision/error"
import { evaluatePosition, positionPenalty } from "../decision/planner"
import { chooseSpin } from "../decision/spin"
import {
  reassessScratchPhysics,
  predictCueStop,
  predictsCushionContact,
  stopNearestPocket,
} from "../decision/trajectory"
import { planBreak, breakIsWorthwhile } from "../decision/breaker"
import {
  rankClearance,
  clearanceFactorOf,
} from "../decision/clearance"
import { BreakPlan } from "../decision/breaker"
import {
  DefensePlan,
  buildDefensePlans,
  desperatePlan,
} from "../decision/defense"

/**
 * v1.3.92：把「力度档选择」与「物理停位预测」注入到 offense 层。
 *
 * offense.ts 是最底层模块，不能反向 import power.ts / trajectory.ts
 * （会形成循环依赖：webpack 下表现为拿到半初始化的空对象，运行时才炸）。
 * 因此由本模块在加载时注册真实实现，offense.refineStopsPhysics() 通过
 * 这两个钩子完成「用该候选真正会用的力度跑真实物理」。
 *
 * 注册内容刻意与正式出杆路径**完全同源**：
 *   · 力度  → choosePowerTier()（与 aim() 主路径同一个函数）
 *   · 停位  → predictCueStop()（误差实测 0.000R）
 * 这样才能保证「预测的那一杆」就是「要打的那一杆」。
 */
// v1.3.93：钩子注册已移到 decision/physicshooks.ts 统一处理。
//
// 原先写在这里会形成**加载顺序依赖** —— 只有本模块被求值后钩子才就绪，
// 否则 refineStopsPhysics 静默退回几何近似（停位误差中位 31.4R ≈ 1 米）。
// 集中到 physicshooks 模块后，import 即安装，与谁先加载无关。
installPhysicsHooks()

/**
 * v1.3.95：strict 模式（真 cue→ghost 切角口径）的切球角下限余弦。
 *
 * 判据换了参考向量后，同一条线路的 cutCos 会**系统性变小**（详见
 * `offense.ts` 注释：L=10R 时球心夹角 0.34 对应的真实值仅 ≈0.147）。
 * 若继续沿用 profile 的旧阈值 0.34，绝大多数本来能打的薄球会被误杀。
 */
const STRICT_MIN_CUT_COS = 0.25



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



export class Professional extends TheFarJaw {
  override readonly name = "Professional"

  /** 母球停位到袋口小于该距离即视为有摔袋风险（v1.3.91 提到 2.0R） */
  private static readonly SCRATCH_SAFE = 2.0 * R

  /**
   * v1.3.91：摔袋收力的力度上限 —— 小力档上界。
   * 母球轨迹明显贴袋时，即使进攻球也压到小力，把母球控制住。
   */
  private static readonly SCRATCH_POWER_CAP = 41 * R

  /**
   * v1.4.2：「击球后无球碰库」合法化闸门的加力阶梯。
   *
   * 规则（八球/九球第 3 条）：本杆无球落袋时，首撞之后必须有球碰到库边，
   * 否则直接犯规送对手自由球。AI 在两类杆上最容易踩：
   *   · 小力进攻（touch 档）—— 没进袋时物体球往往停在袋口途中；
   *   · 防守/轻推 —— 力度本就被刻意压低。
   * 实测基线（tools/harness/foulaudit.ts，120 局 / 1242 杆）：
   * 「击球后无球碰库」31 次 = **2.50%/杆**，占全部犯规的 22%。
   *
   * 这里不复算「理论上该用多大力」，而是**跑真实物理**验「真正要打出去的
   * 那一杆」（含已加噪声的角度/力度/杆法）：不合法就按阶梯加力重打，
   * 直到预测显示有球落袋或首撞后有球碰库。
   *
   * 阶梯刻意取小步（1.18 / 1.4 / 1.7）：加力会改变走位与摔袋风险，
   * 一次跳太大等于把「防犯规」变成「乱打」。
   */
  public static readonly LEGAL_POWER_MULTS = [1, 1.18, 1.4, 1.7]

  /**
   * v1.4.2：最近一次决策里合法性闸门最终采用的加力系数（1 = 未加力）。
   * 供 harness 统计闸门触发频率与幅度（见 tools/harness/foulaudit.ts）。
   */
  public lastLegalMul = 1

  /**
   * v1.3.91：最近一次决策的上下文快照。
   * 公开只读，供 harness 观察 AI 的局势判断（对手威胁、压力、贴球状态等），
   * 也便于在游戏内调试面板展示 AI 的思路。
   */
  public lastDecision: DecisionContext | null = null

  /**
   * v1.3.91：最近一次决策里「选中候选」的**预测母球停位**。
   * 公开只读，供 harness 度量 `estimateStop()` 的预测精度 ——
   * 多步走位规划的可信度完全取决于这个预测准不准。
   */
  public lastPredictedStop: Vector3 | null = null

  /**
   * v1.3.91：最近一次防守采用的方案类型（进攻杆为 null）。
   * 供 harness 统计三种防守方案的选用分布（见 tools/harness/safetycheck.ts）。
   */
  public lastDefenseKind: string | null = null

  /**
   * v1.4.6：最近一杆的出杆路径标记（诊断用，如 "attack" / "def:snooker" /
   * "defKick" / "safety" / "super"）。供 harness 定位犯规样本的来源路径。
   */
  public lastShotPath: string | null = null

  /**
   * v1.3.91 阶段4：最近一次采用的炸球方案（非炸球杆为 null）。
   * 供 harness 统计炸球选用率与收益/风险分布。
   */
  public lastBreakPlan: BreakPlan | null = null

  constructor(profile: DifficultyProfile = DIFFICULTY.Professional) {
    super(profile)
  }

  /**
   * 出杆主入口（保证有输出）。
   *
   * v1.3.92：这里包了一层「**永远不返回空数组**」的硬保证。
   *
   * 背景：`aimInternal()` 有 7 条 return 路径，任何一条走到尽头都可能
   * 返回 `[]`（无候选 → 防守无解 → 认命无解）。对局级实测
   * （tools/harness/_diagmatch.ts）里它的表现是「【决策返回空】卡死」：
   * AI 已打进 6 颗球，却在最后一颗上**彻底不出杆**，整局吞掉。
   * 专业档卡死率 15.0% 基本全出自这里。
   *
   * 现在由外层兜底：内层若给不出方案，就用最保守但**一定合法**的一杆收尾
   * ——「瞄准最近的合法目标球轻推」，保证碰到球、不空杆。（用户在真实对局里
   * 看到的将是 AI 很少见地打出一记很轻的保底球，而不是僵住不出手。）
   */
  override aim(context: BotShotContext, calculator: AimCalculator): GameEvent[] {
    this.lastDefenseKind = null
    this.lastShotPath = "attack"
    this.lastPredictedStop = null
    this.lastBreakPlan = null

    let out: GameEvent[] = []
    try {
      out = this.aimInternal(context, calculator)
    } catch {
      out = []
    }
    if (out.length > 0) return out

    // 兜底：最近合法目标球轻推（一定合法，绝不空杆）
    try {
      const fallback = this.safetyOrFallback(
        context,
        calculator,
        context.cueBall,
        context.validTargetBalls
      )
      if (fallback.length > 0) return fallback
    } catch {
      /* 落到父类 */
    }
    return super.aim(context, calculator)
  }

  /**
   * 真正的决策主体。可能返回空数组，由 `aim()` 统一兜底 ——
   * 因此内部不必在每个分支都小心处理「无解」，代码路径得以清晰。
   */
  private aimInternal(
    context: BotShotContext,
    calculator: AimCalculator
  ): GameEvent[] {
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

    // v1.3.91：构造决策上下文（职业选手视角的完整局势快照）
    const dctx = buildDecisionContext(context, this.profile, calculator, {
      ruleName: (context.ruleName as string) ?? "eightball",
      opponentBalls: context.opponentBalls,
      onEightBall: context.onEightBall,
      isBreak: context.isBreak,
      potStreak: context.potStreak,
    })
    this.lastDecision = dctx

    // v1.3.91 ①：安全风险评估（最高优先级）。
    // 若对手手握高收益进攻机会，则不强行挑战自己的高难度球，改打防守。
    const threat = this.profile.useDefense
      ? this.opponentThreat(dctx)
      : 0

    // v1.3.91 ⓪（阶段4）：开球/炸球评估。
    // 开球杆与球堆局面不能走常规进攻枚举 —— 枚举会把「球堆里最靠外那颗
    // 能薄进袋」当成最优解，于是 AI 只擦掉堆边一颗球，把堆原封不动留给
    // 对手。这里先做炸球收益/风险量化：收益够高（score > 0.15）且摔袋
    // 风险可控时，用炸球方案直接出杆；否则落回常规枚举（例如球已散开）。
    if (this.profile.useBreakEval && dctx.isBreak) {
      const breakPlan = planBreak(dctx)
      if (breakPlan && breakIsWorthwhile(breakPlan)) {
        const bBudget = errorBudget(dctx, 0.35, "break", false)
        const bHit = calculator.generateShot(
          context.table,
          bBudget.aimNoise,
          jitterPower(breakPlan.power, bBudget.powerJitter),
          breakPlan.aimPoint,
          new Vector3(0, 0, 0)
        )
        this.lastBreakPlan = breakPlan
        this.lastShotPath = "break"
        return [AimEvent.fromJson(bHit.tablejson.aim), bHit]
      }
    }

    // v1.3.95：先按「物理可行性硬否决」枚举（ghost 可达 + 贴库进口角），
    // 这是修复「中袋最近就打、哪怕根本瞄不了」的主过滤。
    //
    // 开关见 difficulty.ts 的同名字段：这道闸门是有代价的
    // （AI 转向一库解球 → 失手即犯规），必须用 `--nostrict` 对照反复确认
    // 它是正收益，否则宁可关掉。
    const strictVeto = this.profile.strictCandidateVeto === true
    let candidates = enumerateCandidates(
      dctx,
      this.candidateMinCutCos(dctx, strictVeto),
      { strict: strictVeto }
    )
    if (strictVeto && candidates.length === 0) {
      // 降级：硬否决把候选全否掉时，回到 v1.3.94 的宽松口径。
      // 并对这批候选抬高难度到阈值之上，让上层 tooHard 闸门自然倾向防守
      // —— 既保住「永远有候选可打」（不出现无候选 → 争端/超时），
      // 又不会让 AI 真的去打那些不可行的路线。
      // v1.3.95：降级 = **回到旧口径**（同源阈值 + 球心夹角），
      // 而不是放宽标准 —— 放宽会放进极薄球，实测摔袋翻倍越过红线。
      candidates = enumerateCandidates(dctx, this.candidateMinCutCos(dctx))
      for (const c of candidates) {
        c.difficulty = Math.max(c.difficulty, this.offenseThreshold(dctx))
      }
    }
    if (candidates.length === 0) {
      // 没有任何几何上可进的球 → 直接进入防守决策
      return this.defend(context, calculator, dctx)
    }

    // v1.3.92（本版最重要的结构性修复）：把候选的停位从**几何近似**换成
    // **真实物理预测**。
    //
    // enumerateCandidates 里的 stop / scratchRisk / stopToNext / railHug 全部
    // 是用 estimateStop() 算的几何近似（误差中位 31.4R ≈ 1 米），而且力度
    // 一律按固定基准 62R 估算 —— 可 power.ts 的档位跨度是 21R(touch) ~
    // 159R(break)，**7.6 倍**。受控实验证明 predictCueStop() 的物理预测误差
    // 是 0.000R（119/119 完全一致），所以没有任何理由再用那个近似值。
    //
    // 必须在 rankPlans **之前**做：rankPlans 正是拿 stop / scratchRisk 来
    // 排序候选的，晚一步就等于没修。
    refineStopsPhysics(dctx, candidates, remainingCenter(dctx.targets))

    // v1.3.91 阶段4：先应用清台顺序（难点球优先、压舱石留后），
    // 再交给 rankPlans 决定这一杆的具体打法。
    //
    // ⚠️ 顺序不能反：applyClearanceOrder 是**乘性**修正项
    // （`offenseScore ← offenseScore × (0.75 + 0.25×priority)`），
    // 而 offenseScore 是在 rankPlans 里才算出来的。若在 rankPlans 之前调用，
    // 读到的 `offenseScore` 是 undefined → `?? 0` → 全体候选的分数被统一
    // 改成 0，排序彻底退化成「无偏好」，清台顺序完全失效（实测「难点球优先」
    // 选中率 0.0%，且死局数与纯贪心完全一致 0:0）。
    const best = this.rankPlans(candidates, dctx)
    this.applyClearanceOrder(candidates, dctx)
    const threshold = this.offenseThreshold(dctx)

    // v1.3.91 ②：进攻可行性评估。
    // 难度超阈值 → 放弃进攻转防守（不自不量力地搏球送机会）。
    // 同时若对手威胁过大（threat > 0.45）且本杆本身也不轻松，同样优先防守。
    const tooHard = best.difficulty > threshold
    const respectOpponent = threat > 0.45 && best.difficulty > threshold - 0.12
    if (tooHard || respectOpponent) {
      const defense = this.defend(context, calculator, dctx)
      // 防守有解就用防守；实在无解（全局被锁死）才硬着头皮打原计划
      if (defense.length > 0) return defense
    }

    // v1.3.91 ③：多步走位规划（预判后续 2~3 颗球的衔接）
    const position = evaluatePosition(dctx, best, this.profile.lookaheadDepth ?? 0)
    const spinChoice = chooseSpin(dctx, best, position)
    const powerChoice = choosePowerTier(
      dctx,
      best,
      position,
      spinChoice.spin
    )

    // v1.3.92：对外发布的「AI 预测停位」必须是**真实物理**结果。
    //
    // 旧代码这里是 `this.lastPredictedStop = best.stop.clone()` ——
    // 而 `best.stop` 是枚举阶段的几何近似（误差中位 31.4R）。
    // 也就是说 AI 一边用物理预测做内部走位规划（evaluatePosition 内部走
    // predictCueStop，误差 0.000R），一边给外部一个 31R 偏差的停位数字。
    // 这是「预测与执行分叉」最直接的体现，也让所有 harness 的停位精度
    // 度量长期失真。
    //
    // 现在统一用**最终确定的力度与杆法**跑一次真实物理，作为唯一权威的
    // 停位预测（下方摔袋复核复用同一个结果，不重复计算）。
    let predictedStop = predictCueStop(
      dctx,
      best,
      spinChoice.isJump
        ? powerChoice.power / Math.cos(spinChoice.elevation)
        : powerChoice.power,
      spinChoice.spin
    )
    this.lastPredictedStop = predictedStop

    // v1.3.91 ⑤：误差按难度动态缩放（简单球近乎必进，难球会打丢）
    const budget = errorBudget(
      dctx,
      best.difficulty,
      powerChoice.tier,
      spinChoice.isJump
    )

    // v1.3.92 修复：**侧旋必须塞得进去**。
    //
    // `generateShot()` 末尾有一道静默改写：
    //     if (cue.intersectsAnything(table, aim)) aim.offset.x = 0
    // 其几何是「从 `母球球心 + spinOffset` 沿出杆反方向发一条射线」，而
    // `spinOffset.x` 正比于 `aim.offset.x` —— 也就是说**侧旋越大，射线起点
    // 偏得越远，越容易打到旁边的球**（往往是目标球自己）。一旦相交，
    // AI 精心规划的侧旋被无声抹掉，于是「预测的那一杆」≠「打出去的那一杆」。
    //
    // 实测（tools/harness/_diagtrace.ts）：执行参数里 `offset.x` **恒为 0.00**，
    // 而 `spin.ts` 明明在 `useSideSpin` 分支里认真算了侧旋 —— 白算。
    //
    // 这里在出杆**之前**用与 generateShot 完全相同的判据预检：
    // 塞得进去就保留，塞不进去就诚实地归零（并让预测也基于归零后的杆法）。
    // 宁可不用侧旋，也不能让规划与执行分叉。
    if (spinChoice.spin.x !== 0) {
      const fits = this.cueFitsSideSpin(
        context,
        calculator,
        cue,
        best,
        spinChoice.spin
      )
      if (!fits) {
        spinChoice.spin.x = 0
      }
    }

    // 扎杆需要补偿 cos(elevation) 的平动损失（牺牲速度换旋转）
    let finalPower = spinChoice.isJump
      ? powerChoice.power / Math.cos(spinChoice.elevation)
      : powerChoice.power

    // v1.3.91 ②·续：用**实际力度**复核摔袋风险并做最后收力。
    //
    // 枚举候选时力度还没定（且力度又依赖停位评估，存在循环依赖），所以
    // scratchRisk 是用中力基准估的。力度整体抬到中力后母球跑得远得多，
    // 这里用真实力度复核一次：若重算后的轨迹明显比预估更贴袋，就把力度
    // 压到「够进袋的最低值」并改用低杆收母球 —— 既不摔袋，也不丢球权。
    //
    // ⚠️ v1.3.91 二轮修正（本版最重要的防守修复）——
    // 首版这里调的是 `reassessScratch()`，它内部用 `estimateStop()` 做
    // **几何近似**停位。但阶段2 实测该近似**误差中位数 32R（约 1 米）**，
    // 正是这个误差让走位前瞻在阶段2被整体切到 `predictCueStop()`（真实物理）。
    // 唯独摔袋防护漏改了，于是形成致命矛盾：
    //   实测（tools/harness/_scratchdiag.ts，299 样本）
    //     几何判据说「安全」的杆里，**6.7% 物理上实际会摔袋**；
    //     两法停位误差中位 32.3R / 均值 33.4R / 最大 85.9R。
    //   也就是「摔袋防护」判据本身几乎不感知真实风险 —— 对局级实测
    //   专业档摔袋率高达 61.4%/杆，反而比稳健档（49.1%）更差。
    //
    // 现在改为**真实物理预测**：pocketReady 的力度/杆法跑一遍完整模拟，
    // 看母球究竟停在哪、有没有落袋。预测返回 null 即代表母球进袋。
    if (this.profile.avoidScratch && !spinChoice.isJump) {
      const re = reassessScratchPhysics(
        dctx,
        best,
        finalPower,
        spinChoice.spin
      )
      if (re.wouldScratch || re.scratchRisk < Professional.SCRATCH_SAFE) {
        // 物理预测确认会摔袋（或停位明显贴袋）：改用「低杆 + 收力」拉住母球。
        //
        // ⚠️ 力度下限必须是 `powerChoice.required`（物理反解出的「进袋所需
        // 最小速度」），**不能自己拍一个更小的数**。首版写成
        // `Math.max(powerChoice.required, 26*R)` 看似安全，实际当 required
        // 很小（近台直球）时会把力度压到 26R —— 物体球勉强滚到袋口、母球
        // 被低杆刹停，两球都够不到库 → 触发「击球后无球碰库」犯规。
        // 对局级实测（botmatch）犯规率因此从 28.2% 暴涨到 54.1%。
        // power.ts 的注释早就写明了这条纪律：「所有收力都不低于 required，
        // 保证球仍能滚到袋口、不犯无球碰库」。
        const cappedSpin = new Vector3(0, -0.45, 0)
        // v1.4.1：杆法改成 −0.45 极限低杆后，「进袋下限」必须按**新杆法**
        // 重新反解，不能沿用 powerChoice.required —— 那是按原杆法反解的值。
        // 低杆的母球滚动效率远低于中/高杆（fSpin：−0.45→0.453，
        // 0→0.714，+0.26→0.865），同样的出杆速度传给物体球的有效速度只剩
        // 52%（原高杆）~63%（原中杆）。沿用旧下限 = 实际力度短缺 13%~34%，
        // 物体球停在袋口前 —— 用户实测「AI 明明瞄准了但力度不够」的根因。
        const requiredDraw = cueSpeedFor(
          best.cueToBall,
          best.ballToPocketTrue + 2 * best.pocketRadius,
          best.pocketRadius,
          best.cutCos,
          cappedSpin.y,
          cappedSpin.length(),
          1.2
        )
        const capped = Math.max(requiredDraw, Professional.SCRATCH_POWER_CAP)
        const re2 = reassessScratchPhysics(dctx, best, capped, cappedSpin)
        // 收力 + 低杆仍摔袋 → 这条线本身就危险。此时**不继续硬压力度**
        // （那只会换来无碰库犯规），而是保留 required 级别的力度、改用
        // 最低杆法尽量把母球留在库边附近停住，让「撞库」由物体球完成。
        // v1.4.1：下限同步改为 requiredDraw（按 −0.45 低杆反解），理由同上。
        finalPower = re2.wouldScratch
          ? Math.max(requiredDraw, requiredDraw * 1.15)
          : capped
        spinChoice.spin.y = -0.45
        spinChoice.spin.x = 0
      }
    }

    const aimPoint = calculator.getAimPoint(cue.pos, best.ball.pos, [best.pocket])
    // v1.4.2：力度**只抖一次**并定死，后面主线路 / 远袋角预览 / 直击兜底
    // 全部共用它 —— 此前每个 generateShot 各抖一次，预览与实际其实是两杆
    // 不同力度的球；现在同力度，且合法性闸门验的就是真正打出去的那一杆。
    const shotPower = jitterPower(finalPower, budget.powerJitter)
    const pocketPlan = this.legalShot(
      dctx,
      (p) =>
        calculator.generateShot(
          context.table,
          budget.aimNoise,
          p,
          aimPoint,
          spinChoice.spin,
          spinChoice.elevation,
          budget.elevationNoise
        ),
      shotPower
    )
    const pocketHit = pocketPlan.hit

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
    // 远袋角是纯预览（不出杆），直接用已定死并已过闸门的力度
    const farKnuckleHit = calculator.generateShot(
      context.table,
      budget.aimNoise,
      pocketPlan.power,
      farKnuckleAimPoint,
      spinChoice.spin,
      spinChoice.elevation,
      budget.elevationNoise
    )

    // v1.4.6 修复⑤：主进攻最终闸门升级为**克隆台物理首撞验证**。
    //
    // 历史：v1.3.75~v1.4.2 这里是两层几何闸门（实际角垂距射线检测 +
    // firstContactAlong 首撞合法性），v1.4.6 修复①又加了「含噪可连性」。
    // 但对局级实测（botmatch 逐杆 pred=act 对照 + 犯规样本分析）证明：
    // 几何射线与真实物理之间仍有缝 —— 射线不考虑母球行进中的旋转弧线、
    // 次序碰撞与库边反弹，残留的「首撞非目标」犯规（含连续多杆犯规的
    // 死循环局面）全部来自这条缝；修复①~④落地后 kick/defend/兜底三条
    // 路径已全部物理自验，唯独主进攻还停留在几何判定。
    //
    // 而 probeFirstHitLabel（kick 自验引入的克隆台物理预测）经逐杆对照
    // **与真实物理零失真**（20 局全部 pred=act）。因此最终闸门统一为：
    // 把**实际含噪出杆参数**原样放到克隆台跑一遍物理，首撞必须是合法
    // 目标（本方球）；空杆 / 首撞犯规 / 物理异常 → 改直击目标球心
    // （同样物理验证），直击也不行才整体转防守/解球。
    // 每杆多花至多两次克隆台模拟（毫秒级），换「AI 打出去的每一杆都
    // 经过真实物理背书」—— 消除空杆/误撞低级错误的最后一块拼图。
    let finalHit = pocketHit
    const legalTargets = new Set<Ball>(balls)
    const verifyPhysically = (h: {
      tablejson?: { aim?: unknown }
    }): boolean => {
      const aj = (h.tablejson as { aim?: unknown } | undefined)?.aim
      if (!aj) return false // 拿不到出杆参数 → 无从验证，不放行
      const lbl = this.probeFirstHitLabel(context, AimEvent.fromJson(aj))
      if (lbl === null) return false // 母球零接触（空杆）或物理异常
      const b = context.table.balls.find((x) => x.label === lbl)
      return !!b && legalTargets.has(b) // 首撞必须是本方球
    }
    if (!verifyPhysically(finalHit)) {
      const directHit = this.legalShot(
        dctx,
        (p) =>
          calculator.generateShot(
            context.table,
            budget.aimNoise,
            p,
            best.ball.pos.clone(),
            spinChoice.spin,
            spinChoice.elevation,
            budget.elevationNoise
          ),
        pocketPlan.power
      ).hit
      if (verifyPhysically(directHit)) {
        // 直击方向正对球心，物理验证通过才换线 —— 直击最多打厚进不去，
        // 绝不会空杆或误撞（v1.3.75 的本意，现在有了物理背书）
        finalHit = directHit
      } else {
        return this.fallbackDefense(context, calculator, dctx, cue, balls)
      }
    }

    // v1.3.91 ⑫：思考节奏 —— 复杂度越高，插入越多瞄准预览（观感像真人在比选）。
    // 预览只加在 finalHit **之前**，不破坏 harness 的 `events.length <= 2` 兜底判定。
    const previews = this.tempoPreviews(dctx, best.difficulty, candidates.length)
    const out: GameEvent[] = [AimEvent.fromJson(farKnuckleHit.tablejson.aim)]
    for (let i = 1; i < previews; i++) {
      out.push(AimEvent.fromJson(pocketHit.tablejson.aim))
    }
    out.push(AimEvent.fromJson(finalHit.tablejson.aim))
    out.push(finalHit)
    return out
  }

  /**
   * v1.3.91：进攻中途被「最终闸门」拦下时的兜底。
   *
   * 主路径已经算好了进攻计划，但射线检测发现实际出杆角度会首撞犯规
   * （ghost 法在球堆挤压下偶尔给出打飞的方向）。此时不能硬打，也不能
   * 简单退回改造前的 safetyOrFallback —— 专业档应当走**同一套防守策略池**，
   * 才能享受到斯诺克/推远袋口这些真正的防守手段。
   *
   * 只有当防守策略池也完全无解（被彻底锁死）时，才退回老逻辑收尾。
   */
  private fallbackDefense(
    context: BotShotContext,
    calculator: AimCalculator,
    dctx: DecisionContext,
    cue: Ball,
    balls: Ball[]
  ): GameEvent[] {
    const defense = this.defend(context, calculator, dctx)
    if (defense.length > 0) return defense
    this.lastShotPath = "fbDef->safety"
    return this.safetyOrFallback(context, calculator, cue, balls)
  }

  /**
   * v1.3.91 ⑨：防守决策（专业级 AI 的核心 —— 防守策略池）。
   *
   * 用户明确要求「不给对手留有效进攻窗口」，并给出三种职业防守手段：
   *   ① 贴球防守（小力轻推，母球停在目标球旁）
   *   ② 母球藏障碍球后方做斯诺克
   *   ③ 将目标球推远离袋口（中力）
   *
   * 这里把它们交给 `decision/defense.ts` 统一生成，并**以「对手威胁值」
   * 为唯一裁判**挑出对手最难破解的那个 —— 这是与改造前最本质的区别：
   * 旧逻辑是「挑一颗球轻推过去」，新逻辑是「在所有战术里选对手最难受的」。
   *
   * 返回空数组表示确实无防守可言，调用方会退回原计划硬打。
   */
  /**
   * v1.4.2：出杆合法性闸门 —— 消除「击球后无球碰库」犯规。
   *
   * 用法：把「按力度生成出杆」这件事作为 `make` 传进来，本函数返回
   * **第一个预测合法**的那一份（连同它实际用的力度）。调用方拿到的
   * `hit` 就是要打出去的那一杆，不必再自己重算。
   *
   * 为什么必须验「生成后的 hit」而不是「计划力度」：
   * `generateShot()` 内部还会按仰角、杆法、遮挡做若干静默改写，
   * `finalPower` 只是输入值。只有把最终 `AimEvent` 原样跑一遍物理，
   * 看到的才是真正会发生的事（步长与 container.step 一致 → 确定性）。
   *
   * 预测不可用（物理异常 / 推进超限）时按原杆放行 —— 拿不到证据就
   * 不擅自加力，宁可交给上层其它闸门，也不把走位改坏。
   */
  private legalShot(
    dctx: DecisionContext,
    make: (power: number) => any,
    power: number
  ): { hit: any; power: number } {
    let hit = make(power)
    let used = power
    this.lastLegalMul = 1
    for (let i = 0; i < Professional.LEGAL_POWER_MULTS.length; i++) {
      const p = Math.min(maxPower, power * Professional.LEGAL_POWER_MULTS[i])
      if (i > 0) {
        hit = make(p)
        used = p
        this.lastLegalMul = Professional.LEGAL_POWER_MULTS[i]
      }
      const aimJson = (hit.tablejson as { aim?: unknown } | undefined)?.aim
      // 拿不到出杆参数 → 无从校验，放行
      if (!aimJson) return { hit, power: used }
      const ok = predictsCushionContact(dctx, AimEvent.fromJson(aimJson))
      if (ok === null || ok === true) return { hit, power: used }
      if (p >= maxPower) break
    }
    return { hit, power: used }
  }

  private defend(
    context: BotShotContext,
    calculator: AimCalculator,
    dctx: DecisionContext
  ): GameEvent[] {
    if (!this.profile.useDefense) {
      // 非专业档沿用改造前的安全球逻辑（行为不变）
      return this.safetyOrFallback(
        context,
        calculator,
        context.cueBall,
        context.validTargetBalls
      )
    }

    const plans = buildDefensePlans(dctx, calculator)
    // 斯诺克方案必须在**威胁确实更低**时才采用：把母球藏起来往往意味着
    // 这一杆本身更难打，收益不明显就不该冒这个险。
    let chosen: DefensePlan | null = plans.length > 0 ? plans[0] : null

    if (
      chosen &&
      chosen.kind === "snooker" &&
      chosen.opponentThreat > 0.3
    ) {
      // 藏了半天对手还是有好球，说明遮挡不彻底 → 退而求其次选非斯诺克方案
      const alt = plans.find((p) => p.kind !== "snooker")
      if (alt) chosen = alt
    }

    if (!chosen) {
      // 无正规防守方案可用：一库解球优先（体面且合法），最后才认命硬打
      const kick = this.tryKickShot(
        context,
        calculator,
        context.cueBall,
        context.validTargetBalls,
        context.table.balls.filter(
          (b) => b.onTable() && b !== context.cueBall
        )
      )
      if (kick) {
        this.lastShotPath = "defKick"
        return kick
      }
      const desperate = desperatePlan(dctx, calculator)
      if (!desperate) {
        // v1.3.92：**绝不能返回空数组**。
        //
        // 旧代码这里 `return []`，而 aim() 的多条路径会把它原样上传
        // （line 200 的「无候选→defend」、line 433/458 的 fallbackDefense）。
        // 对局级实测（tools/harness/_diagmatch.ts）里这直接表现为
        // 「【决策返回空】卡死」—— AI 打进 6 颗球后**彻底不出杆**，
        // 整局作废。专业档卡死率 15.0% 的主因就是这一行。
        //
        // 任何情况下 AI 都必须打出一杆：真无解时，最差也要「碰到最近的
        // 合法球」（保证不空杆犯规），这是安全的保底行为。
        return this.safetyOrFallback(
          context,
          calculator,
          context.cueBall,
          context.validTargetBalls
        )
      }
      chosen = desperate
    }

    const budget = errorBudget(dctx, 0.35, chosen.tier, false)
    // v1.4.2：防守杆是「无球碰库」犯规的重灾区 —— 力度本就被刻意压低，
    // 母球轻碰物体球后原地停住、物体球也滚不到库，两球都够不到库即犯规。
    // 走同一道闸门：不合法就按阶梯加力，直到预测显示有球落袋或有球碰库。
    const hit = this.legalShot(
      dctx,
      (p) =>
        calculator.generateShot(
          context.table,
          budget.aimNoise,
          p,
          chosen.aimPoint,
          chosen.spin
        ),
      jitterPower(chosen.power, budget.powerJitter)
    ).hit
    // v1.4.6：防守杆**空杆自验** —— legalShot 只保证「有球碰库」，母球
    // 打空后自己撞库也算它通过。snooker 藏球类方案的 aimPoint 刻意偏离
    // 球心、叠加噪声后完全可能整杆零接触（对局级实测残留空杆主要来源）。
    // 预测母球零接触 → 先零噪声重出同一方案；仍打空 → 退 safetyOrFallback
    // （它自带零噪声可达性自验，保证碰得到球）。
    // v1.4.6 修复⑥：自验收紧为「**首撞必须是本方球**」—— 只查非 null
    // 的话，首撞对方球照样放行（对局级实测 def:snooker/defRetry 残留的
    // 首撞非目标犯规）。重试与主杆用同一把尺子：物理首撞 ∈ 本方球。
    const legalDefTargets = new Set<Ball>(context.validTargetBalls)
    const defHitOk = (aimEv: AimEvent): boolean => {
      const lbl = this.probeFirstHitLabel(context, aimEv)
      if (lbl === null) return false
      const b = context.table.balls.find((x) => x.label === lbl)
      return !!b && legalDefTargets.has(b)
    }
    const defAim = AimEvent.fromJson(hit.tablejson.aim)
    if (!defHitOk(defAim)) {
      const retry = calculator.generateShot(
        context.table,
        0,
        jitterPower(chosen.power, budget.powerJitter),
        chosen.aimPoint,
        chosen.spin
      )
      if (defHitOk(AimEvent.fromJson(retry.tablejson.aim))) {
        this.lastShotPath = "defRetry"
        return [AimEvent.fromJson(retry.tablejson.aim), retry]
      }
      return this.safetyOrFallback(
        context,
        calculator,
        context.cueBall,
        context.validTargetBalls
      )
    }
    this.lastDefenseKind = chosen.kind
    this.lastShotPath = "def:" + chosen.kind
    return [defAim, hit]
  }

  /**
   * v1.3.92：出杆前预检「这个侧旋塞得进去吗」。
   *
   * 复用与 `Cue.intersectsAnything` 完全相同的几何（射线从
   * `母球球心 + spinOffset` 沿出杆反方向发出），只是**不触碰真实球台状态**：
   * 在临时克隆的桌上跑，避免污染比赛桌（决策必须只读）。
   *
   * 之所以要把 `offset.x` 兑现成位移再看：`spinOffset()` 里
   * `upCross(unitAtAngle(angle)) * (offset.x * R)` —— 侧旋在物理上就是
   * 把球杆整体挪到球的侧边，挪多了杆身自然会碰到别的球。
   * 这是**真实存在的物理约束**，不是可以忽略的实现细节。
   */
  private cueFitsSideSpin(
    context: BotShotContext,
    calculator: AimCalculator,
    cue: Ball,
    best: OffenseCandidate,
    spin: Vector3
  ): boolean {
    try {
      const probe = Object.create(
        Object.getPrototypeOf(context.table)
      ) as typeof context.table
      probe.cueball = cue
      probe.balls = context.table.balls
      probe.mesh = null
      const aimPoint = calculator.getAimPoint(cue.pos, best.ball.pos, [
        best.pocket,
      ])
      const angle = Math.atan2(
        aimPoint.y - cue.pos.y,
        aimPoint.x - cue.pos.x
      )
      // 与 cueIntersect 同源的 offset：见 Cue.spinOffset()
      const off = new Vector3(
        -Math.sin(angle) * spin.x * R,
        Math.cos(angle) * spin.x * R,
        spin.y * R
      )
      const probeAim = {
        angle,
        elevation: 0,
        pos: cue.pos,
        offset: spin,
      } as unknown as AimEvent
      return !cueIntersectsAnything(probe, probeAim, off)
    } catch {
      // 预检失败（球缺 mesh 等）→ 保守归零侧旋，宁可不用也不分叉
      return false
    }
  }

  /**
   * 从候选中挑最好的一个。
   *
   * v1.3.91：排序键从「纯切球角」升级为**综合收益**：
   *   offenseScore = (1 − 难度) × 袋口价值 × (1 − 0.5×走位惩罚) × 走位加成
   *
   * 关键修正（v1.3.91 二轮）：首版只把 `positionPenalty`（停位离球群的距离
   * 与贴库程度）当作惩罚项 —— 这是**几何启发式**，不是真正的走位评估。
   * 实测（tools/harness/botpos.ts --cluster）发现启用多步前瞻后
   * 「下一杆有球可打」反而从 89.9% 掉到 85.9%，因为前瞻算了却没用：
   * 昂贵的 `evaluatePosition()` 结果只喂给杆法选择，从未参与候选排序。
   *
   * 现在改为：**对排名前列的候选真正跑一遍前瞻**，用前瞻得到的走位质量
   * （下一杆是否还有球可打、容错区是否覆盖停位）直接参与排序。
   * 为了控制开销，只对「难度在最优值 +0.15 以内」的候选做前瞻 ——
   * 明显更难进的球不值得为走位买单。
   */
  private rankPlans(plans: OffenseCandidate[], dctx: DecisionContext): OffenseCandidate {
    const p = this.profile
    for (const c of plans) {
      const value = p.positionPlay ? pocketValue(c, dctx) : 1
      // 几何走位惩罚（廉价先验）：停位离球群越远、越贴库，下一杆越难
      const penalty = p.positionPlay ? positionPenalty(c) : 0
      // v1.3.91 阶段4：这里用的是**乘性赋值**（不是绝对赋值），
      // 因此会保留 `applyClearanceOrder` 已写入的清台顺序系数。重算
      // offenseScore 时若直接覆盖成绝对值，清台顺序会被整个抹掉。
      ;(c as OffenseCandidate & { offenseScore: number }).offenseScore =
        this.clearanceFactor(c) *
        (1 - c.difficulty) *
        value *
        (1 - 0.5 * penalty)
    }
    const score = (c: OffenseCandidate) =>
      (c as OffenseCandidate & { offenseScore?: number }).offenseScore ?? 0

    // 粗排一轮，找出值得做前瞻的候选
    const rough = plans.slice().sort((a, b) => score(b) - score(a))
    const best0 = rough[0]
    const depth = p.lookaheadDepth ?? 0
    if (p.positionPlay && depth > 0 && rough.length > 1) {
      const cutoff = best0.difficulty + 0.15
      for (const c of rough) {
        if (c.difficulty > cutoff) break
        // v1.3.91 二轮：走位前瞻必须建立在**物理预测的停位**上。
        // 几何近似的 estimateStop 误差中位数 31R（≈1 米），基于它做前瞻
        // 反而会让走位变差（实测「下一杆有球可打」从 89.9% 掉到 85.9%）。
        // 这里先把该候选的力度档算出来喂给物理预测（trajectory.ts），
        // 停位预测误差随即降到中位 1.07R，前瞻才真正有意义。
        const tier = choosePowerTier(dctx, c, {
          quality: 0.5,
          targetTravel: c.stop.distanceTo(c.ball.pos),
        }, new Vector3(0, 0, 0))
        const plan = evaluatePosition(dctx, c, depth, {
          power: tier.power,
          spin: new Vector3(0, 0, 0),
        })
        // 走位质量直接调制收益：质量 0.05（停死）→ 打 7 折；
        // 质量 1（随便打）→ 满额。这样「好进但走死」的球会被压下去。
        // 同样保留清台顺序系数（clearanceFactor）。
        ;(c as OffenseCandidate & { offenseScore: number }).offenseScore =
          this.clearanceFactor(c) * score(c) * (0.7 + 0.3 * plan.quality)
        ;(c as OffenseCandidate & { positionQuality: number }).positionQuality =
          plan.quality
      }
    }

    const sorted = rough.sort((a, b) => {
      // 防摔袋：把「母球轨迹明显会掠过袋口」的线路整体压后
      if (p.avoidScratch) {
        // v1.3.92：物理预测**确认**会摔袋的杆，无条件排到最后。
        // 这是确定性判定（predictCueStop 返回 null = 母球落袋），
        // 优先级高于下面基于 scratchRisk 阈值的启发式判断。
        const hardA = a.physicalScratch ? 1 : 0
        const hardB = b.physicalScratch ? 1 : 0
        if (hardA !== hardB) return hardA - hardB
        const riskyA = a.scratchRisk < 2.4 * R ? 1 : 0
        const riskyB = b.scratchRisk < 2.4 * R ? 1 : 0
        if (riskyA !== riskyB) return riskyA - riskyB
      }
      const sa = score(a)
      const sb = score(b)
      if (sb !== sa) return sb - sa
      return a.difficulty - b.difficulty
    })
    return sorted[0]
  }

  /**
   * v1.3.91 阶段4：把「全局清台顺序」并入候选排序。
   *
   * 与 `rankPlans` 的分工：`rankPlans` 决定**这一杆怎么打**（哪个袋口、
   * 什么杆法、走位质量如何）；这里决定**该不该先打这颗**。
   *
   * 用户规格要求「难点球优先、袋口球留后」。实现上不是让 AI 去搏难球，
   * 而是用 `clearanceFactorOf` 在**收益接近的候选之间**打破平局 ——
   * 难球的优先级加成让它在收益只差一点时排到前面，而明显进不了的球
   * 依然会被难度本身压下去（见 clearance.ts 的 tooRisky 判据）。
   *
   * 仅在专业档（`useClearanceOrder`）启用，其他档位行为完全不变。
   */
  private applyClearanceOrder(
    plans: OffenseCandidate[],
    dctx: DecisionContext
  ): OffenseCandidate[] {
    if (!this.profile.useClearanceOrder) return plans
    const order = rankClearance(plans, dctx)
    for (let i = 0; i < plans.length; i++) {
      const c = plans[i]
      const plan = order[i]
      if (!plan) continue
      // 存成**乘性系数**而不是改写比分：rankPlans 稍后会用自己的公式
      // 重算 offenseScore，绝对赋值会被它覆盖。存系数则万无一失。
      ;(
        c as OffenseCandidate & { clearanceFactor: number }
      ).clearanceFactor = clearanceFactorOf(c, plan)
      ;(c as OffenseCandidate & { clearancePriority: number }).clearancePriority =
        plan.priority
    }
    return plans
  }

  /** 读取候选的清台顺序系数（未应用清台顺序时视为 1，即不影响排序） */
  private clearanceFactor(c: OffenseCandidate): number {
    return (
      (c as OffenseCandidate & { clearanceFactor?: number }).clearanceFactor ?? 1
    )
  }

  /**
   * v1.3.91：本杆使用的切球角下限。
   * 贴球场景放宽（薄推进攻是职业选手处理贴球的常规手段），
   * 其余沿用档位配置。
   */
  private candidateMinCutCos(dctx: DecisionContext, strict = false): number {
    if (dctx.cueTouching && this.profile.useJump) {
      return Math.min(this.profile.minCutCos, 0.2)
    }
    // v1.3.95：见上方 STRICT_MIN_CUT_COS 注释。取与档位配置的较小值，
    // 保证更高难度档位原本更严的偏好不会被放宽。
    // non-strict 分支返回 profile 原值，配合 legacyCut 完全复刻旧行为。
    return strict
      ? Math.min(this.profile.minCutCos, STRICT_MIN_CUT_COS)
      : this.profile.minCutCos
  }

  /**
   * v1.3.91：进攻难度阈值。
   * 赛点压力下小幅上浮（更愿意搏难球，增加博弈张力）。
   */
  private offenseThreshold(dctx: DecisionContext): number {
    const base = this.profile.offenseThreshold ?? 0.72
    return base + 0.08 * dctx.pressure
  }

  /**
   * v1.3.91：思考节奏 —— 复杂度决定预览次数。
   * 复杂球型多比选几条线（观感上像真人在反复权衡），简单球一眼出杆。
   */
  private tempoPreviews(
    dctx: DecisionContext,
    difficulty: number,
    candidateCount: number
  ): number {
    if (!this.profile.useTempo) return 2 // 保持既有「2 条预览线」的默认观感
    const complexity = Math.min(
      1,
      0.4 * (dctx.targets.length / 7) + 0.35 * difficulty + 0.25 * (candidateCount > 4 ? 1 : 0.4)
    )
    if (complexity < 0.3) return 2
    if (complexity < 0.6) return 3
    return 4
  }




  /**
   * v1.3.91 ①：对手威胁评估 —— 把对手花色球代入候选枚举，
   * 看对手手握多少个「难度低于阈值」的进攻机会。
   * 威胁高说明这一杆必须打得保守，不能给对手留下简单球。
   */
  private opponentThreat(dctx: DecisionContext): number {
    if (dctx.opponentBalls.length === 0) return 0
    const oppCtx: DecisionContext = { ...dctx, targets: dctx.opponentBalls }
    const cands = enumerateCandidates(oppCtx, 0.2)
    if (cands.length === 0) return 0
    const easy = cands.filter(
      (c) => c.difficulty <= (this.profile.offenseThreshold ?? 0.72)
    )
    if (easy.length === 0) return 0
    const avgDifficulty =
      easy.reduce((s, c) => s + c.difficulty, 0) / easy.length
    // 机会越多、越容易 → 威胁越大；对手可直接清台时拉满
    let threat = Math.min(1, easy.length / 4) * (1 - avgDifficulty)
    if (easy.length >= dctx.opponentBalls.length) threat = Math.max(threat, 0.85)
    return Math.max(0, Math.min(1, threat))
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
   *
   * v1.3.77：畅通性检查改为沿**实际出杆方向**（ghost 瞄准点）。
   * 旧版查「母球→球心」直线，而真正打出去的是 ghost 方向 —— 大切角时两条
   * 线能差几十度，球心畅通不代表 ghost 路径畅通，实际出杆照样首撞对方球
   * （用户反馈「被别的花色球挡住时还是会坚决犯规」的主因）。
   * 全部直线被挡（snooker）时不再硬打 clearestBall，先试**一库解球**
   * （tryKickShot）：镜像法反弹后首撞本方球，合法且体面；一库也解不到
   * 的无解局才认命按「最畅通」硬打。
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
    const ghostAim = (b: Ball) => calculator.getAimPoint(cue.pos, b.pos)
    const open = balls.filter(
      (b) => !lineBlocked(cue.pos, ghostAim(b), allBalls, cue, b)
    )
    let pool: Ball[]
    if (open.length > 0) {
      pool = open
    } else {
      // v1.3.77：直线全被挡 → 一库解球优先，别再「坚决犯规」
      const kick = this.tryKickShot(
        context,
        calculator,
        cue,
        balls,
        allBalls
      )
      if (kick) {
        this.lastShotPath = "safeKick"
        return kick
      }
      const cb = clearestBall(cue.pos, balls, allBalls, cue, ghostAim)
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

    // v1.4.6 修复⑦：兜底出杆 = 「逐球 × 两档」全部过**克隆台物理首撞
    // 验证**，第一杆全绿的才打出去。
    //
    // 旧结构（v1.4.6 前五修）只验「含噪杆」，失败后**零噪声重出不再验**
    // —— 但 ghost 方向半挡/擦边（lineBlocked 阈值 2R 之外、probe 垂距
    // 2R 之内）时，零噪声杆照样首撞非目标甚至空杆；run6 实测的残留
    // 空杆（path=safety）正出自这条缝。现在对 pool 里每颗球
    // （safetyPlay 优选的 target 排最前）：
    //   ① 含噪出杆 → probe 首撞 === 该球 → 放行（拟人误差保留）；
    //   ② 失败 → 零噪声重出 → probe 再验 → 放行；
    //   ③ 仍失败 → 换下一颗球。
    // 「直线全挡 + kick 失败」的真无解局走认命模式（strict=false）：
    // probe 只保「绝不是空杆」（首撞 null 一律不放行）—— 首撞非目标
    // 犯规已不可避免，但守住「出杆必触球」的底线。
    const legalSet = new Set<Ball>(balls)
    const probeHitsTarget = (
      aimEv: AimEvent,
      t: Ball,
      strict: boolean
    ): boolean => {
      const lbl = this.probeFirstHitLabel(context, aimEv)
      if (lbl === null) return false // 空杆 / 物理异常：任何情况都不放行
      if (!strict) return true // 认命模式：碰到任何球都算守住底线
      return lbl === t.label
    }
    const makeShot = (t: Ball, noise: number, power: number) =>
      calculator.generateShot(
        context.table,
        noise,
        power,
        calculator.getAimPoint(cue.pos, t.pos),
        new Vector3(0, 0, 0)
      )

    // 候选顺序：safetyPlay 优选的 target 最先（保住安全球意图），其余按
    // 与母球的距离由近及远（近球 probe 通过率高、浪费的模拟少）
    const ordered = [
      target,
      ...pool
        .filter((b) => b !== target)
        .sort(
          (a, b) => cue.pos.distanceTo(a.pos) - cue.pos.distanceTo(b.pos)
        ),
    ]
    const desperate = open.length === 0 // 真无解 → 认命模式
    const basePower = powerOverride ?? AimCalculator.DEFAULT_SHOT_POWER
    let chosenShot: { hit: any; ball: Ball } | null = null
    for (const t of ordered) {
      const legalHere = legalSet.has(t)
      // ① 含噪出杆（保留拟人误差）
      const noisy = makeShot(
        t,
        p.aimNoise,
        jitterPower(basePower, p.powerJitter)
      )
      if (probeHitsTarget(AimEvent.fromJson(noisy.tablejson.aim), t, legalHere && !desperate)) {
        chosenShot = { hit: noisy, ball: t }
        break
      }
      // ② 零噪声重出（兜底使命优先于拟人误差）
      const clean = makeShot(t, 0, basePower)
      if (probeHitsTarget(AimEvent.fromJson(clean.tablejson.aim), t, legalHere && !desperate)) {
        chosenShot = { hit: clean, ball: t }
        break
      }
    }
    if (chosenShot) {
      this.lastShotPath = desperate ? "safety:desp" : "safety"
      return [
        AimEvent.fromJson(chosenShot.hit.tablejson.aim),
        chosenShot.hit,
      ]
    }
    // ③ 全部候选都验不过（极罕见）：**直击球心**兜底。
    // v1.4.6 补丁：初版这里复用 makeShot（ghost 点瞄准）—— 贴库/大切角
    // 球的 ghost 点偏移可达 4R+（激进档对局实测出现「safety:last 空杆」，
    // #6 贴左库时 ghost 方向与球心方向差 12.7°、垂距 3.8R，母球先撞库
    // 反弹后什么都没碰到）。现在改为直击**球心**（垂距 0，物理上必触球），
    // 每颗候选都过 probe 双保险（probe 只要求触到球 —— 认命语义）；
    // 全部异常（理论上不可能）才退回 ghost 瞄准杆。
    const lastTarget =
      clearestBall(cue.pos, balls, allBalls, cue, ghostAim) ?? balls[0]
    const lastPower = Math.max(basePower, 30 * R)
    const lastOrder = [
      lastTarget,
      ...ordered.filter((b) => b !== lastTarget),
    ]
    let lastShot: { hit: any; ball: Ball } | null = null
    for (const t of lastOrder) {
      const direct = calculator.generateShot(
        context.table,
        0,
        lastPower,
        t.pos.clone(), // 球心直击，非 ghost 点
        new Vector3(0, 0, 0)
      )
      if (
        this.probeFirstHitLabel(
          context,
          AimEvent.fromJson(direct.tablejson.aim)
        ) !== null
      ) {
        lastShot = { hit: direct, ball: t }
        break
      }
    }
    const lastResort =
      lastShot?.hit ?? makeShot(lastTarget, 0, lastPower)
    this.lastShotPath = "safety:last"
    return [AimEvent.fromJson(lastResort.tablejson.aim), lastResort]
  }

  /**
   * v1.3.77：一库解球（kick shot）。
   *
   * 全部直线被挡（被对方球做了 snooker）时，不再硬打出首撞对方球的犯规杆，
   * 而是用**镜像法**解一库：目标球关于某条库边做镜像，母球瞄准镜像点出杆 →
   * 撞库反弹（入射角=反射角近似，不加旋转）后正好朝目标球去，首撞本方球。
   *
   * 可行性要求（全部满足才算一库解）：
   *   1. 反弹点落在库边有效段内（到任一袋口的距离 > 2.1R，避免反弹点落进袋口）；
   *   2. 母球→反弹点 段无遮挡（全桌视角，排除母球与目标球）；
   *   3. 反弹点→目标球 段无遮挡（排除目标球）。
   * 在所有「本方球 × 四条库」可行组合里取**总路程最短**的。
   *
   * 力度：沿 cue→库→球 总路程做物理反解，额外 ×1.35 补库边能量损失
   * （库弹性约 0.75，等效距离 ÷0.75），夹在 [34R, 72R]。
   *
   * 返回 null 表示一库也解不到 —— 真无解局（极少），调用方按旧逻辑认命硬打。
   */
  private tryKickShot(
    context: BotShotContext,
    calculator: AimCalculator,
    cue: Ball,
    balls: Ball[],
    allBalls: Ball[]
  ): GameEvent[] | null {
    const X = TableGeometry.X
    const Y = TableGeometry.Y
    const pockets = calculator.pockets
    let bestMirror: Vector3 | null = null
    let bestTarget: Ball | null = null
    let bestTotal = Infinity
    let bestD1 = 0
    let bestD2 = 0

    for (const b of balls) {
      // 四条库的镜像点与反弹点
      const candidates: { mirror: Vector3; bounce: Vector3 | null }[] = [
        {
          mirror: new Vector3(2 * X - b.pos.x, b.pos.y, 0),
          bounce: null,
        },
        {
          mirror: new Vector3(-2 * X - b.pos.x, b.pos.y, 0),
          bounce: null,
        },
        {
          mirror: new Vector3(b.pos.x, 2 * Y - b.pos.y, 0),
          bounce: null,
        },
        {
          mirror: new Vector3(b.pos.x, -2 * Y - b.pos.y, 0),
          bounce: null,
        },
      ]
      for (const c of candidates) {
        const mx = c.mirror.x
        const my = c.mirror.y
        // 母球→镜像点 与库边的交点 = 反弹点
        let bounce: Vector3 | null
        if (my === b.pos.y) {
          // x 库镜像：交点 x = ±X
          const plane = mx > 0 ? X : -X
          const denom = mx - cue.pos.x
          if (Math.abs(denom) < 1e-6) continue
          const t = (plane - cue.pos.x) / denom
          if (t <= 0) continue
          const by = cue.pos.y + t * (my - cue.pos.y)
          bounce = new Vector3(plane, by, 0)
        } else {
          // y 库镜像：交点 y = ±Y
          const plane = my > 0 ? Y : -Y
          const denom = my - cue.pos.y
          if (Math.abs(denom) < 1e-6) continue
          const t = (plane - cue.pos.y) / denom
          if (t <= 0) continue
          const bx = cue.pos.x + t * (mx - cue.pos.x)
          bounce = new Vector3(bx, plane, 0)
        }
        // 反弹点须离袋口足够远（别把反弹点选在袋口里）
        let nearPocket = false
        for (const pk of pockets) {
          if (bounce.distanceTo(pk) < 2.1 * R) {
            nearPocket = true
            break
          }
        }
        if (nearPocket) continue
        const d1 = cue.pos.distanceTo(bounce)
        const d2 = bounce.distanceTo(b.pos)
        if (d1 < 1.5 * R || d2 < 2 * R) continue
        // 两段路径都必须畅通（各自的线段排除线段端点的球）
        if (lineBlocked(cue.pos, bounce, allBalls, cue, b)) continue
        if (lineBlocked(bounce, b.pos, allBalls, b)) continue
        const total = d1 + d2
        if (total < bestTotal) {
          bestTotal = total
          bestMirror = c.mirror
          bestTarget = b
          bestD1 = d1
          bestD2 = d2
        }
      }
    }
    if (!bestMirror || !bestTarget) return null

    const railPower = cueSpeedFor(
      bestD1,
      bestD2 + POCKET_RADIUS_CORNER,
      POCKET_RADIUS_CORNER,
      1,
      0,
      0,
      1.3
    )
    const power = Math.min(
      Math.max(railPower * 1.35, 34 * R),
      72 * R
    )
    const aimPoint = bestMirror.clone()

    // v1.3.92：**一库解球必须自己先验证「不会把母球送进袋」**。
    //
    // 对局级实测（tools/harness/_diagmatch.ts，第2局）暴露了一个死循环：
    // 剩最后一颗球时 AI 连续 50+ 杆都走 [防守:kick]、力度恒为 40R，且
    // **每一杆都摔袋**。原因是一库解球只管「母球撞库后能否碰到目标球」，
    // 完全没检查母球撞库后的去向 —— 反弹方向如果指向袋口，就是白送摔袋。
    // 摔袋后母球被重摆回库边，局面高度相似，AI 下一杆又选出几乎相同的
    // 解球线，于是无限循环、整局作废。
    //
    // 这里用与主进攻路径**同一套**物理预测复核（predictCueStop 误差 0.000R）：
    // 若母球会落袋、或停位离袋口过近，就把力度逐级收小再试；
    // 全部试完仍会摔袋则放弃这条解球线（返回 null，让上层换别的策略）。
    for (const scale of [1.0, 0.8, 0.62, 0.48]) {
      const trial = Math.max(18 * R, power * scale)
      const stop = this.probeKickStop(context, calculator, aimPoint, trial)
      if (!stop) continue // 母球进袋 → 这一力度不行
      const near = stopNearestPocket(stop, calculator.pockets)
      if (near < 2.2 * R) continue // 停位贴着袋口，下一杆极易摔袋
      const hit = calculator.generateShot(
        context.table,
        this.profile.aimNoise,
        jitterPower(trial, this.profile.powerJitter),
        aimPoint,
        new Vector3(0, 0, 0)
      )
      // v1.4.6：**首撞自验** —— 镜像法是近似，反弹后的真实方向可能先碰到
      // 别的球（首撞犯规）。出杆前在克隆台用含噪出杆参数跑一遍真实物理，
      // 首撞不是解球目标（或母球零接触）就换下一档力度；全部不行则放弃
      // 这条解球线（返回 null，上层转稳妥兜底）。
      const aimEvent = AimEvent.fromJson(hit.tablejson.aim)
      const firstLabel = this.probeFirstHitLabel(context, aimEvent)
      if (firstLabel !== bestTarget.label) continue
      return [aimEvent, hit]
    }
    // 所有力度都会摔袋 → 这条解球线本质不安全，交回上层
    // v1.4.6：连同「首撞自验」一起判 —— 见 probeFirstHitLabel。
    return null
  }

  /**
   * v1.4.6：在**克隆台**上原样试打一杆（含噪声的实际出杆参数），返回母球
   * **首撞球的 label**（全程零接触返回 null = 空杆；物理异常返回 null）。
   *
   * 为什么需要它：一库解球的镜像法是近似（忽略库边摩擦/旋转/袋口折射），
   * 反弹后的真实方向与几何预测有偏差 —— 对局级实测大量「首撞非目标」犯规
   * 来自 kick 失败。出杆前先在克隆台跑一遍真实物理，首撞不是解球目标就
   * 放弃这条线，AI 的观感从「乱打」变成「稳妥收杆」。
   * 克隆球与真实桌的对应用 label（八球/九球每球 label 唯一）。
   */
  private probeFirstHitLabel(
    context: BotShotContext,
    aim: AimEvent
  ): number | null {
    try {
      // ⚠️ 只克隆**在桌上**的球。已落袋球的 pos 是袋内坐标，若照原样克隆
      // 再 setStationary()，克隆台会多出一圈「幽灵球」——物理与真实桌完全
      // 不同，预测结论全错（首版实测：验证通过的 kick 真打出去仍是空杆，
      // 就是这个原因）。
      const clones = context.table.balls
        .filter((b: Ball) => b.onTable())
        .map((b: Ball) => {
          const nb = new Ball(b.pos.clone(), undefined, b.label)
          nb.setStationary()
          return nb
        })
      const probe = new Table(clones)
      probe.cue = new Cue()
      probe.cueball = clones[0]
      probe.cue!.aim = aim
      probe.cue!.hit(probe.cueball)
      let guard = 0
      while (!probe.allStationary() && guard++ < 200000) {
        probe.advance(0.001953125)
      }
      const cueCollisions = probe.outcome.filter(
        (o) =>
          o.type === OutcomeType.Collision &&
          (o.ballA === probe.cueball || o.ballB === probe.cueball)
      )
      if (cueCollisions.length === 0) return null // 母球全程零接触
      const firstOther =
        cueCollisions[0].ballA === probe.cueball
          ? cueCollisions[0].ballB
          : cueCollisions[0].ballA
      return firstOther?.label ?? null
    } catch {
      return null
    }
  }

  /**
   * v1.3.92：在**克隆台**上试打一杆，返回母球停位（进袋返回 null）。
   * 决策必须只读，绝不能污染真实比赛桌 —— 与 trajectory.predictCueStop 同源思路。
   */
  private probeKickStop(
    context: BotShotContext,
    calculator: AimCalculator,
    aimPoint: Vector3,
    power: number
  ): Vector3 | null {
    try {
      // v1.4.6：只克隆 onTable 的球（同 probeFirstHitLabel —— 已落袋球
      // 克隆成袋口幽灵球会让预测物理失真）。
      const src: Ball[] = context.table.balls.filter(
        (b: Ball) => b.onTable()
      )
      const clones = src.map((b: Ball) => {
        const nb = new Ball(b.pos.clone(), undefined, b.label)
        nb.setStationary()
        return nb
      })
      const probe = new Table(clones)
      probe.cue = new Cue()
      probe.cueball = clones[0]
      const hit = calculator.generateShot(
        probe,
        0,
        power,
        aimPoint,
        new Vector3(0, 0, 0)
      )
      probe.cue!.aim = (hit.tablejson as { aim: never }).aim
      probe.cue!.hit(probe.cueball)
      let guard = 0
      while (!probe.allStationary() && guard++ < 200000) {
        probe.advance(0.001953125)
      }
      if (!probe.cueball.onTable()) return null
      return probe.cueball.pos.clone()
    } catch {
      return null
    }
  }
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
 * v1.3.66：从候选球里挑「母球→该球」视线最不被遮挡的一颗。
 * 返回让母球首撞点离其他球最远的那颗（lineClarity 越大越畅通），
 * 用于「没有任何球视线完全畅通」时的安全球兜底，降低首撞错球犯规。
 * v1.3.77：评估路径由调用方给定（主路径传 ghost 瞄准点 —— 按实际出杆
 * 方向评估，而不是「母球→球心」直线，理由见 safetyOrFallback 注释）。
 */
function clearestBall(
  from: Vector3,
  balls: Ball[],
  allBalls: Ball[],
  cue: Ball,
  toOf: (b: Ball) => Vector3
): Ball | undefined {
  let best: Ball | undefined
  let bestC = -Infinity
  for (const b of balls) {
    const c = lineClarity(from, toOf(b), allBalls, cue, b)
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
