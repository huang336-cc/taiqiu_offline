import { Ball } from "../../../model/ball"
import { Respot } from "../../../utils/respot"
import { AimCalculator } from "../aimcalculator"
import { BotShotContext } from "../botstrategy"
import { TheFarJaw } from "./thefarjaw"

/**
 * 专业难度 AI（Professional）：在激进策略（TheFarJaw）的瞄准与远袋角逻辑之上，
 * 强化目标球选择——优先打「最易进袋」的球（到最近袋口距离最小者），
 * 而非单纯取离母球最近的球。这样专业电脑进球率更高、走位更合理，
 * 明显强于稳健（ClawBreak）与激进（TheFarJaw），作为第三档电脑难度。
 *
 * 出杆精度保持 noise=0（与激进一致，已是最精准），难度差异主要来自决策质量。
 */
export class Professional extends TheFarJaw {
  readonly name = "Professional"

  protected pickTargetBall(context: BotShotContext): Ball | undefined {
    const balls = context.validTargetBalls
    if (balls.length === 0) {
      return undefined
    }

    // 近距优先（与激进一致）：在「离母球较近」的候选里挑最易进袋的，
    // 兼顾走位距离与进球概率，避免为远球长距离走位失误。
    const cue = context.cueBall
    const ranked = [...balls].sort(
      (a, b) => a.pos.distanceTo(cue.pos) - b.pos.distanceTo(cue.pos)
    )
    const candidates = ranked.slice(0, Math.max(2, Math.ceil(balls.length / 2)))

    let best: Ball | undefined
    let bestScore = Infinity
    const pockets = context.pockets ?? []
    for (const ball of candidates) {
      const d = this.easiestPocketDistance(ball.pos, pockets)
      if (d < bestScore) {
        bestScore = d
        best = ball
      }
    }
    return best ?? Respot.closest(cue, balls)
  }

  /** 目标球到最近袋口的距离（越小越易进） */
  private easiestPocketDistance(pos: any, pockets: any[]): number {
    let min = Infinity
    for (const p of pockets) {
      const d = pos.distanceTo(p)
      if (d < min) min = d
    }
    return min
  }
}
