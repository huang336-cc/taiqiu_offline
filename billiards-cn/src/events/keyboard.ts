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

    interact(element).draggable({
      mouseButtons: 1,
      listeners: {
        start: () => {
          this.onDragStart?.()
        },
        move: (e) => {
          this.mousetouch(e)
        },
        end: () => {
          this.onDragEnd?.()
        },
      },
    })
    interact(element).gesturable({
      onstart: () => {
        this.onDragStart?.()
      },
      onmove: (e) => {
        e.dx /= 3
        this.mousetouch(e)
      },
      onend: () => {
        this.onDragEnd?.()
      },
    })
  }
}
