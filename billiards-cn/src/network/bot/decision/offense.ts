import { Vector3 } from "three"
import { Ball } from "../../../model/ball"
import { R } from "../../../model/physics/constants"
import { AimCalculator, railMidMouthExcess } from "../aimcalculator"
import { POCKET_RADIUS_CORNER, POCKET_RADIUS_MIDDLE } from "../powerphysics"
import { TableGeometry } from "../../../view/tablegeometry"
import { DecisionContext, clamp01 } from "./shotcontext"

/**
 * v1.3.91：进攻难度评分与候选枚举（专业级 AI 决策层 · 第一优先级的基础设施）。
 *
 * 改造前 professional.ts 的 enumeratePlans 只算几何可行性与「切球角余弦」，
 * 然后用 cutCos 做单一排序键 —— 这等价于假设「直球一定最好」，忽略了
 * 距离、遮挡余量、袋口类型、贴库、摔袋等职业选手真正在意的东西。
 *
 * 本模块把「一个球-袋组合有多难进」量化成 0~1 的难度分：
 *   0 = 袋口球正面直推（必进）
 *   1 = 贴库薄切长台（几乎不可能）
 * 供上层做两件事：
 *   ① 阈值过滤：难度 > profile.offenseThreshold 直接放弃进攻转防守；
 *   ② 综合收益排序：avoid 只看切角、选错袋口。
 */

/** 单个「目标球 × 袋口」进攻候选及其全部评估量 */
export interface OffenseCandidate {
  ball: Ball
  pocket: Vector3
  /** 切球角余弦（1=正面直球，越小越薄） */
  cutCos: number
  /**
   * v1.3.95：旧口径「母球→目标球**球心**」夹角余弦。
   * 已退出判定（判据改用真实的 cue→ghost 方向），仅保留供诊断与回归对比。
   */
  cutCosCenter?: number
  /** 母球→目标球 球心距离（米） */
  cueToBall: number
  /** 目标球→袋口**内缩点**距离（米，= 瞄准点距离） */
  ballToPocket: number
  /** 目标球→**真实袋心**距离（米），物理反解用 */
  ballToPocketTrue: number
  /** 该袋口有效半径（米） */
  pocketRadius: number
  /** 是否角袋 */
  isCorner: boolean
  /** ghost 击球点（母球撞上目标球时的球心位置） */
  ghost: Vector3
  /** 母球→ghost 路径的最小净空（米），< 2R 视为被挡 */
  clearanceCue: number
  /** 目标球→袋口路径的最小净空（米） */
  clearanceObj: number
  /** 母球撞后估算停位 */
  stop: Vector3
  /** 停位轨迹到最近袋口的距离（米），越小越可能摔袋 */
  scratchRisk: number
  /** 停位到剩余球群中心的距离（米），越小走位越好 */
  stopToNext: number
  /** 停位贴库程度 0~1 */
  railHug: number
  /** 目标球是否贴库 */
  targetOnRail: boolean
  /** 母球是否贴库 */
  cueOnRail: boolean
  /**
   * v1.3.91：本候选是否属于「母球贴着的这颗球」。
   *
   * 贴球局面的物理与常规局面完全不同：母球与目标球几乎重叠（2.02R），
   * 撞击前的行程只有 0.02R，出杆方向的一点点偏差都会直接放大成厚薄误差；
   * 而且这种局面下母球几乎不可能「稳稳撞在 ghost 点上」，实测进球率
   * 只有 0~10%（远低于同一难度评分下常规局面的 78%+）。
   * 实测数据（400 次贴球采样）：
   *   d ∈ [0.2,0.3) → 实际进球  0.0%
   *   d ∈ [0.3,0.4) → 实际进球  0.0%
   *   d ∈ [0.4,0.5) → 实际进球 10.1%
   *   d ∈ [0.5,0.7) → 实际进球  9.2%
   * 也就是说：**贴球时原有的难度评分完全失效**（分数与进球率不相关）。
   * 因此这里单列一个标记，由 scoreDifficulty 施加高额惩罚，
   * 让决策层「知道这一杆其实很难」，从而正确地转向防守或小力处理。
   */
  cueTouchingThis: boolean
  /**
   * v1.3.92：物理预测确认「这一杆母球会落袋」。
   * 由 `refineStopsPhysics()` 写入（枚举阶段恒为 false / undefined）。
   * 与几何近似的 scratchRisk 不同，这是**确定**的摔袋判定，排序时必须无条件压后。
   */
  physicalScratch?: boolean
  /** 综合进攻难度 0~1（越大越难） */
  difficulty: number
}

