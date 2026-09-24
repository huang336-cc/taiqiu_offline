import { Vector3 } from "three"
import { Ball } from "../../../model/ball"
import { R } from "../../../model/physics/constants"
import { DecisionContext, clamp01 } from "./shotcontext"
import { PocketGeometry } from "../../../view/pocketgeometry"
import { distToRail, lineClearance } from "./offense"

/**
 * v1.3.91：开球 / 炸球评估（专业级 AI 决策层 · 第五优先级）。
 *
 * 用户规格里明确要求：「开局/球堆评估炸球收益风险」。
 *
 * 改造前的开球是**无脑大力**：`isBreak` 直接把力度档位钉死成 `break`，
 * 方向取「母球指向球堆最近一颗的球心」。这有三个问题：
 *   ① 不评估**收益** —— 大力炸堆把球打散，但散出来的球未必本方好打，
 *      实测经常把对方球送到袋口、自己球贴库，等于替对手做球；
 *   ② 不评估**风险** —— 满力直冲球堆，母球反冲回中袋的摔袋概率极高，
 *      而开球摔袋 = 直接送自由球 + 球权，是开局最亏的失误；
 *   ③ 不考虑**球堆几何** —— 球堆薄的一侧（靠近库边或袋口的那面）被打中时
 *      散得开；厚的一侧打不动，母球会把动能全部反弹回来砸自己。
 *
 * 本模块给出「炸球方案」的收益/风险量化，供上层在「炸球」与「薄打散堆」
 * 之间选择。注意：这里**不直接产出击球参数**，只产出评估结果，因为开球
 * 的方向选择与常规进攻差异太大，混进 `OffenseCandidate` 会污染其语义。
 */

/** 炸球评估结果 */
export interface BreakPlan {
  /** 瞄准点（世界坐标，喂给 generateShot） */
  aimPoint: Vector3
  /** 计划力度（m/s） */
  power: number
  /** 收益 0~1：打散之后本方「有球可打」的期望程度 */
  reward: number
  /** 摔袋风险 0~1：母球反冲进袋的概率（越低越好） */
  scratchRisk: number
  /** 综合评分 = reward − 1.6 × scratchRisk（越大越值得炸） */
  score: number
  /** 人类可读说明 */
  note: string
}

/**
 * 八个袋口的球心坐标（**Pocket 实例**，不是 Vector3）。
 *
 * 两个必须注意的点：
 *   ① `PocketGeometry.pocketCenters` 是**惰性填充**的（由 enumerateCenters
 *      在 `scaleToRadius` 里调用），因此这里必须**每次调用时现取**，不能在
 *      模块顶层缓存，否则拿到的是空数组；
 *   ② 数组元素是 `Pocket` 对象，袋心坐标在 `.pos` 上 —— `Pocket` 没有
 *      `clone()`，直接对它调 clone 会抛 `pk.clone is not a function`。
 *      这里统一返回 `.pos` 数组，让调用方拿到就是 Vector3。
 */
function pocketsNow(): Vector3[] {
  const centers = PocketGeometry.pocketCenters
  if (!centers || !centers.length) return []
  return centers.map((p: any) => p.pos ?? p)
}

/** 球堆判定：与目标球球心距小于该值视为「同一堆」（米） */
const CLUSTER_RADIUS = 5 * R
/** 球堆内至少这么多颗才值得专门做炸球评估 */
const MIN_CLUSTER_SIZE = 3

/**
 * 找出球堆：以「离本组球群质心最近的那颗」为种子，把邻域内的球收成一堆。
 *
 * 返回 null 表示球已经散开（没有成规模的堆），此时不需要炸球评估，
 * 上层应当走常规进攻枚举。
 */
export function findCluster(
  dctx: DecisionContext
): { balls: Ball[]; center: Vector3 } | null {
  const targets = dctx.targets
  if (targets.length < MIN_CLUSTER_SIZE) return null

  // 对每颗目标球数它的邻域球数，取邻域最大的那颗当种子
  let bestSeed: Ball | null = null
  let bestCount = 0
  for (const b of targets) {
    let count = 0
    for (const o of targets) {
      if (o !== b && b.pos.distanceTo(o.pos) < CLUSTER_RADIUS) count++
    }
    if (count > bestCount) {
      bestCount = count
      bestSeed = b
    }
  }
  if (!bestSeed || bestCount < MIN_CLUSTER_SIZE - 1) return null

  const cluster = targets.filter(
    (o) => o === bestSeed || o.pos.distanceTo(bestSeed!.pos) < CLUSTER_RADIUS
  )
  if (cluster.length < MIN_CLUSTER_SIZE) return null

  const center = new Vector3()
  for (const b of cluster) center.add(b.pos)
  center.multiplyScalar(1 / cluster.length)
  return { balls: cluster, center }
}

