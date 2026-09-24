import { Input } from "./input"
import interact from "interactjs"

/**
 * Maintains a map of pressed keys.
 *
 * Produces events while key is pressed with elapsed time
 */
export class Keyboard {
  pressed = {}
  released = {}
  private readonly flipX: boolean
  private readonly disabled: boolean

  /**
   * 画布拖动的起止回调。
   *
   * 辅助线要求「仅在玩家拖动瞄准时显示」，只靠 move 事件做超时判断会在
   * 手指按住不动时误判为已松手，导致辅助线闪烁。interact.js 的 start/end
   * 能精确反映按住状态，因此把这两个时机透出去。
   */
  onDragStart?: () => void
  onDragEnd?: () => void

  /**
   * v1.3.76：本次手势是否应被**完全忽略**（既不改瞄准角、也不回调起止）。
   *
   * 场景：白球击球点面板展开时，用户点/滑主界面只是想把面板收起来。
   * 旧实现只在 onDragStart 里 return（少调一次 beginAimInteraction），
   * 但 interact.js 的 move 依旧会把 movementX/Y 攒进事件队列 ——
   * 瞄准角照样被转跑，「关面板 = 白瞄一次」。这里在 start 就判定，
   * 命中则整段 start/move/end 全部吞掉。
   */
  shouldIgnoreDrag?: () => boolean
  /** 本次手势已被判为忽略（start 置位，end 复位） */
  private dragSuppressed = false

  getEvents() {
    // v1.3.101：先跑一次贴边自转 —— getEvents 每帧由 container.processEvents 调用，
    // 手指停在边缘不动时 interact.js 的 move 不再触发，靠这里按帧补转动增量，
    // 才能实现「贴边持续转」。放在读取 released 之前，增量与拖拽位移同通道消费。
    this.edgeSpin()
    const result: Input[] = []

    Object.keys(this.released).forEach((key) =>
      result.push(new Input(this.released[key], key + "Up"))
    )

    this.released = {}
    return result
  }

  constructor(element: HTMLCanvasElement, opts: { disabled?: boolean } = {}) {
    this.flipX = new URLSearchParams(globalThis.location?.search).has("flip")
    this.disabled = opts.disabled ?? false
    this.addHandlers(element)
  }

  /**
   * v1.3.101：屏幕滑动瞄准 —— 手指顶到屏幕左右边缘后**继续转动**。
   *
   * 现象：interact.js 的 dx 来自手指实际位移，手指到了屏幕物理边缘就再也
   * 移不动，dx 恒为 0，于是瞄准角卡死 —— 想继续转也没法转。
   *
   * 改法：拖动中若指针停在屏幕左/右边缘带内且仍在移动状态，
   * 每帧按固定角速度注入一个转动增量，实现「贴着边缘持续转动」；
   * 指针离开边缘带或松手即停。
   *
   * v1.4.0：边缘界定放宽 + 渐进速度。旧版 EDGE_PX=6 —— 手指必须顶到
   * 屏幕物理边缘 6px 之内才触发，手机上（贴膜/手势条遮挡）几乎不可用，
   * 用户反馈「需要滑到屏幕最边缘才能触发，太苛刻」。现在：
   *   · 触发带放宽到 max(36px, 屏幕宽 12%)；
   *   · 带内**渐进加速**：刚进入带缓慢转，越靠近屏幕边缘转得越快
   *     （0.6×~2.0× 基准速度），手指停在带内任意位置都能持续转动，
   *     不必顶死到最边缘。
   *
   * 实现上借用同一套 movementX 通道 —— 把每帧要转的量折算成等效位移
   * （edgeSpinPx）塞进 released.movementX，下游 rotateAim 照常消费，
   * 无需改动控制器 / 相机等任何其它代码。方向：停在左边缘继续左转、
   * 右边缘继续右转（与手势方向一致）。
   */
  /** 触发带最小宽度（px）—— 小屏也不至于窄到难点 */
  private static readonly EDGE_MIN_PX = 36
  /** 触发带宽度占屏宽比例 —— 大屏按比例放宽 */
  private static readonly EDGE_FRACTION = 0.12
  /** 每帧贴边自转的基准等效位移（px/帧）。60fps 下折算约 0.9°/秒（与拖拽灵敏度同量级） */
  private static readonly EDGE_SPIN_PX = 2.4
  /** 是否处于拖动中（interact.js start→end 之间） */
  private dragging = false
  /** 本帧指针的屏幕 X 与视口宽度：用于判定是否停在左右边缘 */
  private pointerX = 0
  private viewportW = 0

