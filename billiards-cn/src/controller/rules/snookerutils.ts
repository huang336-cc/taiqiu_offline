import { Outcome } from "../../model/outcome"
import { Respot } from "../../utils/respot"
import { Table } from "../../model/table"

export interface FoulResult {
  points: number
  reason: string | null
}

import { Ball } from "../../model/ball"

export interface ShotInfo {
  pots: number
  firstCollision: any
  legalFirstCollision: boolean
  whitePotted: boolean
  targetIsRed: boolean
}

export class SnookerUtils {
  static shotInfo(
    table: Table,
    outcome: Outcome[],
    targetIsRed: boolean,
    previousPotRed: boolean
  ): ShotInfo {
    const firstCollision = Outcome.firstCollision(outcome)
    return {
      pots: Outcome.potCount(outcome),
      firstCollision: firstCollision,
      legalFirstCollision: SnookerUtils.isLegalFirstCollision(
        table,
        targetIsRed,
        previousPotRed,
        firstCollision
      ),
      whitePotted: Outcome.isCueBallPotted(table.cueball, outcome),
      targetIsRed: targetIsRed,
    }
  }

  static isLegalFirstCollision(
    table: Table,
    targetIsRed: boolean,
    previousPotRed: boolean,
    firstCollision: any
  ): boolean {
    if (!firstCollision) {
      return false
    }
    const id = firstCollision.ballB!.id
    if (targetIsRed) {
      return id >= 7
    } else if (previousPotRed) {
      return id >= 1 && id <= 6
    } else {
      const colours = SnookerUtils.coloursOnTable(table).sort(
        (a, b) => a.id - b.id
      )
      if (colours.length === 0) {
        return false
      }
      return id === colours[0].id
    }
  }

  static calculateFoul(outcome: Outcome[], shotInfo: ShotInfo): FoulResult {
    const points = SnookerUtils.foulPoints(outcome, shotInfo)
    const reason = SnookerUtils.foulReason(outcome, shotInfo)
    return { points, reason }
  }

  private static foulPoints(outcome: Outcome[], shotInfo: ShotInfo): number {
    const potted = Outcome.pots(outcome)
      .map((b) => b.id)
      .filter((id) => id < 7)
    let firstCollisionId = shotInfo.firstCollision?.ballB?.id ?? 0
    if (firstCollisionId > 6) {
      firstCollisionId = 0
    }
    return Math.max(3, firstCollisionId, ...potted) + 1
  }

  private static foulReason(
    outcome: Outcome[],
    shotInfo: ShotInfo
  ): string | null {
    if (shotInfo.whitePotted) {
      return "母球落袋"
    }

    if (!shotInfo.firstCollision) {
      return "空杆，未击中任何球"
    }

    const firstBallId = shotInfo.firstCollision.ballB?.id ?? 0

    if (shotInfo.targetIsRed) {
      if (firstBallId < 7 || firstBallId === 0) {
        const colourName = SnookerUtils.colourName(firstBallId)
        return `该打红球，却先碰到${colourName}`
      }
    } else if (firstBallId >= 7) {
      return "该打彩球，却先碰到红球"
    }

    return SnookerUtils.pottedBallReason(outcome, shotInfo)
  }

  private static pottedBallReason(
    outcome: Outcome[],
    shotInfo: ShotInfo
  ): string | null {
    if (!shotInfo.targetIsRed) {
      const pottedReds = Outcome.pots(outcome).filter((b) => b.id >= 7)
      if (pottedReds.length > 0) {
        return "该打彩球，却打进了红球"
      }
    }
    const pottedColours = Outcome.pots(outcome).filter(
      (b) => b.id > 0 && b.id < 7
    )
    if (pottedColours.length > 1) {
      const colourNames = pottedColours
        .map((b) => SnookerUtils.colourName(b.id))
        .join("、")
      return `同时打进了${colourNames}`
    }
    if (pottedColours.length === 1) {
      const pottedId = pottedColours[0].id
      const firstBallId2 = shotInfo.firstCollision?.ballB?.id ?? 0
      if (pottedId !== firstBallId2) {
        const pottedName = SnookerUtils.colourName(pottedId)
        const hitName =
          firstBallId2 >= 7 ? "红球" : SnookerUtils.colourName(firstBallId2)
        return `打进的是${pottedName}，先碰到的却是${hitName}`
      }
    }
    return null
  }

  static respotAllPottedColours(table: Table, outcome: Outcome[]): Ball[] {
    return Outcome.pots(outcome)
      .filter((ball) => ball.id < 7)
      .filter((ball) => ball.id !== 0)
      .map((ball) => Respot.respot(ball, table))
  }

  static redsOnTable(table: Table): Ball[] {
    const reds = table.balls.slice(7).filter((ball: Ball) => ball.onTable())
    return reds
  }

  static coloursOnTable(table: Table): Ball[] {
    return table.balls.slice(1, 7).filter((ball: Ball) => ball.onTable())
  }

  static ballsOnTable(table: Table): Ball[] {
    return table.balls.filter((ball: Ball) => ball.id !== 0 && ball.onTable())
  }

  static colourName(id: number): string {
    const names: { [key: number]: string } = {
      1: "黄球",
      2: "绿球",
      3: "咖啡球",
      4: "蓝球",
      5: "粉球",
      6: "黑球",
    }
    return names[id] || `${id} 号球`
  }
}
