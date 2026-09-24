import { Vector3 } from "three"
import { Ball } from "../../../model/ball"
import { Table } from "../../../model/table"
import { R } from "../../../model/physics/constants"
import { TableGeometry } from "../../../view/tablegeometry"
import { DecisionContext } from "./shotcontext"
import { enumerateCandidates, lineClearance, distToRail } from "./offense"
import { PowerTier } from "./power"
import { cueSpeedFor } from "../powerphysics"

/**
 * v1.3.91：防守策略池（专业级 AI 决策层 · 最高优先级）。
 *
 * 用户对本档 AI 的核心要求是「模拟真实职业选手的战术思维，兼顾进攻、
 * 走位、防守博弈」，而防守是这套思维里权重最高的一环 —— 职业选手宁可
 * 少进一颗球，也绝不给对手留下简单机会。
 *
 * 改造前的防守只有**一种**：在合法目标球里挑「碰完之后母球离对手球最远」
 * 的那颗，轻推过去。这条规则有三个问题：
 *   ① 「母球离对手球远」不等于「对手难打」—— 距离远但角度正对袋口的球
 *      反而是好球，AI 等于在给对手送礼；
 *   ② 完全没有考虑**母球可以藏起来**（斯诺克），而这是职业防守最有效的手段；
 *   ③ 不会区分「轻推贴球」与「把袋口球推走」这两种力度截然不同的战术。
 *
 * 本模块提供三种职业防守方案，每种都给出「打完之后对手的威胁值」，
 * 由上层选**威胁最小**的那个：
 *
 *   ┌ ① 贴球防守  ── 瞄准目标球球心极轻推，让母球停在目标球旁边
 *   ├ ② 斯诺克    ── 把母球藏到障碍球后方，求遮挡球的「阴影扇形」区域
 *   ├ ③ 推远袋口  ── 沿「目标球 → 远离袋口」方向把袋口球推走
 *   └ ④ 一库解球  ── 直线全被挡时用镜像法绕库，仍是合法首撞
 *
 * 所有方案都严格保证**合法性**（击球后必有球碰库），因为防守送出犯规
 * 比不防守更糟。
 */

/** 防守方案类型 */
export type DefenseKind = "touch" | "snooker" | "pushaway" | "kick" | "desperate"

/**
 * 合法性闸门：沿 aimPoint 方向出杆，预测的首撞是否落在**本方**目标球上。
 *
 * v1.3.91：这是防守方案进入候选池的**必过条件**。
 * 八球规则下「首撞非本方球」是直接犯规送自由球 —— 防守送出犯规比不防守
 * 更糟。实测没有这道闸门时，foulsnook 场景（60% 本方球被对方球挡住）
 * 的首撞犯规率从 0.3% 暴涨到 14.3%：三种防守方案都是从「目标球」出发
 * 构造的，没有检查「母球到那个瞄准点的路径是否被对方球截断」。
 *
 * 判定方式与 professional.ts 的最终闸门同源（射线垂距 < 2R 视为会撞上，
 * 取投影最近的球作为首撞）。
 */
export function firstContactIsLegal(
  dctx: DecisionContext,
  aimPoint: Vector3
): boolean {
  const cue = dctx.cue
  const dir = aimPoint.clone().sub(cue.pos)
  if (dir.lengthSq() < 1e-9) return false
  dir.normalize()
  const legal = new Set<Ball>(dctx.targets)
  let bestT = Infinity
  let bestBall: Ball | null = null
  for (const b of dctx.allBalls) {
    if (b === cue) continue
    const rel = b.pos.clone().sub(cue.pos)
    const t = rel.dot(dir)
    if (t <= 0) continue
    const perp = Math.sqrt(Math.max(0, rel.lengthSq() - t * t))
    if (perp < 2 * R && t < bestT) {
      bestT = t
      bestBall = b
    }
  }
  // 一颗球都碰不到：可能先撞库（解球），交给上层的一库解球逻辑处理
  if (!bestBall) return true
  return legal.has(bestBall)
}

