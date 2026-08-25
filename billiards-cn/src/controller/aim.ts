import { BreakEvent } from "../events/breakevent"
import { Controller, HitEvent, Input } from "./controller"
import { ControllerBase } from "./controllerbase"
import { PlayShot } from "./playshot"
import { Replay } from "./replay"
import { gameOverButtons } from "../utils/gameover"
import { Settings } from "../utils/settings"
import { t } from "../utils/i18n"
import { Tutorial } from "../view/tutorial"

/**
 * Aim using input events.
 *
 */
export class Aim extends ControllerBase {
  override get name(): string {
    return "Aim"
  }
  constructor(container) {
    super(container)
    const table = this.container.table

    table.cue.aimMode()
    // 瞄准辅助线可在设置中关闭
    table.cue.showHelper(Settings.get().aimAssist)
    table.cueball = this.container.rules.cueball

    const params = new URLSearchParams(globalThis.location?.search)
    let customShot = false
    if (params.has("initShot")) {
      const shot = JSON.parse(params.get("initShot")!)
      if (shot) {
        if (typeof shot.cueBallId === "number") {
          table.cueball = table.balls[shot.cueBallId] || table.cueball
        }
        table.cue.aim.angle = shot.angle ?? table.cue.aim.angle
        table.cue.aim.power = shot.power ?? table.cue.aim.power
        if (shot.offset) {
          table.cue.aim.offset.set(shot.offset.x ?? 0, shot.offset.y ?? 0, 0)
        }
        table.cue.aim.elevation = shot.elevation ?? 0
        customShot = true
      }
    }

    table.cue.aim.i = table.balls.indexOf(table.cueball)
    table.cue.moveTo(table.cueball.pos)
    if (!customShot) {
      table.cue.aimAtNext(
        table.cueball,
        this.container.rules.nextCandidateBall()
      )
      table.cue.aim.elevation = 0
    }
    this.container.view.camera.suggestMode(this.container.view.camera.aimView)
    // v1.2.33：进入瞄准视角后立即把相机摆到位，避免从俯视/摆球视角 lerp 期间
    // 相机停留在白球附近、纵向 FOV 被白球/球杆占满，导致玩家看不到前方被击球。
    this.container.view.camera.forceMove(table.cue.aim)
    // 横向滑动条的「居中 = 初始正向瞄准」基准：进入瞄准状态时锁定当前角度
    table.cue.setAimBase(table.cue.aim.angle)
    table.cue.updateAimInput()
    table.cue.updateTargetLine(table)
  }

  override onFirst() {
    this.container.table.showTraces(false)
    this.container.view.clearLines()
    this.container.table.cue.aimInputs.setButtonText(t("hitButton"))
    // 分步实操新手引导：仅首次安装自动显示，或带 tutorial=1 强制显示
    const forceTutorial =
      new URLSearchParams(globalThis.location?.search).get("tutorial") === "1"
    // v1.2.6：把 aimInputs 暴露给 Tutorial，用于步骤 1 期间锁定控件。
    // 仅在有 cue 引用时注册，避免教程与对局耦合。
    ;(globalThis as any).__AimInputs = this.container.table.cue.aimInputs
    // v1.2.7 #D1：force 教程模式下，仅在「尚未看过引导」时预先禁用控件。
    // 看过之后（首杆结束、Tutorial.finish 已 markSeenGuide），重新进入 Aim 不应
    // 再禁用——否则控件被永久锁死、游戏画面静止、无法继续击球。
    // 引导步骤 1 的 lockControls(true) 仍会负责在「重新打开新手引导」重新显示时锁定控件。
    this.container.table.cue.aimInputs.setDisabled(
      forceTutorial && !Settings.hasSeenGuide()
    )
    // v1.1.11：与 Tutorial.start 内部判断保持一致，用 hasSeenGuide()（含独立 key 兜底）。
    // 避免真机主 key 写入失败时，seenGuide 内存判定与 start 内部不一致导致每杆重显。
    if (!Settings.hasSeenGuide() || forceTutorial) {
      Tutorial.start(forceTutorial)
    }
  }

  override handleInput(input: Input): Controller {
    switch (input.key) {
      case "Space":
        this.container.table.cue.setPower(input.t * this.scale)
        break
      case "SpaceUp":
        return this.playShot()
      default:
        if (!this.commonKeyHandler(input)) {
          return this
        }
    }

    this.container.sendEvent(this.container.table.cue.aim)
    return this
  }

  override handleBreak(breakEvent: BreakEvent): Controller {
    if (!breakEvent.shots || breakEvent.shots.length === 0) {
      // Broken multiplayer state: both players think they're active.
      // Sync table state and show error notification.
      if (breakEvent.init) {
        this.container.table.updateFromShortSerialised(breakEvent.init)
      }
      this.container.notifyLocal(
        {
          type: "Info",
          title: "出现异常",
          subtext: "请返回主菜单重新开始",
          extra: gameOverButtons.lobby,
          icon: "⚠️",
        },
        0
      )
      return this
    }
    return new Replay(
      this.container,
      breakEvent.init,
      breakEvent.shots,
      breakEvent.retry,
      1500,
      breakEvent.diagram
    )
  }

  playShot() {
    this.container.inputQueue.length = 0
    // 出杆瞬间立刻收起全部辅助线，不等下一帧
    this.container.table.cue.hideTargetLine()
    this.container.table.cue.aimInputs.setDisabled(true)
    // 完成击球 → 结束新手引导
    Tutorial.notifyShot()
    const hitEvent = new HitEvent(this.container.table.serialiseHit())
    this.container.sendEvent(hitEvent)
    return new PlayShot(this.container)
  }
}
