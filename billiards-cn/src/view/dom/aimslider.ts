import { id } from "../../utils/dom"
import { unitAtAngle } from "../../utils/three-utils"
import { Tutorial } from "../tutorial"
import type { Container } from "../../container/container"
import { Vector3 } from "three"
import type { PerspectiveCamera } from "three"

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
 * 数据同步：滑动条 / 手指拖拽瞄准 共用 cue.aim.angle
 * 这一份数据。任何一方改动都会经由 Cue.updateAimInput / rotateAim 回灌到
 * updateAimAngleSlider()，因此两者永远一致。
 */
export class AimSlider {
  private readonly container: Container
  private readonly bar: HTMLElement | null
  private readonly track: HTMLElement | null
  private readonly slider: HTMLInputElement | null

  /** 用户正在拖滑块：此时不要用程序值回写，否则会和手指打架 */
  private dragging = false
  /** 拖动起点：屏幕 X 与当时的瞄准角，用于相对增量（不截断、可继续滑动） */
  private dragStartX = 0
  private dragStartAngle = 0
  /** 本次手势是否发生了有效滑动（>3px 视为拖动，否则视为轻点） */
  private didDrag = false
  /**
   * v1.3.76：本次拖动期间**冻结**的视角符号（见 viewSign）。
   * 原先 onDragMove 每帧重算 viewSign()：相机跟着瞄准角一起转，
   * dot 值会在 0 附近来回穿越，符号一会儿 +1 一会儿 -1，
   * 于是「同一个手指位置」被解算成两个相反的角度增量 —— 表现就是
   * 拖到条子边缘时示意线来回抽搐。拖动开始时算一次并锁死即可。
   */
  private dragViewSign = 1
  /**
   * v1.5.1：带**滞后**的视角符号（viewSign 的稳定化记忆）。
   *
   * 缺陷实测（tools/render/probe-aim151.js，横屏 1422×640，真实触摸）：
   * 把瞄准角从 0° 扫到 355°，dot 在 **0° 与 180° 附近穿越 0**，实测
   * |dot| 最小值 = 0.0000；用 `dot >= 0 ? 1 : -1` 取符号时，落在这两个
   * 奇异区内的手势会被解算成相反的角度增量 —— 拖到轨道端部 14 次，
   * **6 次反向**，且全部集中在基准角 0° / 180° / 183° 上。
   *
   * 根因：dot≈0 意味着「角度增大」在屏幕上几乎不产生横向位移，此时符号
   * 由浮点噪声决定，dot 在穿越带内反复易号 → 同一个手指方向时左时右。
   *
   * 改法：只在 |d| 明确越过阈值时才更新符号，过渡带内**保持上一次判定**。
   * 该记忆由 sync() 每帧连续维护（不受拖动影响），所以拖动开始时取到的
   * 已经是「当前角度下最近一次可信的符号」，不会取到噪声值。
   *
   * 初值取 **0 而不是 1**：0 表示「还没有过任何判定」。首次进入过渡带时
   * 没有历史可沿用，此时必须取即时符号 —— 硬编码 1 会让开局那一段
   * （实测初始瞄准角处 dot 恰好为 0）整段手势都反着走。
   */
  private lastViewSign = 0

  // ---- v1.4.2：贴边自转已从本控件移除（左右两端一律「只跟随手指」）----
  //
  // v1.4.0 曾给这条滑条加上与画布拖拽同款的「贴边自转」：指针停在屏幕
  // 左右边缘带内（max(36px, 屏宽 12%)）时，每帧注入虚拟位移让角度继续转。
  // 画布拖拽没问题（画布铺满全屏，屏幕边缘就是它的边缘），但**这条滑条
  // 不是** —— 实测（tools/harness/_edgeprobe.ts，5 种视口）：
  //
  //   · 滑条位于底栏最右侧，右端距屏幕右边缘恒为 **37px**，
  //     而触发带宽 = max(36, 视口宽 12%) = 101~153px —— 于是
  //     **右半条整段都落在触发带内**，手指一进去就开始自转；
  //   · 带内速度 = 2.4px × (0.6~2.0) ≈ 3.58px/帧，按本条灵敏度
  //     （一整条轨宽 = 2°）折算 ≈ **3.4°/秒** —— 对一条量程只有 ±1° 的
  //     「细微」瞄准条来说，这是手指不动也一路狂奔；
  //   · 左端距屏幕左边缘 633~1110px，**永远进不了触发带**，左端不会自转。
  //
  // 结果就是两端行为不一致：右端自己跑、左端不跑。用户要求「右边缘逻辑
  // 改为左边缘同样逻辑」，故按左端口径统一 —— 两端都只跟随手指真实位移。
  // 画布拖拽（events/keyboard.ts 的 edgeSpin）不受影响，保留原样。
  /** 拖动中最近一次指针屏幕 X */
  private lastClientX = 0
  /**
   * v1.5.1：当前手势的 pointerId。
   * 此前 onDragMove 不校验来源指针，第二根手指（或误触）的 move 也会
   * 被当成同一手势，lastClientX 瞬间跳到另一根手指的位置 —— 表现为
   * 「拖着拖着瞄准线突然朝反方向猛跳一下」。现在只认发起手势的那根手指。
   */
  private activePointerId: number | null = null

