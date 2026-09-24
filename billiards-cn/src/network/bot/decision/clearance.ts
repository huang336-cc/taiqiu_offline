import { Vector3 } from "three"
import { Ball } from "../../../model/ball"
import { R } from "../../../model/physics/constants"
import { DecisionContext, clamp01 } from "./shotcontext"
import {
  OffenseCandidate,
  enumerateCandidates,
  distToRail,
} from "./offense"
import { predictCueStop } from "./trajectory"

/**
 * v1.3.91：全局清台顺序（专业级 AI 决策层 · 第四优先级）。
 *
 * 用户规格里明确要求「全局清台顺序（难点球优先）」。
 *
 * 改造前 AI 的排序键是**纯收益**：`(1 − 难度) × 袋口价值 × 走位加成`。
 * 于是它每一杆都挑「当下最容易进的那颗」，把简单球一颗颗吃掉，最后
 * 留下一堆难球互相卡死 —— 这正是业余选手最典型的败因。
 *
 * 职业选手的思维是反的：**先解决难点球**。理由很简单：
 *   · 难球在有「下一颗球可走位」的时候最好打（可以借走位把它放在舒服的
 *     角度上）；一旦台面只剩难球，每一杆都是孤军奋战；
 *   · 简单球是「压舱石」，留到后面当走位的落点目标，走位自由度大得多；
 *   · 早点清掉难点球，等于早点把「打不进就送对手机会」的风险敞口关掉。
 *
 * 本模块给每颗候选算一个 `clearancePriority`（0~1，越大越该先打），
 * 由三部分构成：
 *   ① 本体难度：这颗球本身越难，越该先清（相对同组其它球而言）；
 *   ② 难球稀缺性：同组里比它难的球越少，它越「孤」（越该现在解决）；
 *   ③ 压舱石惩罚：若它明显比同组平均简单，说明它适合留到最后当落点，
 *      适当压在后面打。
 *
 * 注意：本模块**不改变 `difficulty`**（那是物理事实），只额外给出
 * 「顺序偏好」，避免把「难」与「该先打」两个正交概念混成一个数。
 */

/** 清台顺序评估结果 */
export interface ClearancePlan {
  /** 清台优先级 0~1（越大越应先打） */
  priority: number
  /** 这颗球在本组的难度排名（0 = 最难） */
  difficultyRank: number
  /** 本组剩余球数 */
  remaining: number
  /** 同组里比这颗更难的球数 */
  harderCount: number
  /** 是否为「压舱石」（明显比同组平均简单，适合留后当落点） */
  ballast: boolean
  /** 人类可读说明 */
  note: string
}

/**
 * 为一批候选计算清台顺序优先级。
 *
 * 返回与入参**同序**的数组，`priority` 已归一化到 0~1。
 *
 * @param cands 候选列表（一般来自 enumerateCandidates）
 * @param dctx  决策上下文
 */
export function rankClearance(
  cands: OffenseCandidate[],
  dctx: DecisionContext
): ClearancePlan[] {
  const n = dctx.targets.length
  if (cands.length === 0) return []

  // 同一颗球可能有多个袋口候选 —— 难度排序按**球**去重统计，
  // 否则一颗能进三个袋的球会被当成三颗球，污染稀缺性判断。
  const perBall = new Map<Ball, number>()
  for (const c of cands) {
    const prev = perBall.get(c.ball)
    if (prev === undefined || c.difficulty < prev) {
      perBall.set(c.ball, c.difficulty)
    }
  }
  const ballDifficulties = [...perBall.values()].sort((a, b) => a - b)
  const hardest = ballDifficulties[0] ?? 0
  const easiest = ballDifficulties[ballDifficulties.length - 1] ?? 0
  const spread = Math.max(1e-6, easiest - hardest)

  return cands.map((c) => {
    const d = c.difficulty
    // ① 本体难度：在「本组难度谱系」里的相对位置（越难越靠前）
    const own = clamp01((d - hardest) / spread)
    // ② 难球稀缺性：比它难的球越少 → 它越孤 → 越该先解决
    const harderCount = ballDifficulties.filter((x) => x < d - 1e-6).length
    const scarcity = clamp01(1 - harderCount / Math.max(1, ballDifficulties.length - 1))
    // ③ 压舱石惩罚：明显比平均简单 → 留后
    const avg = ballDifficulties.reduce((s, x) => s + x, 0) / ballDifficulties.length
    const ballast = d < avg - 0.12

    // 权重取舍：稀缺性（"这颗球不现在打就没人打了"）权重最高，
    // 本体难度次之，压舱石只做轻微抑制（避免把简单球永远压到最后
    // 导致清台卡死）。
    //   own = 0 → 本组最难 → (1−own) = 1 → 优先级最高
    //   own = 1 → 本组最易 → (1−own) = 0 → 优先级最低
    let priority = 0.55 * (1 - own) + 0.35 * scarcity
    if (ballast) priority -= 0.1

    return {
      priority: clamp01(priority),
      difficultyRank: harderCount,
      remaining: n,
      harderCount,
      ballast,
      note: ballast
        ? `压舱石（难度 ${d.toFixed(2)}，留后当落点）`
        : `难点球优先（难度 ${d.toFixed(2)}，比它难的还有 ${harderCount} 颗）`,
    }
  })
}

