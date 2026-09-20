import { Aim } from "./aim"
import { WatchAim } from "./watchaim"
import { ControllerBase } from "./controllerbase"
import { PlaceBallEvent } from "../events/placeballevent"
import { RerackEvent } from "../events/rerackevent"
import { Session } from "../network/client/session"
import { BeginEvent } from "../events/beginevent"
import { HitEvent } from "../events/hitevent"

export class WatchShot extends ControllerBase {
  override get name(): string {
    return "WatchShot"
  }
  constructor(container, _hitEvent?: HitEvent) {
    super(container)
    this.container.table.outcome = []
    this.container.table.hit()
  }

  override onFirst() {
    this.container.table.cue.aimInputs.setDisabled(true)
  }

  override handleStationary(_) {
    if (Session.isBotMode()) {
      this.container.sendEvent(new BeginEvent())
    }

    const outcome = this.container.table.outcome
    if (this.container.rules.isEndOfGame(outcome) && !Session.isBotMode()) {
      return this.container.rules.handleGameEnd(false)
    }
    return this
  }

  override handleStartAim(_) {
    this.container.rules.startTurn()
    return new Aim(this.container)
  }

  /**
   * 对手（机器人）摆白球。
   *
   * ⚠️ v1.3.85 修复「白色尖楔泄漏」。
   *
   * 病史：`PlaceBallEvent` 原本无条件 `return new PlaceBall(...)`，而
   * `PlaceBall` 是**交互式**摆球控制器 —— 它调 `cue.placeBallMode()` 显示
   * 4 个白色指示锥、把相机切到俯视，然后一直等 `SpaceUp` 才 `placed()`。
   *
   * 但机器人侧的摆球是**瞬时的**：`BotEventHandler.handlePlaceBall()`
   * 直接把球放到 `event.pos` 并 publish 瞄准结果，**永远不会发 `SpaceUp`**。
   * 于是玩家侧被永久卡在 `PlaceBall`：
   *   - 4 个白色指示锥常驻画面（就是瞄准视角里白球旁那几片"白楔"）
   *   - 玩家自己的球杆 `cue.mesh` 被 `placeBallMode()` 隐藏，再也看不到
   *   - 相机停在俯视，被后续事件反复推回，瞄准视角构图全错
   *
   * 修复：事件里已经带了最终位置（`event.pos`），说明**决策已完成**，
   * 玩家侧不需要再交互一次。直接落位 → 进 `Aim`，并显式 `aimMode()`
   * 复位被 `placeBallMode()` 改过的可见性与相机。
   *
   * 保留原有职责：`respot` 的球先归位，`useStartPos` 时先 `startTurn()`。
   */
  override handlePlaceBall(event: PlaceBallEvent) {
    const table = this.container.table
    const respot = event.respot
    if (respot) {
      const ball = table.balls.find((b) => b.id === respot.id)
      if (ball) {
        ball.pos.copy(respot.pos)
        ball.setStationary()
        ball.fround()
      }
    }

    // 应用机器人已经决定好的白球位置（与 BotEventHandler 的语义对齐）
    const cueball = table.cueball
    if (event.pos) {
      cueball.pos.copy(
        event.useStartPos ? event.pos : this.container.rules.placeBall(event.pos)
      )
    }
    cueball.setStationary()
    cueball.fround()

    if (event.useStartPos) {
      this.container.rules.startTurn()
    }

    // 复位 `PlaceBall` 遗留的可见性 / 相机状态（关键：清掉白色指示锥）
    table.cue.aimMode()
    table.cue.moveTo(cueball.pos)
    table.cue.shadowMesh && (table.cue.shadowMesh.visible = true)

    return new Aim(this.container)
  }

  override handleWatch(event) {
    if ("rerack" in event.json) {
      console.log("Respot")
      RerackEvent.applyBallinfoToTable(this.container.table, event.json)
      return this
    }
    return new WatchAim(this.container)
  }
}
