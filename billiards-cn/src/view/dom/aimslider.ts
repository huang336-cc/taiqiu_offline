import { id } from "../../utils/dom"
import { Settings } from "../../utils/settings"
import { unitAtAngle } from "../../utils/three-utils"
import type { Container } from "../../container/container"

/**
 * 横向瞄准角度滑动条（悬浮 2D UI，不参与 3D 场景渲染）。
 *
 * 数值映射：
 * - 滑动条总长度 = 瞄准的完整左右转动范围（普通对局 ±180°，
 *   分析模式收窄到 aimLimits 给出的窗口）。
 * - 滑块居中 = 进入瞄准时的初始正向瞄准方向（cue.aimBase）。
 * - 向左拖 → 角度向左转；向右拖 → 角度向右转；位置与角度线性一一对应。
 * - 触达两端后 input[type=range] 自身即会夹住，滑块拖不出去。
 *
 * 方向同步（关键点）：滑块的「左右」始终对应屏幕上「瞄准线可见方向的左右」，
 * 而不是相机/画布拖拽的左右。因为相机始终在球杆正后方、随瞄准方向转动，
 * 若直接用世界坐标的 aim.angle 当屏幕方向，滑块就会跟着「视角转动方向」走，
 * 而不是玩家肉眼看到的瞄准线方向。故经 viewSign() 取出当前相机视角下
 * 「aim.angle 增大是否等于瞄准线在屏幕上向右转」的符号，对滑块做镜像，保证
 * 任何视角下「滑块右拖 = 瞄准线在屏幕上向右转（即同步瞄准方向，而非视角方向）」。
 *
 * 数据同步：滑动条 / 手指拖拽瞄准 / 左右微调按钮三者共用 cue.aim.angle
 * 这一份数据。任何一方改动都会经由 Cue.updateAimInput / rotateAim 回灌到
 * updateAimAngleSlider()，因此三者永远一致。
 */
export class AimSlider {
  private readonly container: Container
  private readonly bar: HTMLElement | null
  private readonly slider: HTMLInputElement | null
  private readonly nudgeLeft: HTMLElement | null
  private readonly nudgeRight: HTMLElement | null

  /** 用户正在拖滑块：此时不要用程序值回写，否则会和手指打架 */
  private dragging = false
  /** 长按微调按钮的连发定时器 */
  private repeatTimer: ReturnType<typeof setInterval> | null = null
  private repeatDelay: ReturnType<typeof setTimeout> | null = null

  /** 单次微调步长（弧度）≈0.11°，配合长按连发可做精细修正 */
  private static readonly NUDGE_STEP = 0.002

  constructor(container: Container) {
    this.container = container
    this.bar = id("aimAngleBar")
    this.slider = id("aimAngle") as HTMLInputElement | null
    this.nudgeLeft = id("aimNudgeL")
    this.nudgeRight = id("aimNudgeR")
    this.addListeners()
    this.applyVisibility()
    // 初始与其它瞄准控件一致：未轮到玩家出杆前为禁用态
    this.setDisabled(true)
    this.sync()
  }

  private get cue() {
    return this.container.table.cue
  }

  private addListeners() {
    // 这条悬浮条位于 #viewP1 内部，而画布的「点球对准 / 拖动瞄准」监听挂在
    // #viewP1 上。不掐断冒泡的话，拖滑块会顺带触发一次画布交互，角度被改两次。
    const swallow = (e: Event) => e.stopPropagation()
    for (const type of ["pointerdown", "pointerup", "pointermove", "click"]) {
      this.bar?.addEventListener(type, swallow)
    }

    if (this.slider) {
      this.slider.addEventListener("pointerdown", this.onDragStart)
      this.slider.addEventListener("pointerup", this.onDragEnd)
      this.slider.addEventListener("pointercancel", this.onDragEnd)
      this.slider.addEventListener("input", this.onSliderInput)
      // 键盘操作（部分设备外接手柄/键盘）同样要收尾
      this.slider.addEventListener("change", this.onDragEnd)
    }
    this.bindNudge(this.nudgeLeft, -1)
    this.bindNudge(this.nudgeRight, 1)
  }

