import { Color, Vector3 } from "three"
import { Container } from "../../container/container"
import { Input } from "../../events/input"
import { Session } from "../../network/client/session"
import { Overlap } from "../../utils/overlap"
import { unitAtAngle } from "../../utils/three-utils"
import { id } from "../../utils/dom"
import { TimeoutButton } from "../timeoutbutton"
import { AngleInput } from "./angleinput"
import { AimSlider } from "./aimslider"
import { maxPower } from "../../model/physics/constants"

export class AimInputs {
  readonly ballContainerWrapperElement
  readonly ballContainerElement
  readonly cueBallElement
  readonly cueTipElement
  readonly powerSliderContainerElement
  readonly cuePowerElement
  readonly cuePowerPercentElement: HTMLElement | null
  readonly resetSpinElement
  readonly cueTiltElement: AngleInput
  /** Shared button for both "Hit" and "Place Ball" actions. */
  readonly cueHitElement
  /** ② 白球击球点触发按钮（展开上方紧凑面板） */
  readonly cueBallTriggerElement
  readonly objectBallStyle: CSSStyleDeclaration | undefined
  readonly objectBallOverlap: HTMLElement | null
  readonly container: Container
  readonly overlap: Overlap
  /** 横向瞄准角度滑动条（悬浮 2D UI） */
  aimSlider: AimSlider | undefined

  ballWidth
  ballHeight
  tipRadius
  private static readonly TIP_SCALE = 1.3
  private controlsDisabled = true
  private readonly timeoutButton: TimeoutButton | undefined
  /** 电脑对战「回合时间限制」（秒）；0 = 无限制，不显示倒计时 */
  private turnTimerSeconds = 0
  private sliderAnimId: number | null = null

  constructor(container) {
    this.container = container
    this.ballContainerWrapperElement = id("ballContainerWrapper")
    this.ballContainerElement = id("ballContainer")
    this.cueBallElement = id("cueBall")
    this.cueTipElement = id("cueTip")
    this.powerSliderContainerElement = id("powerSliderContainer")
    this.cuePowerElement = id("cuePower")
    this.cuePowerPercentElement = id("powerPercent")
    this.resetSpinElement = id("resetSpin") as HTMLButtonElement
    this.cueTiltElement = id("cueTilt") as AngleInput
    this.cueHitElement = id("cueHit") as HTMLButtonElement
    this.cueBallTriggerElement = id("cueBallTrigger") as HTMLButtonElement
    if (this.cueHitElement) {
      const params = new URLSearchParams(location.search)
      const shotClockSeconds = params.get("shotClock")
      // v1.1.31：电脑对战的「回合时间」选项（?timer=N）直接驱动击球按钮的圆环倒计时，
      // 让用户在游戏内能直观看到设置生效；非电脑模式仍走 shotClock/默认 20 秒。
      // v1.1.32：默认「无限制」（timer=0）时不显示倒计时，仅在用户明确选择 10/20/30 秒时启用。
      const timerSeconds = Number(params.get("timer") ?? "0")
      this.turnTimerSeconds = timerSeconds
      const duration = timerSeconds > 0
        ? timerSeconds * 1000
        : shotClockSeconds
          ? Number(shotClockSeconds) * 1000
          : 0
      this.timeoutButton = new TimeoutButton(this.cueHitElement, {
        duration,
        onComplete: () => {
          this.cueHitElement?.click()
        },
      })
    }
    this.objectBallStyle = id("objectBall")?.style
    this.objectBallOverlap = id("objectBallOverlap")
    this.overlap = new Overlap(this.container.table.balls)
    if (this.cuePowerElement) {
      this.container.table.cue.aim.power =
        Number(this.cuePowerElement.value) * maxPower
      this.updatePowerProgress()
    }
    this.updateTiltSlider(this.container.table.cue.aim.elevation)
    this.addListeners()
    // 必须在 addListeners 之后构造：它内部会读一次当前角度做初始同步
    this.aimSlider = new AimSlider(this.container)
    this.updateVisualState(0, 0)
    if (Session.isSpectator()) {
      this.setDisabled(true)
    }
  }

