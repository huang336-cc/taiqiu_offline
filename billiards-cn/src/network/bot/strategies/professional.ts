import { Ball } from "../../../model/ball"
import { Respot } from "../../../utils/respot"
import { AimCalculator } from "../aimcalculator"
import { BotShotContext } from "../botstrategy"
import { TheFarJaw } from "./thefarjaw"
import { Vector3 } from "three"
import { R } from "../../../model/physics/constants"
import { TableGeometry } from "../../../view/tablegeometry"
import { AimEvent } from "../../../events/aimevent"

/**
 * 专业难度 AI（Professional）：在激进策略（TheFarJaw）的远袋角逻辑之上，
 * 大幅强化「决策质量」，作为最强的一档电脑难度。
 *
 * 与旧版（只挑"最易进袋的球"）相比，本版逐项增强：
 *  1. 候选过滤：剔除「被其它球遮挡（视线挡住）」与「切球角过大（>78°）」的球-袋组合，
 *     只保留几何上真的能进的线路。
 *  2. 母球防摔袋：用「母球沿切线方向走位」的几何近似，预判击球后母球大致停位，
 *     若会落入任一袋口（距离 < 1.6R）则降低力度 / 在该球上改用更安全的袋口，
 *     实在无解则整体优先选"母球离袋口最远"的方案。
 *  3. 走位朝向：在所有可行组合里，额外奖励"打进后母球大致朝向剩余球群中心"的方案，
 *     提升连续进球（break & run）能力，而不是进一颗就乱跑。
 *  4. 力度自适应：根据 母球→目标→袋 的距离组合选力度（近用小力、远用中力），
 *     避免满力胡跑导致母球失控摔袋或走位崩坏。
 *  5. 若没有任何可进的合法球，退化为稳健的"近距碰一颗"保底出杆，避免空杆/犯规。
 */
export class Professional extends TheFarJaw {
  readonly name = "Professional"

  /** 出杆主入口：返回与 TheFarJaw 同构的事件序列（aim + 远袋角备选）。 */
  aim(context: BotShotContext, calculator: AimCalculator): GameEvent[] {
    if (!TableGeometry.hasPockets) {
      // 无袋玩法（开伦/沙孤）沿用父类逻辑
      return super.aim(context, calculator)
    }

    const cue = context.cueBall
    const balls = context.validTargetBalls
    const pockets = calculator.pockets
    if (balls.length === 0 || pockets.length === 0) {
      return super.aim(context, calculator)
    }

    // 1) 枚举所有 (目标球, 袋口) 组合，计算每个组合的几何可行性与走位评分
    type Plan = {
      ball: Ball
      pocket: Vector3
      cutCos: number // 余弦切球角（越大越正，越易进）
      lineBlocked: boolean
      cuePocketDist: number
      potDist: number
      scratchRisk: number // 母球摔袋风险（停位到最近袋距离，越小越危险）
      angleToNext: number // 打进后母球朝向"剩余球群中心"的契合度（余弦）
    }
    const plans: Plan[] = []
    const otherBalls = balls
    const nextCenter = this.remainingCenter(cue, balls)

    for (const ball of balls) {
      for (const pocket of pockets) {
        // 切球角：母球→目标 与 目标→袋 的方向夹角余弦
        const toTarget = ball.pos.clone().sub(cue.pos).normalize()
        const toPocket = pocket.clone().sub(ball.pos).normalize()
        const cutCos = toTarget.dot(toPocket)
        if (cutCos <= 0.15) continue // 切球角 > ~81°，几乎不可能进，跳过

        // 视线遮挡：母球→目标 直线是否被其它球挡
        const blocked = this.lineBlocked(cue.pos, ball.pos, otherBalls, ball)
        if (blocked) continue

        const cueToBall = cue.pos.distanceTo(ball.pos)
        const ballToPocket = ball.pos.distanceTo(pocket)
        const scratch = this.scratchDistance(cue.pos, ball.pos, pocket, pockets)

        let angleToNext = 0
        if (nextCenter) {
          // 母球切线方向（打进后母球大致沿此方向走）
          const ghost = ball.pos.clone().addScaledVector(toPocket, -2 * R)
          const tangent = AimCalculator.getTangentVector(cue.pos, ball.pos, ghost)
          const toNext = nextCenter.clone().sub(cue.pos).normalize()
          angleToNext = tangent.dot(toNext)
        }

        plans.push({
          ball,
          pocket,
          cutCos,
          lineBlocked: blocked,
          cuePocketDist: cueToBall + ballToPocket,
          potDist: ballToPocket,
          scratchRisk: scratch,
          angleToNext,
        })
      }
    }

    if (plans.length === 0) {
      // 没有任何几何上可进的球：退化为近距碰一颗，避免空杆犯规
      const fallback = Respot.closest(cue, balls)
      if (!fallback) return super.aim(context, calculator)
      const aimPoint = calculator.getAimPoint(cue.pos, fallback.pos)
      const hit = calculator.generateShot(
        context.table,
        0,
        AimCalculator.DEFAULT_SHOT_POWER,
        aimPoint,
        new Vector3(0, 0, 0)
      )
      const aimEvent = AimEvent.fromJson(hit.tablejson.aim)
      return [aimEvent, hit]
    }

    // 2) 评分：优先「不摔袋」>「切球角正」>「走位朝向好」>「距离近」
    plans.sort((a, b) => {
      // 摔袋风险：低于安全阈值的方案直接降权
      const safeA = a.scratchRisk > 1.6 * R ? 0 : 1
      const safeB = b.scratchRisk > 1.6 * R ? 0 : 1
      if (safeA !== safeB) return safeA - safeB // 安全优先
      if (b.cutCos !== a.cutCos) return b.cutCos - a.cutCos // 切球角更正优先
      if (b.angleToNext !== a.angleToNext)
        return b.angleToNext - a.angleToNext // 走位更好优先
      return a.cuePocketDist - b.cuePocketDist // 距离更近优先
    })

    const best = plans[0]

    // 3) 力度自适应：远距用更大力度，近距用小力度，降低失控/摔袋
    let power = AimCalculator.DEFAULT_SHOT_POWER
    if (best.cuePocketDist < 1.2) power = 55 * R
    else if (best.cuePocketDist < 2.2) power = 80 * R
    else if (best.cuePocketDist < 3.5) power = 100 * R
    else power = AimCalculator.MAX_SHOT_POWER
    // 若仍有摔袋风险，主动收力，减小母球穿透
    if (best.scratchRisk < 1.6 * R) {
      power = Math.min(power, 70 * R)
    }

    // 4) 用选中的 (球, 袋) 生成进球杆（带远袋角备选，提升容错）
    const aimPoint = calculator.getAimPoint(cue.pos, best.ball.pos, [
      best.pocket,
    ])
    const knuckles = calculator.closestKnuckles(
      calculator.findBestPocket(cue.pos, best.ball.pos, [best.pocket])
    )
    const farKnuckle =
      best.ball.pos.distanceTo(knuckles[0]) >
      best.ball.pos.distanceTo(knuckles[1])
        ? knuckles[0]
        : knuckles[1]
    const farKnuckleAimPoint = calculator.getAimPoint(
      cue.pos,
      best.ball.pos,
      [farKnuckle]
    )

    const pocketHit = calculator.generateShot(
      context.table,
      0,
      power,
      aimPoint,
      new Vector3(0, 0, 0)
    )
    const farKnuckleHit = calculator.generateShot(
      context.table,
      0,
      AimCalculator.MAX_SHOT_POWER,
      farKnuckleAimPoint,
      new Vector3(0, -0.3, 0)
    )
    const aimEvent = AimEvent.fromJson(pocketHit.tablejson.aim)
    const farKnuckleAimEvent = AimEvent.fromJson(
      farKnuckleHit.tablejson.aim
    )
    return [aimEvent, farKnuckleAimEvent, farKnuckleHit]
  }