/**
 * 清台顺序的**乘性系数**（供排序键使用）。
 *
 *   factor = CLEAR_MIN + (CLEAR_MAX − CLEAR_MIN) × priority
 *          = 0.60 + 0.85 × priority          ∈ [0.60, 1.45]
 *
 * ## 为什么区间必须放宽到「能跨过难度差」（v1.3.91 三轮修正）
 *
 * 首版是 `0.75 + 0.25 × priority ∈ [0.75, 1.00]`，意图是「只在收益接近时
 * 打破平局」。但这在数学上**根本不可能实现「难点球优先」**：
 *
 *   排序键 = (1 − difficulty) × factor，难度项 range 是 [0,1]，而 factor
 *   只提供了 **33%** 的调节幅度。代入实测数值：
 *     score(难球 0.5, priority 拉满 1.0) = 0.50 × 1.00 = 0.500
 *     score(易球 0.3, priority 最低 0.0) = 0.70 × 0.75 = 0.525  ← 仍然胜出
 *   也就是**任何一颗稍难的球都永远排不到简单球前面**，所谓「难点球优先」
 *   从未生效。阶段4 harness 报出的「选中率 80.4%」量的是「按 priority
 *   排序后挑到了更难的那颗」这个**中间量**，不是最终排序结果 —— 指标本身
 *   不具有代表性，把失效掩盖过去了。
 *
 * 对局级实测（tools/harness/botmatch.ts，60 局样本）也印证了这一点：
 * 「开启清台顺序」清台率 69.5% **反而低于**「关闭」76.3% —— 因为它只产生了
 * 随机扰动（把某些球的分数上下平移），却没有实现预期的难球优先策略。
 *
 * ## 现在的区间与边界
 *
 * 取 [0.60, 1.45]（调节幅度 ±~40%，跨度 2.4 倍）。这样：
 *   · 难球 priority 高 → factor 最高 1.45，足以压过约 0.25 的难度劣势
 *     （0.5×1.45 = 0.725 > 0.7×0.60 = 0.42，甚至能反超）；
 *   · 但仍**不会**让一颗明显进不了的球排到前面 —— `clearanceFactorOf`
 *     保留了 `difficulty > 0.75` 的 `tooRisky` 闸门（直接不给加成），
 *     且 `rankClearance` 的 `priority` 本身就依赖难度谱系。
 *   · 下界 0.60 让「压舱石」（明显偏简单的球）被适度压后，但不会压死
 *     （压死会清台卡死，因为最后只剩压舱石时无路可走）。
 *
 * ## 为什么返回系数而不是直接算最终分
 *
 * `professional.ts` 的排序键会**多次**重算 `offenseScore`（粗排一次、
 * 走位前瞻后再调制一次）。若在这里做绝对赋值，后续重算会把清台顺序
 * 整个覆盖掉 —— 实测就是这么失效的（「难点球优先」选中率 0.0%）。
 * 做成乘性系数后，任何一次重算都能自动保留顺序偏好。
 *
 * @param c    候选
 * @param plan 该候选的清台顺序评估
 */
export function clearanceFactorOf(
  c: OffenseCandidate,
  plan: ClearancePlan
): number {
  // 兜底：若本杆难度已超出「可接受进攻」范围，顺序偏好不再加分
  const tooRisky = c.difficulty > 0.75
  const priority = tooRisky ? 0 : plan.priority
  return CLEAR_MIN + (CLEAR_MAX - CLEAR_MIN) * priority
}

/** 清台顺序系数下界（压舱石被压后的位置） */
export const CLEAR_MIN = 0.6
/** 清台顺序系数上界（难点球被抬到的位置） */
export const CLEAR_MAX = 1.45

