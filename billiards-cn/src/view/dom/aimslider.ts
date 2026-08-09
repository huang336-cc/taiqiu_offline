import { id } from "../../utils/dom"
import { Settings } from "../../utils/settings"
import { unitAtAngle } from "../../utils/three-utils"
import { Tutorial } from "../tutorial"
import type { Container } from "../../container/container"

/**
 * 横向瞄准角度滑动条（悬浮 2D UI，不参与 3D 场景渲染）。
 *
 * 数值映射：
* - 滑动条总长度 = 瞄准的完整左右转动范围（普通对局 ±1°，v1.1.31 由 ±2° 收紧，
   *   比屏幕拖动瞄准的角分辨率更细微，专用于「差一点点」时的极精细修正，
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
  private readonly track: HTMLElement | null
  private readonly slider: HTMLInputElement | null
  private readonly nudgeLeft: HTMLElement | null
  private readonly nudgeRight: HTMLElement | null

  /** 用户正在拖滑块：此时不要用程序值回写，否则会和手指打架 */
  private dragging = false
  /** 拖动起点：屏幕 X 与当时的瞄准角，用于相对增量（不截断、可继续滑动） */
  private dragStartX = 0
  private dragStartAngle = 0
  /** 拖动起点元素（用于区分「轻点微调按钮」与「滑动」） */
  private dragStartTarget: HTMLElement | null = null
  /** 本次手势是否发生了有效滑动（>3px 视为拖动，否则视为轻点） */
  private didDrag = false

  /** 单次微调步长（弧度）≈0.11°，轻点左右微调按钮时走一步 */
  private static readonly NUDGE_STEP = 0.002

  constructor(container: Container) {
    this.container = container
    this.bar = id("aimAngleBar")
    this.track = id("aim-angle-track")
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

    // 仅在 track / bar 上挂 pointerdown 以发起拖动；move/up 改由 window
    // 捕获阶段监听负责（见 onDragStart），以彻底绕开 WebView 的
    // setPointerCapture 不派发 move、以及浏览器把横向拖动当成滚动触发
    // pointercancel 导致「滑动无反应」的问题。
    if (this.track) {
      this.track.addEventListener("pointerdown", this.onDragStart)
    }
    if (this.bar && this.bar !== this.track) {
      this.bar.addEventListener("pointerdown", this.onDragStart)
    }
    // v1.2.9 #F2：把拖动发起也直接挂到 ‹ › 微调按钮本身（不再仅靠冒泡）。
    // 原生 <button> 在触摸拖动时会立刻触发 pointercancel（被当作点击/选择手势），
    // 导致「按住滑动」在 onDragEnd 里被立即结束、表现为「按钮无法滑动拉杆」。
    // 已把按钮改为 div[role=button]，这里再显式绑定 + onDragStart 内 preventDefault，
    // 双保险确保从按钮按下也能稳定进入拖动。
    if (this.nudgeLeft) {
      this.nudgeLeft.addEventListener("pointerdown", this.onDragStart)
    }
    if (this.nudgeRight) {
      this.nudgeRight.addEventListener("pointerdown", this.onDragStart)
    }
    // v1.2.7 #D4：不再为左右微调按钮单独绑定 pointerdown。
    // 整条（含 ‹ › 按钮）统一作为拖动/轻点表面，由 onDragStart/onDragEnd 处理，
    // 既支持「按住滑动微调」，也保留「轻点单步微调」（见 onDragEnd）。
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

  private onDragStart = (e: PointerEvent) => {
    if (this.isDisabled()) return
    // v1.2.9 #F2：阻止原生按钮 / 链接的默认手势（聚焦、文本选择、点击态），
    // 避免触摸拖动时被浏览器当成「点击并取消」，进而立刻触发 pointercancel
    // 而结束拖动。放在最前，确保后续拖动逻辑稳定接管。
    try {
      e.preventDefault()
    } catch {
      /* 个别环境不支持 preventDefault，忽略 */
    }
    // v1.2.7 #D4：移除「落在微调按钮上不触发拖动」的守卫——整条（含左右 ‹ › 按钮）
    // 都可按下并滑动微调瞄准。轻点微调按钮（无移动）仍保留「单步微调」，见 onDragEnd。
    this.dragStartTarget = (e.target as HTMLElement) ?? null
    // v1.2.6：新手引导步骤 2 推进——首次拖动瞄准条 = 用户在做瞄准动作
    Tutorial.notifyAimDrag()
    this.dragging = true
    this.didDrag = false
    // 记录起点：屏幕 X 与当时的真实瞄准角，后续用相对增量（不截断）
    this.dragStartX = e.clientX
    this.dragStartAngle = this.cue.aim.angle
    this.cue.beginAimInteraction()
    // 捕获指针（best-effort）：支持的浏览器里手指滑出范围也继续收到 move。
    // 用 e.currentTarget（bar 或 track），因为监听现在同时挂在两者上。
    const captureEl = (e.currentTarget as HTMLElement) ?? this.track ?? this.bar
    try {
      captureEl?.setPointerCapture(e.pointerId)
    } catch {
      /* 某些 WebView 在非 primary pointer 上会抛错，忽略 */
    }
    // v1.2.6 #235：在 window 捕获阶段挂 move/up/cancel。
    // 捕获阶段早于 bar 的冒泡 stopPropagation，因此即便手指滑出元素、
    // 或浏览器把横拖当滚动而触发 pointercancel，也能持续收到 move 事件，
    // 彻底解决「细微瞄准栏滑动无反应」的问题。
    window.addEventListener("pointermove", this.onDragMove, true)
    window.addEventListener("pointerup", this.onDragEnd, true)
    window.addEventListener("pointercancel", this.onDragEnd, true)
  }

  private onDragMove = (e: PointerEvent) => {
    if (!this.dragging || this.isDisabled()) return
    const track = this.track
    if (!track) return
    const rect = track.getBoundingClientRect()
    if (rect.width <= 0) return
    const dx = e.clientX - this.dragStartX
    // 移动超过阈值即判定为「拖动」，不再视作轻点
    if (Math.abs(dx) > 3) this.didDrag = true
    // 一条满轨宽 = ±AIM_FINE_HALF_RANGE（与旧 range 灵敏度一致，但不再夹住两端）
    const HALF = Math.PI / 180
    const delta = (dx / rect.width) * 2 * HALF * this.viewSign()
    const target = this.dragStartAngle + delta
    this.cue.setAimAngle(target, this.container.table)
    this.container.lastEventTime = performance.now()
    // 视觉填充仅作方向提示（轨道中心=本杆初始方向），角度本身不截断
    const pct = Math.max(0, Math.min(100, 50 + (dx / rect.width) * 50))
    if (this.slider) {
      this.slider.style.setProperty("--v", pct.toFixed(2) + "%")
    }
  }

  private onDragEnd = (e: PointerEvent) => {
    if (!this.dragging) return
    const wasTap = !this.didDrag
    const startTarget = this.dragStartTarget
    this.dragging = false
    try {
      this.track?.releasePointerCapture(e.pointerId)
    } catch {
      /* 无捕获时忽略 */
    }
    // 摘掉 window 捕获阶段的拖动监听，避免影响其它交互
    window.removeEventListener("pointermove", this.onDragMove, true)
    window.removeEventListener("pointerup", this.onDragEnd, true)
    window.removeEventListener("pointercancel", this.onDragEnd, true)
    this.cue.endAimInteraction()
    this.cue.flashAimInteraction()
    // 松手归中：滑块回 0，基准锁定为当前瞄准角，下次拖动重新相对当前方向微调
    if (this.slider) {
      this.slider.value = "0"
      this.slider.style.setProperty("--v", "50%")
    }
    this.cue.setAimBase(this.cue.aim.angle)
    // v1.2.7 #D4：轻点（无滑动）落在左右微调按钮上 → 单步微调，保留原「点一下走一步」。
    // 滑动则已在 onDragMove 中实时调整瞄准角，这里不再重复。
    if (wasTap && startTarget?.closest?.(".aim-nudge")) {
      const sign = startTarget.closest("#aimNudgeL") ? -1 : 1
      this.nudge(sign)
    }
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
    // v1.2.11 #F10：横向瞄准滑动条不再可关闭，始终显示。
    this.bar.hidden = false
  }
}
