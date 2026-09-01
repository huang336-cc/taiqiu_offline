import { Vector3 } from "three"
import { Container } from "../../container/container"
import { Ball } from "../../model/ball"
import { Outcome, OutcomeType } from "../../model/outcome"
import { Table } from "../../model/table"
import { Controller } from "../controller"
import { Rules } from "./rules"
import { TableGeometry } from "../../view/tablegeometry"
import { TableConfig } from "../../view/tableconfig"
import { Rack } from "../../utils/rack"
import { isFirstShot } from "../../utils/utils"
import { R } from "../../model/physics/constants"
import { Session } from "../../network/client/session"
import { MatchResultHelper } from "../../network/client/matchresult"
import { Aim } from "../aim"
import { WatchAim } from "../watchaim"
import { PlaceBall } from "../placeball"
import { PlaceBallEvent } from "../../events/placeballevent"
import { WatchEvent } from "../../events/watchevent"
import { StartAimEvent } from "../../events/startaimevent"
import { ScoreEvent } from "../../events/scoreevent"
import { roundVec } from "../../utils/three-utils"
import { Respot } from "../../utils/respot"
import { RerackEvent } from "../../events/rerackevent"
import { t, foulReason } from "../../utils/i18n"

const flipType = (t: number) => {
  if (t === 1) return 2
  if (t === 2) return 1
  return 0
}

export class EightBall implements Rules {
  readonly container: Container

  cueball: Ball
  currentBreak = 0
  previousBreak = 0
  rulename = "eightball"
  /** 本局第一杆（开球）是否已处理；开球杆进球不分球，球桌保持开放 */
  private firstShotPlayed = false

  constructor(container: Container) {
    this.container = container
  }

  startTurn(): void {
    this.previousBreak = this.currentBreak
    this.currentBreak = 0
  }

  readonly asset = "models/p8.min.gltf"

  tableGeometry(): void {
    TableConfig.apply(
      this.rulename,
      TableConfig.tableSizeFromUrl(this.rulename)
    )
  }

  table(): Table {
    const table = new Table(this.rack())
    this.cueball = table.cueball
    return table
  }

  rack(): Ball[] {
    return Rack.fromInitParam(Rack.eightBall())
  }

  secondToPlay(): void {
    // Intentionally empty
  }

  otherPlayersCueBall(): Ball {
    return this.cueball
  }

  isPartOfBreak(outcome: Outcome[]): boolean {
    return Outcome.isBallPottedNoFoul(this.container.table.cueball, outcome)
  }

  allowsPlaceBall(): boolean {
    return true
  }

  placeBall(target?: Vector3): Vector3 {
    if (target) {
      const max = new Vector3(TableGeometry.tableX, TableGeometry.tableY)
      const min = new Vector3(-TableGeometry.tableX, -TableGeometry.tableY)
      if (isFirstShot(this.container.recorder)) {
        const baulkline = (-R * 11) / 0.5
        max.setX(baulkline)
        min.setX(baulkline)
      }
      return target.clone().clamp(min, max)
    }
    const baulkline = (-R * 11) / 0.5
    return new Vector3(baulkline, 0, 0)
  }

  nextCandidateBall(p1type?: number): Ball | undefined {
    const type = p1type ?? Session.getInstance().p1type
    const table = this.container.table
    const balls = table.balls.filter((b) => b !== this.cueball && b.onTable())

    if (type === 0) {
      return balls.find((b) => b.label !== 8)
    }

    const myGroup = balls.filter((b) => this.isMyType(b, type))
    if (myGroup.length > 0) {
      return Respot.closest(table.cueball, myGroup)
    }

    return table.balls.find((b) => b.label === 8 && b.onTable())
  }

  private isMyType(ball: Ball, type = Session.getInstance().p1type): boolean {
    if (type === 1) {
      return (ball.label || 0) >= 1 && (ball.label || 0) <= 7
    }
    if (type === 2) {
      return (ball.label || 0) >= 9 && (ball.label || 0) <= 15
    }
    return false
  }

  isFoul(outcome: Outcome[]): boolean {
    return this.foulReason(outcome) !== null
  }

  getAmountScored(outcome: Outcome[]): number {
    return Outcome.potCount(outcome)
  }

  respot(_outcome: Outcome[]): Ball[] {
    return []
  }