  addListeners() {
    this.cueBallElement?.addEventListener("pointermove", this.mousemove)
    this.cueBallElement?.addEventListener("click", (e) => {
      this.adjustSpin(e)
    })
    this.resetSpinElement?.addEventListener("click", this.resetSpin)
    this.cueHitElement?.addEventListener("click", this.hit)
    // v1.1.41：力度条改为容器层自定义 pointer 事件
    // —— 原生 input[type=range] 在 Android WebView 上只在 thumb 附近 ±22px 响应触摸，
    // 触摸轨道其他位置不触发；改为容器捕获 pointer，JS 计算 x→value 并写回 input.value。
    // 因此这里只保留 input 的 'input' 事件监听（程序写值后触发），pointerdown/up 移到容器。
    this.cuePowerElement?.addEventListener("input", this.powerChanged)
    if (this.powerSliderContainerElement) {
      const c = this.powerSliderContainerElement
      c.addEventListener("pointerdown", this.onPowerPointerDown)
      c.addEventListener("pointermove", this.onPowerPointerMove)
      c.addEventListener("pointerup", this.onPowerPointerUp)
      c.addEventListener("pointercancel", this.onPowerPointerUp)
      c.addEventListener("lostpointercapture", this.onPowerPointerUp)
    }
    this.cueTiltElement?.addEventListener("input", this.tiltChanged)
    if (!("ontouchstart" in globalThis)) {
      id("viewP1")?.addEventListener("dblclick", this.hit)
    }
    document.addEventListener("wheel", this.mousewheel, { passive: false })

    // v1.1.17：② 白球击球点面板
    this.cueBallTriggerElement?.addEventListener("click", this.toggleCueBallPopup)
    id("cueballPopup")?.addEventListener("click", this.onPopupClick)
    document.addEventListener("click", this.onDocClick)
    // v1.2.5：弹窗打开期间，视口尺寸变化（旋转/软键盘）时 JS 重定位，避免溢出
    window.addEventListener("resize", this.repositionIfOpen)
    window.addEventListener("orientationchange", this.repositionIfOpen)
  }

  setButtonText(text) {
    const label = this.cueHitElement?.querySelector(".seg-label")
    if (label) {
      label.textContent = text
    } else if (this.cueHitElement) {
      this.cueHitElement.innerText = text
    }
  }

  /* ---------- v1.1.17：② 白球击球点面板 ---------- */
  private toggleCueBallPopup = (e?: Event) => {
    e?.stopPropagation()
    const popup = id("cueballPopup")
    const trigger = this.cueBallTriggerElement
    if (!popup || !trigger) return
    const willOpen = popup.hidden
    popup.hidden = !willOpen
    trigger.setAttribute("aria-expanded", willOpen ? "true" : "false")
    // v1.2.5：展开后用 JS 根据触发按钮真实位置计算内联 left/bottom，
    // 不再依赖 CSS 的 position:fixed + env()/calc() 视口假设。
    // 小米 13 等 WebView 下该 CSS 假设会漂移导致弹窗超出屏幕边界，
    // JS 计算并夹紧到视口内可彻底规避。
    if (willOpen) {
      this.positionCueBallPopup()
    }
  }

  /**
   * v1.2.5：把白球操作弹窗定位在触发按钮正上方，并夹紧在视口内，
   * 保证任何机型/分辨率都不溢出屏幕。
   */
  private positionCueBallPopup() {
    const popup = id("cueballPopup") as HTMLElement | null
    const trigger = this.cueBallTriggerElement
    if (!popup || !trigger || popup.hidden) return
    // 先确保可见才能拿到真实尺寸
    popup.hidden = false
    const vw = window.innerWidth
    const vh = window.innerHeight
    const margin = 8
    const gap = 10 // 弹窗底边与触发按钮顶边之间的间距
    const pw = popup.offsetWidth || 256
    const ph = popup.offsetHeight || 320

    const tr = trigger.getBoundingClientRect()
    // 水平：以触发按钮中心为基准居中，再夹紧到 [margin, vw-pw-margin]
    let left = tr.left + tr.width / 2 - pw / 2
    left = Math.max(margin, Math.min(left, vw - pw - margin))
    // 垂直：弹窗底边贴触发按钮顶边上方 gap 处（fixed 的 bottom = 视口底到弹窗底距离）
    let bottom = vh - tr.top + gap
    // 顶部越界兜底：若上方空间不够，则改为贴顶（minimum 8px）
    if (vh - bottom - ph < margin) {
      bottom = vh - ph - margin
    }
    popup.style.position = "fixed"
    popup.style.left = left + "px"
    popup.style.right = "auto"
    popup.style.bottom = bottom + "px"
    popup.style.top = "auto"
    popup.style.transform = "none"
    popup.style.maxWidth = "calc(100vw - 16px)"
    // 箭头指向触发按钮中心
    const arrow = popup.querySelector(".cueball-popup-arrow") as HTMLElement | null
    if (arrow) {
      const arrowLeft = tr.left + tr.width / 2 - left - 10
      arrow.style.left = Math.max(10, Math.min(arrowLeft, pw - 30)) + "px"
    }
  }

