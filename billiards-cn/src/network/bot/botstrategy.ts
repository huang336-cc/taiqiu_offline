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
}

export interface BotStrategy {
  readonly name: string
  aim(context: BotShotContext, calculator: AimCalculator): GameEvent[]
}
