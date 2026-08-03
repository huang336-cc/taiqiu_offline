import { Controller } from "./controller"
import { ChatEvent } from "../events/chatevent"
import { NotificationEvent } from "../events/notificationevent"
import { ScoreEvent } from "../events/scoreevent"
import { ConcedeEvent } from "../events/concedeevent"
import { Outcome } from "../model/outcome"
import { Session } from "../network/client/session"

const flipP1type = (t: number) => (t === 1 ? 2 : 1)

export abstract class ControllerBase extends Controller {
  readonly scale = 0.001

  constructor(container) {
    super(container)
    container.table.proximityIndicator.hide()
  }

  override handleChat(chatevent: ChatEvent): Controller {
    if (chatevent.message) {
      this.container.chat.showMessage(chatevent.message)
    }
    if (chatevent.line) {
      this.container.view.addLine(chatevent.line)
    }
    return this
  }

  override handleNotification(event: NotificationEvent): Controller {
    const data = event.data
    if (
      typeof data !== "string" &&
      data.type === "GameOver" &&
      !data.highBreaks
    ) {
      data.highBreaks = this.container.ballTray
        .getTopBreaks(3)
        .map(({ score, hiScoreUri }) => ({ score, url: hiScoreUri }))
    }
    this.container.notification.show(data, event.duration)
    return this
  }

  override handleScore(event: ScoreEvent): Controller {
    const session = Session.getInstance()
    if (
      event.p1type !== undefined &&
      event.p1type !== 0 &&
      session.p1type === 0
    ) {
      session.p1type =
        session.playerIndex === 0 ? event.p1type : flipP1type(event.p1type)
    }
    this.container.updateScoreHud(event.p1, event.p2, event.b, event.active)

    const rulename = this.container.rules.rulename
    if (
      !this.container.replayMode &&
      (rulename === "threecushion" || rulename === "sagu") &&
      this.container.rules.isEndOfGame([]) &&
      this.name !== "End"
    ) {
      const myTarget = session.getRaceTargetForPlayer(session.clientId)
      const amIWinner = session.myScore() >= myTarget
      return this.container.rules.handleGameEnd(amIWinner)
    }

    return this
  }

  override handleConcede(_: ConcedeEvent): Controller {
    return this.container.rules.handleGameEnd(true, "opponent conceded")
  }

  hit() {
    this.container.sound.lastOutcomeTime = -1
    this.container.table.outcome = [
      Outcome.hit(
        this.container.table.cueball,
        this.container.table.cue.aim.power,
        0
      ),
    ]
    this.container.table.hit()
    this.container.view.camera.suggestMode(this.container.view.camera.aimView)
    this.container.table.cue.showHelper(false)
  }

  commonKeyHandler(input) {
    const cue = this.container.table.cue
    const delta = input.t * this.scale
    switch (input.key) {
      case "movementXUp":
        cue.rotateAim(delta * 2, this.container.table)
        return true
      case "movementYUp":
        this.container.view.camera.adjustHeight(delta * 8)
        return true
      default:
        return false
    }
  }
}
