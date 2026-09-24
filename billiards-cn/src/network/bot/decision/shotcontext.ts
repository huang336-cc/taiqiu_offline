import { Vector3 } from "three"
import { Ball } from "../../../model/ball"
import { Table } from "../../../model/table"
import { R } from "../../../model/physics/constants"
import { AimCalculator } from "../aimcalculator"
import { BotShotContext } from "../botstrategy"
import { DifficultyProfile } from "../difficulty"
import { TableGeometry } from "../../../view/tablegeometry"
import { Session } from "../../client/session"

/**
 * v1.3.91：专业级 AI 决策层的统一输入契约。
 *
 * 背景：改造前 professional.ts 直接在 aim() 里从 BotShotContext 现取现算，
 * 缺「对手花色球」「开球杆」「连续进球数」等职业选手决策必需的上下文，
 * 于是做不出「评估对手威胁」「手感波动」这类判断。
 *
 * 这里把一次决策需要的全部信息收敛成一个不可变快照，供 decision/ 下的
 * 各纯函数模块（offense / planner / defense / power / error ...）消费。
 * 所有字段都是只读，决策模块不得回写 —— 保证决策可复现、可单测。
 */
export interface DecisionContext {
  /** 物理桌（只读用途：物理模拟与球查询） */
  readonly table: Table
  /** 本方母球 */
  readonly cue: Ball
  /** 本方合法目标球（八球=本方花色，未分花色时=非黑8；九球=最小号） */
  readonly targets: Ball[]
  /** 全桌在台球（含对手花色与黑8），障碍物判定一律以它为准 */
  readonly allBalls: Ball[]
  /** 对手花色球（用于评估「对手可进攻概率」） */
  readonly opponentBalls: Ball[]
  /** 本方是否已清台（此时唯一目标是黑8） */
  readonly onEightBall: boolean
  /** 瞄准用袋口（已 inset，同 AimCalculator.pockets） */
  readonly pockets: Vector3[]
  /** 难度参数表 */
  readonly profile: DifficultyProfile
  /** 瞄准计算器 */
  readonly calculator: AimCalculator
  /** 规则名（eightball / nineball / snooker ...） */
  readonly ruleName: string
  /** 母球是否贴库（离库 < 1.5R） */
  readonly cueOnRail: boolean
  /** 母球是否贴球（与最近球球心距 < 2.15R）—— 只有这种情况才允许小力轻推 */
  readonly cueTouching: boolean
  /**
   * v1.3.91：母球紧贴的球（`cueTouching` 为真时有效，否则 null）。
   *
   * 贴球是台球里最特殊的一类局面：母球与目标球几乎重叠，撞击瞬间几乎没有
   * 分离行程，出杆角度的一点偏差都会被放大成「打厚/打薄」。更麻烦的是，
   * 如果把它当普通球处理，几何上算出来的 ghost 点与母球出发点只差 2R ——
   * 恰好压在 `MIN_GHOST_DISTANCE` 附近，力度反解（`cueSpeedFor`）也失去意义。
   * 决策层需要知道「贴的是哪一颗」，才能对这颗球单独降权、单独放宽/收紧。
   */
  readonly touchingBall: Ball | null
  /** 本杆是否为开球杆 */
  readonly isBreak: boolean
  /** 连续进球数（手感波动：越高误差越轻微上浮） */
  readonly potStreak: number
  /** 赛点/关键局压力系数 0~1（越高越愿意搏难球） */
  readonly pressure: number
}

/** buildDecisionContext 的补充信息（BotShotContext 里没有、需调用方提供） */
export interface DecisionExtras {
  /** 规则名，默认 "eightball" */
  ruleName?: string
  /** 对手花色球；缺省时按「全桌非本方目标球」推导 */
  opponentBalls?: Ball[]
  /** 本方是否只剩黑8可打；缺省时自动推导 */
  onEightBall?: boolean
  /** 是否开球杆；缺省 false */
  isBreak?: boolean
  /** 连续进球数；缺省 0 */
  potStreak?: number
  /** 压力系数；缺省自动按剩余球数估算 */
  pressure?: number
}