  /** 弹窗打开时随视口变化（旋转/键盘弹出）重定位 */
  private repositionIfOpen = () => {
    const popup = id("cueballPopup") as HTMLElement | null
    if (popup && !popup.hidden) this.positionCueBallPopup()
  }

  /** v1.1.18 popup 内点击：仅阻止冒泡（避免被外部点击立即关闭） */
  private onPopupClick = (e: Event) => {
    e.stopPropagation()
  }

  /** 点击面板外部关闭 ② 面板 */
  private onDocClick = (e: Event) => {
    const popup = id("cueballPopup")
    if (!popup || popup.hidden) return
    const t = e.target as HTMLElement
    if (t && (popup.contains(t) || this.cueBallTriggerElement?.contains(t))) {
      return
    }
    popup.hidden = true
    this.cueBallTriggerElement?.setAttribute("aria-expanded", "false")
  }

  setDisabled(disabled: boolean) {
    this.controlsDisabled = disabled || Session.isSpectator()
    this.updateHitButton()
    this.updatePowerElement()
    this.updateTiltElement()
    this.updateCueBall()
    this.updateBallContainer()
    this.aimSlider?.setDisabled(this.controlsDisabled)
    if (this.objectBallStyle) {
      if (this.controlsDisabled) {
        this.objectBallStyle.visibility = "hidden"
      } else {
        this.showOverlap()
      }
    }
  }

  private updateBallContainer() {
    if (this.ballContainerWrapperElement) {
      this.ballContainerWrapperElement.classList.toggle(
        "is-disabled",
        this.controlsDisabled
      )
    }
    if (this.ballContainerElement) {
      this.ballContainerElement.classList.toggle(
        "is-disabled",
        this.controlsDisabled
      )
    }
  }

  private updateHitButton() {
    if (this.cueHitElement) {
      this.cueHitElement.disabled = this.controlsDisabled
      if (this.controlsDisabled) {
        this.timeoutButton?.cancel()
      } else {
        const useShotClock =
          !this.container.isSinglePlayer || Session.isBotMode()
        if (useShotClock) {
          // v1.1.32：仅在「回合时间限制」被明确设置（>0）时启动倒计时；
          // 默认「无限制」（turnTimerSeconds=0）不显示倒计时圆环。
          if (this.turnTimerSeconds > 0) {
            this.timeoutButton?.startTimer()
          }
        }
      }
    }
  }

  private updatePowerElement() {
    if (this.powerSliderContainerElement) {
      this.powerSliderContainerElement.classList.toggle(
        "is-disabled",
        this.controlsDisabled
      )
    }
    if (this.cuePowerElement) {
      this.cuePowerElement.disabled = this.controlsDisabled
      this.cuePowerElement.classList.toggle(
        "is-disabled",
        this.controlsDisabled
      )
    }
  }

  private updateTiltElement() {
    if (this.cueTiltElement) {
      this.cueTiltElement.disabled = this.controlsDisabled
    }
    if (this.resetSpinElement) {
      this.resetSpinElement.disabled = this.controlsDisabled
    }
  }

  private updateCueBall() {
    if (this.cueBallElement) {
      this.cueBallElement.style.pointerEvents = this.controlsDisabled
        ? "none"
        : "auto"
      this.cueBallElement.classList.toggle("is-disabled", this.controlsDisabled)
    }
  }

  isDisabled(): boolean {
    return this.controlsDisabled
  }

  /**
   * 白球击球点展开面板（cueballPopup）当前是否处于展开状态。
   * 展开期间屏蔽画布拖拽 / 点球瞄准，避免用户滑动屏幕调整打点时
   * 误触旋转瞄准方向；只有收起面板后才能重新滑动屏幕瞄准。
   */
  isCueBallPopupOpen(): boolean {
    const popup = id("cueballPopup") as HTMLElement | null
    return !!popup && !popup.hidden
  }

  /** item 1：标记「正在瞄准」开始（按住滑条）。 */
  private beginAim = () => {
    this.container.table.cue.beginAimInteraction()
  }

  /** item 1：标记「正在瞄准」结束（松开滑条）。 */
  private endAim = () => {
    this.container.table.cue.endAimInteraction()
  }

