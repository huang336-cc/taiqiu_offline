import { GameEvent } from "../../events/gameevent"
import { Outcome } from "../../model/outcome"
import { Logger } from "./logger"
import { Container } from "../../container/container"
import { EventType } from "../../events/eventtype"
import { AimCalculator } from "./aimcalculator"
import { StartAimEvent } from "../../events/startaimevent"
import { PlaceBallEvent, RespotBody } from "../../events/placeballevent"
import { WatchEvent } from "../../events/watchevent"
import { EventUtil } from "../../events/eventutil"
import { Respot } from "../../utils/respot"
import { Session } from "../client/session"
import { Ball } from "../../model/ball"
import { Vector3 } from "three"
import { Rules } from "../../controller/rules/rules"
import { RuleFactory } from "../../controller/rules/rulefactory"
import { TableGeometry } from "../../view/tablegeometry"
import { Snooker } from "../../controller/rules/snooker"
import { SnookerUtils } from "../../controller/rules/snookerutils"
import { isFirstShot } from "../../utils/utils"
import { BotShotContext, BotStrategy } from "./botstrategy"
import { ClawBreak } from "./strategies/clawbreak"
import { TheFarJaw } from "./strategies/thefarjaw"
import { T, foulReason as translateFoul } from "../../utils/i18n"
import { R } from "../../model/physics/constants"

class BotContainer {
  table
  recorder
  notify() {}
  sendEvent() {}
  sound = { playSuccess() {} }
  isSinglePlayer = false

  constructor(container: Container) {
    this.table = container.table
    this.recorder = container.recorder
  }
}

export class BotEventHandler {
  private readonly logs: Logger
  private readonly container: Container
  private readonly publishSequenceToPlayer: (
    events: GameEvent[],
    delay?: number
  ) => void
  protected enqueueMessage: (message: string) => void
  private readonly calculator: AimCalculator
  private readonly strategy: BotStrategy
  protected readonly botRules: Rules
  private shouldStartTurnOnNextControl = false
  private queuedOwnStartAim = false

  constructor(
    logs: Logger,
    container: Container,
    publishSequenceToPlayer: (events: GameEvent[], delay?: number) => void,
    enqueueMessage: (message: string) => void
  ) {
    this.logs = logs
    this.container = container
    this.publishSequenceToPlayer = publishSequenceToPlayer
    this.enqueueMessage = enqueueMessage
    this.calculator = new AimCalculator(container.rules?.aiNoiseScale ?? 1)
    const botName =
      new URLSearchParams(globalThis.location.search).get("bot") ?? "ClawBreak"
    this.strategy = botName === "TheFarJaw" ? new TheFarJaw() : new ClawBreak()
    this.botRules = RuleFactory.create(
      container.rules.rulename,
      new BotContainer(container)
    )
    if (
      container.rules.rulename === "threecushion" ||
      container.rules.rulename === "sagu"
    ) {
      this.botRules.cueball = this.container.table.balls[1]
    }
  }

  /**
   * Main entry point for the bot to handle game events.
   */
  public handle(event: GameEvent): void {
    this.logs.info(`Bot handling event: ${event.type}`)
    switch (event.type) {
      case EventType.STARTAIM:
        if (!this.queuedOwnStartAim) {
          this.shouldStartTurnOnNextControl = true
        }
        this.queuedOwnStartAim = false
        this.handleStartAim()
        break
      case EventType.PLACEBALL:
        this.shouldStartTurnOnNextControl = true
        this.handlePlaceBall(event as PlaceBallEvent)
        break
      case EventType.BEGIN:
        this.handleStationary()
        break
    }
  }