  private wrongBallHitReason(
    hitBall: Ball,
    outcome: Outcome[],
    type?: number
  ): string | null {
    const session = Session.getInstance()
    const effectiveType = type ?? session.p1type
    if (effectiveType === 0) {
      return hitBall.label === 8 ? "开局先碰黑八，犯规" : null
    }
    const cueball = this.container.table.cueball
    const pottedThisShot = new Set(Outcome.pots(outcome))
    const myGroupBefore = this.container.table.balls.filter(
      (b) =>
        b !== cueball &&
        (b.onTable() || pottedThisShot.has(b)) &&
        this.isMyType(b, effectiveType)
    )
    if (myGroupBefore.length > 0) {
      return this.isMyType(hitBall, effectiveType)
        ? null
        : "先碰到了对方的球"
    }
    return hitBall.label === 8 ? null : "本方球已清台，必须先碰黑八"
  }

  foulReason(outcome: Outcome[], type?: number): string | null {
    const table = this.container.table
    const cueball = table.cueball

    if (Outcome.isCueBallPotted(cueball, outcome)) {
      return "母球落袋"
    }

    const firstCollision = Outcome.firstCollision(
      Outcome.cueBallFirst(cueball, outcome)
    )

    if (!firstCollision) {
      return "空杆，未击中任何球"
    }

    const wrongBall = this.wrongBallHitReason(
      firstCollision.ballB!,
      outcome,
      type
    )
    if (wrongBall) {
      return wrongBall
    }

    // 3. No cushion after contact
    if (Outcome.potCount(outcome) === 0) {
      const firstCollisionIndex = outcome.indexOf(firstCollision)
      const cushionsAfter = outcome
        .slice(firstCollisionIndex + 1)
        .some((o) => o.type === OutcomeType.Cushion)
      if (!cushionsAfter) {
        return "击球后无球碰库"
      }
    }

    return null
  }

  update(outcome: Outcome[]): Controller {
    const reason = this.foulReason(outcome)

    let next: Controller
    if (reason) {
      next = this.handleFoul(outcome, reason)
    } else {
      const pots = Outcome.pots(outcome)
      if (pots.length > 0) {
        next = this.handlePot(outcome)
      } else {
        next = this.handleMiss()
      }
    }

    // 本局第一杆（开球）处理完毕，后续杆才允许按进球花色自动分球。
    this.firstShotPlayed = true
    return next
  }

  private handleFoul(outcome: Outcome[], reason: string): Controller {
    this.container.notify({
      type: "Foul",
      title: t("foul"),
      subtext: foulReason(reason),
      extra: t("ballInHand"),
    })
    this.startTurn()
    const pots = Outcome.pots(outcome)
    const eightBallPotted = pots.some((b) => b.label === 8)
    const cueball = this.container.table.cueball

    // v1.3.18：犯规时若同帧打进合法球（非母球、非黑八），仍计入我方累计比分。
    // 旧版（v1.3.4 起）只在开球杆（!firstShotPlayed）做这个特例，
    // 导致用户报告的「进球同时白球（母球）也进了，进球数未递增」bug。
    // 现统一为「任何犯规都保留本杆合法进球」，仅排除母球（犯规代价）和黑八
    // （早进黑八已由 respotEightBallFoul 分支单独处理）。
    const foulScoredPots = pots.filter(
      (b) => b !== cueball && b.label !== 8
    )
    if (foulScoredPots.length > 0) {
      const session = Session.getInstance()
      session.addMyScore(foulScoredPots.length)
      const { p1: s1, p2: s2 } = session.orderedScoresForHud()
      this.container.sendScoreUpdate(s1, s2, this.currentBreak)
    }

    if (eightBallPotted) {
      const session = Session.getInstance()
      const hasGroupBalls = this.container.table.balls.some(
        (b) => b !== cueball && b.label !== 8 && b.onTable()
      )
      if (session.p1type !== 0 && hasGroupBalls) {
        return this.respotEightBallFoul()
      }
      return this.handleGameEnd(false, "8-ball pocketed on foul")
    }

    const startPos = cueball.onTable() ? cueball.pos.clone() : this.placeBall()
    roundVec(startPos)
    const placeBallEvent = new PlaceBallEvent(startPos, undefined, true)
    this.container.sendEvent(placeBallEvent)

    if (this.container.isSinglePlayer) {
      return new PlaceBall(this.container, startPos)
    }
    return new WatchAim(this.container)
  }