/** 母球视为「贴库」的临界距离（米） */
export const CUE_RAIL_THRESHOLD = 1.5 * R
/** 母球视为「贴球」的临界距离（米，略大于 2R 以覆盖浮点与物理接触容差） */
export const CUE_TOUCHING_THRESHOLD = 2.15 * R

/**
 * 由 BotShotContext（bot 事件层的薄上下文）构造决策上下文。
 *
 * 全部补充信息可选：harness 直接构造 BotShotContext 时不会传新字段，
 * 这里按「全桌非目标球即对手球」等规则兜底推导，因此 **harness 无需修改**。
 */
export function buildDecisionContext(
  context: BotShotContext,
  profile: DifficultyProfile,
  calculator: AimCalculator,
  extras: DecisionExtras = {}
): DecisionContext {
  const cue = context.cueBall
  const targets = context.validTargetBalls
  const allBalls = context.table.balls.filter((b) => b.onTable() && b !== cue)

  const targetSet = new Set<Ball>(targets)
  const opponentBalls =
    extras.opponentBalls ??
    allBalls.filter((b) => !targetSet.has(b) && (b.label ?? 0) !== 8)

  // 「只剩黑8」：本方目标里除了黑8没别的球可打
  const onEightBall =
    extras.onEightBall ??
    (targets.length > 0 && targets.every((b) => (b.label ?? 0) === 8))

  const nearest = nearestBall(cue, allBalls)

  return {
    table: context.table,
    cue,
    targets,
    allBalls,
    opponentBalls,
    onEightBall,
    pockets: calculator.pockets,
    profile,
    calculator,
    ruleName: extras.ruleName ?? "eightball",
    cueOnRail: distToRail(cue.pos) < CUE_RAIL_THRESHOLD,
    cueTouching: nearest.dist < CUE_TOUCHING_THRESHOLD,
    touchingBall: nearest.dist < CUE_TOUCHING_THRESHOLD ? nearest.ball : null,
    isBreak: extras.isBreak ?? false,
    potStreak: extras.potStreak ?? 0,
    pressure:
      extras.pressure ??
      estimatePressure(targets.filter((b) => (b.label ?? 0) !== 8).length, opponentBalls.length),
  }
}

/** 点到最近库边的距离（米） */
export function distToRail(p: Vector3): number {
  return Math.min(TableGeometry.X - Math.abs(p.x), TableGeometry.Y - Math.abs(p.y))
}

/** 返回最近的球及其球心距（米）；无其它球时 dist = Infinity */
function nearestBall(
  cue: Ball,
  others: Ball[]
): { ball: Ball | null; dist: number } {
  let best: Ball | null = null
  let bestD = Infinity
  for (const b of others) {
    const d = cue.pos.distanceTo(b.pos)
    if (d < bestD) {
      bestD = d
      best = b
    }
  }
  return { ball: best, dist: bestD }
}

/**
 * 压力系数近似（八球单机难精确判定「赛点」，用局面信号代偿）：
 *   - 本方剩 1~2 颗：每颗都关键            +0.35
 *   - 对手剩 ≤2 颗：不搏就输               +0.40
 *   - 与 Session 比分差 ≤1（若可得）        +0.25
 */
function estimatePressure(myRemaining: number, oppRemaining: number): number {
  let p = 0
  if (myRemaining > 0 && myRemaining <= 2) p += 0.35
  if (oppRemaining <= 2) p += 0.4
  p += scorePressureBonus()
  return clamp01(p)
}

/** 比分胶着加成 */
function scorePressureBonus(): number {
  const { p1, p2 } = Session.getInstance().orderedScoresForHud()
  return Math.abs(p1 - p2) <= 1 ? 0.25 : 0
}

export function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v
}