  /** 剩余目标球的群体中心（用于评估走位朝向） */
  private remainingCenter(cue: Ball, balls: Ball[]): Vector3 | null {
    if (balls.length <= 1) return null
    const c = new Vector3()
    let n = 0
    for (const b of balls) {
      if (b === cue) continue
      c.add(b.pos)
      n++
    }
    if (n === 0) return null
    c.multiplyScalar(1 / n)
    return c
  }

  /** 母球→目标 直线是否被其它球遮挡（点到线段距离 < 2R 视为挡） */
  private lineBlocked(
    from: Vector3,
    to: Vector3,
    balls: Ball[],
    target: Ball
  ): boolean {
    const dir = to.clone().sub(from)
    const len = dir.length()
    if (len < 1e-4) return false
    dir.multiplyScalar(1 / len)
    for (const b of balls) {
      if (b === target) continue
      const w = b.pos.clone().sub(from)
      const t = Math.max(0, Math.min(len, w.dot(dir)))
      const proj = from.clone().add(dir.clone().multiplyScalar(t))
      if (proj.distanceTo(b.pos) < 2 * R) return true
    }
    return false
  }

  /**
   * 母球摔袋风险近似：击打目标球后，母球沿「切线方向」行进一段（与总距离相关），
   * 计算其停位到最近袋口的距离。距离越小越危险。
   */
  private scratchDistance(
    cuePos: Vector3,
    targetPos: Vector3,
    pocket: Vector3,
    pockets: Vector3[]
  ): number {
    const toPocket = pocket.clone().sub(targetPos).normalize()
    const ghost = targetPos.clone().addScaledVector(toPocket, -2 * R)
    const tangent = AimCalculator.getTangentVector(cuePos, targetPos, ghost)
    // 走位距离随母球→目标距离增大（大力更容易穿透）
    const travel = Math.min(6 * R, cuePos.distanceTo(targetPos) * 1.5 + R)
    const stop = cuePos.clone().addScaledVector(tangent, travel)
    let min = Infinity
    for (const p of pockets) {
      const d = stop.distanceTo(p)
      if (d < min) min = d
    }
    return min
  }
}
