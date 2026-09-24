/**
 * v1.3.93：AI 自由球（ball in hand）摆位评估。
 *
 * ## 为什么单独成模块
 *
 * 原先的摆位逻辑写在 `BotEventHandler.chooseBallInHandPosition()` 里，是一套
 * **自成一体的粗启发式**：14×14 网格取点，只判「不与任何球重叠」和「视线不被挡」，
 * 打分函数是 `1 / (1 + |距离 - 0.5m|)` —— 即「离目标球约半米最舒服」。
 *
 * 它只关心「能不能直着看见一颗目标球」，完全不关心：
 *   · 看见的那颗球到底**能不能打进**（切角可能大到根本打不进）；
 *   · 打完母球会**停在哪**、会不会**摔袋**；
 *   · 下一杆**好不好打**（走位质量）；
 *   · 摆完之后**对手**是不是反而更好打。
 *
 * 用户反馈「AI 拿到自由球在乱摆白球」，指的就是这个 —— 它摆的位置几何上"合法"，
 * 战术上却常常是坏选择。
 *
 * ## 修法
 *
 * 不再另写一套启发式，改为**复用 `decision/` 下已经打磨过的评估基础设施**：
 *
 *   `enumerateCandidates`  → 这个摆位点能打进哪些球、难度多大
 *   `refineStopsPhysics`   → 用真实物理算母球停位与摔袋风险（误差 0.000R）
 *   `evaluatePosition`     → 打完这一杆，下一杆好不好打（递归前瞻）
 *   `evalThreat`           → 摆完之后对手的威胁有多大
 *
 * 流程是「网格粗筛 → 前 N 个候选精算」：粗筛沿用便宜的几何检查把明显的废点剔掉，
 * 只有排名靠前的少数点才付出「临时移动母球 + 构造上下文 + 跑物理」的代价。
 *
 * 这样 AI 的选择与它实际出杆时用的是**同一套判据**，不会出现「以为好、真打时才发现
 * 打不进」的脱节。
 */
import { Vector3 } from "three"
import { Ball } from "../../../model/ball"
import { Table } from "../../../model/table"
import { R } from "../../../model/physics/constants"
import { TableGeometry } from "../../../view/tablegeometry"
import { AimCalculator } from "../aimcalculator"
import { DifficultyProfile } from "../difficulty"
import { BotShotContext } from "../botstrategy"
import {
  OffenseCandidate,
  enumerateCandidates,
  lineClearance,
  physicsHooksReady,
  refineStopsPhysics,
  remainingCenter,
} from "./offense"
import { evaluatePosition } from "./planner"
import { evalThreat } from "./defense"
import { buildDecisionContext, DecisionContext } from "./shotcontext"
// 副作用导入：保证物理钩子已安装（幂等），否则 refineStopsPhysics 会静默退回
// 几何近似（停位误差中位 31.4R ≈ 1 米），评估出来的"安全摆位"是假的。
import "./physicshooks"

/** 粗筛网格密度：每轴 N+1 个点，共 (N+1)² 个候选 */
const GRID = 14

/**
 * 进入精算阶段的候选数。
 *
 * 每多精算一个点，代价是「临时移动母球 + enumerateCandidates + 多轮克隆台物理」，
 * 在 16 颗球的牌面上大约是毫秒级。取 12 是实测手感上的平衡点：再多命中率提升
 * 已经不明显，但 AI 自由球时的思考停顿会变得可感。
 */
const SHORTLIST = 12

/**
 * 摆位点到目标球的距离上限（米）。
 *
 * 超过这个距离，即使几何上「看得见」，命中率也低到不值得摆过去 —— 台面长边
 * 约 2.88m（TableGeometry.tableX×2），1.6m 大约是半个台面，够覆盖合理的
 * 进攻距离，又不会让 AI 把白球摆到对自己毫无意义的天边角落。
 */
const MAX_PLACEMENT_DIST = 1.6

export interface BallInHandChoice {
  /** 最终选定的摆球位置 */
  pos: Vector3
  /** 该位置的战术评分（越大越好），仅用于诊断 */
  score: number
  /** 该位置最简单一杆的难度 0~1（越小越好），无球可打时为 1 */
  easiestDifficulty: number
  /** 该位置是否存在摔袋风险（预测母球会进袋） */
  risky: boolean
  /** 精算过多少个候选点（诊断用） */
  evaluated: number
}

/**
 * 为自由球选择母球摆放位置。
 *
 * @param table      当前牌桌（母球的位置会被临时改写，函数返回前恢复）
 * @param targets    本方合法目标球
 * @param profile    难度档位参数（决定 minCutCos 等阈值）
 * @param calculator 瞄准计算器
 * @param shotCtx    原始出杆上下文（用于构造决策上下文）
 * @param fallback   兜底位置（通常是 rules.placeBall()）
 */