/** 袋口内缩系数（与 AimCalculator.POCKET_INSET_FACTOR 同步） */
const POCKET_INSET_FACTOR = 0.94
/** 净空低于该值开始计入遮挡惩罚（米） */
const CLEARANCE_PENALTY_START = 2.6 * R
/** 目标球视为贴库的距离（米） */
const BALL_ON_RAIL = 1.6 * R

/**
 * v1.3.95：目标球贴库时「袋口进口角」的下限余弦。
 *
 * ⚠️ v1.4.0 历史注记：v1.3.95 曾有「贴库进袋方向离库分量 ≥ 0.3」的
 * strict 硬否决判据（RAIL_ENTRY_COS），v1.4.0 已整体移除。
 * 它假设「目标球贴库时只能沿离开该库的方向出球」，但袋口是库面上的**豁口**
 * ——球穿过库线进入袋口恰恰是进球的必经之路。更致命的是角袋：贴库球
 * 沿库滚动、被库面约束贴库滑行，滑到库尽头自然坠入角袋 jaw（实测 100%），
 * 而按本判据这种线路的「离库分量」只有 0.12 左右，全被误杀。
 * 误杀后果：strict 枚举对贴库球返回空 → 降级路径把所有候选难度拉平 →
 * rankPlans 按 pocketValue 排序 → 最近的中袋（袋口球加分）胜出 →
 * 打出实测 0~19% 进球率的必失之杆。这正是用户反馈的
 * 「白球和击打球都靠边库时，电脑还是选择打中袋，而不是打远处的边袋」。
 *
 * 中袋的可行性改用**穿越点判据**（见 aimcalculator.railMidMouthExcess）：
 * 球→袋心连线与库面的交点落在中袋口（2.6R）之外 = 必撞膝盖，才否决。
 */

/**
 * v1.4.0：贴库局面下母球「可落位」的阈值。
 *
 * 目标球贴库且打中袋时，母球必须把球沿**近乎垂直库面**的方向撞出去。
 * 由 ghost 法，母球撞上目标球瞬间的球心位于
 *     ghost = ball − 2R · (ball→pocket 单位向量)
 * 若该方向几乎垂直库面，ghost 就会落在**库外**（离库 < 2R 意味着球心已
 * 越过库线内侧）。母球跑不到那里，这一杆物理上无法以理想厚薄执行 ——
 * AI 只能斜着切，球出不去。这正是「贴库打中袋」屡屡失手的根因。
 */
const RAIL_CUE_GHOST_MIN = 2.0 * R

/**
 * 判断「目标球打这个袋」是否物理上可行（0~1 适配度，1 = 完全可行）。
 *
 * v1.4.0 判据与 aimcalculator 的 findBestPocket 罚分同源（穿越点判据）：
 *   · 中袋：球→袋心连线与库面的穿越点超出中袋口（2.6R）→ 0（必撞膝盖，
 *     实测进球率 0~19%，同球打角袋 100%）；
 *   · 角袋：**不做**贴库否决 —— 贴库球沿库滚入角袋实测 100%，旧的
 *     「离库分量 ≥ 0.3」判据是误杀（见 RAIL_ENTRY_COS 注释）；
 *   · 两种袋共用：ghost 落到库内 2R 之内 → 0.15（母球无法站位，只能斜切）。
 *
 * 这是 v1.4.0 针对「白球和击打球都靠边库时，电脑还是选择打中袋，而不是
 * 打远处的边袋」的结构性修复入口 —— 原先 `pocketValue()` 里中袋只扣
 * 0.08（角袋 1.0 vs 中袋 0.92），而中袋的线路距离又通常明显更短，
 * 于是「近中袋」在 `(1 − difficulty) × pocketValue` 里几乎总赢。
 */
function railPocketSuitability(
  ballPos: Vector3,
  pocket: Vector3,
  ghost: Vector3
): number {
  const excess = railMidMouthExcess(ballPos, pocket)
  if (excess !== null && excess > 0) return 0
  // 母球可落位检查：ghost 若落到库内 2R 之内，母球根本无法站位，
  // 只能斜切 —— 贴库打中袋的失手绝大多数来自这里。
  const ghostRail = distToRail(ghost)
  if (ghostRail < RAIL_CUE_GHOST_MIN) return 0.15
  return 1
}

/**
 * v1.3.95：ghost 必须落在球心可达区域内。
 *
 * ghost 是「母球撞上目标球瞬间的球心位置」。若它算到台面之外，说明母球
 * 要跑到库外面才能把这颗球切进袋 —— 物理上不可能。此前从不检查这件事，
 * 是「选了几何上最近但打不进的袋」的直接原因之一。
 * 口径与 `Table.prepareAdvanceToCushions` 的库边判定一致（|x| < tableX）。
 */
