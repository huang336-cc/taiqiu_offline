import { Vector3 } from "three"
import { Controller } from "../../controller/controller"
import { Ball } from "../../model/ball"
import { Outcome } from "../../model/outcome"
import { Table } from "../../model/table"

export interface Rules {
  cueball: Ball
  currentBreak: number
  previousBreak: number
  rulename: string
  /** AI 瞄准噪声缩放：<1 让电脑更精准（专业/更困难模式用）。默认 1。 */
  aiNoiseScale?: number
  readonly asset: string
  update(outcome: Outcome[]): Controller
  rack(): Ball[]
  tableGeometry(): void
  table(): Table
  secondToPlay(): void
  otherPlayersCueBall(): Ball
  isPartOfBreak(outcome: Outcome[]): boolean
  isEndOfGame(outcome: Outcome[], type?: number): boolean
  allowsPlaceBall(): boolean
  placeBall(target?: Vector3): Vector3
  nextCandidateBall(p1type?: number): Ball | undefined
  startTurn(): void
  handleGameEnd(isWinner: boolean, endSubtext?: string): Controller
  foulReason(outcome: Outcome[], type?: number): string | null
  getAmountScored(outcome: Outcome[]): number
  respot(outcome: Outcome[]): Ball[]
  advanceState?(outcome: Outcome[]): void
  initialController?(): Controller
  hideScoreHud?(): boolean
  scaleTableModel?(scene: any): void
}
