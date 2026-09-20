import { BeginEvent } from "../events/beginevent"
import { WatchEvent } from "../events/watchevent"
import { Controller } from "./controller"
import { WatchAim } from "./watchaim"
import { ControllerBase } from "./controllerbase"
import { BreakEvent } from "../events/breakevent"
import { PlaceBall } from "./placeball"
import { Replay } from "../controller/replay"
import { Session } from "../network/client/session"
import { Spectate } from "./spectate"
import { Aim } from "./aim"

/**
 * Initial state of controller.
 *
 * Transitions into active player or watcher or replay mode.
 */
export class Init extends ControllerBase {
  override get name() {
    return "Init"
  }

  override onFirst() {
    const session = Session.getInstance()
    if (
      !session.spectator &&
      !this.container.isSinglePlayer &&
      !session.botMode &&
      !this.container.replayMode
    ) {
      this.container.notification.show(
        { type: "Info", title: "正在准备牌局…" },
        0
      )
    }
  }

  override handleBegin(_: BeginEvent): Controller {
    if (!Session.getInstance().vsNotificationShown) {
      this.container.notification.clear()
    }
    this.showTwoPlayerScores()
    if (Session.isSpectator()) {
      return new Spectate(
        this.container,
        this.container.relay!,
        Session.getInstance().tableId
      )
    }
    this.container.sendEvent(new WatchEvent(this.container.table.serialise()))
    if (Session.isPracticeMode() && Session.hasInitParam()) {
      this.container.table.cueball.fround()
      this.container.sendEvent(
        new BreakEvent(this.container.table.shortSerialise())
      )
      return new Aim(this.container)
    }
    /**
     * ⚠️ v1.3.85 修复「白色尖楔泄漏」的第二个入口。
     *
     * 病史：人机模式开球时，玩家侧会走到 `new PlaceBall(...)` —— 这是
     * **交互式**摆球控制器，会 `cue.placeBallMode()` 显示 4 个白色指示锥、
     * 隐藏玩家球杆、切俯视相机，然后死等 `SpaceUp`。但人机模式下的开球
     * 是机器人做的（`BotEventHandler.handleStationary` → `handleStartAim`
     * → 直接出杆），**永远不会有 `SpaceUp` 给玩家侧**。
     *
     * 结果：整局卡在 `PlaceBall`，白色指示锥常驻画面（瞄准视角里白球旁
     * 那几片"白楔"）、玩家球杆不可见。这是纯人机独有的路径。
     *
     * 修复：人机模式下按本地默认位置直接落位并进 `Aim`，跳过交互摆球。
     * 位置由 `rules.placeBall()` 给出，与机器人侧同一套规则，不会错位。
     */
    if (Session.isBotMode()) {
      const cueball = this.container.table.cueball
      cueball.pos.copy(this.container.rules.placeBall())
      cueball.setStationary()
      cueball.fround()
      this.container.table.cue.aimMode()
      this.container.table.cue.moveTo(cueball.pos)
      this.container.sendEvent(
        new BreakEvent(this.container.table.shortSerialise())
      )
      return new Aim(this.container)
    }
    return (
      this.container.rules.initialController?.() ??
      new PlaceBall(this.container)
    )
  }

  override handleWatch(event: WatchEvent): Controller {
    this.container.rules.secondToPlay()
    this.container.table.updateFromSerialised(event.json)
    Session.getInstance().playerIndex = 1
    this.showTwoPlayerScores()
    return new WatchAim(this.container)
  }

  private showTwoPlayerScores() {
    if (!this.container.isSinglePlayer) {
      this.container.updateScoreHud(0, 0, 0)
    }
  }

  override handleBreak(event: BreakEvent): Controller {
    if (event.init) {
      this.container.table.updateFromShortSerialised(event.init)
      return new Replay(
        this.container,
        event.init,
        event.shots,
        false,
        1500,
        event.diagram
      )
    }
    if (Session.isPracticeMode() && Session.hasInitParam()) {
      this.container.table.cueball.fround()
      this.container.sendEvent(
        new BreakEvent(this.container.table.shortSerialise())
      )
      return new Aim(this.container)
    }
    // 同 handleBegin：人机模式跳过交互式摆球，避免卡在 PlaceBall
    if (Session.isBotMode()) {
      const cueball = this.container.table.cueball
      cueball.pos.copy(this.container.rules.placeBall())
      cueball.setStationary()
      cueball.fround()
      this.container.table.cue.aimMode()
      this.container.table.cue.moveTo(cueball.pos)
      this.container.sendEvent(
        new BreakEvent(this.container.table.shortSerialise())
      )
      return new Aim(this.container)
    }
    return (
      this.container.rules.initialController?.() ??
      new PlaceBall(this.container)
    )
  }
}