/**
 * 清台顺序的整体评分（供排序键使用）。
 *
 *   score = offenseScore × (0.75 + 0.25 × priority)
 *
 * 保留 `offenseScore` 为主导项 —— 顺序偏好的作用是**在收益接近的候选之间
 * 打破平局**，而不是让 AI 去搏一颗明显进不了的球。「难点球优先」的前提是
 * 这颗难球**本来就在可打范围内**。
 *
 * @param c         候选
 * @param plan      该候选的清台顺序评估
 * @param offenseScore 本杆的进攻收益（见 professional.ts rankPlans）
 */
export function clearanceAdjusted(
  c: OffenseCandidate,
  plan: ClearancePlan,
  offenseScore: number
): number {
  return offenseScore * clearanceFactorOf(c, plan)
}

/**
 * 预判清台路线：从当前候选出发，贪心地向前推演 2~3 杆，
 * 返回路径上每颗球（供「是否留出黑8机会」等终局判断使用）。
 *
 * 与 `projectCuePath` 的区别：这里每一杆都会**真正跑一次物理预测**，
 * 因此母球落点可信（用于判断「打完这条线之后还有没有球」）。
 *
 * @param dctx  决策上下文
 * @param first 第一步候选
 * @param steps 向前推演步数（专业档 3）
 */
export function clearanceRoute(
  dctx: DecisionContext,
  first: OffenseCandidate,
  steps: number,
  options: { power?: number; spin?: Vector3 } = {}
): { ball: Ball; stop: Vector3; difficulty: number }[] {
  const route: { ball: Ball; stop: Vector3; difficulty: number }[] = []
  let cand: OffenseCandidate | null = first
  let remaining = dctx.targets.slice()
  let cuePos = dctx.cue.pos.clone()
  let power = options.power
  let spin = options.spin
  const budget = Math.max(1, steps)

  for (let i = 0; i < budget && cand; i++) {
    let stop = cand.stop.clone()
    if (power !== undefined && power > 0) {
      const p = predictCueStop(dctx, cand, power, spin ?? new Vector3(0, 0, 0))
      if (p) stop = p
    }
    route.push({ ball: cand.ball, stop, difficulty: cand.difficulty })

    remaining = remaining.filter((b) => b !== cand!.ball)
    if (remaining.length === 0) break

    // 下一杆：把虚拟母球摆到预测落点，取最容易的一颗作为「大概率会打的那杆」
    const virtualCtx: DecisionContext = {
      ...dctx,
      cue: { ...dctx.cue, pos: stop.clone() } as Ball,
      targets: remaining,
    }
    const next = enumerateCandidates(virtualCtx, Math.max(0.15, dctx.profile.minCutCos - 0.1))
    if (next.length === 0) break
    let best: OffenseCandidate = next[0]
    for (const c of next) if (c.difficulty < best.difficulty) best = c
    cand = best
    cuePos = stop
    // 后续杆沿用同一力度档（真实 AI 会逐杆重算，这里只做路线预判）
    power = power
    spin = spin
  }
  void cuePos
  return route
}

/**
 * 难点球稀疏度：本组里「难度超过阈值」的球还剩几颗。
 *
 * 用于终局判断：若难点球已经清完，剩下的都是压舱石，
 * AI 应当转入「稳妥走位、不给对手机会」的模式。
 */
export function hardBallCount(dctx: DecisionContext, threshold = 0.55): number {
  const cands = enumerateCandidates(dctx, Math.max(0.15, dctx.profile.minCutCos - 0.1))
  const perBall = new Map<Ball, number>()
  for (const c of cands) {
    const prev = perBall.get(c.ball)
    if (prev === undefined || c.difficulty < prev) perBall.set(c.ball, c.difficulty)
  }
  let hard = 0
  for (const b of dctx.targets) {
    const d = perBall.get(b)
    // 一颗球若连候选都枚举不出来，说明它被完全挡死 —— 也是难点
    if (d === undefined || d > threshold) hard++
  }
  return hard
}

/** 台面「堵死程度」0~1：本组球里有多少颗连一个可进袋口都找不到 */
export function tableClutter(dctx: DecisionContext): number {
  if (dctx.targets.length === 0) return 0
  const cands = enumerateCandidates(dctx, Math.max(0.15, dctx.profile.minCutCos - 0.1))
  const reachable = new Set<Ball>(cands.map((c) => c.ball))
  const blocked = dctx.targets.filter((b) => !reachable.has(b)).length
  const railHug = dctx.targets.filter((b) => distToRail(b.pos) < 2 * R).length
  return clamp01(0.7 * (blocked / dctx.targets.length) + 0.3 * (railHug / dctx.targets.length))
}