  /** 左右微调按钮：点一下走一步，长按连发 */
  private bindNudge(el: HTMLElement | null, sign: number) {
    if (!el) return
    const start = (e: Event) => {
      e.preventDefault()
      if (this.isDisabled()) return
      this.cue.beginAimInteraction()
      this.nudge(sign)
      this.repeatDelay = setTimeout(() => {
        this.repeatTimer = setInterval(() => this.nudge(sign), 40)
      }, 320)
    }
    const stop = () => {
      if (this.repeatDelay !== null) {
        clearTimeout(this.repeatDelay)
        this.repeatDelay = null
      }
      if (this.repeatTimer !== null) {
        clearInterval(this.repeatTimer)
        this.repeatTimer = null
        this.cue.endAimInteraction()
        return
      }
      // 只点了一下：没进入连发，也要把 begin 的计数还回去
      this.cue.endAimInteraction()
      this.cue.flashAimInteraction()
    }
    el.addEventListener("pointerdown", start)
    el.addEventListener("pointerup", stop)
    el.addEventListener("pointerleave", stop)
    el.addEventListener("pointercancel", stop)
  }

  private nudge(sign: number) {
    if (this.isDisabled()) return
    this.cue.rotateAim(sign * AimSlider.NUDGE_STEP * this.viewSign(), this.container.table)
    this.container.lastEventTime = performance.now()
  }

  /**
   * 当前相机视角下，aim.angle 增大是否对应「瞄准线在屏幕上向右转」。
   * 取相机世界矩阵的 X 列（即屏幕右方向在世界坐标系中的向量），与
   * 瞄准方向的 +90° 垂直向量做点积：dot>0 表示 aim.angle 增大 = 瞄准线
   * 屏幕右转，此时滑块无需翻转；dot<0 则需翻转，使「滑块右拖 = 瞄准线
   * 屏幕右转」。默认瞄准视角下 dot<0，故返回 -1，把滑块方向与画布拖拽
   * 镜像、贴合玩家肉眼所见的瞄准方向；切到俯视等视角时符号自动切换，
   * 始终与可见瞄准方向保持一致。
   */
  private viewSign(): number {
    const cam = this.container.view?.camera?.camera
    if (!cam) return 1
    cam.updateMatrixWorld()
    const e = cam.matrixWorld.elements
    // 相机世界矩阵第一列 = 屏幕右方向（世界坐标）
    const rx = e[0]
    const ry = e[1]
    const a = this.cue.aim.angle
    const perp = unitAtAngle(a + Math.PI / 2)
    const dot = rx * perp.x + ry * perp.y
    return dot >= 0 ? 1 : -1
  }

  private isDisabled(): boolean {
    const inputs = this.cue.aimInputs
    return !inputs || inputs.isDisabled()
  }

  private onDragStart = () => {
    if (this.isDisabled()) return
    this.dragging = true
    this.cue.beginAimInteraction()
  }

  private onDragEnd = () => {
    if (!this.dragging) return
    this.dragging = false
    this.cue.endAimInteraction()
    this.cue.flashAimInteraction()
    // 松手归中：滑块回 0，基准锁定为当前瞄准角，下次拖动重新相对当前方向微调
    if (this.slider) {
      this.slider.value = "0"
      this.slider.style.setProperty("--v", "50%")
    }
    this.cue.setAimBase(this.cue.aim.angle)
  }

  private onSliderInput = () => {
    if (!this.slider) return
    if (this.isDisabled()) {
      // 控件被禁用时把滑块拉回当前真实角度，避免出现「假位置」
      this.sync()
      return
    }
    const value = Number(this.slider.value)
    const target = this.cue.aimAngleFromSlider(value * this.viewSign())
    this.cue.setAimAngle(target, this.container.table)
    this.container.lastEventTime = performance.now()
    // 拖动中实时更新轨道填充（滑块静止时由 sync 锁定在 50% 居中）
    this.slider.style.setProperty(
      "--v",
      (value * 50 + 50).toFixed(3) + "%"
    )
  }

  /**
   * 由 Cue 在任何角度变化后回调。
   * 静止时：滑块永远归中（--v 50%），并把基准角锁定为当前瞄准角，
   * 这样下一次拖动就是相对「当前方向」的 ±5° 微调。拖动中则不回写，
   * 避免和手指打架。
   */
  sync() {
    if (!this.slider) return
    if (this.dragging) return
    this.cue.setAimBase(this.cue.aim.angle)
    this.slider.value = "0"
    this.slider.style.setProperty("--v", "50%")
  }

  /** 控件禁用态跟随其它瞄准控件 */
  setDisabled(disabled: boolean) {
    this.bar?.classList.toggle("is-disabled", disabled)
    if (this.slider) this.slider.disabled = disabled
    if (this.nudgeLeft) (this.nudgeLeft as HTMLButtonElement).disabled = disabled
    if (this.nudgeRight)
      (this.nudgeRight as HTMLButtonElement).disabled = disabled
  }

  /** 读取设置里的开关，决定这条悬浮条是否出现 */
  applyVisibility() {
    if (!this.bar) return
    this.bar.hidden = !Settings.get().aimSlider
  }
}
