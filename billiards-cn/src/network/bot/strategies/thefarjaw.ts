import { AimEvent } from "../../../events/aimevent"
import { GameEvent } from "../../../events/gameevent"
import { Ball } from "../../../model/ball"
import { Vector3 } from "three"
import { Respot } from "../../../utils/respot"
import { AimCalculator } from "../aimcalculator"
import { BotShotContext, BotStrategy } from "../botstrategy"
import { TableGeometry } from "../../../view/tablegeometry"

import { ThreeStrategy } from "./threecushionstrategy"
import { DifficultyProfile, DIFFICULTY, jitterPower } from "../difficulty"

export class TheFarJaw implements BotStrategy {
  // 显式标注 string（而非让 TS 推断成字面量类型 "TheFarJaw"），
  // 否则子类 Professional 的 name = "Professional" 会因字面量类型
  // 不兼容而报 TS2416。
  readonly name: string = "TheFarJaw"
  /** v1.3.58：难度档位，默认激进档 */
  protected readonly profile: DifficultyProfile

  constructor(profile: DifficultyProfile = DIFFICULTY.TheFarJaw) {
    this.profile = profile
  }

  aim(context: BotShotContext, calculator: AimCalculator): GameEvent[] {
    if (!TableGeometry.hasPockets) {
      return new ThreeStrategy(
        AimCalculator.MAX_SHOT_POWER,
        this.profile
      ).aim(context, calculator)
    }

    const targetBall = this.pickTargetBall(context)
    if (!targetBall) {
      return []
    }

    const targetPoint = targetBall.pos
    const aimPoint = calculator.getAimPoint(
      context.cueBall.pos,
      targetPoint,
      calculator.pockets
    )
    const knuckles = calculator.closestKnuckles(
      calculator.findBestPocket(
        context.cueBall.pos,
        targetPoint,
        calculator.pockets
      )
    )

    const farKnuckle =
      targetPoint.distanceTo(knuckles[0]) > targetPoint.distanceTo(knuckles[1])
        ? knuckles[0]
        : knuckles[1]

    const farKnuckleAimPoint = calculator.getAimPoint(
      context.cueBall.pos,
      targetPoint,
      [farKnuckle]
    )

    // v1.3.58：noise 与力度抖动由难度档决定
    const pocketHitEvent = calculator.generateShot(
      context.table,
      this.profile.aimNoise,
      jitterPower(
        AimCalculator.DEFAULT_SHOT_POWER,
        this.profile.powerJitter
      ),
      aimPoint,
      new Vector3(0, 0, 0)
    )
    const farKnuckleHitEvent = calculator.generateShot(
      context.table,
      this.profile.aimNoise,
      jitterPower(AimCalculator.MAX_SHOT_POWER, this.profile.powerJitter),
      farKnuckleAimPoint,
      new Vector3(0, -0.3, 0)
    )
    const aimEvent = AimEvent.fromJson(pocketHitEvent.tablejson.aim)
    const farKnuckleAimEvent = AimEvent.fromJson(
      farKnuckleHitEvent.tablejson.aim
    )
    return [aimEvent, farKnuckleAimEvent, farKnuckleHitEvent]
  }

  protected pickTargetBall(context: BotShotContext): Ball | undefined {
    if (context.validTargetBalls.length === 0) {
      return undefined
    }

    if (context.table.proximityEnabled) {
      return Respot.furthest(context.cueBall, context.validTargetBalls)
    }

    return Respot.closest(context.cueBall, context.validTargetBalls)
  }
}