/** 一个防守方案 */
export interface DefensePlan {
  kind: DefenseKind
  /** 瞄准点（世界坐标，直接喂给 generateShot） */
  aimPoint: Vector3
  /** 计划出杆速度（m/s） */
  power: number
  /** 力度档位（供误差模型使用） */
  tier: PowerTier
  /** 杆法（防守一般用中杆或轻低杆） */
  spin: Vector3
  /**
   * 执行此方案后，**对手**的威胁值 0~1（越小越好，这是选方案的唯一依据）。
   */
  opponentThreat: number
  /** 人类可读的方案说明（调试面板/harness 展示用） */
  note: string
}

/** 斯诺克判定：对手最佳候选的净空需低于此值才算「藏住了」（米） */
const SNOOKER_BLOCKED_CLEARANCE = 2.6 * R
/** 推远袋口：目标球需要被推离袋口的最小距离（米） */
const PUSHAWAY_MIN_TRAVEL = 6 * R

/**
 * 评估「把母球放在 hypotheticalCuePos 时，对手的进攻威胁」。
 *
 * 这是防守决策的**唯一裁判**：不管用什么手段，最终都要落到
 * 「对手接下来有多好打」这一个可比较的数值上。
 *
 * 算法：
 *   1. 把对手花色球代入候选枚举（与自己做进攻评估完全同一套代码）；
 *   2. 统计其中难度 ≤ 阈值的「简单机会」有几个；
 *   3. 机会越多、平均难度越低 → 威胁越大；对手可直接清台时拉满。
 *
 * @param dctx              决策上下文
 * @param hypotheticalCuePos 假想的母球停位（评估「打完之后」的局面）
 */
export function evalThreat(
  dctx: DecisionContext,
  hypotheticalCuePos: Vector3
): number {
  if (dctx.opponentBalls.length === 0) return 0
  const virtualCue = { ...dctx.cue, pos: hypotheticalCuePos.clone() } as Ball
  const oppCtx: DecisionContext = {
    ...dctx,
    cue: virtualCue,
    targets: dctx.opponentBalls,
  }
  const cands = enumerateCandidates(oppCtx, 0.2)
  if (cands.length === 0) return 0

  const threshold = dctx.profile.offenseThreshold ?? 0.72
  const easy = cands.filter((c) => c.difficulty <= threshold)
  if (easy.length === 0) {
    // 一个简单机会都没有：威胁仅来自「有球可打但都很难」
    const bestDiff = Math.min(...cands.map((c) => c.difficulty))
    return Math.max(0, 0.25 * (1 - bestDiff))
  }
  const avgDifficulty = easy.reduce((s, c) => s + c.difficulty, 0) / easy.length
  // 机会越多、越容易 → 威胁越大（4 个以上简单机会视为清台局）
  let threat = Math.min(1, easy.length / 4) * (1 - avgDifficulty)
  if (easy.length >= dctx.opponentBalls.length) threat = Math.max(threat, 0.85)
  return Math.max(0, Math.min(1, threat))
}

/**
 * 生成全部可行的防守方案（按对手威胁升序排列）。
 *
 * @param dctx       决策上下文
 * @param calculator 瞄准计算器
 */
