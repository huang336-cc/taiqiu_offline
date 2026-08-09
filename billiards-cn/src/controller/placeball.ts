import { ControllerBase } from "./controllerbase"
import { Controller, Input } from "./controller"
import { Aim } from "./aim"
import { BreakEvent } from "../events/breakevent"
import { R } from "../model/physics/constants"
import { Vector3, Raycaster, Plane, Vector2 } from "three"
import { CueMesh } from "../view/cuemesh"
import { CameraTop } from "../view/cameratop"
import { T } from "../utils/i18n"

/**
 * Place cue ball using input events.
 *
 * Needs to be configurable to break place ball and post foul place ball anywhere legal.
 */
export class PlaceBall extends ControllerBase {
  override get name() {
    return "PlaceBall"
  }
  readonly placescale = 0.02 * R
  private readonly startPos: Vector3 | undefined
  private readonly raycaster = new Raycaster()
  private readonly tablePlane = new Plane(new Vector3(0, 0, 1), 0)
  private removeListeners: (() => void) | null = null

  constructor(container, startPos?: Vector3) {
    super(container)
    this.startPos = startPos
    this.container.table.cue.moveTo(this.container.table.cueball.pos)
    this.container.view.camera.forceMode(this.container.view.camera.topView)
  }

  override onFirst() {
    const cueball = this.container.table.cueball
    if (this.container.rules.allowsPlaceBall()) {
      if (this.startPos) {
        cueball.pos.copy(this.container.rules.placeBall(this.startPos.clone()))
      } else {
        cueball.pos.copy(this.container.rules.placeBall())
      }
    }
    cueball.setStationary()
    cueball.updateMesh(0)
    this.container.table.cue.placeBallMode()
    this.container.table.cue.showHelper(false)
    this.container.table.cue.moveTo(this.container.table.cueball.pos)
    this.container.table.cue.aimInputs.setButtonText(T.placeBallButton)
    this.container.table.cue.aimInputs.setDisabled(false)
    this.addTableClickListener()
    if (!this.container.rules.allowsPlaceBall()) {
      this.container.inputQueue.push(new Input(1, "SpaceUp"))
    }
  }

  /**
   * 任务7：犯规后摆白球时，允许点击/拖拽球桌任意位置把白球移过去。
   * 监听 canvas 的 pointer 事件，用 raycast 把屏幕坐标映射到球桌平面 (z=0)。
   */
  private addTableClickListener() {
    const canvas = this.container.view.element as HTMLElement
    const camera = this.container.view.camera.camera
    let dragging = false

    const toTable = (clientX: number, clientY: number): Vector3 | null => {
      const rect = canvas.getBoundingClientRect()
      const ndc = new Vector2(
        ((clientX - rect.left) / rect.width) * 2 - 1,
        -((clientY - rect.top) / rect.height) * 2 + 1
      )
      this.raycaster.setFromCamera(ndc, camera)
      const hit = new Vector3()
      return this.raycaster.ray.intersectPlane(this.tablePlane, hit)
        ? hit
        : null
    }

    const moveCueTo = (clientX: number, clientY: number) => {
      const tablePos = toTable(clientX, clientY)
      if (!tablePos) return
      const cueball = this.container.table.cueball
      tablePos.copy(this.container.rules.placeBall(tablePos))
      cueball.pos.copy(tablePos)
      cueball.fround()
      CueMesh.indicateValid(!this.container.table.overlapsAny(cueball.pos))
      this.container.table.cue.moveTo(cueball.pos)
      this.container.view.camera.forceMove(this.container.table.cue.aim)
    }

    const onPointerDown = (e: PointerEvent) => {
      dragging = true
      canvas.setPointerCapture?.(e.pointerId)
      moveCueTo(e.clientX, e.clientY)
    }
    const onPointerMove = (e: PointerEvent) => {
      if (!dragging) return
      moveCueTo(e.clientX, e.clientY)
    }
    const stopDrag = (e: PointerEvent) => {
      dragging = false
      try {
        canvas.releasePointerCapture?.(e.pointerId)
      } catch {
        // 忽略释放失败
      }
    }

    canvas.addEventListener("pointerdown", onPointerDown)
    canvas.addEventListener("pointermove", onPointerMove)
    canvas.addEventListener("pointerup", stopDrag)
    canvas.addEventListener("pointercancel", stopDrag)

    this.removeListeners = () => {
      canvas.removeEventListener("pointerdown", onPointerDown)
      canvas.removeEventListener("pointermove", onPointerMove)
      canvas.removeEventListener("pointerup", stopDrag)
      canvas.removeEventListener("pointercancel", stopDrag)
    }
  }

  private cleanupTableClickListener() {
    this.removeListeners?.()
    this.removeListeners = null
  }

  override handleInput(input: Input): Controller {
    const ballPos = this.container.table.cueball.pos
    switch (input.key) {
      case "ArrowLeft":
        this.moveTo(0, input.t * this.placescale)
        break
      case "ArrowRight":
        this.moveTo(0, -input.t * this.placescale)
        break
      // use cursor movement for placing cueball
      case "movementXUp":
        this.handleMovement(input.t * 4, 0)
        break
      case "movementYUp":
        this.handleMovement(0, input.t * 4)
        break
      case "SpaceUp":
        return this.placed()
      default:
        this.commonKeyHandler(input)
    }

    this.container.table.cue.moveTo(ballPos)
    this.container.view.camera.forceMove(this.container.table.cue.aim)
    this.container.sendEvent(this.container.table.cue.aim)

    return this
  }

  handleMovement(dx: number, dy: number) {
    const aspect = this.container.view.camera.camera.aspect
    if (aspect > CameraTop.portrait) {
      this.moveTo(dx * this.placescale, -dy * this.placescale)
    } else {
      this.moveTo(-dy * this.placescale, -dx * this.placescale)
    }
  }

  moveTo(dx, dy) {
    const delta = new Vector3(dx, dy)
    const ballPos = this.container.table.cueball.pos.add(delta)
    ballPos.copy(this.container.rules.placeBall(ballPos))
    this.container.table.cueball.fround()
    CueMesh.indicateValid(!this.container.table.overlapsAny(ballPos))
  }

  placed() {
    if (this.container.table.overlapsAny(this.container.table.cueball.pos)) {
      return this
    }
    this.cleanupTableClickListener()
    this.container.table.cueball.fround()
    this.container.table.cue.aimInputs.setButtonText(T.hitButton)
    this.container.sendEvent(
      new BreakEvent(this.container.table.shortSerialise())
    )
    this.container.view.camera.forceMode(this.container.view.camera.aimView)
    return new Aim(this.container)
  }
}