  private handlePot(outcome: Outcome[]): Controller {
    const session = Session.getInstance()
    const table = this.container.table
    const pots = Outcome.pots(outcome)

    // 8 号球提前进袋（非合法结束）按犯规处理：复位 8 号球，不计分。
    // 注意：合法结束（清完本组后打进 8 号）不在此分支，会正常计分并结束对局。
    if (pots.some((b) => b.label === 8) && !this.isEndOfGame(outcome)) {
      return this.respotEightBallFoul()
    }

    const myGroupBefore = session.p1type
    if (session.p1type === 0) {
      // 开球杆（本局第一杆）进球不分配花色：球桌保持开放，
      // 玩家仍可自由选择打另一个花色，直到后续某一杆才按进球花色定组。
      if (this.firstShotPlayed) {
        const solids = pots.filter((b) => b.label! >= 1 && b.label! <= 7)
        const stripes = pots.filter((b) => b.label! >= 9 && b.label! <= 15)

        if (solids.length > 0 && stripes.length === 0) {
          session.p1type = 1
        } else if (stripes.length > 0 && solids.length === 0) {
          session.p1type = 2
        }
      }
    }

    this.currentBreak += pots.length
    session.addMyScore(pots.length)

    // v1.3.59：删除进球后的 success 特效提示音（与落袋音叠加显得多余吵闹）

    const p1typeForEvent =
      session.playerIndex === 0 ? session.p1type : flipType(session.p1type)
    const scoreEvent = new ScoreEvent(
      session.playerIndex === 0 ? session.myScore() : session.opponentScore(),
      session.playerIndex === 1 ? session.myScore() : session.opponentScore(),
      this.currentBreak,
      (session.playerIndex + 1) as any,
      p1typeForEvent
    )
    this.container.sendEvent(scoreEvent)

    this.container.sendEvent(new WatchEvent(table.serialise()))

    // 合法打进 8 号球（清完本组后）→ 结束对局。此时 8 号球已计入得分，
    // 比分栏显示的进球数 = 实际进袋数（含 8 号），不再被限制为 7。
    // v1.3.57 注：能走到这里的必然是玩家自己出的杆（电脑出杆走
    // WatchShot → BEGIN → BotEventHandler.handleGameEnd，不经 rules.update），
    // 所以胜负恒为 true 是正确结果，而非判定逻辑正确——落袋游戏只有一个
    // 母球，`table.cueball === balls[playerIndex]` 在 playerIndex=0 时恒真；
    // 别把电脑的胜负也接到这个判定上（v1.3.56 及之前 boteventhandler 正是
    // 照搬了这行，导致电脑赢也显示「你赢了」）。
    if (this.isEndOfGame(outcome)) {
      const myCueBall = table.balls[session.playerIndex]
      const amIWinner = table.cueball === myCueBall
      return this.handleGameEnd(amIWinner)
    }

    if (myGroupBefore !== 0) {
      const myGroupPotted = pots.some((b) => this.isMyType(b, myGroupBefore))
      if (!myGroupPotted) {
        return this.handleMiss()
      }
    }

    return new Aim(this.container)
  }

  private respotEightBallFoul(): Controller {
    const table = this.container.table
    const eightBall = table.balls.find((b) => b.label === 8)!
    const footSpot = new Vector3(TableGeometry.tableX / 2, 0, 0)
    Respot.respotBehind(footSpot, eightBall, table)
    eightBall.fround()
    this.container.sendEvent(
      RerackEvent.fromJson({ balls: [eightBall.serialise()] })
    )
    return this.handleFoul([], "8-ball pocketed early")
  }

  private handleMiss(): Controller {
    const table = this.container.table
    this.container.sendEvent(new StartAimEvent())
    if (this.container.isSinglePlayer) {
      this.container.sendEvent(new WatchEvent(table.serialise()))
      this.startTurn()
      return new Aim(this.container)
    }
    return new WatchAim(this.container)
  }

  isEndOfGame(outcome: Outcome[], type?: number): boolean {
    const eightBall = this.container.table.balls.find((b) => b.label === 8)!
    const eightBallPotted = Outcome.pots(outcome).includes(eightBall)
    if (!eightBallPotted || this.foulReason(outcome, type)) {
      return false
    }

    const session = Session.getInstance()
    if (session.p1type === 0) {
      return false
    }

    const table = this.container.table
    const cueball = table.cueball
    const pottedThisShot = new Set(Outcome.pots(outcome))
    const myGroup = table.balls.filter(
      (b) =>
        b !== cueball &&
        b !== eightBall &&
        b.onTable() &&
        this.isMyType(b, type) &&
        !pottedThisShot.has(b)
    )

    return myGroup.length === 0
  }

  handleGameEnd(isWinner: boolean, endSubtext?: string): Controller {
    return MatchResultHelper.presentGameEnd(
      this.container,
      this.rulename,
      isWinner,
      endSubtext
    )
  }
}