  /** item 1：瞬时交互（滚轮 / 点球）→ 给辅助线一个短暂的可见窗口。 */
  private flashAim = () => {
    this.container.table.cue.flashAimInteraction()
  }

  /* ---------- v1.1.41：力度条容器自定义 pointer 事件 ---------- */
  private onPowerPointerDown = (e: PointerEvent) => {
    if (this.controlsDisabled) return
    if (!this.powerSliderContainerElement || !this.cuePowerElement) return
    e.preventDefault()
    const el = this.powerSliderContainerElement
    try {
      el.setPointerCapture(e.pointerId)
    } catch {
      /* 某些嵌入式 WebView 在非 primary pointer 上 setPointerCapture 会抛错，忽略 */
    }
    this.beginAim()
    this.updatePowerFromPointer(e)
  }

  private onPowerPointerMove = (e: PointerEvent) => {
    if (this.controlsDisabled) return
    if (!this.powerSliderContainerElement || !this.cuePowerElement) return
    if (!this.powerSliderContainerElement.hasPointerCapture(e.pointerId)) return
    e.preventDefault()
    this.updatePowerFromPointer(e)
  }

  private onPowerPointerUp = (e: PointerEvent) => {
    const el = this.powerSliderContainerElement
    if (el && el.hasPointerCapture(e.pointerId)) {
      try {
        el.releasePointerCapture(e.pointerId)
      } catch {
        /* 无捕获时忽略 */
      }
    }
    this.endAim()
  }

  /** 根据 pointer 坐标把轨道宽度映射到 [0,1]，写回 input.value 并触发 powerChanged */
  private updatePowerFromPointer(e: PointerEvent) {
    const el = this.powerSliderContainerElement
    const input = this.cuePowerElement
    if (!el || !input) return
    // v1.2.4：触摸坐标必须映射到【视觉轨道 .power-track】的矩形，而不是外层容器。
    // 外层容器包含左侧 78px 百分比文字 + 14px 内边距，而 8 球与橙红填充都以
    // .power-track 宽度为基准（left:var(--p)），两者坐标系不同会导致
    // 「实际力度位置在手指右侧（不跟手）」。改用 track 的 left/width 后，
    // 触点与 8 球位置一一对应，力度条真正跟手。
    const track = el.querySelector(".power-track") as HTMLElement | null
    const rect = (track ?? el).getBoundingClientRect()
    if (rect.width <= 0) return
    const x = e.clientX - rect.left
    const ratio = Math.max(0, Math.min(1, x / rect.width))
    input.value = ratio.toString()
    this.powerChanged()
  }

  mousemove = (e) => {
    e.buttons === 1 && this.adjustSpin(e)
  }

  readDimensions() {
    this.ballWidth = this.cueBallElement?.offsetWidth
    this.ballHeight = this.cueBallElement?.offsetHeight
    this.tipRadius = this.cueTipElement?.offsetWidth / 2
  }

  adjustSpin(e) {
    if (this.controlsDisabled) {
      return
    }
    this.readDimensions()
    // v1.2.5：弹出面板里选击球点属于「打点偏好」设置，不应被球桌几何的
    // 避免逻辑（avoidCueTouchingOtherBall）强制上移，否则白球贴球时下半部分
    // 选不中。故传入 avoid=false，让玩家能自由选择任意打点（含低杆/下半部分）。
    this.container.table.cue.setSpin(
      new Vector3(
        -(e.offsetX - this.ballWidth / 2) /
          (this.ballWidth / 2) /
          AimInputs.TIP_SCALE,
        -(e.offsetY - this.ballHeight / 2) /
          (this.ballHeight / 2) /
          AimInputs.TIP_SCALE
      ),
      this.container.table,
      false
    )
    this.container.lastEventTime = performance.now()
  }

  resetSpin = (_) => {
    if (this.controlsDisabled) {
      return
    }
    this.container.table.cue.setSpin(new Vector3(0, 0, 0), this.container.table)
    this.updateVisualState(0, 0)
    this.container.lastEventTime = performance.now()
  }

  updateVisualState(x: number, y: number) {
    const elt = this.cueTipElement?.style
    if (elt) {
      // Use percentages so the tip scales automatically with the ball
      elt.left = ((-(x * AimInputs.TIP_SCALE) / 2 + 0.5) * 100).toString() + "%"
      elt.top = ((-(y * AimInputs.TIP_SCALE) / 2 + 0.5) * 100).toString() + "%"
      elt.transform = "translate(-50%, -50%)"
    }
    this.showOverlap()
  }