  /**
   * The balls have finished rolling after a shot. Bot applies rules to decide the next action.
   */
  private handleStationary(): void {
    const outcome = this.container.table.outcome
    const botType = this.botType()
    if (this.container.rules.isEndOfGame(outcome, botType)) {
      this.handleGameEnd()
      return
    }
    const foulReason = this.botRules.foulReason(outcome, botType)
    if (foulReason) {
      this.logs.info(`Bot foul: ${foulReason}`)
      if (this.handleEightBallFoul(outcome)) {
        this.botRules.advanceState?.(outcome)
        return
      }
      this.handleFoul(foulReason, outcome)
      this.botRules.advanceState?.(outcome)
      return
    }
    const pots = this.botRules.getAmountScored(outcome)
    this.logs.info(
      `Bot handleStationary: cueball=${this.botRules.cueball?.id}, pots=${pots}, outcomeLen=${outcome.length}`
    )
    if (
      this.container.rules.rulename !== "threecushion" &&
      this.container.rules.rulename !== "sagu"
    ) {
      this.botRules.advanceState?.(outcome)
    }
    if (pots > 0) {
      if (this.handleEightBallEarlyPot(outcome)) {
        return
      }
      // In snooker, don't respot colours once all reds have been potted
      const isSnooker = this.container.rules.rulename === "snooker"
      const redsOnTable = isSnooker
        ? SnookerUtils.redsOnTable(this.container.table)
        : []
      const shouldRespot = !isSnooker || redsOnTable.length > 0
      const respotted = shouldRespot ? this.botRules.respot(outcome) : []
      respotted.forEach((ball) => ball.fround())
      this.handlePot(pots, outcome)
      return
    }
    this.logs.hide()
    this.publishSequenceToPlayer([new StartAimEvent()])
  }

  private botType(): number {
    const p1type = Session.getInstance().p1type
    if (p1type === 1) return 2
    if (p1type === 2) return 1
    return 0
  }

  validTargetBalls(): Ball[] {
    switch (this.container.rules.rulename) {
      case "eightball":
        return this.validEightBallTargets(this.botType())
      case "nineball":
        return this.validNineBallTargets()
      case "snooker":
        return this.validSnookerTargets()
      case "threecushion":
        return this.validThreeCushionTargets()
      case "sagu":
        return this.validSaguTargets()
      default:
        return []
    }
  }

  private validEightBallTargets(botType: number): Ball[] {
    const cueball = this.container.table.cueball
    const balls = this.container.table.balls.filter(
      (ball) => ball !== cueball && ball.onTable()
    )

    if (botType === 0) {
      return balls.filter((ball) => ball.label !== 8)
    }

    const groupBalls = balls.filter((ball) =>
      this.isEightBallType(ball, botType)
    )
    if (groupBalls.length > 0) {
      return groupBalls
    }

    return balls.filter((ball) => ball.label === 8)
  }

  private isEightBallType(ball: Ball, type: number): boolean {
    if (type === 1) {
      return (ball.label ?? 0) >= 1 && (ball.label ?? 0) <= 7
    }
    if (type === 2) {
      return (ball.label ?? 0) >= 9 && (ball.label ?? 0) <= 15
    }
    return false
  }

  private validNineBallTargets(): Ball[] {
    const cueball = this.container.table.cueball
    const lowestBall = this.container.table.balls
      .filter((ball) => ball !== cueball && ball.onTable())
      .sort((a, b) => (a.label ?? 0) - (b.label ?? 0))[0]

    return lowestBall ? [lowestBall] : []
  }

  private validSnookerTargets(): Ball[] {
    if (isFirstShot(this.container.recorder)) {
      return []
    }

    const snookerRules = this.botRules as Snooker
    const table = this.container.table
    const redsOnTable = SnookerUtils.redsOnTable(table)
    const coloursOnTable = SnookerUtils.coloursOnTable(table)

    if (snookerRules.previousPotRed) {
      return coloursOnTable
    }
    if (redsOnTable.length > 0) {
      return redsOnTable
    }

    return coloursOnTable.length > 0 ? [coloursOnTable[0]] : []
  }

  private validThreeCushionTargets(): Ball[] {
    if (isFirstShot(this.container.recorder)) {
      return []
    }

    const cueball = this.container.table.balls[1]
    return this.container.table.balls.filter(
      (ball) => ball !== cueball && ball.onTable()
    )
  }