const GHOST_MARGIN = R * 0.05

/** ghost 是否落在球心可达区域（台面矩形内） */
function ghostInsideTable(ghost: Vector3): boolean {
  return (
    Math.abs(ghost.x) <= TableGeometry.tableX - GHOST_MARGIN &&
    Math.abs(ghost.y) <= TableGeometry.tableY - GHOST_MARGIN
  )
}

/**
 * 枚举全部「目标球 × 袋口」候选（几何可行者）。
 *
 * 与改造前 enumeratePlans 的差异：这里**不再用 minCutCos 直接剔除薄球**
 * （薄与不薄交给 difficulty 评分与上层阈值统一裁量，贴球场景还要放宽），
 * 但仍然剔除两类**物理上必坏**的组合：
 *   1. ghost 退化的线路（母球几乎贴在目标球袋口侧，出杆方向由浮点残差决定）；
 *   2. 视线被完全挡死（母球→ghost 或 球→袋 净空 < 2R）。
 */
export interface EnumerateOptions {
  /**
   * v1.3.95：是否启用「物理可行性硬否决」（ghost 可达性 + 贴库进口角）。
   *
   * 为真时才否决「母球根本跑不到 / 目标球根本上不了袋」的组合。
   */
  strict?: boolean
  /**
   * v1.3.95：`strict` 会一并切换切角判据的口径。
   *
   *   strict = true  → 用**真实**的 cue→ghost 切角（见 cutCosTrue）
   *   strict = false → 沿用旧的「母球→球心」夹角
   *
   * 默认必须保持旧口径：planner / defense / clearance / ballinhand 以及各
   * harness 都是两个参数的旧调用方式，它们的选出/评估行为必须**逐位不变**，
   * 否则会把「只想在正式出杆时生效的修复」扩散到全决策链，回归面失控。
   */
}

