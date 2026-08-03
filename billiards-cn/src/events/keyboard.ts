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
        move: (e) => {
          this.mousetouch(e)
        },
      },
    })
    interact(element).gesturable({
      onmove: (e) => {
        e.dx /= 3
        this.mousetouch(e)
      },
    })
  }
}