  private validSaguTargets(): Ball[] {
    if (isFirstShot(this.container.recorder)) {
      return []
    }

    const cueball = this.container.table.balls[1]
    const opponentCue = this.container.table.balls[0]
    return this.container.table.balls.filter(
      (ball) => ball !== cueball && ball !== opponentCue && ball.onTable()
    )
  }

  private handleGameEnd(forcedAmIWinner?: boolean): void {
    const session = Session.getInstance()
    let amIWinner: boolean
    if (forcedAmIWinner !== undefined) {
      amIWinner = forcedAmIWinner
    } else if (
      this.container.rules.rulename === "eightball" ||
      this.container.rules.rulename === "nineball"
    ) {
      // v1.2.15：落袋游戏自然结束时，isEndOfGame 触发的一方获胜。
      // 当前行动方由 cueball.id 判断（玩家=0，电脑=1）。
      amIWinner = this.container.table.cueball.id === session.playerIndex
    } else {
      const { p1, p2 } = session.orderedScoresForHud()
      amIWinner = session.playerIndex === 0 ? p1 >= p2 : p2 >= p1
    }

    console.log("Bot handleGameEnd, amIWinner=" + amIWinner)
    console.log("Bot handleGameEnd, session", session)
    this.container.updateController(
      // here using player rules why?
      this.container.rules.handleGameEnd(amIWinner)
    )
  }

  private handleEightBallFoul(outcome: Outcome[]): boolean {
    if (this.container.rules.rulename !== "eightball") {
      return false
    }

    const table = this.container.table
    const cueball = table.cueball
    const eightBall = table.balls.find((b) => b.label === 8)
    if (!eightBall || !Outcome.pots(outcome).includes(eightBall)) {
      return false
    }

    const session = Session.getInstance()
    const hasObjectBallsRemaining = table.balls.some(
      (b) => b !== cueball && b.label !== 8 && b.onTable()
    )

    if (session.p1type !== 0 && hasObjectBallsRemaining) {
      const footSpot = new Vector3(TableGeometry.tableX / 2, 0, 0)
      Respot.respotBehind(footSpot, eightBall, table)
      eightBall.fround()
      this.handleFoul("8-ball pocketed early", [], [eightBall])
      return true
    }

    // v1.2.15：bot 犯规打进黑八且没有剩余目标球时，判玩家获胜。
    this.handleGameEnd(true)
    return true
  }

  private handleEightBallEarlyPot(outcome: Outcome[]): boolean {
    if (this.container.rules.rulename !== "eightball") {
      return false
    }

    const table = this.container.table
    const cueball = table.cueball
    const eightBall = table.balls.find((b) => b.label === 8)
    if (!eightBall || !Outcome.pots(outcome).includes(eightBall)) {
      return false
    }

    const session = Session.getInstance()
    const hasObjectBallsRemaining = table.balls.some(
      (b) => b !== cueball && b.label !== 8 && b.onTable()
    )

    if (session.p1type !== 0 && hasObjectBallsRemaining) {
      const footSpot = new Vector3(TableGeometry.tableX / 2, 0, 0)
      Respot.respotBehind(footSpot, eightBall, table)
      eightBall.fround()
      this.handleFoul("8-ball pocketed early", [], [eightBall])
      return true
    }

    return false
  }

