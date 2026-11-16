import { AimEvent } from "../events/aimevent"
import { HitEvent } from "../events/hitevent"
import { BreakEvent } from "../events/breakevent"
import { StartAimEvent } from "../events/startaimevent"
import { WatchShot } from "./watchshot"
import { Aim } from "./aim"
import { ControllerBase } from "./controllerbase"

export class WatchAim extends ControllerBase {
  override get name() {
    return "WatchAim"
  }

  constructor(container) {
    super(container)
    this.container.table.cueball = this.container.rules.otherPlayersCueBall()
    // v1.3.58：上一杆击球后球杆已被收起，轮到对手瞄准时把杆重新亮出来
    this.container.table.cue.aimMode()
    this.container.table.cue.moveTo(this.container.table.cueball.pos)
    this.container.view.camera.suggestMode(this.container.view.camera.topView)
  }

  override onFirst() {
    this.container.table.cue.aimInputs.setDisabled(true)
    this.container.view.clearLines()
  }

  override handleAim(event: AimEvent) {
    this.container.table.cue.aim = event
    this.container.table.cueball.pos.copy(event.pos)
    // v1.5.4（#71）：对手正在摆自由球（白球跟随其 aim 移动）。若上一杆
    // 本端把白球判为出界（offTable=true → 渲染隐藏），这里必须恢复显示，
    // 否则对手摆球时本端看白球是隐身的。
    this.container.table.cueball.offTable = false
    this.container.table.cue.updateAimInput()
    return this
  }

  /**
   * v1.8.4：收到「轮到你」的 StartAimEvent 却还停在观战瞄准时，切回自己的
   * 瞄准态。
   *
   * 正常换手是由 WatchShot 接住这条事件的；但重连快照恢复时，客机会先被
   * WatchEvent 带进 WatchAim（为了拿到球位），如果当前其实是客机的回合，
   * 就必须能从这里切回 Aim，否则重连后一直看着"自己不能打"。
   */
  override handleStartAim(_: StartAimEvent) {
    this.container.rules.startTurn()
    return new Aim(this.container)
  }

  override handleBreak(event: BreakEvent) {
    if (event.init) {
      this.container.table.updateFromShortSerialised(event.init)
    }
    return this
  }

  override handleHit(event: HitEvent) {
    this.container.table.updateFromSerialised(event.tablejson)
    this.container.table.cue.updateAimInput()

    return new WatchShot(this.container, event)
  }
}