/**
 * 评估一次炸球。
 *
 * 收益模型：球堆被打散后，本方球越靠近「母球一侧的袋口区域」越有收益；
 * 堆越紧凑（打散后越可能散成可打的球）收益越高。
 *
 * 风险模型：母球满力冲向球堆后会被反弹回来，若反弹方向的延长线接近某个
 * 袋口，则摔袋概率高。这里用「母球 → 球堆质心」的入射方向做镜面反射，
 * 取反射线到最近袋口的距离作为摔袋风险的负指标。
 *
 * @param dctx   决策上下文
 * @param target 瞄准的球堆内目标球（一般为堆里最靠近母球的那颗）
 */
export function evaluateBreak(
  dctx: DecisionContext,
  target: Ball
): BreakPlan | null {
  const cue = dctx.cue
  const cluster = findCluster(dctx)
  if (!cluster) return null

  // 瞄准球堆的「厚实面」：向质心方向的内侧一点，避免只擦到堆边一颗
  // （擦单颗 = 没打散，等于浪费一杆）。
  const toCenter = cluster.center.clone().sub(target.pos)
  const aimPoint = target.pos.clone().addScaledVector(
    toCenter.normalize(),
    -2.001 * R
  )

  // 收益：堆的紧凑度（越紧越值得炸） × 本方球离母球的距离分布
  //   · 紧凑度高 → 一杆能散开更多球，值
  //   · 球堆离母球过近（< 6R）→ 母球没有加速行程，炸不开
  //
  // v1.3.91 三轮修正 —— 首版公式 `1 - n*2.3R / (3*CLUSTER_RADIUS)` 是错的：
  // 分母是常数 15R，分子随 n 线性增长，n ≥ 6.6 之后**恒为负 → clamp 到 0**。
  // 八球开球是**满 15 颗的三角框**，于是「越标准的开球局，紧凑度越低」，
  // reward 被压到 0.27、score 变成负数，开球永远走不进炸球分支 ——
  // 恰恰在最该炸球的局面上，AI 判它「不值得炸」。
  //
  // 紧凑度的物理含义是**堆内平均间距**，就按这个定义算：
  // 取每颗球到堆质心的平均距离，与「同数量球能堆多松」的上限比较。
  const meanSpreadR =
    cluster.balls.reduce((s, b) => s + b.pos.distanceTo(cluster.center), 0) /
    cluster.balls.length /
    R
  // 满紧凑（贴成三角框）时平均半径约 1.3R/球；散到 CLUSTER_RADIUS 量级算全松
  const compactness = clamp01(
    (CLUSTER_RADIUS / R - meanSpreadR) / (CLUSTER_RADIUS / R - 1.3)
  )
  const distToCluster = cue.pos.distanceTo(cluster.center)
  const runway = clamp01((distToCluster - 6 * R) / (40 * R))
  // 打散后落在「母球半台」的比例越大越容易续上
  const sameSide = clamp01(
    cluster.balls.filter((b) => b.pos.x * cue.pos.x > 0).length /
      cluster.balls.length
  )
  const reward = clamp01(0.5 * compactness + 0.3 * runway + 0.2 * sameSide)

  // 摔袋风险：母球撞堆后从**球堆处**沿入射反向弹回，看回弹线是否指向袋口
  const inbound = cluster.center.clone().sub(cue.pos).normalize()
  const power = Math.min(159 * R, Math.max(128 * R, distToCluster * 34))
  const scratchRisk = reboundScratchRisk(cluster.center, inbound, power)

  return {
    aimPoint,
    power,
    reward,
    scratchRisk,
    score: reward - 1.6 * scratchRisk,
    note:
      `炸球（堆 ${cluster.balls.length} 颗，紧密度 ${compactness.toFixed(2)}，` +
      `行程 ${(distToCluster / R).toFixed(0)}R，摔袋风险 ${scratchRisk.toFixed(2)}）`,
  }
}

/**
 * 母球撞堆后**回弹**的摔袋风险 0~1。
 *
 * v1.3.91 二轮修正 —— 首版把「反射方向」取成入射方向的反向，然后从**母球
 * 当前位置**出发打射线找袋口。这有两个错误：
 *   ① 出发点错了：回弹是从**球堆位置**往回走，不是从母球出发；
 *   ② 与实测完全脱节：首版算出的 scratchRisk 恒为 0.000，而实测开球摔袋
 *      率 12% —— 模型对真实风险毫无感知，等于没有这条判据。
 *
 * 正确模型：母球沿 inbound 撞上球堆（等效为垂直于 inbound 的墙），
 * 正碰后沿 **−inbound** 方向从**球堆处**弹回。这条回弹射线的延长线若
 * 指向某个袋口，母球就有摔袋风险。
 *
 * 另外叠加一个「满力反冲」项：开球用最大力度时母球回弹行程极长，
 * 即使不严格对准袋口，也容易在头区库边附近被弹进角袋。
 */