export function enumerateCandidates(
  ctx: DecisionContext,
  minCutCos: number,
  opts: EnumerateOptions = {}
): OffenseCandidate[] {
  const cue = ctx.cue
  const out: OffenseCandidate[] = []
  const nextCenter = remainingCenter(ctx.targets)
  const strict = opts.strict === true

  for (const ball of ctx.targets) {
    for (const pocket of ctx.pockets) {
      const toTarget = ball.pos.clone().sub(cue.pos).normalize()
      const toPocket = pocket.clone().sub(ball.pos).normalize()
      /** 旧口径：母球→目标球**球心**夹角余弦（仅作诊断留存，不再用于判定） */
      const cutCosCenter = toTarget.dot(toPocket)

      // v1.3.95：ghost 必须**先**算出来，才能用母球真实的出杆方向判切角。
      //
      // 原实现的顺序是「先按 cue→球心 判 cutCos 再算 ghost」，但母球实际是
      // 沿 cue→ghost 行进的，两者差异极大（例如 L=10R 时，球心夹角余弦 0.34
      // 对应的真实切角余弦仅 ≈0.147 即 81°）。于是 minCutCos 这道「物理极限」
      // 闸门系统性放过了实际上根本打不进的薄球 —— 这正是用户看到的
      // 「中袋最近就打，哪怕切角不可能」。
      const ghost = ctx.calculator.ghostBallFor(cue.pos, ball.pos, [pocket])
      // ghost 退化：母球贴在目标球袋口侧时出杆方向失控（空杆根因）
      if (cue.pos.distanceTo(ghost) < MIN_GHOST_DISTANCE) continue

      /** 真实切角余弦：母球出杆方向(cue→ghost) 与目标球出球方向的夹角余弦 */
      const aimDir = ghost.clone().sub(cue.pos).normalize()
      const cutCosTrue = aimDir.dot(toPocket)
      // v1.3.95：口径由 strict 决定。默认回填旧口径，使下游 estimateStop /
      // scoreDifficulty 与 v1.3.94 逐位一致（见 EnumerateOptions 注释）。
      const cutCos = strict ? cutCosTrue : cutCosCenter
      // 低于下限（含负值=球在母球背后方向）直接丢弃
      if (cutCos <= minCutCos) continue

      // ---- v1.3.95：物理可行性硬否决（仅 strict 生效）----
      if (strict) {
        // ① ghost 必须落在球心可达区域内 —— 母球不可能跑到库外面去瞄准
        if (!ghostInsideTable(ghost)) continue
        // ② v1.4.0：中袋穿越点判据 —— 球→袋心连线与库面的交点落在中袋口
        //    （2.6R）之外时，目标球必撞袋口膝盖，几何上必失（实测 0~19%，
        //    同球打角袋 100%）。角袋**豁免**：贴库球沿库滚入角袋实测 100%
        //    （旧的「离库分量 ≥ 0.3」判据把这些 100% 线路全部误杀，导致
        //    strict 局面"无候选"→ 降级 → rankPlans 挑最近中袋）。
        const mouthExcess = railMidMouthExcess(ball.pos, pocket)
        if (mouthExcess !== null && mouthExcess > 0) continue
      }
      // v1.3.91：贴球场景的击球行程只有 0.02R，母球出发时几乎与目标球
      // 重叠 —— 此时「母球→ghost」这条极短的线段不能作为遮挡判据：
      //   · 线段上的任何球（包括目标球自己）都会以「距离≈0」触发遮挡；
      //   · 贴球局面下其它球往往也挨在一起，短线段必然"被挡"，全部候选被剔除。
      // 实测：不做这个豁免时，贴球场景平均只能枚举出 3.2 个候选、
      // 4.5% 的局面完全枚举不出候选（只能走兜底），进球率从基线的 63%
      // 掉到 45%。因此对贴球候选单独处理：
      //   · 母球侧净空只统计**不在目标球 2R 邻域内**的球（近邻本来就贴着，
      //     物理上不构成"挡住母球出发"）；
      //   · 目标球侧（ball→pocket）仍按全量球检查（那一段是长距离，必须严格）。
      const cuePathBalls = ctx.allBalls.filter(
        (b) => b === ball || b.pos.distanceTo(ball.pos) > 2 * R
      )
      const clearanceCue = lineClearance(
        cue.pos,
        ghost,
        cuePathBalls,
        cue,
        ball
      )
      const clearanceObj = lineClearance(ball.pos, pocket, ctx.allBalls, ball)
      // 净空不足 2R = 有球挡在路上，物理上打不过去
      if (clearanceCue < 2 * R || clearanceObj < 2 * R) continue

      const cueToBall = cue.pos.distanceTo(ball.pos)
      const ballToPocket = ball.pos.distanceTo(pocket)
      // 内缩点 → 真实袋心（内缩是沿「袋心→台心」乘 0.94，可逆）
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
        cueToBall,
        // v1.3.91：枚举阶段还不知道最终力度，先按中力基准估算停位。
        // 选定候选后会由 reassessScratch 用实际力度重算，见该函数注释。
        MEDIUM_POWER_BASELINE
      )
      let pathMin = Infinity
      for (const p of ctx.pockets) {
        const d = segDistToPoint(cue.pos, stop, p)
        if (d < pathMin) pathMin = d
      }

      const cand: OffenseCandidate = {
        ball,
        pocket,
        cutCos,
        cutCosCenter,
        cueToBall,
        ballToPocket,
        ballToPocketTrue,
        pocketRadius,
        isCorner,
        ghost,
        clearanceCue,
        clearanceObj,
        stop,
        scratchRisk: pathMin,
        stopToNext: nextCenter ? stop.distanceTo(nextCenter) : 0,
        railHug: railHug(stop),
        targetOnRail: distToRail(ball.pos) < BALL_ON_RAIL,
        cueOnRail: ctx.cueOnRail,
        cueTouchingThis: ctx.touchingBall === ball,
        difficulty: 0,
      }
      // v1.3.91：母球贴库时的额外摔袋风险。
      // 实测摔袋样本几乎全部发生在母球起点贴库（|x|≈45R 或 |y|≈24R）时：
      // 贴库的母球离角袋/中袋很近，出杆后稍有前冲就会被最近的袋口吃掉。
      // 这一项直接压进 scratchRisk（取与路径风险的较小值），
      // 让上层既有的"风险收力"逻辑自动生效。
      if (ctx.cueOnRail) {
        let nearestPocket = Infinity
        for (const p of ctx.pockets) {
          const d = cue.pos.distanceTo(p)
          if (d < nearestPocket) nearestPocket = d
        }
        // 贴库时以「母球到最近袋口」的距离作为风险上限（3R 内视为高危）
        cand.scratchRisk = Math.min(cand.scratchRisk, nearestPocket)
      }
      cand.difficulty = scoreDifficulty(cand)
      out.push(cand)
    }
  }
  return out
}

/**
 * 综合进攻难度评分（职业选手视角）。
 *
 * 各因子权重按「对进球率的影响强度」排布：
 *   切角 0.42（最重要，薄球是打丢首因）
 *   总路程 0.18（长台放大所有误差）
 *   目标到袋 0.14（袋边球好进）
 *   遮挡余量 0.10 + 0.06（稍有球贴着线路就会干扰）
 *   袋口类型/贴库/摔袋 为加成项
 */