  constructor(container: Container) {
    this.container = container
    this.bar = id("aimAngleBar")
    this.track = id("aim-angle-track")
    this.slider = id("aimAngle") as HTMLInputElement | null
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
    // v1.2.19 #1：不再把拖动发起挂到 input[range] 旋钮本身。
    // Android WebView 上 input[range] 的 thumb 会触发原生 range 拖动，
    // 导致只有浏览器原生 thumb 在动（视觉跟手），而我们的 onDragMove 里的
    // setAimAngle 根本收不到有效的 move / 角度未更新。
    // 改为让旋钮纯视觉：CSS 设 pointer-events:none，手指按在旋钮上时事件
    // 穿透到下方的 .aim-angle-track，由 track 的 pointerdown 启动拖动，
    // onDragMove 再同步更新 slider.value/--v，让旋钮跟随手指并真正改变角度。
  }

  /**
   * 当前相机视角下，aim.angle 增大是否对应「瞄准线在屏幕上向右转」。
   * 返回 +1 表示角度增大 = 瞄准线屏幕右转（滑块无需翻转），-1 表示需翻转，
   * 使「滑块右拖 = 瞄准线在屏幕上向右转」在任何视角下都成立。
   *
   * v1.5.1 起用**有限差分实测**判定（详见下方实现处注释）；早期版本用的是
   * 一阶近似：取相机世界矩阵第一列（屏幕右方向）与 unitAtAngle(a+90°) 做
   * 点积，dot>=0 取 +1。该近似在瞄准方向平行/反平行于屏幕右方向时恒等于 0，
   * 符号判定退化成浮点噪声 —— 只在拿不到母球的极端情况下还用它兜底。
   */
  private viewSign(): number {
    const cam = this.container.view?.camera?.camera
    if (!cam) return this.lastViewSign || 1
    cam.updateMatrixWorld()
    const e = cam.matrixWorld.elements
    // 相机世界矩阵第一列 = 屏幕右方向（世界坐标）
    const rx = e[0]
    const ry = e[1]
    const a = this.cue.aim.angle
    const ball = this.container.table?.balls?.[0]
    if (!ball) {
      // 拿不到母球（极端情况）时退回一阶近似：perp · 屏幕右方向
      const perp = unitAtAngle(a + Math.PI / 2)
      const dot = rx * perp.x + ry * perp.y
      this.lastViewSign = dot >= 0 ? 1 : -1
      return this.lastViewSign
    }
    //
    // v1.5.1：改用**有限差分实测**替代一阶近似 dot。
    //
    // 一阶近似 `dot = 屏幕右方向 · unitAtAngle(a+90°)` 在瞄准方向平行/反平行于
    // 屏幕右方向时会**恰好等于 0**（实测扫描：dot 在 0° 与 180° 附近穿越 0，
    // |dot| 最小值 = 0.0000），此时符号由浮点噪声决定，方向判定随机 —— 这正是
    // 「细微瞄准条右滑却反向瞄准」的根因（实测 14 次拖动 6 次反向）。
    //
    // 有限差分绕开了这个奇点：直接把 a 与 a+EPS 两个方向上的瞄准线远端点
    // 投影到屏幕，比较真实的屏幕横向坐标。它测的是**用户真正看到的东西**，
    // 且天然包含了相机跟随、俯仰角等一阶近似没算进去的因素。
    const EPS = (0.5 * Math.PI) / 180
    const x0 = this.screenXAt(a, cam, ball.pos)
    const x1 = this.screenXAt(a + EPS, cam, ball.pos)
    if (x0 === null || x1 === null) return this.lastViewSign || 1
    const d = x1 - x0
    // 滞后阈值（NDC 单位，屏幕宽度 = 2.0）：位移小于约 1.4px 时方向不可感知，
    // 沿用上一次判定，避免在过渡带里来回易号造成抽搐。
    const HYST = 0.002
    if (d > HYST) {
      this.lastViewSign = 1
    } else if (d < -HYST) {
      this.lastViewSign = -1
    } else if (this.lastViewSign === 0) {
      // 首次就落在过渡带：没有历史可沿用，取即时符号（哪怕它很小）
      this.lastViewSign = d >= 0 ? 1 : -1
    }
    return this.lastViewSign || 1
  }