export function chooseBallInHandPosition(
  table: Table,
  targets: Ball[],
  profile: DifficultyProfile,
  calculator: AimCalculator,
  shotCtx: BotShotContext,
  fallback: () => Vector3
): BallInHandChoice {
  const cueball = table.cueball
  if (!cueball) {
    return { pos: fallback(), score: 0, easiestDifficulty: 1, risky: true, evaluated: 0 }
  }

  const obstacles = table.balls.filter((b) => b !== cueball && b.onTable())
  const tx = TableGeometry.tableX - R * 1.2
  const ty = TableGeometry.tableY - R * 1.2

  // ---------------------------------------------------------------- 粗筛
  // 只用便宜检查：不与任何球重叠、至少能看见一颗目标球、且不是贴球位置。
  // 目的不是选优，而是把候选压到几十个以内，避免对上百个点做昂贵精算。
  interface Rough {
    pos: Vector3
    rough: number
  }
  const roughPts: Rough[] = []
  if (targets.length === 0) {
    // 没有目标球可打（理论上不会走到这里）——退回兜底，不做无意义的精算
    return {
      pos: fallback(),
      score: 0,
      easiestDifficulty: 1,
      risky: true,
      evaluated: 0,
    }
  }

  for (let i = 0; i <= GRID; i++) {
    for (let j = 0; j <= GRID; j++) {
      const pos = new Vector3(-tx + (i * 2 * tx) / GRID, -ty + (j * 2 * ty) / GRID, 0)
      // 不能与任何球重叠（留 2% 余量，避免摆完就贴球）
      let bad = false
      for (const b of obstacles) {
        if (pos.distanceTo(b.pos) < 2 * R * 1.02) {
          bad = true
          break
        }
      }
      if (bad) continue
      // 至少能看见一颗目标球（用与决策层同一个净空函数，保证判据一致）。
      //
      // v1.3.93：粗筛**不再用「离目标球约 0.5m 最舒适」打分** —— 那个偏好本身
      // 就是旧实现的问题所在：它把「距离适中」当成了目标，而不是「这一杆好打」。
      // 这里只做**二值筛选**（看得见 / 看不见），排序交给后面的精算评分，
      // 保证短名单里留下的是「几何上可行」的点集，而非「几何上符合某个偏好」的点集。
      let visible = false
      for (const t of targets) {
        const d = pos.distanceTo(t.pos)
        // 贴太近没法瞄准（行程不足）；太远则命中率低到没有意义
        if (d < 2 * R + 0.05) continue
        if (d > MAX_PLACEMENT_DIST) continue
        const clr = lineClearance(pos, t.pos, obstacles, cueball, t)
        if (clr < 2 * R) continue
        visible = true
        break
      }
      if (!visible) continue
      // 粗排：可见目标球越多、且离得越近越好（只是排序信号，不是最终评分）
      let visCount = 0
      let minDist = Infinity
      for (const t of targets) {
        const d = pos.distanceTo(t.pos)
        if (d < 2 * R + 0.05 || d > MAX_PLACEMENT_DIST) continue
        if (lineClearance(pos, t.pos, obstacles, cueball, t) < 2 * R) continue
        visCount++
        if (d < minDist) minDist = d
      }
      roughPts.push({
        pos,
        rough: visCount + Math.max(0, 1 - minDist / MAX_PLACEMENT_DIST),
      })
    }
  }

  if (roughPts.length === 0) {
    // 整桌都找不到「能看见球」的点（极端残局）——交给兜底
    return {
      pos: fallback(),
      score: -1,
      easiestDifficulty: 1,
      risky: true,
      evaluated: 0,
    }
  }

  roughPts.sort((a, b) => b.rough - a.rough)
  const shortlist = roughPts.slice(0, SHORTLIST)

  // ---------------------------------------------------------------- 精算
  const savedPos = cueball.pos.clone()
  let best: BallInHandChoice | null = null

  try {
    for (const cand of shortlist) {
      const scored = scorePlacement(
        cueball,
        cand.pos,
        profile,
        calculator,
        shotCtx
      )
      if (!best || scored.score > best.score) {
        best = { ...scored, pos: cand.pos.clone() }
      }
    }
  } finally {
    // 无论如何都要把母球放回原位 —— 这个函数只做「试探」，不产生副作用
    cueball.pos.copy(savedPos)
    cueball.setStationary()
  }

  if (!best) {
    return {
      pos: fallback(),
      score: -1,
      easiestDifficulty: 1,
      risky: true,
      evaluated: shortlist.length,
    }
  }
  return { ...best, evaluated: shortlist.length }
}