export function buildDefensePlans(
  dctx: DecisionContext,
  calculator: {
    getAimPoint: (a: Vector3, b: Vector3) => Vector3
  }
): DefensePlan[] {
  const plans: DefensePlan[] = []
  const allBalls = dctx.allBalls
  // v1.3.91：以「当前局面下对手的威胁」为基线，方案只有在**确实把威胁
  // 压下去**时才算有效。没有这条判据时，斯诺克方案会以 95.8% 的压倒性
  // 比例被选中 —— 因为「假设母球藏到障碍球后面」的威胁评估天然乐观，
  // 而 AI 其实难以精确把母球停到那个点上。要求明确的改善幅度可以抑制
  // 这种「账面好看、执行不到」的方案。
  const baseline = evalThreat(dctx, dctx.cue.pos)

  for (const ball of dctx.targets) {
    // ── ① 贴球防守 ──
    // 瞄准球心极轻推，让母球在撞击后几乎原地停住、紧挨着目标球。
    // 力度取「物体球刚够滚到袋口边界」，没进也必撞库（合法性），
    // 这是三项方案里对手最难借力的一个：母球贴着球，对手连出杆角度都窄。
    const touch = touchDefense(dctx, calculator, ball)
    if (touch) plans.push(touch)

    // ── ② 斯诺克（藏母球）──
    // 求「遮挡球的阴影扇形」：沿 目标球 → 障碍球 方向延长，
    // 落在延长线附近的母球停位就能把目标球挡住。
    const snooker = snookerDefense(dctx, calculator, ball, allBalls)
    if (snooker) plans.push(snooker)

    // ── ③ 推远袋口 ──
    // 若这颗球是「袋口机会球」（离袋 < 8R），把它推开是最直接的止损：
    // 对手面对的不再是一个几乎必进的球。
    const push = pushAwayDefense(dctx, calculator, ball)
    if (push) plans.push(push)
  }

  // ── ④ 一库解球（kick）──
  // v1.3.91 二轮：这一条是**强制防守场景的关键补位**。
  //
  // 上面三种方案都从「母球 → 目标球」直线出发，当全部直线被对方球截断
  // （被做斯诺克的局面）时会**整体为空**。改造前这种局面落到旧的
  // safetyOrFallback：它挑「最畅通的一颗」硬打，实测首撞犯规率 38%。
  //
  // 镜像法绕库能让母球先碰库再吃到本方球，首撞合法 —— 这正是职业选手
  // 被做斯诺克时的标准解法，必须与其他三种战术并列参与「对手威胁」比选，
  // 而不是等到池空了才当兜底。
  const kick = kickDefense(dctx, calculator)
  if (kick) plans.push(kick)

  // 按对手威胁升序：最前面的就是「对手最难破解」的那个方案。
  // v1.3.91：过滤掉首撞犯规的方案（见 firstContactIsLegal 注释）。
  const viable = plans
    .filter((p) => firstContactIsLegal(dctx, p.aimPoint))
    .sort((a, b) => a.opponentThreat - b.opponentThreat)

  // 只保留「相对当前局面确有改善」的方案；改善幅度小于 0.05 视同无效
  // （避免为了账面数字选一个自己根本执行不到的方案）。
  const improved = viable.filter(
    (p) => p.opponentThreat < baseline - 0.05
  )
  // 全部都没改善时退回「威胁最低的那个」，防守总比不设防好
  return improved.length > 0 ? improved : viable.slice(0, 1)
}

/**
 * ① 贴球防守。
 *
 * 让母球轻轻贴上目标球。这是最安全的防守形态之一：母球紧贴目标球时，
 * 对手几乎无法做出有效击球（撞球行程太短），只能被动解球。
 *
 * 合法性保证：力度反解为「物体球滚到袋口边界仍需撞库余速」，
 * 因此即使没打进，物体球也必然碰到库边 —— 不犯「无球碰库」。
 */
function touchDefense(
  dctx: DecisionContext,
  calculator: { getAimPoint: (a: Vector3, b: Vector3) => Vector3 },
  ball: Ball
): DefensePlan | null {
  const cue = dctx.cue
  const aimPoint = calculator.getAimPoint(cue.pos, ball.pos)
  // 母球停在目标球旁 → 用目标球位置近似评估对手威胁
  const stop = ball.pos
    .clone()
    .add(
      cue.pos
        .clone()
        .sub(ball.pos)
        .normalize()
        .multiplyScalar(2.2 * R)
    )
  const threat = evalThreat(dctx, stop)
  // 轻推力度：够碰到球、并让球滚一小段（保证碰库）
  const power = Math.min(48 * R, Math.max(24 * R, cue.pos.distanceTo(ball.pos) * 22))
  return {
    kind: "touch",
    aimPoint,
    power,
    tier: "touch",
    spin: new Vector3(0, -0.2, 0),
    opponentThreat: threat,
    note: `贴球防守 #${ball.label}（母球停在目标球旁）`,
  }
}

/**
 * ② 斯诺克（藏母球）。
 *
 * 找一颗「障碍球」，把母球放到它的阴影里 —— 也就是
 * 「目标球 → 障碍球」连线的延长线附近。这样对手看得到目标球，
 * 但直线路径被障碍球挡住，只能打库解球。
 *
 * 实现：对每颗非目标球做障碍，沿「障碍球 → 目标球」方向反向延长一个
 * 母球停位，检查 (a) 该停位不越界、不与任何球重叠；(b) 从该停位到
 * 目标球的**每一条**袋口线路都被这颗障碍球挡住（否则只是部分遮挡）；
 * (c) 母球从当前位置能合法地打到目标球（不能为了藏母球先犯规）。
 */