  private handleFoul(
    foulReason: string,
    outcome: Outcome[],
    respottedOverride?: Ball[]
  ): void {
    const session = Session.getInstance()
    const cueball = this.container.table.cueball
    const isSnooker = this.container.rules.rulename === "snooker"
    const whitePotted = Outcome.isCueBallPotted(cueball, outcome)
    const ballInHand = !isSnooker || whitePotted

    // v1.3.18：bot 出杆犯规时若同帧打进合法球，按规则过滤后仍计入 bot 累计比分。
    // 与玩家端 eightball/nineball.handleFoul 对称：犯规（母球落袋）只损失球权，
    // 但本杆已落袋的合法球不丢。八号/九号球视规则被 respot 复位，不算分。
    const ruleName = this.container.rules.rulename
    if (ruleName === "eightball" || ruleName === "nineball") {
      const pots = Outcome.pots(outcome)
      const disallowedLabel = ruleName === "eightball" ? 8 : 9
      const foulScoredPots = pots.filter(
        (b) => b !== cueball && b.label !== disallowedLabel
      )
      if (foulScoredPots.length > 0) {
        session.addOpponentScore(foulScoredPots.length)
      }
    }

    if (isSnooker) {
      session.addMyScore(this.snookerFoulPoints(outcome))
    }

    if (this.container.rules.rulename === "sagu") {
      session.setOpponentScore(Math.max(0, session.opponentScore() - 1))
    }

    const { p1: s1, p2: s2 } = session.orderedScoresForHud()
    this.container.sendScoreUpdate(s1, s2, 0, this.myActivePlayer())

    this.container.notify({
      type: "Foul",
      title: T.foul,
      subtext: translateFoul(foulReason),
      ...(ballInHand ? { extra: T.ballInHand } : {}),
    })
    if (!ballInHand) {
      ;(respottedOverride ?? this.container.rules.respot(outcome)).forEach(
        (ball) => ball.fround()
      )
      this.publishSequenceToPlayer([new StartAimEvent()])
      return
    }
    if (!cueball.onTable()) {
      Respot.respotBehind(
        this.container.rules.placeBall(),
        cueball,
        this.container.table
      )
    }
    // v1.2.5：玩家犯规后电脑自由摆球——搜索整桌最佳合法点，而非默认开球线。
    const startPos = this.chooseBallInHandPosition()
    cueball.setStationary()
    const respotted = respottedOverride ?? this.container.rules.respot(outcome)
    let respot: RespotBody | undefined
    if (respotted.length > 0) {
      respot = { id: respotted[0].id, pos: respotted[0].pos.clone() }
    }
    this.publishSequenceToPlayer([new PlaceBallEvent(startPos, respot, true)])
  }

  private snookerFoulPoints(outcome: Outcome[]): number {
    const snookerRules = this.botRules as Snooker
    const info = SnookerUtils.shotInfo(
      this.container.table,
      outcome,
      snookerRules.targetIsRed,
      snookerRules.previousPotRed
    )
    return SnookerUtils.calculateFoul(outcome, info).points
  }

  private myActivePlayer(): 1 | 2 {
    return (Session.getInstance().playerIndex + 1) as 1 | 2
  }

  /**
   * v1.2.5：玩家犯规后电脑获得「自由摆球」（ball in hand）。
   * 不再只放到默认开球线位置，而是在整张球桌上搜索一个「合法（不与任何球重叠）且
   * 能对准目标球」的最佳点：优先选一条能直球命中目标球、距离适中（约 0.5m）的落点，
   * 让电脑像玩家一样自由摆球并争取好球型。
   */
  private chooseBallInHandPosition(): Vector3 {
    const table = this.container.table
    const cueball = table.cueball
    const balls = table.balls.filter((b) => b !== cueball && b.onTable())
    const targets = this.validTargetBalls()
    const tx = TableGeometry.tableX - R * 1.2
    const ty = TableGeometry.tableY - R * 1.2

    const overlaps = (pos: Vector3): boolean => {
      for (const b of balls) {
        if (pos.distanceTo(b.pos) < 2 * R * 1.02) return true
      }
      return false
    }
    // 从 from 到 to 的线段是否被其它球阻挡（点到线段距离 < 2R 视为挡住）
    const lineBlocked = (from: Vector3, to: Vector3): boolean => {
      const dir = to.clone().sub(from)
      const len = dir.length()
      if (len < 1e-4) return false
      dir.multiplyScalar(1 / len)
      for (const b of balls) {
        const w = b.pos.clone().sub(from)
        const t = Math.max(0, Math.min(len, w.dot(dir)))
        const proj = from.clone().add(dir.clone().multiplyScalar(t))
        if (proj.distanceTo(b.pos) < 2 * R) return true
      }
      return false
    }
    const scorePos = (pos: Vector3): number => {
      if (overlaps(pos)) return -1
      if (targets.length === 0) return 0.5
      let best = -1
      for (const t of targets) {
        const d = pos.distanceTo(t.pos)
        if (d < 2 * R + 0.05) return -1 // 太近无法瞄准
        if (lineBlocked(pos, t.pos)) continue // 视线被挡，跳过
        // 距离约 0.5m 最舒适，越接近越好
        const quality = 1 / (1 + Math.abs(d - 0.5))
        best = Math.max(best, quality)
      }
      return best
    }

    let bestPos: Vector3 | null = null
    let bestScore = -1
    const N = 14
    const stepX = (2 * tx) / N
    const stepY = (2 * ty) / N
    for (let i = 0; i <= N; i++) {
      for (let j = 0; j <= N; j++) {
        const pos = new Vector3(-tx + i * stepX, -ty + j * stepY, 0)
        const s = scorePos(pos)
        if (s > bestScore) {
          bestScore = s
          bestPos = pos
        }
      }
    }
    // 兜底：极端情况下退回到规则默认点
    return bestPos ?? this.container.rules.placeBall()
  }