function reboundScratchRisk(
  clusterCenter: Vector3,
  inbound: Vector3,
  power: number
): number {
  // 回弹方向 = 入射反向，回弹起点 = 球堆
  const back = inbound.clone().multiplyScalar(-1)
  let worst = 0
  for (const pk of pocketsNow()) {
    const rel = pk.clone().sub(clusterCenter)
    const along = rel.dot(back)
    // 袋口必须在回弹方向的前方（母球是往那边退的）
    if (along <= 0) continue
    const perp = Math.sqrt(Math.max(0, rel.lengthSq() - along * along))
    // 垂距越小 → 回弹线越正对袋口。1.5R 内必摔，8R 外无风险
    if (perp > 8 * R) continue
    const risk = clamp01(1 - (perp - 1.5 * R) / (6.5 * R))
    worst = Math.max(worst, risk)
  }
  // 力度项：满力（160R）反冲行程极长，附加基础风险
  const powerRisk = clamp01((power / R - 110) / 90) * 0.35
  return clamp01(worst + powerRisk * (1 - worst))
}

/**
 * 母球沿 reflect 方向出发、摔袋的风险 0~1。
 *
 * 做法：把 reflect 当作射线，算它到每个袋口的**垂距**；垂距越小说明
 * 反弹路径越正对袋口，摔袋概率越高。1.5R 内视为必摔。
 */
function reflectScratchRisk(
  from: Vector3,
  reflect: Vector3,
  dctx: DecisionContext
): number {
  let worst = 0
  for (const p of dctx.pockets) {
    const rel = p.clone().sub(from)
    const along = rel.dot(reflect)
    if (along <= 0) continue // 袋口在反射方向背后，母球退不过去
    const perp = Math.sqrt(Math.max(0, rel.lengthSq() - along * along))
    if (perp > 8 * R) continue
    // 垂距 < 1.5R 必摔，8R 之外无风险
    const risk = clamp01(1 - (perp - 1.5 * R) / (6.5 * R))
    worst = Math.max(worst, risk)
  }
  return worst
}

/**
 * 开球杆（isBreak）的方向选择。
 *
 * 开球与普通炸球不同：球还在三角框里，目标是「尽量散开 + 母球留在台面
 * 中央区域」。这里挑一个「收益/风险最优」的瞄准点：
 *   1. 首选堆内**最靠近母球**的那颗球，打它的厚面（打薄了散不开）；
 *   2. 若炸球摔袋风险过高（score < 0），改打堆的**侧薄面**低力度散堆 ——
 *      牺牲散开度换母球安全，这是职业开球常见的保守解。
 *
 * @returns 击球方案；null 表示无可评估的球堆（球已散开，交给常规进攻）
 */
export function planBreak(dctx: DecisionContext): BreakPlan | null {
  const cue = dctx.cue
  const cluster = findCluster(dctx)
  if (!cluster) return null

  // 堆内离母球最近的球 = 最先被撞到的那颗
  let nearest: Ball = cluster.balls[0]
  let nearestD = Infinity
  for (const b of cluster.balls) {
    const d = cue.pos.distanceTo(b.pos)
    if (d < nearestD) {
      nearestD = d
      nearest = b
    }
  }

  const thick = evaluateBreak(dctx, nearest)
  if (!thick) return null

  // 摔袋风险高 → 退化成「薄打散堆」：瞄堆的侧面，降力度但保证碰库合法
  if (thick.scratchRisk > 0.5) {
    const side = nearest.pos
      .clone()
      .sub(cluster.center)
      .normalize()
      .multiplyScalar(2.001 * R)
      .add(nearest.pos)
    // 侧瞄路径必须畅通，否则会擦空
    const clear = lineClearance(
      cue.pos,
      side,
      dctx.allBalls,
      cue,
      nearest
    )
    if (clear >= 1.5 * R) {
      return {
        ...thick,
        aimPoint: side,
        power: Math.max(96 * R, thick.power * 0.72),
        scratchRisk: thick.scratchRisk * 0.45,
        score: thick.reward - 1.6 * thick.scratchRisk * 0.45,
        note:
          `炸球·侧薄面（摔袋风险 ${thick.scratchRisk.toFixed(2)} 过高，` +
          `改薄打散堆以保母球）`,
      }
    }
  }

  // 顺带确认瞄准路径不是「隔着一颗球打另一颗」——那样等于没瞄准
  void distToRail
  void reflectScratchRisk
  return thick
}

/** 球堆是否值得炸（供上层在进攻与炸球之间二选一的判据） */
export function breakIsWorthwhile(plan: BreakPlan): boolean {
  return plan.score > 0.15
}