export function scoreDifficulty(c: OffenseCandidate): number {
  const cut = 1 - Math.max(0, Math.min(1, c.cutCos))

  // 距离项（v1.3.91 标定修正）：
  // 首版用「总路程指数饱和」，结果近台球也有 0.3+ 的基础难度（实测候选
  // 难度全部挤在 0.2~0.4），阈值 0.72 形同虚设、区分度全无。
  // 改为：以「总路程 / 台长」为归一化量，用幂函数压缩 —— 台面内 1m 内
  // 几乎不算难度，超过半台才明显计分，长台趋近 1。
  const total = c.cueToBall + c.ballToPocketTrue
  const tableLen = TableGeometry.X * 2 // 台长（米），八球台约 2.54m
  const dist = Math.pow(clamp01(total / tableLen), 1.6)
  // 目标球到袋越近越容易（袋口球），以 6R 为免罚区间
  const nearPocket = clamp01(
    (c.ballToPocketTrue - 6 * R) / (12 * R)
  )

  const blockCue = clamp01(
    (CLEARANCE_PENALTY_START - c.clearanceCue) / CLEARANCE_PENALTY_START
  )
  const blockObj = clamp01(
    (CLEARANCE_PENALTY_START - c.clearanceObj) / CLEARANCE_PENALTY_START
  )

  // 中袋的口岸角度容错比角袋窄
  const pocketPenalty = c.isCorner ? 0 : 0.06
  /**
   * v1.4.0：**贴库目标球打中袋**的难度加成。
   *
   * 见 `RAIL_MIDDLE_ENTRY_COS` 的实测标定：贴在长库上的球打中袋，
   * 只要离库 cos 未达 0.72，实测进球率就是 0~19%（同球打角袋 100%）。
   * 这里用目标球到中袋的**有效距离**做连续难度惩罚 —— 离中袋越远，
   * 入射角越贴近库面、越不可能越过膝盖。
   *
   * 与 `pocketValue` 里的乘性因子分工：
   *   · 难度（这里）负责「这一杆有多难」，会触发 tooHard → 转防守；
   *   · 价值（pocketValue）负责「同等难度下选哪个袋」。
   * 两者都要有，否则会出现「难度合理但袋选错」或「袋选对了但难度低估」。
   *
   * v1.4.0：口径改为与 aimcalculator 的 `railMidMouthExcess` 同源的穿越点
   * 判据 —— 穿越点越深入中袋口膝盖区，罚分越大（渐进）；角袋恒为 0。
   * 非中袋 / 未贴库局面 excess 为 null，本项为 0，评分与 v1.3.104 一致。
   */
  const railMiddlePenalty = (() => {
    const ex = railMidMouthExcess(c.ball.pos, c.pocket)
    if (ex === null || ex <= 0) return 0
    return clamp01(ex / (4 * R)) * 0.3
  })()
  const railPenalty = (c.targetOnRail ? 0.08 : 0) + (c.cueOnRail ? 0.05 : 0)
  const scratchPenalty = c.scratchRisk < 2.4 * R ? 0.12 : 0
  // v1.3.91：贴球惩罚（见 OffenseCandidate.cueTouchingThis 注释）。
  //
  // 贴球时母球与目标球几乎重叠，撞击行程极短，出杆角度的微小偏差会被直接
  // 放大成厚薄误差 —— 实测进球率仅 0~10%，但原评分会给出 0.18~0.45 的
  // 「简单球」分数，导致 AI 在贴球局面误判为进攻良机（进球率从基线 63%
  // 掉到 45%）。
  //
  // 惩罚值经过标定：0.45 太高（AI 几乎全部转防守，fallback 涨到 24%，
  // 进球率反降到 49%）；0.30 能刚好把「薄切/远台贴球」推过阈值 0.72，
  // 同时保留「贴球正对袋口（cut≈1、ballToPocket 近）」这类真机会 ——
  // 这与职业选手的实际处理一致：贴球能打就打，打不了就轻碰防守。
  const touchingPenalty = c.cueTouchingThis ? 0.3 : 0

  const d =
    0.42 * cut +
    0.18 * dist +
    0.14 * nearPocket +
    0.1 * blockCue +
    0.06 * blockObj +
    pocketPenalty +
    railMiddlePenalty +
    railPenalty +
    scratchPenalty +
    touchingPenalty
  return clamp01(d)
}