  /**
   * 瞄准线在给定角度下、距母球 L 米的那一点，投影到屏幕后的**归一化横坐标**
   * （NDC，范围 -1~1）。返回 null 表示该点落在相机后方，不可用。
   */
  private screenXAt(
    angle: number,
    cam: PerspectiveCamera,
    ballPos: { x: number; y: number; z: number }
  ): number | null {
    const L = 1.0
    const u = new Vector3(Math.cos(angle), 0, -Math.sin(angle))
    const p = new Vector3(
      ballPos.x + u.x * L,
      ballPos.y + u.y * L,
      ballPos.z + u.z * L
    )
    // 先看它在相机空间里的深度：z > 0 表示在相机后方，投影结果会翻面，不可用
    const local = p.clone().applyMatrix4(cam.matrixWorldInverse)
    if (local.z > -0.05) return null
    return p.project(cam).x
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
    // v1.2.6：新手引导步骤 2 推进——首次拖动瞄准条 = 用户在做瞄准动作
    Tutorial.notifyAimDrag()
    // v1.5.1：已在拖动中的手势忽略后续按下（多指），只认第一根手指
    if (this.dragging) return
    this.dragging = true
    this.didDrag = false
    this.activePointerId = typeof e.pointerId === "number" ? e.pointerId : null
    // 记录起点：屏幕 X 与当时的真实瞄准角，后续用相对增量（不截断）
    this.dragStartX = e.clientX
    this.dragStartAngle = this.cue.aim.angle
    this.lastClientX = e.clientX
    // v1.3.76：锁死本次手势的视角符号，避免拖动中因符号翻转而抽搐
    this.dragViewSign = this.viewSign()
    this.cue.beginAimInteraction()
    // v1.2.17 #6：不再调用 setPointerCapture。部分 Android WebView 在 pointerdown
    // 上 preventDefault 后再 setPointerCapture，会立刻派发 pointercancel 并结束拖动，
    // 表现为「按住拉杆没反应」。全局 move/up/cancel 已由下方 window 捕获阶段监听
    // 统一接管，手指滑出元素也能持续收到事件，无需 setPointerCapture。
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
    // v1.5.1：只接受发起手势的那根手指的位移
    if (this.activePointerId != null && e.pointerId !== this.activePointerId) return
    this.lastClientX = e.clientX
    this.applyDrag()
  }

