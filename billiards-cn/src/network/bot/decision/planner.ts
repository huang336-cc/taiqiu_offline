import { Vector3 } from "three"
import { Ball } from "../../../model/ball"
import { R } from "../../../model/physics/constants"
import { DecisionContext, clamp01 } from "./shotcontext"
import { OffenseCandidate, enumerateCandidates, distToRail } from "./offense"
import { predictCueStop } from "./trajectory"

/**
 * v1.3.91：多步走位规划（专业级 AI 决策层 · 第三优先级）。
 *
 * 改造前 professional.ts 的走位评估只有一条粗糙的启发式：奖励「停位靠近
 * 剩余球群中心」。这有两个致命缺陷：
 *   ① 只看当前这一杆，不看下一杆 —— 球群中心未必有球可打，母球停在那儿
 *      可能正好被死球卡住（职业选手说的"走位走死了"）；
 *   ② 奖励「靠近球群」等价于默认「离得近就好」，而真实职业走位追求的是
 *      **下一杆有球可打且难度低**，方向比距离重要得多。
 *
 * 本模块把停位评估升级为真正的递归前瞻：
 *   物理预测停位（见 trajectory.ts）→ 把虚拟母球摆过去 → 枚举下一杆候选
 *   → 打分，用「最佳下一杆收益 + 可延续球数 + 离库自由度 + 更深一层的前瞻」
 *   加权，得到走位质量。
 *
 * 同时引入**容错停留区域**的概念：职业选手不追求停在某一个精确点位，
 * 而是追求停在一个「即使偏差 10cm 仍然有球可打」的区域。这里用下一杆
 * 所有可打候选的 ghost 位置集合的质心与半径来表达。
 */

/** 走位评估结果 */
export interface PositionPlan {
  /** 走位质量 0~1（越大越好；0.05 表示停死了，1 表示下一杆随便打） */
  quality: number
  /** 期望母球撞后行走距离（米）——供力度档位判断是否需要主动发力 */
  targetTravel: number
  /** 下一杆可打进（难度 ≤ 阈值）的候选数 */
  followUpCount: number
  /** 下一杆最简单候选的收益（1 − 难度），无候选时为 0 */
  easiestNext: number
  /**
   * 容错停留区域的质心与半径（米）。
   * 半径越大表示「允许的误差越大」，走位越从容。
   */
  zoneCenter: Vector3 | null
  zoneRadius: number
  /** 停位是否落在容错区外（需要主动调整杆法力度） */
  outOfZone: boolean
  /** 停位是否由物理预测得出（false = 退化为几何近似） */
  physicsBased: boolean
}

/**
 * 走位评估的可选参数。
 *
 * `power` / `spin` 用于物理预测：同一个候选，用力不同、杆法不同，
 * 母球停位会差很远（这是走位的全部意义所在）。不传时退化为几何近似。
 */
export interface PositionOptions {
  power?: number
  spin?: Vector3
}

/**
 * 评估某一杆的走位质量（前瞻 `depth` 步）。
 *
 * @param dctx  决策上下文
 * @param cand  当前选中的进攻候选
 * @param depth 向前预判的步数（专业档 3；<=0 视为关闭前瞻）
 * @param opts  力度/杆法（用于物理预测停位）
 */
