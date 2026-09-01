import { AimEvent } from "../../../events/aimevent"
import { GameEvent } from "../../../events/gameevent"
import { Ball } from "../../../model/ball"
import { Respot } from "../../../utils/respot"
import { zero } from "../../../utils/three-utils"
import { AimCalculator } from "../aimcalculator"
import { BotShotContext, BotStrategy } from "../botstrategy"
import { TableGeometry } from "../../../view/tablegeometry"
import { ThreeStrategy } from "./threecushionstrategy"
import { DifficultyProfile, DIFFICULTY, jitterPower } from "../difficulty"
import { Vector3 } from "three"

export class ClawBreak implements BotStrategy {
  readonly name = "ClawBreak"
  /** v1.3.58：难度档位，默认稳健档 */
  protected readonly profile: DifficultyProfile

  constructor(profile: DifficultyProfile = DIFFICULTY.ClawBreak) {
    this.profile = profile
  }

  aim(context: BotShotContext, calculator: AimCalculator): GameEvent[] {
    if (!TableGeometry.hasPockets) {
      return new ThreeStrategy(
        AimCalculator.DEFAULT_SHOT_POWER,
        this.profile
      ).aim(context, calculator)
    }

    const targetBall = this.pickTargetBall(context)
    const targetPoint = targetBall?.pos ?? zero
    const aimPoint = calculator.getAimPoint(context.cueBall.pos, targetPoint)
    // v1.3.58：noise 由难度档决定（此前写死 0，导致三档零差异）；
    // 旋转显式给中杆 —— 旧代码走 generateShot 的默认参数 randomSpin()，
    // 会给稳健档凭空加 ±0.3 的随机高低杆，是「难度倒挂」的另一半原因。
    const hitEvent = calculator.generateShot(
      context.table,
      this.profile.aimNoise,
      jitterPower(
        AimCalculator.DEFAULT_SHOT_POWER,
        this.profile.powerJitter
      ),
      aimPoint ?? undefined,
      new Vector3(0, 0, 0)
    )
    const aimEvent = AimEvent.fromJson(hitEvent.tablejson.aim)
    return [aimEvent, hitEvent]
  }

  private pickTargetBall(context: BotShotContext): Ball | undefined {
    if (context.validTargetBalls.length === 0) {
      return undefined
    }

    if (context.table.proximityEnabled) {
      return Respot.furthest(context.cueBall, context.validTargetBalls)
    }

    return Respot.closest(context.cueBall, context.validTargetBalls)
  }
}