function snookerDefense(
  dctx: DecisionContext,
  calculator: { getAimPoint: (a: Vector3, b: Vector3) => Vector3 },
  ball: Ball,
  allBalls: Ball[]
): DefensePlan | null {
  const cue = dctx.cue
  let best: DefensePlan | null = null

  for (const blocker of allBalls) {
    if (blocker === ball || blocker === cue) continue
    // 母球应停在「过 blocker、平行于 blocker→ball 的反方向」一侧，
    // 取距离 blocker 2.6R（母球贴着障碍球，遮挡最彻底）
    const away = blocker.pos.clone().sub(ball.pos).normalize()
    const stop = blocker.pos.clone().addScaledVector(away, 2.6 * R)

    // 越界检查（留 1.2R 余量，避免母球贴在库上导致出杆异常）
    if (
      Math.abs(stop.x) > TableGeometry.X - 1.2 * R ||
      Math.abs(stop.y) > TableGeometry.Y - 1.2 * R
    )
      continue
    // 重叠检查
    let overlap = false
    for (const b of allBalls) {
      if (b === cue) continue
      if (stop.distanceTo(b.pos) < 2.2 * R) {
        overlap = true
        break
      }
    }
    if (overlap) continue

    // 从假想停位出发，看目标球是否**所有**袋口线路都被挡
    let allBlocked = dctx.pockets.length > 0
    let blockedCount = 0
    for (const _p of dctx.pockets) {
      const ghost = calculator.getAimPoint(stop, ball.pos)
      const clr = lineClearance(stop, ghost, allBalls, cue, ball)
      if (clr < SNOOKER_BLOCKED_CLEARANCE) blockedCount++
    }
    allBlocked = blockedCount >= Math.ceil(dctx.pockets.length * 0.5)
    if (!allBlocked) continue

    // 合法性：母球从当前位置必须能打到目标球（否则这一杆本身就是犯规）
    const realGhost = calculator.getAimPoint(cue.pos, ball.pos)
    if (
      lineClearance(cue.pos, realGhost, allBalls, cue, ball) <
      2 * R
    )
      continue

    const threat = evalThreat(dctx, stop)
    const plan: DefensePlan = {
      kind: "snooker",
      aimPoint: realGhost,
      power: Math.min(55 * R, Math.max(28 * R, cue.pos.distanceTo(ball.pos) * 26)),
      tier: "medium",
      spin: new Vector3(0, 0.1, 0),
      opponentThreat: threat,
      note: `斯诺克 #${ball.label}（藏母球于 #${blocker.label} 后方，遮挡 ${blockedCount}/${dctx.pockets.length} 条线）`,
    }
    if (!best || plan.opponentThreat < best.opponentThreat) best = plan
  }
  return best
}

/**
 * ③ 推远袋口。
 *
 * 目标球若离袋口很近（< 8R），它就是对手的「机会球」。与其让它在袋口
 * 等着，不如把它推离袋口 —— 对手面对的难度立刻上升。
 *
 * 力度用中力：太轻推不动、太重容易把球推到别的袋口或者自己摔袋。
 * 方向沿「袋口 → 台心」的延长线，把球往台面深处推。
 */