/**
 * 对单个摆位点做完整战术评估。
 *
 * 做法：把母球临时挪到该点，用**与正式出杆完全相同的判据**算一遍
 * 「这一杆能打成什么样」，然后还原。评分由四部分组成：
 *
 *   offense   ：最容易那一杆的收益（1 − 难度），加权最高
 *   position  ：打完之后的走位质量（evaluatePosition 的 quality）
 *   scratch   ：摔袋惩罚（一票否决级）
 *   threat    ：摆完后对手的威胁（负分项）
 */
function scorePlacement(
  cueball: Ball,
  pos: Vector3,
  profile: DifficultyProfile,
  calculator: AimCalculator,
  shotCtx: BotShotContext
): Omit<BallInHandChoice, "pos"> {
  cueball.pos.copy(pos)
  cueball.setStationary()

  // 构造「假设母球在这个点」的决策上下文
  const ctx = buildCtx(shotCtx, profile, calculator, cueball)

  const minCutCos = profile.minCutCos ?? 0
  const cands = enumerateCandidates(ctx, minCutCos)
  if (cands.length === 0) {
    // 这个点虽然「看得见」球，但没有任何可打进的线路（切角全超限）
    return { score: -1, easiestDifficulty: 1, risky: false, evaluated: 0 }
  }

  // 用真实物理刷新停位与摔袋风险（与出杆路径同源）。
  //
  // 必须先确认物理钩子已就绪：钩子缺失时 refineStopsPhysics 会静默退回几何
  // 近似（停位误差中位 31.4R ≈ 1 米），那样评估出来的「安全摆位」是假的。
  // 这种情况下宁可不用精确停位信息，也不能给出错误的安全承诺。
  const hooksReady = physicsHooksReady()
  if (hooksReady) {
    refineStopsPhysics(ctx, cands, remainingCenter(ctx.targets))
  }

  // 过滤掉「预测母球会摔袋」的候选（仅在钩子就绪时该判据才可信）
  const safe = hooksReady ? cands.filter((c) => !c.physicalScratch) : cands
  const pool = safe.length > 0 ? safe : cands
  const allScratch = hooksReady && safe.length === 0

  // 取最容易的一杆作为「这个摆位点的进攻天花板」
  let easiest: OffenseCandidate = pool[0]
  for (const c of pool) {
    if (c.difficulty < easiest.difficulty) easiest = c
  }

  const offense = 1 - Math.min(1, easiest.difficulty)
  // 走位：打完这一杆后下一杆好不好打
  let position = 0
  try {
    position = evaluatePosition(ctx, easiest, 2).quality
  } catch {
    position = 0
  }
  // 对手威胁：摆在这里之后，对手从他们的球位出发有多难受
  let threat = 0
  try {
    threat = evalThreat(ctx, pos)
  } catch {
    threat = 0
  }

  // ---- 加权 ----
  // offense 是主项：自由球的意义首先在于「拿到一个能打的球」。
  // position 次之：能连着打下去才是真正的好签。
  // threat 是防御项：摆完别把台面送给对手。
  // scratch 直接重罚：宁可打得难一点，也不能摔袋送自由球。
  let score = offense * 1.0 + position * 0.45 + (1 - Math.min(1, threat)) * 0.3
  if (allScratch) score -= 0.9

  // 距离适中偏好（轻微）：太近贴球不好打，太远命中率低。
  // 这一项权重刻意压低，只作为同分时的微调，避免回到「半米偏好」的老路。
  score += Math.max(0, 1 - Math.abs(easiest.cueToBall - 0.5) / 0.5) * 0.08

  return {
    score,
    easiestDifficulty: Math.min(1, easiest.difficulty),
    risky: allScratch,
    evaluated: 0,
  }
}

/**
 * 以「母球在指定位置」为前提构造决策上下文。
 *
 * 直接复用 `shotcontext.buildDecisionContext`，只是把 cueBall 换成临时对象 ——
 * 这样保证与正式出杆路径用**同一套**上下文推导（目标球筛选、袋口、贴球判定等），
 * 不会出现两处判据不一致。
 */
function buildCtx(
  shotCtx: BotShotContext,
  profile: DifficultyProfile,
  calculator: AimCalculator,
  cueball: Ball
): DecisionContext {
  return buildDecisionContext(
    { ...shotCtx, cueBall: cueball },
    profile,
    calculator,
    { ruleName: shotCtx.ruleName ?? "eightball" }
  )
}
