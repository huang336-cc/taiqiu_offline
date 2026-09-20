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
        start: () => {
          // v1.3.76：整段手势吞掉，不改瞄准、也不回调起止
          if (this.shouldIgnoreDrag?.()) {
            this.dragSuppressed = true
            return
          }
          this.dragSuppressed = false
          this.onDragStart?.()
        },
        move: (e) => {
          if (this.dragSuppressed) return
          this.mousetouch(e)
        },
        end: () => {
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
      onstart: () => {
        if (this.shouldIgnoreDrag?.()) {
          this.dragSuppressed = true
          return
        }
        this.dragSuppressed = false
        this.onDragStart?.()
      },
      onmove: (e) => {
        if (this.dragSuppressed) return
        e.dx /= 3
        this.mousetouch(e)
      },
      onend: () => {
        if (this.dragSuppressed) {
          this.dragSuppressed = false
          return
        }
        this.onDragEnd?.()
      },
    })
  }
}