function pushAwayDefense(
  dctx: DecisionContext,
  calculator: { getAimPoint: (a: Vector3, b: Vector3) => Vector3 },
  ball: Ball
): DefensePlan | null {
  const cue = dctx.cue
  // 找最近的袋口
  let nearestPocket: Vector3 | null = null
  let nearestD = Infinity
  for (const p of dctx.pockets) {
    const d = ball.pos.distanceTo(p)
    if (d < nearestD) {
      nearestD = d
      nearestPocket = p
    }
  }
  if (!nearestPocket) return null
  // 只有「袋口机会球」才值得专门推走
  if (nearestD > 8 * R) return null

  // 母球需要站在「能把这颗球推向台心」的位置上，即球的目标方向是离袋方向
  const pushDir = ball.pos.clone().sub(nearestPocket).normalize()
  // 母球瞄准点：沿 pushDir 反方向 R*2.001（标准 ghost 位置）
  const ghost = ball.pos.clone().addScaledVector(pushDir, -2.001 * R)
  // 检查这条线是否畅通
  if (lineClearance(cue.pos, ghost, dctx.allBalls, cue, ball) < 2 * R) return null
  // 推完之后目标球大约走 PUSHAWAY_MIN_TRAVEL，估一下停位
  const ballAfter = ball.pos
    .clone()
    .addScaledVector(pushDir, PUSHAWAY_MIN_TRAVEL)
  // 用「目标球被推远后 + 母球停在球后」近似评估威胁
  const stop = ghost.clone().addScaledVector(pushDir, 1.5 * R)
  const threat = evalThreat(dctx, stop)
  void ballAfter
  void calculator

  return {
    kind: "pushaway",
    aimPoint: ghost,
    power: Math.min(80 * R, Math.max(50 * R, cue.pos.distanceTo(ball.pos) * 30)),
    tier: "medium",
    spin: new Vector3(0, -0.15, 0),
    opponentThreat: threat,
    note: `推远袋口 #${ball.label}（离袋 ${(nearestD / R).toFixed(1)}R，推离 ${(
      PUSHAWAY_MIN_TRAVEL / R
    ).toFixed(0)}R）`,
  }
}

/**
 * ④ 一库解球（镜像法）。
 *
 * 全部「母球直打目标球」的线路被对方球截断时（典型：被做斯诺克），
 * 唯一体面的合法出路是**借库**：把目标球关于某条库边做镜像，母球瞄准
 * 镜像点出杆，撞库反弹（入射角 ≈ 反射角，不加旋转）后正好朝目标球去。
 *
 * 这与 professional.ts 旧 `tryKickShot` 是同一套几何，但有两个关键区别：
 *   ① 这里返回 `DefensePlan`，因此**必须**参加统一的「对手威胁」比选，
 *      而不是等防守池空了才被当作兜底；
 *   ② 威胁值用「解完之后母球大致停在反弹点附近、还需走一段才能回到台面」
 *      这一物理直觉给出保守估计 —— 解球本来就只是止损，不指望压制对手。
 *
 * 四条库的镜像点全部枚举，取**总路程最短**（母球→反弹点→目标球）的那个；
 * 反弹点必须离袋口足够远，否则撞进去等于摔袋送自由球。
 *
 * ⚠️ v1.3.91 二轮修正 —— **必须瞄准库面上的反弹点，不能瞄镜像点**。
 * 镜像点几何上是「母球→反弹点」这条线的正确方向，但它本身落在**台外**
 * （如 x = 2X − ball.x）。实测（tools/harness/_mirror.ts）把台外镜像点
 * 直接当瞄准点喂给物理引擎时，母球**一次库都碰不到**（事件序列只有
 * `H:0 H:0 H:0`，没有任何 `R:` 反弹事件），于是沿着那条射线一路平推，
 * 首撞到路径上任意一颗**对方球** —— forced 场景实测首撞犯规 21.7%，
 * 且犯规样本里「首撞前碰库」恒为 0%。
 *
 * 反弹点在库面上、位于台内，瞄准它同样给出正确的入射方向，而物理引擎
 * 会在那里正常触发库边反弹。因此 aimPoint 取 bounce，镜像点仅用于定方向。
 */
