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
  /** v1.3.94（杆法档位按钮）：斯登 / 跟进 / 缩杆 / 扎杆 四个预设按钮 */
  readonly spinStunElement
  readonly spinFollowElement
  readonly spinDrawElement
  readonly spinJumpElement
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
    this.spinStunElement = id("spinStun") as HTMLButtonElement
    this.spinFollowElement = id("spinFollow") as HTMLButtonElement
    this.spinDrawElement = id("spinDraw") as HTMLButtonElement
    this.spinJumpElement = id("spinJump") as HTMLButtonElement
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
    // v1.3.93：击球点盘改用 pointerdown + setPointerCapture 驱动。
    //
    // 修的问题（用户：「白球击球点滑动不跟手」），原实现有三个叠加缺陷：
    //
    //  ① 只监听 pointermove，没有 pointerdown —— 按下那一刻不会跳到按点，
    //     必须先滑一下才响应，手感上就是「慢半拍」。
    //  ② 没有 setPointerCapture —— 手指滑出白球那 90px 左右的范围后事件
    //     直接断掉，盘面停在半路不动（这是「滑一半卡住」的直接原因）。
    //  ③ `adjustSpin` 用 e.offsetX/offsetY 取坐标 —— offsetX 是相对**事件
    //     目标元素**的偏移，而白球内部还有高光伪元素 .cueBall::before 和
    //     杆头 #cueTip。指针滑到这些子元素上时 e.target 会切换，参照系跟着
    //     变，offsetX 瞬间跳变。正确做法是用 getBoundingClientRect + clientX。
    //
    // 改法：pointerdown 立即定位并捕获指针；pointermove 仅在持有捕获时生效；
    // pointerup/cancel 释放。坐标统一用白球外框 rect 换算。
    if (this.cueBallElement) {
      this.cueBallElement.addEventListener("pointerdown", this.onSpinPointerDown)
      this.cueBallElement.addEventListener("pointermove", this.onSpinPointerMove)
      this.cueBallElement.addEventListener("pointerup", this.onSpinPointerUp)
      this.cueBallElement.addEventListener("pointercancel", this.onSpinPointerUp)
      // 鼠标的单击选点（桌面端）保留：pointerdown 已经处理，避免重复调用
      // 这里不再绑 click，防止「按一下被执行两次」。
    }
    this.resetSpinElement?.addEventListener("click", this.resetSpin)
    // v1.3.94（杆法档位按钮）：一键设定击球杆法（保留当前左右塞 offX）
    this.spinStunElement?.addEventListener("click", () => this.setSpinGear("stun"))
    this.spinFollowElement?.addEventListener("click", () => this.setSpinGear("follow"))
    this.spinDrawElement?.addEventListener("click", () => this.setSpinGear("draw"))
    this.spinJumpElement?.addEventListener("click", () => this.setSpinGear("jump"))
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
      // v1.4.0：capture 中途丢失 → 转 window 兜底继续拖动（不再当松手处理）
      c.addEventListener("lostpointercapture", this.onPowerCaptureLost)
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
    // v1.3.76：点/滑主界面先收起打点面板，且本次手势不改瞄准（捕获阶段优先）
    document.addEventListener("pointerdown", this.onMainAreaPointerDown, true)
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
    // v1.4.0：控件**启用瞬间 = 新回合瞄准开始**，此时复位白球击球点。
    //
    // 用户反馈「每个回合前都要将白球击球点位置重置（v1.3.46 已实现但未
    // 生效）」。v1.3.46 的复位挂在 AimController.enter：aim.offset 清零 +
    // updateAimInput() 刷 UI，数据链路本身没断 —— 真正的残留来自两处
    // **视觉状态**：
    //   ① 杆法档位按钮的 `.active` 高亮从不主动清除 —— 上一杆点了「缩杆」，
    //      这一杆按钮还亮着，玩家自然认为击球点没重置；
    //   ② 摆球类控制器（placeball/placeallballs/drilloptions）进入瞄准
    //      不走 AimController.enter 的 !customShot 分支之前 aim.offset 可能
    //      带着上一杆的打点。
    // 本钩子覆盖**所有**进入瞄准的路径（setDisabled(false) 的全部调用点
    // 都是回合开始），与 enter 的清零互为双保险。
    if (!this.controlsDisabled) {
      this.resetSpinForNewTurn()
    }
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

  /**
   * v1.4.0：新回合开始时复位白球击球点（打点 + 抬杆 + 杆法按钮高亮）。
   * 只在控件启用（回合开始）时由 setDisabled 调用；观战态 controlsDisabled
   * 恒为 true，不会误清回放/观战演示的演示打点。
   */
  private resetSpinForNewTurn() {
    const cue = this.container.table.cue
    if (cue.aim.offset.x !== 0 || cue.aim.offset.y !== 0) {
      cue.aim.offset.set(0, 0, 0)
    }
    if (cue.aim.elevation !== 0) {
      cue.aim.elevation = 0
    }
    // 数据清零后统一刷 UI：红点回中、仰角滑杆归零（updateAimInput 内部
    // 不检查 disabled，可在此安全调用）
    cue.updateAimInput()
    // 杆法档位按钮高亮一并清除 —— 否则玩家看到的「缩杆还亮着」就是
    // 「击球点没重置」的直接来源
    for (const el of [
      this.spinStunElement,
      this.spinFollowElement,
      this.spinDrawElement,
      this.spinJumpElement,
    ]) {
      el?.classList.remove("active")
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
    // v1.3.94（杆法档位按钮）：与 resetSpin 同步禁用
    for (const el of [
      this.spinStunElement,
      this.spinFollowElement,
      this.spinDrawElement,
      this.spinJumpElement,
    ]) {
      if (el) el.disabled = this.controlsDisabled
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

  /**
   * v1.3.76：收起白球击球点面板。
   * @returns 原本是否处于展开态（调用方可据此判断「这次点击是不是用来关面板的」）
   */
  closeCueBallPopup(): boolean {
    const popup = id("cueballPopup") as HTMLElement | null
    if (!popup || popup.hidden) return false
    popup.hidden = true
    this.cueBallTriggerElement?.setAttribute("aria-expanded", "false")
    this.autoClosedAt = performance.now()
    return true
  }

  /**
   * v1.3.76：本次手势是否应完全屏蔽瞄准（仅「手指还按着」这一段）。
   *
   * 用户点击/滑动主界面只是为了把展开的打点面板收起来，不该顺带把瞄准
   * 角度也转跑（旧行为：面板虽然不响应，但画布拖拽照样改角度，
   * 等于「关面板 = 白瞄一次」）。用于画布拖拽这条路径。
   */
  isAimSuppressed(): boolean {
    return this.aimSuppressed
  }

  /**
   * v1.3.76：点球对准（tap）用的宽松版。
   * tap 是在 pointerup **之后**才派发的，那时 `aimSuppressed` 已经复位，
   * 因此额外给一个 350ms 的冷却窗口，覆盖「这一次关面板的点击」。
   * 只影响点球对准，不影响拖拽 —— 玩家关完面板想立刻拖屏瞄准不受影响。
   */
  isAimTapSuppressed(): boolean {
    return this.aimSuppressed || performance.now() - this.autoClosedAt < 350
  }

  /** 手势期间屏蔽瞄准（pointerdown 置位，pointerup 复位） */
  private aimSuppressed = false
  /** 最近一次「点主界面自动收起面板」的时刻 */
  private autoClosedAt = -1e9

  /**
   * v1.3.76：主界面（3D 画布 / 球桌）上的按下 —— 先把展开的打点面板收起来，
   * 并且**整段手势都不改瞄准角度**，收起之后的下一次手势才恢复瞄准。
   *
   * 挂在 document 的捕获阶段，保证早于 interact.js（画布拖拽）与
   * drawing.ts（点球对准）拿到事件；命中主界面时直接掐断冒泡，
   * 让这两条瞄准路径本次根本收不到事件。
   */
  private onMainAreaPointerDown = (e: Event) => {
    if (!this.isCueBallPopupOpen()) return
    const t = e.target as HTMLElement | null
    const popup = id("cueballPopup") as HTMLElement | null
    if (t && popup?.contains(t)) return
    if (t && this.cueBallTriggerElement?.contains(t)) return
    // 面板外的任何位置都收起面板（力度条 / 击球按钮等同样适用）
    this.closeCueBallPopup()
    this.aimSuppressed = true
    window.addEventListener("pointerup", this.onMainAreaPointerUp, true)
    window.addEventListener("pointercancel", this.onMainAreaPointerUp, true)
    // 只有落在 3D 主界面（#viewP1 内的画布）才掐断冒泡：
    // 其它 UI（按钮 / 滑条）仍要正常响应这一次点击。
    const view = id("viewP1")
    if (view && t && view.contains(t)) {
      e.stopPropagation()
    }
  }

  private onMainAreaPointerUp = () => {
    this.aimSuppressed = false
    window.removeEventListener("pointerup", this.onMainAreaPointerUp, true)
    window.removeEventListener("pointercancel", this.onMainAreaPointerUp, true)
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
    // v1.4.0：记录本次手势的 pointerId；capture 未成功时挂 window 兜底监听。
    // 此前 setPointerCapture 失败被静默吞掉，而 onPowerPointerMove 的
    // hasPointerCapture 守卫会把**所有**后续 move 丢弃 —— 力度条只响应
    // 按下那一下，之后手指怎么滑都不动，用户感知就是「力度条不跟手」。
    this.powerPointerId = e.pointerId
    if (!el.hasPointerCapture(e.pointerId)) {
      this.attachPowerWindowFallback()
    }
    // v1.3.93：按下时才量一次轨道几何，拖动全程复用（见 powerTrackRect）
    this.powerSliderDragging = true
    this.measurePowerTrack()
    this.beginAim()
    this.updatePowerFromPointer(e)
  }

  private onPowerPointerMove = (e: PointerEvent) => {
    if (this.controlsDisabled) return
    if (!this.powerSliderContainerElement || !this.cuePowerElement) return
    // v1.4.0：守卫改为 pointerId 校验。capture 正常时事件只会来自容器内，
    // fallback 模式下容器监听收不到滑出容器的 move，两者互不干扰；
    // 关键是不再因 hasPointerCapture 为 false 而丢掉合法的拖动事件。
    if (this.powerPointerId !== e.pointerId) return
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
    // v1.4.0：摘掉 window 兜底监听并复位手势状态
    this.powerPointerId = null
    this.detachPowerWindowFallback()
    // v1.3.93：松手后回到「按 input 量化值」的常规路径，并丢弃缓存的几何。
    // 丢弃是为了让下次按下重新量 —— 期间可能旋转过屏幕 / 改变过窗口大小。
    this.powerSliderDragging = false
    this.powerTrackRect = null
    this.endAim()
  }

  // ---- v1.4.0：力度条 window 兜底监听 ----
  //
  // 两个触发场景：
  //   ① pointerdown 时 setPointerCapture 直接失败（部分 Android WebView
  //      在非 primary pointer / 触摸被浏览器判定为滚动的边缘情况）；
  //   ② 拖动中途 capture 被 WebView 静默释放（lostpointercapture）——
  //      此前监听直接把它当 pointerup 处理，拖动被强制结束，
  //      表现为「滑到一半力度条就不动了」。
  // 兜底 = window 捕获阶段挂 move/up/cancel，手指滑出容器也能持续收到。
  private powerPointerId: number | null = null
  private powerWindowFallback = false

  private attachPowerWindowFallback() {
    if (this.powerWindowFallback) return
    this.powerWindowFallback = true
    window.addEventListener("pointermove", this.onPowerPointerMoveWindow, true)
    window.addEventListener("pointerup", this.onPowerPointerUpWindow, true)
    window.addEventListener("pointercancel", this.onPowerPointerUpWindow, true)
  }

  private detachPowerWindowFallback() {
    if (!this.powerWindowFallback) return
    this.powerWindowFallback = false
    window.removeEventListener("pointermove", this.onPowerPointerMoveWindow, true)
    window.removeEventListener("pointerup", this.onPowerPointerUpWindow, true)
    window.removeEventListener("pointercancel", this.onPowerPointerUpWindow, true)
  }

  private onPowerPointerMoveWindow = (e: PointerEvent) => {
    if (e.pointerId !== this.powerPointerId) return
    this.updatePowerFromPointer(e)
  }

  private onPowerPointerUpWindow = (e: PointerEvent) => {
    if (e.pointerId !== this.powerPointerId) return
    this.onPowerPointerUp(e)
  }

  /**
   * v1.4.0：拖动中途 capture 丢失 —— 不再结束拖动，转入 window 兜底继续。
   * （旧实现把 lostpointercapture 直接绑到 onPowerPointerUp，WebView 手势
   * 判定一抖动就强制松手。）
   */
  private onPowerCaptureLost = (e: PointerEvent) => {
    if (!this.powerSliderDragging || e.pointerId !== this.powerPointerId) return
    this.attachPowerWindowFallback()
  }

  /**
   * v1.3.93：力度条轨道的几何缓存。
   *
   * 修的问题：`updatePowerFromPointer` 原先**每次 pointermove 都调
   * `getBoundingClientRect()`**。pointermove 在触摸屏上可达 120Hz，
   * 而 getBoundingClientRect 会强制浏览器同步重算布局（forced reflow）。
   * 更糟的是 `.power-track` 是 flex 子项、宽度会随右侧百分比文字变宽变窄，
   * 每次读到的 rect 可能抖动 —— 既慢又不准。用户感知就是「滑动不跟手」。
   *
   * 修法：在 pointerdown 时量一次并缓存，拖动全程复用；
   * 窗口尺寸变化（旋转/缩放）时失效重取。
   */
  private powerTrackRect: { left: number; width: number } | null = null
  /** v1.3.93：力度条是否正在被拖动（拖动中走精确比例通道，绕过 input 量化） */
  private powerSliderDragging = false
  /**
   * v1.3.93：拖动期间由球杆回灌的精确力度比例，用于切断「写值→回调→回写」回环。
   * 见 updatePowerSlider 的说明。
   */
  private lastAppliedRatio: number | null = null

  private measurePowerTrack() {
    const el = this.powerSliderContainerElement
    if (!el) return
    const track = el.querySelector(".power-track") as HTMLElement | null
    const rect = (track ?? el).getBoundingClientRect()
    if (rect.width <= 0) {
      this.powerTrackRect = null
      return
    }
    this.powerTrackRect = { left: rect.left, width: rect.width }
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
    //
    // v1.3.93：改为用缓存的 rect（见 powerTrackRect）。缓存为空时（首次
    // pointerdown 未经 measure、或窗口刚变化）补量一次，保证不返回错误值。
    if (!this.powerTrackRect) this.measurePowerTrack()
    const cached = this.powerTrackRect
    if (!cached) return
    const x = e.clientX - cached.left
    const ratio = Math.max(0, Math.min(1, x / cached.width))
    if (this.powerSliderDragging) {
      // v1.3.93：拖动中跳过 input.value 的字符串量化。
      // 原生 input[type=range] 的 step="0.01" 会把写回值量化到 100 档，
      // 快速拖动时力度呈阶梯跳变、手感发涩。这里直接把精确比例交给 cue，
      // value 只作为「非拖动场景（键盘/程序写入）」的回退通道。
      this.applyPowerRatio(ratio)
      return
    }
    input.value = ratio.toString()
    this.powerChanged()
  }

  /** v1.3.93：绕过 input 量化，直接把 [0,1] 比例下发给球杆并刷新视觉 */
  private applyPowerRatio(ratio: number) {
    this.flashAim()
    this.lastAppliedRatio = ratio
    this.container.table.cue.setPower(ratio)
    // 精确比例写进 DOM 只是为了视觉与后续读取一致，这里用 toFixed(4) 而非
    // 依赖 step 量化，避免「手感准了但数字显示跳档」。
    if (this.cuePowerElement) {
      this.cuePowerElement.value = ratio.toFixed(4)
    }
    this.updatePowerProgress(ratio)
  }

  /* ---------- v1.3.93：击球点盘的 pointer 事件 ---------- */
  private onSpinPointerDown = (e: PointerEvent) => {    if (this.controlsDisabled) return
    // preventDefault：阻止 Android WebView 把手势判定成滚动/长按选择，
    // 否则会在拖动中途派发 pointercancel 把滑动打断（力度条早已这么做，
    // 击球点盘此前漏了这一步）。
    e.preventDefault()
    try {
      this.cueBallElement?.setPointerCapture(e.pointerId)
    } catch {
      /* 非 primary pointer 上可能抛错，忽略 */
    }
    this.adjustSpin(e)
  }

  private onSpinPointerMove = (e: PointerEvent) => {
    if (this.controlsDisabled) return
    // 仅在持有捕获时响应：pointerdown 已把指针锁给白球，
    // 因此这里不再需要判断 e.buttons（触摸事件里它恒为 0）。
    if (this.cueBallElement?.hasPointerCapture(e.pointerId)) {
      e.preventDefault()
      this.adjustSpin(e)
    }
  }

  private onSpinPointerUp = (e: PointerEvent) => {
    const el = this.cueBallElement
    if (el && el.hasPointerCapture(e.pointerId)) {
      try {
        el.releasePointerCapture(e.pointerId)
      } catch {
        /* 无捕获时忽略 */
      }
    }
  }

  readDimensions() {
    this.ballWidth = this.cueBallElement?.offsetWidth
    this.ballHeight = this.cueBallElement?.offsetHeight
    this.tipRadius = this.cueTipElement?.offsetWidth / 2
  }

  /**
   * v1.3.93：把指针位置换算成击球点偏移。
   *
   * 与旧版的唯一实质区别是坐标来源：不再用 e.offsetX/offsetY（参照系会随
   * 事件目标在子元素间跳变），改为白球外框的 getBoundingClientRect + clientX。
   * 这样无论指针压在高光伪元素、杆头还是白球本体上，算出来的都是同一个
   * 以白球中心为原点的归一化坐标。
   */
  adjustSpin(e) {
    if (this.controlsDisabled) {
      return
    }
    this.readDimensions()
    const el = this.cueBallElement
    if (!el) return
    const rect = el.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) return
    const halfW = rect.width / 2
    const halfH = rect.height / 2
    // v1.2.5：弹出面板里选击球点属于「打点偏好」设置，不应被球桌几何的
    // 避免逻辑（avoidCueTouchingOtherBall）强制上移，否则白球贴球时下半部分
    // 选不中。故传入 avoid=false，让玩家能自由选择任意打点（含低杆/下半部分）。
    this.container.table.cue.setSpin(
      new Vector3(
        -(e.clientX - rect.left - halfW) / halfW / AimInputs.TIP_SCALE,
        -(e.clientY - rect.top - halfH) / halfH / AimInputs.TIP_SCALE
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

  /**
   * v1.3.94（杆法档位按钮）：一键设定击球杆法。
   *
   * 预设量值与 AI 的 `chooseSpin` 玩家可达区间对齐（FOLLOW_MAX=0.4 /
   * DRAW_MAX=−0.45 / elevation≤0.42），保证玩家与 AI 共用同一套物理、无特权。
   * 左右塞(offX)保持不变，只改高低杆(offY)与抬杆(elev)：
   *   斯登 = 中杆停球；跟进 = 高杆前跟；缩杆 = 低杆回缩；扎杆 = 低杆+抬杆起跳。
   */
  setSpinGear = (kind: "stun" | "follow" | "draw" | "jump") => {
    if (this.controlsDisabled) {
      return
    }
    const cue = this.container.table.cue
    const offX = cue.aim.offset.x // 保留当前左右塞
    let offY = 0
    let elev = 0
    switch (kind) {
      case "stun":
        offY = 0
        elev = 0
        break
      case "follow":
        offY = 0.4
        elev = 0
        break
      case "draw":
        offY = -0.42
        elev = 0
        break
      case "jump":
        offY = -0.45
        elev = 0.35
        break
    }
    cue.setSpin(new Vector3(offX, offY, 0), this.container.table)
    cue.setElevation(elev)
    this.updateVisualState(offX, offY)
    this.updateTiltSlider(elev)
    // 高亮当前档位按钮
    for (const [el, k] of [
      [this.spinStunElement, "stun"],
      [this.spinFollowElement, "follow"],
      [this.spinDrawElement, "draw"],
      [this.spinJumpElement, "jump"],
    ] as const) {
      el?.classList.toggle("active", k === kind)
    }
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

  private updatePowerProgress(ratioOverride?: number) {
    if (this.cuePowerElement) {
      const ratio =
        ratioOverride ?? Number(this.cuePowerElement.value)
      const percent = ratio * 100
      // v1.1.29：--p 设在容器上，轨道填充与 8 球滑块共用同一进度
      this.powerSliderContainerElement.style.setProperty("--p", percent + "%")
      // v1.4.0：整数百分比没有变化就不写 innerText —— 文字内容一变，
      // flex 兄弟的宽度重排会拖累同帧的 move 处理（120Hz 触摸采样下
      // 每次 move 都重排一次，是「拖动手感发涩」的最后一处来源）。
      const text = Math.round(percent) + "%"
      if (this.cuePowerPercentElement && this.lastPowerText !== text) {
        this.lastPowerText = text
        this.cuePowerPercentElement.innerText = text
      }
    }
  }
  /** v1.4.0：力度百分比文字缓存（内容不变不写 DOM） */
  private lastPowerText: string | null = null

  powerChanged = (_?: unknown) => {
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
    if (!this.cuePowerElement) return
    // v1.3.93：拖动中切断回环。
    //
    // 原先的调用链是个闭环：
    //   pointermove → updatePowerFromPointer（写 input.value → powerChanged）
    //     → cue.setPower() → cue.updateAimInput() → aimInputs.updatePowerSlider()
    //     → 又写一次 input.value + updatePowerProgress()
    //
    // 结果每次 pointermove 都跑两遍 DOM 写 + 两遍 style.setProperty，
    // 拖动越频繁越卡，表现为「跟不上手指」。
    //
    // 拖动期间力度值已由 applyPowerRatio 精确下发，球杆的回灌值与它同源，
    // 再写一遍 DOM 纯属重复劳动。用 1e-4 容差判断：只有真正不同（例如
    // 球杆内部按物理约束 clamp 过）才回写，保证不丢修正。
    if (this.powerSliderDragging && this.lastAppliedRatio !== null) {
      if (Math.abs(power - this.lastAppliedRatio) < 1e-4) return
    }
    this.cuePowerElement.value = power
    this.updatePowerProgress()
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
