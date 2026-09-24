import { Aim } from "./aim"
import { WatchAim } from "./watchaim"
import { PlaceBall } from "./placeball"
import { ControllerBase } from "./controllerbase"
import { PlaceBallEvent } from "../events/placeballevent"
import { RerackEvent } from "../events/rerackevent"
import { Session } from "../network/client/session"
import { BeginEvent } from "../events/beginevent"
import { HitEvent } from "../events/hitevent"
import { isFirstShot } from "../utils/utils"

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
   *
   * ⚠️ v1.3.102 修复「电脑犯规玩家无法摆球」。
   *
   * 病史（用户 2026-09-22 报）：电脑犯规后，玩家**看不到摆球提示、也没法把
   * 白球拖到想要的位置**，白球被 AI 摆到它自己挑的点上就直接开打了。
   *
   * 根因在**发事件的那一侧**：`BotEventHandler.handleFoul` 处理的是「电脑自己
   * 的犯规」（`handleStationary` 里 `botRules.foulReason` 判的是 bot 这一杆），
   * 却仍然调 `chooseBallInHandPosition()` 给**自己**挑点，然后
   * `publishSequenceToPlayer([new PlaceBallEvent(startPos, respot, true)])`。
   * `useStartPos=true` 在本函数里的语义是「**位置已定**，直接落位、跳过交互」，
   * 于是玩家被彻底锁在摆球流程之外 —— 犯规方没有交出球权。
   *
   * 正确语义：**犯规方交出球权**（与 `eightball.ts handleFoul` 对称）。
   * 现在 `BotEventHandler.handleFoul` 已改为发 `useStartPos=false`，
   * 本函数据此把控制权交给**交互式** `PlaceBall`，玩家就能像单机模式一样
   * 自由拖拽白球，按 `SpaceUp` 确认后再开打。
   *
   * 守卫（与 `boteventhandler.handlePlaceBall` 的 `canReposition` 对称）：
   *   · 只有 `useStartPos=false` 且 `rules.allowsPlaceBall()` 才进交互摆球；
   *   · 开球杆（`isFirstShot`）位置由规则层定死，仍走原来的「直接落位」；
   *   · 无自由球机制的规则（三库 / 沙狐）照旧直接落位。
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

    // v1.3.102：电脑犯规 → 玩家自由球 → 交给交互式 PlaceBall 让玩家自己摆。
    // `useStartPos=false` 是「位置未定，请自己摆」的信号（对称于 bot 侧
    // `canReposition` 的判据），但开球杆与无自由球机制的规则除外。
    if (
      !event.useStartPos &&
      this.container.rules.allowsPlaceBall() &&
      !isFirstShot(this.container.recorder)
    ) {
      return new PlaceBall(this.container, event.pos)
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
