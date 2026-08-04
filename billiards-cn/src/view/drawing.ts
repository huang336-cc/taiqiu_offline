import {
  Scene,
  Vector3,
  Vector2,
  Raycaster,
  Plane,
  Line,
  BufferGeometry,
  LineBasicMaterial,
  Color,
  Camera,
} from "three"
import { LineData } from "../events/chatevent"
import { Session } from "../network/client/session"
import { Ball } from "../model/ball"
import { R } from "../model/physics/constants"

export class Drawing {
  private readonly scene: Scene
  private readonly canvas: HTMLCanvasElement
  private readonly camera: () => Camera
  private readonly raycaster = new Raycaster()
  private readonly tablePlane = new Plane(new Vector3(0, 0, 1), 0)
  private readonly lines: Line[] = []
  private readonly balls: () => Ball[]

  private isDrawing = false
  private startPoint: Vector3 | null = null
  private previewLine: Line | null = null

  onLineDrawn?: (line: LineData) => void
  onBallTap?: (ball: Ball) => void

  constructor(scene: Scene, canvas: HTMLCanvasElement, camera: () => Camera, balls: () => Ball[]) {
    this.scene = scene
    this.canvas = canvas
    this.camera = camera
    this.balls = balls
    this.addListeners()
  }

  private addListeners() {
    if (!this.canvas) return
    this.canvas.addEventListener("pointerdown", this.onPointerDown)
  }

  private toTable(clientX: number, clientY: number): Vector3 | null {
    const rect = this.canvas.getBoundingClientRect()
    const ndc = new Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1
    )
    this.raycaster.setFromCamera(ndc, this.camera())
    const hit = new Vector3()
    return this.raycaster.ray.intersectPlane(this.tablePlane, hit) ? hit : null
  }

  /**
   * 指针按下：
   * - 左键 / 触摸：点击球体自动将球杆对准该球（点击瞄准）
   * - 右键：起笔画战术线
   *
   * 注意：此前这里误写成两个同名的 onPointerDown 字段，后者直接覆盖前者，
   * 导致「点击球自动对准」完全失效。必须合并为一个处理函数。
   */
  private onPointerDown = (e: PointerEvent) => {
    if (e.button === 2) {
      const point = this.toTable(e.clientX, e.clientY)
      if (point) {
        this.isDrawing = true
        this.startPoint = point
        this.canvas.setPointerCapture(e.pointerId)
      }
      return
    }
    if (e.button !== 0) return
    const point = this.toTable(e.clientX, e.clientY)
    if (!point) return
    // 找到点击位置最近的球（放宽到 2.2R，手指点击精度有限）
    const balls = this.balls()
    const cueball = balls[0]
    let closest: Ball | null = null
    let closestDist = Infinity
    for (const ball of balls) {
      if (ball === cueball) continue
      if (!ball.onTable()) continue
      const d = ball.pos.distanceTo(point)
      if (d < R * 2.2 && d < closestDist) {
        closestDist = d
        closest = ball
      }
    }
    if (closest) {
      this.onBallTap?.(closest)
    }
  }

  private onPointerMove = (e: PointerEvent) => {
    if (!this.isDrawing || !this.startPoint) return
    const endPoint = this.toTable(e.clientX, e.clientY)
    if (endPoint) {
      this.updatePreview(this.startPoint, endPoint)
    }
  }

  private onPointerUp = (e: PointerEvent) => {
    if (!this.isDrawing || !this.startPoint) return
    this.isDrawing = false
    const endPoint = this.toTable(e.clientX, e.clientY)
    if (endPoint && this.startPoint.distanceTo(endPoint) > 0.01) {
      const lineData: LineData = {
        p1: { x: this.startPoint.x, y: this.startPoint.y },
        p2: { x: endPoint.x, y: endPoint.y },
        colour: Session.playerIndex() === 1 ? "#ffaa11" : "#ffffff",
      }
      this.onLineDrawn?.(lineData)
      this.addLine(lineData)
    }
    this.removePreview()
    this.canvas.releasePointerCapture(e.pointerId)
  }

  private updatePreview(p1: Vector3, p2: Vector3) {
    if (!this.previewLine) {
      const geometry = new BufferGeometry().setFromPoints([
        p1.clone().add(new Vector3(0, 0, 0.001)),
        p2.clone().add(new Vector3(0, 0, 0.001)),
      ])
      const material = new LineBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.5,
      })
      this.previewLine = new Line(geometry, material)
      this.scene.add(this.previewLine)
    } else {
      this.previewLine.geometry.setFromPoints([
        p1.clone().add(new Vector3(0, 0, 0.001)),
        p2.clone().add(new Vector3(0, 0, 0.001)),
      ])
    }
  }

  private removePreview() {
    if (this.previewLine) {
      this.scene.remove(this.previewLine)
      this.previewLine.geometry.dispose()
      ;(this.previewLine.material as LineBasicMaterial).dispose()
      this.previewLine = null
    }
  }

  addLine(data: LineData) {
    const p1 = new Vector3(data.p1.x, data.p1.y, 0.001) // Slightly above table
    const p2 = new Vector3(data.p2.x, data.p2.y, 0.001)
    const geometry = new BufferGeometry().setFromPoints([p1, p2])
    const material = new LineBasicMaterial({
      color: new Color(data.colour),
      opacity: 0.25,
      linewidth: 2,
      transparent: true,
    })
    const line = new Line(geometry, material)
    this.scene.add(line)
    this.lines.push(line)
  }

  undo() {
    const line = this.lines.pop()
    if (line) {
      this.scene.remove(line)
      line.geometry.dispose()
      ;(line.material as LineBasicMaterial).dispose()
    }
  }

  clear() {
    this.lines.forEach((line) => {
      this.scene.remove(line)
      line.geometry.dispose()
      ;(line.material as LineBasicMaterial).dispose()
    })
    this.lines.length = 0
  }
}