  showOverlap() {
    if (this.objectBallStyle) {
      const table = this.container.table
      if (table.cue) {
        const dir = unitAtAngle(table.cue.aim.angle)
        const closest = this.overlap.getOverlapOffset(table.cueball, dir)
        if (closest) {
          this.readDimensions()
          this.objectBallStyle.visibility = "visible"
          this.objectBallStyle.left =
            (closest.overlap * this.ballWidth) / 2 +
            this.cueBallElement.offsetLeft +
            "px"
          this.objectBallStyle.backgroundColor = new Color(0, 0, 0)
            .lerp(closest.ball.ballmesh.color, 0.5)
            .getStyle()
          if (this.objectBallOverlap) {
            const overlapPercent = Math.round(
              (1 - Math.min(Math.abs(closest.overlap) / 2, 1)) * 100
            )
            this.objectBallOverlap.innerText = overlapPercent + "%"
          }
        } else {
          this.objectBallStyle.visibility = "hidden"
          if (this.objectBallOverlap) {
            this.objectBallOverlap.innerText = ""
          }
        }
      }
    }
  }

  /** 角度数据回灌到横向滑动条（Cue 在任何角度变化后调用） */
  updateAimAngleSlider() {
    this.aimSlider?.sync()
  }

  /** 设置面板改了「横向瞄准滑动条」开关后重新应用显隐 */
  applyAimSliderVisibility() {
    this.aimSlider?.applyVisibility()
  }

  private updatePowerProgress() {
    if (this.cuePowerElement) {
      const percent = Number(this.cuePowerElement.value) * 100
      // v1.1.29：--p 设在容器上，轨道填充与 8 球滑块共用同一进度
      this.powerSliderContainerElement.style.setProperty("--p", percent + "%")
      if (this.cuePowerPercentElement) {
        this.cuePowerPercentElement.innerText = Math.round(percent) + "%"
      }
    }
  }

  powerChanged = (_) => {
    if (this.controlsDisabled) {
      return
    }
    this.flashAim()
    this.container.table.cue.setPower(Number(this.cuePowerElement.value))
    this.updatePowerProgress()
  }

  tiltChanged = (_) => {
    if (this.controlsDisabled || !this.cueTiltElement) {
      return
    }
    this.container.table.cue.setElevation(this.cueTiltElement.elevation)
    this.container.lastEventTime = performance.now()
  }

  updatePowerSlider(power) {
    if (this.cuePowerElement) {
      this.cuePowerElement.value = power
      this.updatePowerProgress()
    }
  }

  updateTiltSlider(elevation) {
    if (this.cueTiltElement) {
      this.cueTiltElement.elevation = elevation
    }
  }

  hit = (_) => {
    if (this.controlsDisabled) {
      return
    }
    this.container.table.cue.setPower(Number(this.cuePowerElement?.value))
    this.container.inputQueue.push(new Input(0, "SpaceUp"))
  }

  /**
   * The "Hit" animation logic for the slider.
   * v1.2.11 #F8：改为 no-op。原先击球后先清 0 再补间回目标值，
   * 用户要求击球后维持原百分比进度不动，故不再做任何视觉动画。
   * 签名保留以防其它引用。
   */
  animateSliderHit() {
    // v1.2.11 #F8：不再先清 0 再回弹，维持用户设定百分比
  }

  /**
   * Sets the slider visual without changing the actual game power.
   * Updates both the CSS variable and the input value for visual consistency.
   */
  private setSliderVisual(val: number) {
    const percent = val * 100
    this.cuePowerElement.value = val.toString()
    // v1.1.29：--p 设在容器上，轨道填充与 8 球滑块共用同一进度
    this.powerSliderContainerElement.style.setProperty("--p", percent + "%")
    if (this.cuePowerPercentElement) {
      this.cuePowerPercentElement.innerText = Math.round(percent) + "%"
    }
  }

  mousewheel = (e) => {
    if (e.ctrlKey) {
      e.preventDefault()
      return
    }
    if (this.controlsDisabled) {
      return
    }
    if (this.cuePowerElement) {
      this.flashAim()
      this.cuePowerElement.value = (
        Number(this.cuePowerElement.value) -
        Math.sign(e.deltaY) / 10
      ).toString()
      this.container.table.cue.setPower(Number(this.cuePowerElement.value))
      this.updatePowerProgress()
      this.container.lastEventTime = performance.now()
    }
  }
}
