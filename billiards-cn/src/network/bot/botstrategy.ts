import { GameEvent } from "../../events/gameevent"
import { Ball } from "../../model/ball"
import { Table } from "../../model/table"
import { AimCalculator } from "./aimcalculator"

export interface BotShotContext {
  table: Table
  cueBall: Ball
  validTargetBalls: Ball[]
  ballInHand: boolean
  /** 袋口位置（已 inset），供策略评估「最易进袋」目标球 */
  pockets?: any[]
  // ── v1.3.91：专业级决策层所需的补充上下文，全部可选 ──
  // 不传时 decision/shotcontext.ts 会按规则兜底推导，
  // 因此既有 harness（用 `ctx as any` 构造）无需修改即可继续运行。
  /** 对手花色球（用于评估对手可进攻概率）。缺省=全桌非本方目标球 */
  opponentBalls?: Ball[]
  /** 规则名（eightball / nineball / snooker ...）。缺省 "eightball" */
  ruleName?: string
  /** 本方是否只剩黑8可打。缺省自动推导 */
  onEightBall?: boolean
  /** 本杆是否为开球杆。缺省 false */
  isBreak?: boolean
  /** 连续进球数（手感波动）。缺省 0 */
  potStreak?: number
}

export interface BotStrategy {
  readonly name: string
  aim(context: BotShotContext, calculator: AimCalculator): GameEvent[]
}