/**
 * 袋口价值：同样的进球，进哪个袋对后续走位更有利。
 * 角袋走位空间大；袋口球是「机会球」值得优先收；走位方向与剩余球群
 * 对齐的袋口加分。
 *
 * v1.4.0（关键修复）：新增**贴库进袋可行性**因子。
 *
 * 用户反馈：「当白球和击打球靠边库时，电脑还是选择打中袋，而不是打远处的
 * 边袋」。根因是这里的价值函数只给中袋扣 0.08（角袋 1.0 vs 中袋 0.92），
 * 而中袋到贴库球的线路**通常近得多**（同一条长库上，中袋在正中，远处角袋
 * 在两端），于是
 *     offenseScore = (1 − 难度) × 袋口价值 × 走位因子
 * 里「近中袋」几乎总赢 —— 哪怕那一杆物理上根本打不进。
 *
 * 现在加入 `railPocketSuitability()`：目标球贴库时，
 *   · 中袋穿越点超出袋口（2.6R）→ 0（必撞膝盖，实测 0~19%）；
 *   · 角袋**不否决**（沿库滚入角袋实测 100%，旧的离库分量判据是误杀）；
 *   · ghost 落到库内 2R 之内 → 0.15（母球无法站位，只能斜切）。
 * 于是「贴库 + 远处角袋」会正常胜出。
 *
 * 注意：这一因子对任何局面都会计算，但**只在穿越点命中膝盖区 / ghost
 * 贴库时产生罚分**，普通局面的排序与 v1.3.104 逐位一致。
 */
export function pocketValue(c: OffenseCandidate, ctx: DecisionContext): number {
  let v = c.isCorner ? 1.0 : 0.92
  // 目标球离袋 < 8R：袋口机会球，职业选手必收
  if (c.ballToPocketTrue < 8 * R) v *= 1.15
  // v1.4.0：贴库进袋可行性（见上方说明）。用乘性因子而不是加减 ——
  // 可行度 0 的线路会被压到 0，任何难度优势都翻不回来。
  const feas = railPocketSuitability(c.ball.pos, c.pocket, c.ghost)
  if (feas < 1) v *= feas
  // 停位方向与剩余球群方向的夹角越一致越好
  const next = remainingCenter(ctx.targets)
  if (next) {
    const stopDir = c.stop.clone().sub(c.ball.pos).normalize()
    const groupDir = next.clone().sub(c.ball.pos).normalize()
    v *= 1 + 0.08 * stopDir.dot(groupDir)
  }
  return v
}

/** 母球停位估算（沿切线，按切球厚薄决定走多远） */
export function estimateStop(
  cuePos: Vector3,
  targetPos: Vector3,
  pocket: Vector3,
  cutCos: number,
  cueToBall: number,
  /**
   * v1.3.91：出杆力度（m/s）。
   * 改造前停位估算写死 `min(8R, ...)`，是按「小力轻推」时代标定的。
   * 力度整体抬到中力后，母球实际能跑 30R 以上，8R 的上限让 scratchRisk
   * 严重低估 → 防摔袋判断整体失准（实测摔袋率从 1~2% 升到 4~5%）。
   * 这里把力度纳入：走位距离随出杆速度近似线性放大。
   */
  power: number = 0
): Vector3 {
  const toPocket = pocket.clone().sub(targetPos).normalize()
  const ghost = targetPos.clone().addScaledVector(toPocket, -2 * R)
  const tangent = AimCalculator.getTangentVector(cuePos, targetPos, ghost)
  const thin = 1 - Math.max(0, cutCos)
  // 力度因子：以中力（约 60R ≈ 2.0 m/s）为 1.0 基准，上下按速度比例缩放
  const powerFactor = power > 0 ? Math.max(0.6, Math.min(2.6, power / (60 * R))) : 1
  const travel = Math.min(
    24 * R,
    (cueToBall * 1.1 + R) * (0.25 + 0.9 * thin) * powerFactor
  )
  return cuePos.clone().addScaledVector(tangent, travel)
}

/** 剩余目标球的群体中心 */
export function remainingCenter(balls: Ball[]): Vector3 | null {
  if (balls.length <= 1) return null
  const c = new Vector3()
  let n = 0
  for (const b of balls) {
    c.add(b.pos)
    n++
  }
  if (n === 0) return null
  return c.multiplyScalar(1 / n)
}

/** ghost 退化阈值（与 AimCalculator.MIN_AIM_DISTANCE 同义） */
export const MIN_GHOST_DISTANCE = 1.2 * R

/**
 * 中力基准出杆速度（m/s）。枚举候选时用于估算停位，作为力度未知时的保守取值。
 * 与 decision/power.ts 的 medium 档中值对齐。
 */
export const MEDIUM_POWER_BASELINE = 62 * R

/**
 * v1.3.91：用**实际出杆力度**重算某候选的摔袋风险。
 *
 * 枚举阶段力度未定（且力度选择又依赖停位／走位评估，存在循环依赖），
 * 所以叫「重算」：候选选定并定下力度后，调用本函数得到更准的停位与风险，
 * 供上层做最后的收力／改杆法决策。
 */