  /** v1.3.101：拖动开始 —— 记录视口宽度与起始指针位置，开启贴边自转 */
  private beginDrag(e) {
    this.dragging = true
    this.viewportW = globalThis.innerWidth ?? 0
    if (e.client && typeof e.client.x === "number") {
      this.pointerX = e.client.x
    }
  }

  mousetouch = (e) => {
    const k = this.released
    const topHalf = e.client.y < e.rect.height / 2
    const factor = topHalf || e.ctrlKey ? 0.5 : 1
    const dx = e.dx * factor * (this.flipX ? -1 : 1)
    const dy = e.dy * 0.8
    k["movementY"] = (k["movementY"] ?? 0) + dy
    k["movementX"] = (k["movementX"] ?? 0) + dx
    if (Math.abs(k["movementX"]) > Math.abs(k["movementY"])) {
      k["movementY"] = 0
    }
    // 记录本帧指针位置，供 edgeSpin 判定「是否停在屏幕边缘」
    if (e.client && typeof e.client.x === "number") {
      this.pointerX = e.client.x
    }
  }

  /**
   * v1.4.0：拖动中每帧调用一次（由 getEvents 驱动）—— 指针停在屏幕左/右
   * 边缘带内时注入持续转动增量，带内渐进加速。手指静置边缘时 interact.js
   * 不再发 move，所以必须靠「每帧」这一节拍，而非依赖 move 事件。
   */
  private edgeSpin() {
    if (!this.dragging) return
    const vw = this.viewportW || (globalThis.innerWidth ?? 0)
    if (vw <= 0) return
    // v1.4.0：触发带 = max(36px, 屏宽 12%)，带内按「贴近边缘的深度」渐进加速
    const zone = Math.max(Keyboard.EDGE_MIN_PX, vw * Keyboard.EDGE_FRACTION)
    let dir = 0
    let depth = 0
    if (this.pointerX <= zone) {
      dir = -1
      depth = 1 - this.pointerX / zone
    } else if (this.pointerX >= vw - zone) {
      dir = 1
      depth = 1 - (vw - this.pointerX) / zone
    }
    if (dir === 0 || depth <= 0) return
    const speed = Keyboard.EDGE_SPIN_PX * (0.6 + 1.4 * Math.min(1, depth))
    const k = this.released
    // 与 mousetouch 的 dx 同源处理 flipX，保证「贴边转」与「拖拽转」方向一致
    k["movementX"] = (k["movementX"] ?? 0) + dir * speed * (this.flipX ? -1 : 1)
    // 纯横向自转：清零可能残留的纵向分量，避免贴边时视角漂移
    k["movementY"] = 0
  }

  private addHandlers(element: HTMLCanvasElement) {
    element.addEventListener("dragstart", (e) => e.preventDefault())

    // 悬浮 2D 控件（横向瞄准滑动条）位于 #viewP1 之内，
    // 若不排除，在其上拖动会同时触发画布拖动瞄准，角度被叠加两次。
    const ignoreFrom = ".aim-angle-bar, #helpOverlay"

    interact(element).draggable({
      mouseButtons: 1,
      ignoreFrom,
      listeners: {
        start: (e) => {
          // v1.3.76：整段手势吞掉，不改瞄准、也不回调起止
          if (this.shouldIgnoreDrag?.()) {
            this.dragSuppressed = true
            return
          }
          this.dragSuppressed = false
          this.beginDrag(e)
          this.onDragStart?.()
        },
        move: (e) => {
          if (this.dragSuppressed) return
          this.mousetouch(e)
        },
        end: () => {
          this.dragging = false
          if (this.dragSuppressed) {
            this.dragSuppressed = false
            return
          }
          this.onDragEnd?.()
        },
      },
    })
    interact(element).gesturable({
      ignoreFrom,
      onstart: (e) => {
        if (this.shouldIgnoreDrag?.()) {
          this.dragSuppressed = true
          return
        }
        this.dragSuppressed = false
        this.beginDrag(e)
        this.onDragStart?.()
      },
      onmove: (e) => {
        if (this.dragSuppressed) return
        e.dx /= 3
        this.mousetouch(e)
      },
      onend: () => {
        this.dragging = false
        if (this.dragSuppressed) {
          this.dragSuppressed = false
          return
        }
        this.onDragEnd?.()
      },
    })
  }
}