function kickDefense(
  dctx: DecisionContext,
  calculator: { getAimPoint: (a: Vector3, b: Vector3) => Vector3 }
): DefensePlan | null {
  const cue = dctx.cue
  // 反弹点必须落在「球心可达的库面」上：库面球心位置是 tableX/tableY = X−R，
  // 而不是 X（X 是球心能到达的极限，见 cushion.ts 的 willBounceLong）。
  const faceX = TableGeometry.tableX
  const faceY = TableGeometry.tableY
  let best: { aim: Vector3; bounce: Vector3; ball: Ball; total: number } | null = null

  for (const ball of dctx.targets) {
    // 关于「球心可达库面」（±faceX / ±faceY）做镜像
    const mirrors: { mirror: Vector3; axis: "x" | "y"; plane: number }[] = [
      { mirror: new Vector3(2 * faceX - ball.pos.x, ball.pos.y, 0), axis: "x", plane: faceX },
      { mirror: new Vector3(-2 * faceX - ball.pos.x, ball.pos.y, 0), axis: "x", plane: -faceX },
      { mirror: new Vector3(ball.pos.x, 2 * faceY - ball.pos.y, 0), axis: "y", plane: faceY },
      { mirror: new Vector3(ball.pos.x, -2 * faceY - ball.pos.y, 0), axis: "y", plane: -faceY },
    ]
    for (const m of mirrors) {
      // 母球 → 镜像点 与库面的交点 = 反弹点
      const from = m.axis === "x" ? cue.pos.x : cue.pos.y
      const to = m.axis === "x" ? m.mirror.x : m.mirror.y
      const denom = to - from
      if (Math.abs(denom) < 1e-6) continue
      const t = (m.plane - from) / denom
      if (t <= 0 || t >= 1) continue
      const bounce =
        m.axis === "x"
          ? new Vector3(m.plane, cue.pos.y + t * (m.mirror.y - cue.pos.y), 0)
          : new Vector3(cue.pos.x + t * (m.mirror.x - cue.pos.x), m.plane, 0)

      // 反弹点不能落在袋口里（撞进去等于摔袋）
      let nearPocket = false
      for (const pk of dctx.pockets) {
        if (bounce.distanceTo(pk) < 2.1 * R) {
          nearPocket = true
          break
        }
      }
      if (nearPocket) continue

      const d1 = cue.pos.distanceTo(bounce)
      const d2 = bounce.distanceTo(ball.pos)
      if (d1 < 1.5 * R || d2 < 2 * R) continue
      // 两段路径都必须畅通
      if (lineClearance(cue.pos, bounce, dctx.allBalls, cue, ball) < 2 * R) continue
      if (lineClearance(bounce, ball.pos, dctx.allBalls, ball) < 2 * R) continue

      const total = d1 + d2
      if (!best || total < best.total) best = { aim: bounce, bounce, ball, total }
    }
  }
  if (!best) return null

  // 解球完母球会停在反弹点附近再被库弹回来一段：用「反弹点 + 往台心 3R」
  // 作为保守停位估计（解球不指望走位，只要不留给对手必进球局）。
  const stop = best.bounce
    .clone()
    .addScaledVector(
      best.ball.pos.clone().sub(best.bounce).normalize(),
      Math.min(4 * R, best.total * 0.15)
    )
  const threat = evalThreat(dctx, stop)

  // 力度：沿「母球→库→球」总路程做物理反解。
  //
  // v1.3.91 二轮：实测标定（tools/harness/_powercalib.ts / _reach.ts）表明
  // 母球满力纯滚动可达 ~85 m，而台面长边仅 2.8 m —— **距离从来不是约束**，
  // 旧的 `total * 26` 线性系数其实是过供（把 72R 上限打满）。
  // 库边弹性约 0.75，等效路程按 1/0.75 放大，取中力档即可稳稳到位。
  // 用 cueSpeedFor 做物理反解，与 safetyOrFallback 的安全球同源。
  const power = Math.min(
    90 * R,
    Math.max(
      cueSpeedFor(best.total / 0.75, 6 * R, 2 * R, 1, 0, 0, 1.15),
      40 * R
    )
  )

  // ── v1.3.92：一库解球必须复核「母球解完之后会不会自己摔袋」 ──
  //
  // 上面只检查了**反弹点**不在袋口里，却完全没管母球撞库**之后**去哪。
  // 一库解球的力度是为「把目标球推到位」反解出来的，母球撞库后余速很足，
  // 反弹方向若指向袋口，就是白送一次摔袋。
  //
  // 对局级实测（tools/harness/_diagmatch.ts 第4局）里的表现是最坏形态：
  // 剩最后一颗球、母球贴库时，AI 反复选出几乎相同的解球线，
  // **连续 50+ 杆全部摔袋**，整局作废 —— 因为摔袋后母球被重摆回库边，
  // 局面几乎不变，下一杆又选出同一条线，形成死循环。
  //
  // 现在用真实物理跑一遍，按力度从大到小找一条「母球不进袋、且停位不贴袋口」
  // 的解球线；全都摔袋则返回 null，让上层改用别的防守方案（而不是硬打）。
  const checked = verifyKickNoScratch(dctx, best.aim, power)
  if (!checked) return null
  void calculator

  return {
    kind: "kick",
    // ⚠️ 必须瞄库面上的反弹点，不能瞄台外的镜像点（见函数头注释）
    aimPoint: best.aim,
    power: checked,
    tier: "medium",
    spin: new Vector3(0, 0, 0),
    opponentThreat: threat,
    note: `一库解球 #${best.ball.label}（绕库总程 ${(best.total / R).toFixed(1)}R）`,
  }
}