  private handlePot(pots: number, outcome: Outcome[]): void {
    this.logs.info(
      `Bot handlePot: scored ${pots} points. Next cueball=${this.botRules.cueball?.id}`
    )
    const session = Session.getInstance()
    session.addOpponentScore(pots)
    this.botRules.currentBreak += pots
    this.assignEightBallType(session, outcome)

    if (
      this.container.rules.rulename === "snooker" &&
      this.botRules.isEndOfGame(outcome, this.botType())
    ) {
      this.handleGameEnd()
      return
    }

    const { p1: s1, p2: s2 } = session.orderedScoresForHud()
    this.container.sendScoreUpdate(
      s1,
      s2,
      0,
      this.container.inferActivePlayer()
    )
    this.publishSequenceToPlayer([
      new WatchEvent(this.container.table.serialise()),
    ])
    this.queuedOwnStartAim = true
    this.enqueueMessage(EventUtil.serialise(new StartAimEvent()))
  }

  private assignEightBallType(session: Session, outcome: Outcome[]): void {
    if (session.p1type !== 0 || this.container.rules.rulename !== "eightball") {
      return
    }
    const pottedBalls = Outcome.pots(outcome)
    const hasSolid = pottedBalls.some(
      (b) => (b.label ?? 0) >= 1 && (b.label ?? 0) <= 7
    )
    const hasStripe = pottedBalls.some(
      (b) => (b.label ?? 0) >= 9 && (b.label ?? 0) <= 15
    )
    if (hasSolid && !hasStripe) {
      session.p1type = 2
    } else if (hasStripe && !hasSolid) {
      session.p1type = 1
    }
  }

  private handleStartAim(): void {
    this.startTurnIfNeeded()
    this.logs.show()
    this.container.table.cue.aim.elevation = 0
    this.publishSequenceToPlayer(this.aim())
  }

  private handlePlaceBall(event: PlaceBallEvent): void {
    this.startTurnIfNeeded()
    const table = this.container.table

    if (event.respot) {
      const ball = table.balls.find((b) => b.id === event.respot?.id)
      if (ball) {
        ball.pos.copy(event.respot.pos)
        ball.setStationary()
        ball.fround()
      }
    }

    const cueball = table.cueball
    cueball.pos.copy(
      event.useStartPos ? event.pos : this.container.rules.placeBall()
    )
    cueball.setStationary()
    cueball.fround()
    this.container.table.cue.aim.elevation = 0
    this.publishSequenceToPlayer(this.aim())
  }

  private startTurnIfNeeded(): void {
    if (!this.shouldStartTurnOnNextControl) {
      return
    }
    this.botRules.startTurn()
    this.shouldStartTurnOnNextControl = false
  }

  private aim() {
    return this.strategy.aim(this.buildShotContext(), this.calculator)
  }

  private buildShotContext(): BotShotContext {
    const cueBall =
      this.container.rules.rulename === "threecushion" ||
      this.container.rules.rulename === "sagu"
        ? this.container.table.balls[1]
        : this.container.table.cueball

    return {
      table: this.container.table,
      cueBall,
      validTargetBalls: this.validTargetBalls(),
      ballInHand: false,
    }
  }
}