  /**
   * 拖动核心换算：手指的真实位移 → 瞄准角增量（v1.3.101 起的相对增量映射）。
   *
   * v1.4.2：不再叠加任何「虚拟位移」。此前叠加的贴边自转量使右端自己跑、
   * 左端不跑（详见 lastClientX 处的注释），现两端一律只吃真实位移。
   */
  private applyDrag() {
    const track = this.track
    if (!track) return
    const rect = track.getBoundingClientRect()
    if (rect.width <= 0) return
    const dx = this.lastClientX - this.dragStartX
    // 移动超过阈值即判定为「拖动」，不再视作轻点
    if (Math.abs(dx) > 3) this.didDrag = true
    // 一条满轨宽 = ±AIM_FINE_HALF_RANGE（与旧 range 灵敏度一致，但不再夹住两端）
    const HALF = Math.PI / 180
    // v1.3.101：拖出轨道两端后**继续转动瞄准角度**（不再夹在 2×HALF）。
    //
    // v1.3.76 曾把角度增量硬夹在 ±2×HALF（= 拖满一整条轨宽）以治
    // 「辅助线抽搐」，但副作用是「滑到边缘就转不动了」——手指想继续
    // 微调角度、却已经顶到条子尽头，很别扭。现在改为：
    //   · 滑块的**视觉位置**仍夹在轨道内（frac ∈ [-1,1]）：拉杆到头即贴边，
    //     符合滑条直觉，不会跑出画面；
    //   · **实际瞄准角度**按手指的绝对位移线性映射（不设上限），继续转。
    // 这样「滑块设上限、实际角度继续」，兼顾滑条手感与瞄准自由。
    // rate 取 2×HALF/轨宽 = 拖满一整条轨宽对应 2°——与旧灵敏度一致，
    // 超出轨宽后按同一斜率继续换算角度。
    const rate = (2 * HALF) / rect.width
    // v1.5.1：拖动中**实时**取滞后符号，不再沿用拖动开始时锁定的那一个。
    // 锁定的前提是「拖动期间视角不变」，但实测并不成立：按下手指会触发
    // beginAimInteraction，相机随之跟随瞄准角，dot 在手势开始后的头几帧
    // 里仍在变化 —— 锁定一个过渡期的符号，整段手势就都是反的。
    // 抽搐风险由 viewSign 的滞后阈值兜住（|dot| 未明确越过阈值就不换符号）。
    this.dragViewSign = this.viewSign()
    const delta = dx * rate * this.dragViewSign
    const target = this.dragStartAngle + delta
    this.cue.setAimAngle(target, this.container.table)
    this.container.lastEventTime = performance.now()
    // 视觉填充仅作方向提示（轨道中心=本杆初始方向）；**滑块位置夹在轨道内**。
    // 与角度增量共用同一 rate（两者线性同源），故拖满轨宽时滑块恰好到端、
    // 角度恰好转了 2°，再往外拖滑块贴边不动、角度继续。
    const frac = Math.max(-1, Math.min(1, dx * rate / HALF))
    const pct = Math.max(0, Math.min(100, 50 + (dx * rate / HALF) * 50))
    if (this.slider) {
      // v1.2.17 #6：同步更新滑块 value，让旋钮（拉杆）在拖动时跟随手指移动，
      // 否则旋钮永远 Snap 回中心、手指拖它不动，表现为「无法拖动拉杆」。
      this.slider.value = frac.toFixed(4)
      this.slider.style.setProperty("--v", pct.toFixed(2) + "%")
    }
    // v1.3.76：滑块离开中心后淡出中央基准刻线。
    // 静止时刻线被旋钮盖住看不出来；一旦旋钮滑到两端，刻线和旋钮就变成
    // 屏幕上两根并排的竖条，玩家分不清哪根才是当前瞄准位置。
    this.bar?.classList.toggle("aim-off-center", Math.abs(frac) > 0.02)
  }

  private onDragEnd = (e: PointerEvent) => {
    if (!this.dragging) return
    // v1.5.1：非发起手指抬起时不结束手势（否则多指操作时第一根手指
    // 还按着、却被第二根的 up 提前收尾，后续拖动全部失效）
    if (this.activePointerId != null && e.pointerId !== this.activePointerId) return
    this.dragging = false
    this.activePointerId = null
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
    // v1.3.76：滑块回中 → 基准刻线重新显示（与拖动中的淡出配对）
    this.bar?.classList.remove("aim-off-center")
    this.cue.setAimBase(this.cue.aim.angle)
  }

  /**
   * 由 Cue 在任何角度变化后回调。
   * 静止时：滑块永远归中（--v 50%），并把基准角锁定为当前瞄准角，
   * 这样下一次拖动就是相对「当前方向」的 ±5° 微调。拖动中则不回写，
   * 避免和手指打架。
   */
  sync() {
    // v1.5.1：非拖动期间每帧维护一次滞后符号（viewSign 内部会更新
    // lastViewSign）。这样用户按下手指时取到的是「当前角度下最近一次可信的
    // 符号」，而不是奇异区里的噪声值 —— 前提是符号记忆连续，不能只在
    // 拖动开始那一瞬间才算一次。
    if (!this.dragging && this.container.view?.camera?.camera) {
      this.viewSign()
    }
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
  }

  /** 读取设置里的开关，决定这条悬浮条是否出现 */
  applyVisibility() {
    if (!this.bar) return
    // v1.2.11 #F10：横向瞄准滑动条不再可关闭，始终显示。
    this.bar.hidden = false
  }
}