/**
 * v1.3.92：在克隆台上试打一杆一库解球，返回**安全**的力度（不安全返回 null）。
 *
 * 判定「安全」= 母球没进袋 **且** 停位离最近袋心 > 2.2R。
 * 从给定力度起逐级收力重试（收力只会让母球跑得更短、通常更安全）。
 *
 * 决策必须**只读**：全程在克隆出的临时球台上推进物理，绝不触碰真实比赛桌。
 */
function verifyKickNoScratch(
  dctx: DecisionContext,
  aimPoint: Vector3,
  power: number
): number | null {
  const source = dctx.table.balls
  for (const scale of [1.0, 0.8, 0.62, 0.48]) {
    const trial = Math.max(18 * R, power * scale)
    try {
      const clones: Ball[] = source.map((b: Ball) => {
        const nb = new Ball(b.pos.clone(), undefined, b.label)
        nb.setStationary()
        return nb
      })
      const probe = new Table(clones)
      probe.cueball = clones[0]
      const hit = dctx.calculator.generateShot(
        probe,
        0,
        trial,
        aimPoint,
        new Vector3(0, 0, 0)
      )
      probe.cue!.aim = (hit.tablejson as { aim: never }).aim
      probe.cue!.hit(probe.cueball)
      let guard = 0
      while (!probe.allStationary() && guard++ < 200000) {
        probe.advance(0.001953125)
      }
      if (guard >= 200000) continue
      if (!probe.cueball.onTable()) continue // 母球进袋 → 换更小的力度
      let nearest = Infinity
      for (const pk of dctx.pockets) {
        const dd = probe.cueball.pos.distanceTo(pk)
        if (dd < nearest) nearest = dd
      }
      if (nearest < 2.2 * R) continue // 停位贴袋口，下一杆极易摔袋
      return trial
    } catch {
      continue
    }
  }
  return null
}

/**
 * 认命兜底：所有正经防守都不可行（被完全锁死）时的最后一招。
 * 挑一颗最容易碰到的目标球，用足够力度打过去，优先保证「不空杆」。
 */
export function desperatePlan(
  dctx: DecisionContext,
  calculator: { getAimPoint: (a: Vector3, b: Vector3) => Vector3 }
): DefensePlan | null {
  const cue = dctx.cue
  if (dctx.targets.length === 0) return null
  let bestBall = dctx.targets[0]
  let bestClarity = -Infinity
  for (const b of dctx.targets) {
    const ghost = calculator.getAimPoint(cue.pos, b.pos)
    const clarity = lineClearance(cue.pos, ghost, dctx.allBalls, cue, b)
    if (clarity > bestClarity) {
      bestClarity = clarity
      bestBall = b
    }
  }
  const aimPoint = calculator.getAimPoint(cue.pos, bestBall.pos)
  // v1.3.91：认命兜底是最后一道防线，但**依然不允许首撞犯规**。
  // 若连「最畅通的那颗」都会先撞到对方球，说明确实无解 —— 返回 null，
  // 让上层走一库解球；一库也解不到才真的认命。
  if (!firstContactIsLegal(dctx, aimPoint)) return null
  return {
    kind: "desperate",
    aimPoint,
    power: 70 * R,
    tier: "medium",
    spin: new Vector3(0, 0, 0),
    opponentThreat: 1,
    note: `认命兜底 #${bestBall.label}（净空 ${(bestClarity / R).toFixed(2)}R）`,
  }
}

/** 母球到最近库边的距离（米）——供上层评估停位质量 */
export function railProximity(p: Vector3): number {
  return distToRail(p)
}