export function reassessScratch(
  ctx: DecisionContext,
  cand: OffenseCandidate,
  power: number
): { stop: Vector3; scratchRisk: number; wouldScratch: boolean } {
  const stop = estimateStop(
    ctx.cue.pos,
    cand.ball.pos,
    cand.pocket,
    cand.cutCos,
    cand.cueToBall,
    power
  )
  let pathMin = Infinity
  let nearestPocket = Infinity
  for (const p of ctx.pockets) {
    const d = segDistToPoint(ctx.cue.pos, stop, p)
    if (d < pathMin) pathMin = d
    const ds = stop.distanceTo(p)
    if (ds < nearestPocket) nearestPocket = ds
  }
  // v1.3.91：直接判定「估算停位是否落在袋口内」。
  // 只靠 pathMin（轨迹离袋距离）不够 —— 停位点本身如果就在袋口里，
  // 那这一杆必摔袋。袋口有效半径取中袋半径（保守值），小于它即认为进袋。
  const pocketR = POCKET_RADIUS_MIDDLE
  const wouldScratch = nearestPocket < pocketR
  return {
    stop,
    scratchRisk: Math.min(pathMin, nearestPocket),
    wouldScratch,
  }
}

/**
 * v1.3.92：用**真实物理**刷新候选的停位相关字段（结构性修复）。
 *
 * ## 为什么必须做这一步
 *
 * `enumerateCandidates` 里所有停位字段（stop / scratchRisk / stopToNext /
 * railHug）都是在**枚举阶段**用 `estimateStop()` 几何近似算的 —— 那是纯几何
 * 闭式解：母球沿切线直线滑出、距离 = f(切球厚薄, 力度)。它的实测误差
 * **中位数 31.4R（约 1 米）**，而 `predictCueStop()` 的物理预测误差是 **0.000R**
 * （受控实验 119/119 完全一致）。
 *
 * 更致命的是**力度基准错误**：枚举时还不知道最终力度，一律按
 * `MEDIUM_POWER_BASELINE = 62R` 估算。但 `power.ts` 的档位区间是
 * `touch 21R ~ break 159R` —— **7.6 倍**的跨度被当成一个常数。
 * 于是一杆 `firm`(118R) 的球，其停位是用 62R 算的，误差可达 58R。
 *
 * 后果链条：
 *   ① `rankPlans` 用这些错误的 stop/scratchRisk **排序候选** →
 *      选出来的可能不是真正最优的那颗；
 *   ② `lastPredictedStop` 直接取 `best.stop` → **AI 对外发布的预测是错的**，
 *      所有基于它的后续推理都建在沙上；
 *   ③ `scratchRisk` 错误 → `rankPlans` 的防摔袋前置过滤失效
 *      （对局级实测：专业档摔袋/杆 28.9%，犯规/杆 55.3%，清台率 84.7%
 *       反而低于稳健档 94.4% —— 难度倒挂）。
 *
 * ## 做法
 *
 * 对每个候选：先用 `power.ts` 算出**该候选真正会用的力度档**（这才是正确
 * 的预测输入），再用 `predictCueStop()` 跑一遍真实物理，用真实停位覆盖
 * 几何近似值。
 *
 * 这一步必须在 `rankPlans` **之前**完成 —— 否则排序依据仍然是错的。
 *
 * 开销控制：物理预测约等于一次真实击球的推进。候选数通常 < 40，
 * 单杆多花几毫秒，对 AI 思考时间无感（且正好让「复杂球型思考更久」更自然）。
 *
 * @param ctx    决策上下文
 * @param cands  候选列表（原地修改）
 */
export function refineStopsPhysics(
  ctx: DecisionContext,
  cands: OffenseCandidate[],
  nextCenter: Vector3 | null
): void {
  for (const c of cands) {
    // 该候选真正会用的力度 —— 不能再用 62R 常数
    const power = predictPowerFor(ctx, c)
    const stop = predictStopFor(ctx, c, power)
    if (!stop) {
      // 物理预测显示母球会落袋：这是**确定的摔袋信号**。
      // 把 scratchRisk 压到 0，让上层排序把它整条压后 / 强制收力。
      c.scratchRisk = 0
      c.physicalScratch = true
      continue
    }
    c.physicalScratch = false
    c.stop = stop
    // 用真实停位重算全部派生量
    let pathMin = Infinity
    let nearest = Infinity
    for (const p of ctx.pockets) {
      const d = segDistToPoint(ctx.cue.pos, stop, p)
      if (d < pathMin) pathMin = d
      const ds = stop.distanceTo(p)
      if (ds < nearest) nearest = ds
    }
    // 贴库母球起点风险仍保留（见 enumerateCandidates 的说明）
    let risk = Math.min(pathMin, nearest)
    if (ctx.cueOnRail) {
      let nearestFromCue = Infinity
      for (const p of ctx.pockets) {
        const d = ctx.cue.pos.distanceTo(p)
        if (d < nearestFromCue) nearestFromCue = d
      }
      risk = Math.min(risk, nearestFromCue)
    }
    c.scratchRisk = risk
    c.stopToNext = nextCenter ? stop.distanceTo(nextCenter) : 0
    c.railHug = railHug(stop)
    // 难度依赖 scratchRisk（摔袋惩罚项 0.12），必须重算
    c.difficulty = scoreDifficulty(c)
  }
}