export function evaluatePosition(
  dctx: DecisionContext,
  cand: OffenseCandidate,
  depth: number,
  opts: PositionOptions = {}
): PositionPlan {
  const profile = dctx.profile
  if (!profile.positionPlay || depth <= 0) {
    return {
      quality: 0.5,
      targetTravel: 0,
      followUpCount: 0,
      easiestNext: 0,
      zoneCenter: null,
      zoneRadius: 0,
      outOfZone: false,
      physicsBased: false,
    }
  }

  // 停位：优先用真实物理预测（误差中位数 ~1R），拿不到时退回几何近似（~31R）
  let stop = cand.stop
  let physicsBased = false
  if (opts.power !== undefined && opts.power > 0) {
    const p = predictCueStop(
      dctx,
      cand,
      opts.power,
      opts.spin ?? new Vector3(0, 0, 0)
    )
    if (p) {
      stop = p
      physicsBased = true
    }
  }

  const remaining = dctx.targets.filter((b) => b !== cand.ball)
  if (remaining.length === 0) {
    // 打完这颗就清了本组：停位质量以「是否留出黑8机会」粗略代替。
    // 黑8多半在球堆附近，这里给一个中性偏好的分。
    return {
      quality: 0.8,
      targetTravel: stop.distanceTo(cand.ball.pos),
      followUpCount: 0,
      easiestNext: 0,
      zoneCenter: null,
      zoneRadius: 0,
      outOfZone: false,
      physicsBased,
    }
  }

  // 把虚拟母球摆到预测停位，枚举下一杆候选（纯几何，不动物理引擎）
  const virtualCue = { ...dctx.cue, pos: stop.clone() } as Ball
  const virtualCtx: DecisionContext = {
    ...dctx,
    cue: virtualCue,
    targets: remaining,
  }
  const minCut = Math.max(0.15, profile.minCutCos - 0.1)
  const nextCands = enumerateCandidates(virtualCtx, minCut)

  if (nextCands.length === 0) {
    // 死位：母球停在一个下一杆完全打不到球的地方，重罚
    return {
      quality: 0.05,
      targetTravel: stop.distanceTo(cand.ball.pos),
      followUpCount: 0,
      easiestNext: 0,
      zoneCenter: null,
      zoneRadius: 0,
      outOfZone: true,
      physicsBased,
    }
  }

  const threshold = profile.offenseThreshold ?? 0.72
  const good = nextCands.filter((c) => c.difficulty <= threshold)
  const easiestNext =
    good.length > 0 ? Math.max(...good.map((c) => 1 - c.difficulty)) : 0
  const followUps = Math.min(1, good.length / 3)
  const freedom = Math.max(0, 1 - railHugAt(stop))

  // 递归前瞻：挑下一杆最有希望的 2 个候选再往前看一步（衰减计入）
  let deeper = 0
  if (depth > 1 && good.length > 0) {
    const top = good
      .slice()
      .sort((a, b) => a.difficulty - b.difficulty)
      .slice(0, 2)
    let bestDeep = 0
    for (const c2 of top) {
      const p2 = evaluatePosition(virtualCtx, c2, depth - 1)
      bestDeep = Math.max(bestDeep, p2.quality)
    }
    deeper = bestDeep
  }

  // 容错停留区域：下一杆所有可打候选的 ghost 点集合
  const zone = toleranceZone(good.length > 0 ? good : nextCands)
  const outOfZone = zone ? stop.distanceTo(zone.center) > zone.radius : false

  const quality = clamp01(
    0.45 * easiestNext +
      0.2 * followUps +
      0.1 * freedom +
      0.25 * deeper -
      (outOfZone ? 0.1 : 0)
  )

  return {
    quality,
    // 期望母球行走距离：停位离当前球越远，越需要发力把母球送过去
    targetTravel: stop.distanceTo(cand.ball.pos),
    followUpCount: good.length,
    easiestNext,
    zoneCenter: zone?.center ?? null,
    zoneRadius: zone?.radius ?? 0,
    outOfZone,
    physicsBased,
  }
}

/** 停位贴库程度 0~1（与 offense.railHug 同口径） */
function railHugAt(p: Vector3): number {
  return Math.max(0, 1 - distToRail(p) / (4 * R))
}

/**
 * 容错停留区域：把一组候选的 ghost 位置收成一个球（质心 + 半径）。
 *
 * 职业选手的走位目标是「一片区域」而不是「一个点」——只要停在区内，
 * 无论下一杆打哪颗球都不费劲。半径越大，走位越从容（容错越高）。
 */
function toleranceZone(
  cands: OffenseCandidate[]
): { center: Vector3; radius: number } | null {
  if (cands.length === 0) return null
  const center = new Vector3()
  for (const c of cands) center.add(c.ghost)
  center.multiplyScalar(1 / cands.length)
  let radius = 0
  for (const c of cands) {
    radius = Math.max(radius, c.ghost.distanceTo(center))
  }
  // 半径至少给 2R（母球本身有体积，容错区不可能小于一个球）
  return { center, radius: Math.max(2 * R, radius) }
}

/**
 * 预测母球在第 `steps` 步之后的大致位置（供清台顺序与炸球评估使用）。
 *
 * 与 `evaluatePosition` 的区别：这里只关心**位置**，不关心质量评分，
 * 用于「我打完这三颗之后母球会在哪、还有没有球可打」这类更远的判断。
 */
export function projectCuePath(
  dctx: DecisionContext,
  first: OffenseCandidate,
  steps: number
): Vector3[] {
  const path: Vector3[] = [first.stop.clone()]
  let cursor = first
  const remaining = dctx.targets.slice()
  const removeBall = (b: Ball) => {
    const i = remaining.indexOf(b)
    if (i >= 0) remaining.splice(i, 1)
  }
  removeBall(first.ball)

  for (let i = 1; i < steps && remaining.length > 0; i++) {
    const virtualCtx: DecisionContext = {
      ...dctx,
      cue: { ...dctx.cue, pos: cursor.stop.clone() } as Ball,
      targets: remaining,
    }
    const cands = enumerateCandidates(
      virtualCtx,
      Math.max(0.15, dctx.profile.minCutCos - 0.1)
    )
    if (cands.length === 0) break
    // 取最简单的那个作为「AI 大概率会打的那一杆」
    let best = cands[0]
    for (const c of cands) if (c.difficulty < best.difficulty) best = c
    path.push(best.stop.clone())
    removeBall(best.ball)
    cursor = best
  }
  return path
}

/**
 * 走位惩罚（越小越好，0~1）。用于综合排序键中压低「虽然好进但走位糟糕」的候选。
 */
export function positionPenalty(cand: OffenseCandidate): number {
  return Math.min(1, cand.stopToNext / (10 * R)) * 0.6 + cand.railHug * 0.4
}