/**
 * 物理预测的**依赖注入点**。
 *
 * `offense.ts` 是最底层的候选定义模块，`power.ts` / `trajectory.ts` 都依赖它。
 * 若这里直接 import 那两个模块会形成循环依赖（webpack 下表现为一个模块拿到
 * 半初始化的空对象，运行时才炸，非常难查）。因此改为由上层
 * （`strategies/professional.ts`）在模块加载时注册实现。
 *
 * 未注册时退回零值，`refineStopsPhysics` 会整体跳过 —— 保证任何单独引用
 * `offense.ts` 的 harness 都不会因为缺注册而崩溃。
 */
type PowerForFn = (ctx: DecisionContext, c: OffenseCandidate) => number
type StopForFn = (
  ctx: DecisionContext,
  c: OffenseCandidate,
  power: number
) => Vector3 | null

let powerForImpl: PowerForFn | null = null
let stopForImpl: StopForFn | null = null

/** 由 decision/index 或策略层注册真实实现（见 registerPhysicsHooks 调用点） */
export function registerPhysicsHooks(power: PowerForFn, stop: StopForFn): void {
  powerForImpl = power
  stopForImpl = stop
}

/**
 * v1.3.93：物理钩子是否已注册。
 *
 * `refineStopsPhysics` 是「用候选真正会用的力度跑真实物理算停位」的关键修复，
 * 但它依赖策略层在模块加载时通过 `registerPhysicsHooks` 注入实现。钩子缺失时
 * 会**静默退回**几何近似 —— 而几何近似的停位误差实测中位 31.4R（约 1 米），
 * 正是「白球一直摔袋」的原始病灶。
 *
 * 因此凡是要依赖精确停位的调用方（如自由球摆位评估），都应先用本函数确认钩子
 * 就绪，而不是拿到一份看起来正常、实则退化的结果。
 */
export function physicsHooksReady(): boolean {
  return powerForImpl !== null && stopForImpl !== null
}

function predictPowerFor(ctx: DecisionContext, c: OffenseCandidate): number {
  return powerForImpl ? powerForImpl(ctx, c) : MEDIUM_POWER_BASELINE
}

function predictStopFor(
  ctx: DecisionContext,
  c: OffenseCandidate,
  power: number
): Vector3 | null {
  return stopForImpl ? stopForImpl(ctx, c, power) : null
}

export function distToRail(p: Vector3): number {
  return Math.min(TableGeometry.X - Math.abs(p.x), TableGeometry.Y - Math.abs(p.y))
}

function railHug(pos: Vector3): number {
  return Math.max(0, 1 - distToRail(pos) / (4 * R))
}

/** 停位贴库程度 0~1（公开版，供 planner / trajectory 复用同一口径） */
export function railHugAt(pos: Vector3): number {
  return railHug(pos)
}

/**
 * from→to 线段对其它球的**最小净空**（米）。
 * 返回 Infinity 表示线段上没有任何球；< 2R 表示被挡。
 */
export function lineClearance(
  from: Vector3,
  to: Vector3,
  balls: Ball[],
  ...excludes: Ball[]
): number {
  const dir = to.clone().sub(from)
  const len = dir.length()
  if (len < 1e-4) return Infinity
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

/** 线段 a→b 到点 p 的最短距离（XY 平面） */
export function segDistToPoint(a: Vector3, b: Vector3, p: Vector3): number {
  const abx = b.x - a.x
  const aby = b.y - a.y
  const len2 = abx * abx + aby * aby
  let t = len2 > 1e-9 ? ((p.x - a.x) * abx + (p.y - a.y) * aby) / len2 : 0
  t = Math.max(0, Math.min(1, t))
  return Math.hypot(p.x - (a.x + t * abx), p.y - (a.y + t * aby))
}

/** 从候选里挑难度最低的（越界返回 null） */
export function easiest(cands: OffenseCandidate[]): OffenseCandidate | null {
  let best: OffenseCandidate | null = null
  for (const c of cands) {
    if (!best || c.difficulty < best.difficulty) best = c
  }
  return best
}
