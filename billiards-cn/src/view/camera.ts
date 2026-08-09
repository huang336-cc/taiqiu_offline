import { PerspectiveCamera, MathUtils, Vector3, Frustum, Matrix4 } from "three"
import { up, zero, unitAtAngle } from "../utils/three-utils"
import { AimEvent } from "../events/aimevent"
import { CameraTop } from "./cameratop"
import { R } from "../model/physics/constants"
import { Settings } from "../utils/settings"

export class Camera {
  // v1.1.42：第一人称（aimView）视野再次回调 —— v1.1.41 的 R*20/R*8 仍偏紧，
  // 在很多球位下看不到前方袋口和被击球；拉到 R*24/R*9，注视点从 +1.5R 抬到 +2R，
  // FOV 内能稳定框到「球杆前段 + 完整白球 + 被击球 + 前方袋口」四件套。
  static defaultHeight = R * 9
  static defaultDistance = R * 24
  static defaultFovOffset = 0

  // 横屏横向 FOV 上限（度）。超过该宽高比时收窄纵向 FOV，使横向 FOV 回到此值，
  // 球台在超宽屏（如 20:9 手机 2400×1080）上铺满宽度，避免两侧深色留白（黑边）。
  // 约对应 16:9 屏幕在纵向 40° 时的横向 FOV，更宽屏幕的取景与 16:9 一致。
  static readonly maxHorizontalFovDeg = 60

  static configureForRule(ruleType: string) {
    if (ruleType === "threecushion" || ruleType === "sagu") {
      Camera.defaultHeight = R * 23
      Camera.defaultDistance = R * 22
      Camera.defaultFovOffset = 6
      CameraTop.zoomFactor = 0.92
    }
  }

  constructor(aspectRatio) {
    this.camera = new PerspectiveCamera(45, aspectRatio, R, R * 1000)
  }

  camera: PerspectiveCamera
  mode = this.topView
  private mainMode = this.aimView
  private height = Camera.defaultHeight
  isZoomedOut = false

  private readonly target = new Vector3()
  private readonly lookTarget = new Vector3()
  private readonly tempVec = new Vector3()
  private readonly tempVec2 = new Vector3()

  private   distance = Camera.defaultDistance
  private fovOffset = Camera.defaultFovOffset
  savedDistance?: number

  /**
   * v1.2.6 #232：回放专用框定焦点。
   * 由 Replay 控制器在每一杆前写入 [白球, 被击球, 对应球袋] 三点，
   * replayFrameView 据此把相机摆到一个能同时看见这三者的视角（俯角观察，
   * 沿「白球→球袋」方向在后上方俯瞰），保证每次击球的视野都包含
   * 白球、被击球与对应进球的球袋。为空时回退到 topView。
   */
  replayFocus: Vector3[] | null = null

  elapsed: number
  private t = 0

  update(elapsed, aim: AimEvent) {
    this.elapsed = elapsed
    this.t += elapsed
    this.mode(aim)
  }

  orbitView(_: AimEvent) {
    this.camera.fov = this.adaptiveFov(45)
    const orbitR = R * 70
    const orbitH = R * 33
    this.target.set(
      Math.sin(this.t / 5) * orbitR,
      Math.cos(this.t / 5) * orbitR,
      orbitH + Math.sin(this.t / 19) * orbitH * 0.25
    )
    this.camera.position.lerp(this.target, 0.004)
    this.camera.up = up
    this.camera.lookAt(zero)
  }

  spectatorView(aim: AimEvent) {
    const h = 25 * R
    const pf = this.camera.aspect < 0.8 ? 3 : 1
    this.camera.fov = this.adaptiveFov(40)
    if (h < 10 * R) {
      const factor = 100 * (10 * R - h)
      this.camera.fov -= factor * pf
    }
    this.target
      .copy(aim.pos)
      .addScaledVector(
        unitAtAngle(aim.angle, this.tempVec),
        -(this.distance + R * 12)
      )
    this.camera.position.lerp(this.target, 0.1)
    this.camera.position.z = h
    this.camera.up = up
    this.lookTarget.lerp(
      this.tempVec2
        .copy(aim.pos)
        .addScaledVector(unitAtAngle(aim.angle, this.tempVec), R * 10),
      0.03
    )
    this.camera.lookAt(this.lookTarget)
  }

  topView(_: AimEvent) {
    this.camera.fov = CameraTop.fov
    this.camera.position.lerp(
      CameraTop.viewPoint(this.camera.aspect, this.camera.fov, this.tempVec),
      0.9
    )
    this.camera.up = up
    this.camera.lookAt(zero)
  }

  aimView(aim: AimEvent, fraction = 0.08) {
    const h = this.height
    const pf = this.camera.aspect < 0.8 ? 3 : 1
    this.camera.fov = this.adaptiveFov(40)
    if (h < 10 * R) {
      const factor = 100 * (10 * R - h)
      this.camera.fov -= factor * pf
    }
    this.target
      .copy(aim.pos)
      .addScaledVector(unitAtAngle(aim.angle, this.tempVec), -this.distance)
    this.camera.position.lerp(this.target, fraction)
    this.camera.position.z = h
    this.camera.up = up
    // v1.1.42：注视点从 +1.5R 抬到 +2R —— 让相机略抬头，更多地看「正前方」
    // （被击球、袋口）而不是白球脚下。配合 defaultDistance R*24 / height R*9，
    // FOV 锥在白球前方 5–20R 的高度稳定包住桌面。
    this.lookTarget.copy(aim.pos).addScaledVector(up, R * 2)
    this.camera.lookAt(this.lookTarget)
  }

  adjustHeight(delta) {
    delta = this.height < 10 * R ? delta / 8 : delta
    this.height = MathUtils.clamp(this.height + delta, R * 6, R * 120)
    if (this.height > R * 110) {
      this.suggestMode(this.topView)
    }
    if (this.height < R * 105) {
      this.suggestMode(this.aimView)
    }
  }

  adjustFov(delta: number) {
    this.fovOffset = MathUtils.clamp(this.fovOffset + delta, -30, 60)
  }

  // 依据宽高比自适应纵向 FOV：竖屏（aspect<0.8）保持 60°；横屏在横向 FOV 超过
  // maxHorizontalFovDeg 时收窄纵向 FOV，使横向 FOV 回到上限，球台在超宽屏铺满宽度。
  private adaptiveFov(baseLandscapeFov: number): number {
    const aspect = this.camera.aspect
    if (aspect < 0.8) {
      // 竖屏：纵向取较宽值，保持原行为
      return 60 + this.fovOffset
    }
    const baseFov = baseLandscapeFov + this.fovOffset
    const hRad = 2 * Math.atan(Math.tan((baseFov * Math.PI) / 180 / 2) * aspect)
    const hDeg = (hRad * 180) / Math.PI
    if (hDeg <= Camera.maxHorizontalFovDeg) {
      return baseFov
    }
    const targetHRad = (Camera.maxHorizontalFovDeg * Math.PI) / 180
    const vRad = 2 * Math.atan(Math.tan(targetHRad / 2) / aspect)
    return (vRad * 180) / Math.PI
  }

  adjustDistance(delta: number) {
    delta = this.distance < 10 * R ? delta / 8 : delta
    this.distance = MathUtils.clamp(this.distance + delta, R * 2, R * 100)
  }

  restoreSavedDistance() {
    if (this.savedDistance !== undefined) {
      this.distance = this.savedDistance
      this.savedDistance = undefined
    }
  }

  private computeStepBackFov(h: number): number {
    const pf = this.camera.aspect < 0.8 ? 3 : 1
    const tempFov = this.adaptiveFov(40)
    const fov = h < 10 * R ? tempFov - 100 * (10 * R - h) * pf : tempFov
    return fov - 3
  }

  private areAllBallsInFrustum(frustum: Frustum, balls: any[]): boolean {
    for (const b of balls) {
      if (!b.onTable()) continue
      const mesh = b.ballmesh?.mesh
      const inFrustum = mesh
        ? frustum.intersectsObject(mesh)
        : frustum.containsPoint(b.pos)
      if (!inFrustum) {
        return false
      }
    }
    return true
  }

  private tryDistanceFit(
    testDistance: number,
    h: number,
    aim: AimEvent,
    frustum: Frustum,
    projScreenMatrix: Matrix4,
    balls: any[]
  ): boolean {
    const targetPos = this.tempVec2
      .copy(aim.pos)
      .addScaledVector(unitAtAngle(aim.angle, this.tempVec), -testDistance)

    this.camera.position.copy(targetPos)
    this.camera.position.z = h
    this.camera.up.copy(up)

    const tempLookTarget = this.tempVec.copy(aim.pos).addScaledVector(up, h / 2)

    this.camera.lookAt(tempLookTarget)
    this.camera.updateMatrixWorld(true)
    this.camera.matrixWorldInverse.copy(this.camera.matrixWorld).invert()

    projScreenMatrix.multiplyMatrices(
      this.camera.projectionMatrix,
      this.camera.matrixWorldInverse
    )
    frustum.setFromProjectionMatrix(projScreenMatrix)

    return this.areAllBallsInFrustum(frustum, balls)
  }

  stepBackToFitAllBalls(balls: any[], aim: AimEvent) {
    const frustum = new Frustum()
    const projScreenMatrix = new Matrix4()

    const h = this.height
    const fov = this.computeStepBackFov(h)

    const originalPosition = this.camera.position.clone()
    const originalRotation = this.camera.rotation.clone()
    const originalMatrixWorld = this.camera.matrixWorld.clone()
    const originalMatrixWorldInverse = this.camera.matrixWorldInverse.clone()
    const originalProjectionMatrix = this.camera.projectionMatrix.clone()
    const originalFov = this.camera.fov

    this.camera.fov = fov
    this.camera.updateProjectionMatrix()

    let foundDistance = this.distance
    const maxDistance = R * 120
    const step = R

    for (let d = this.distance; d <= maxDistance; d += step) {
      if (this.tryDistanceFit(d, h, aim, frustum, projScreenMatrix, balls)) {
        foundDistance = d
        break
      }
    }

    // Restore original camera state
    this.camera.position.copy(originalPosition)
    this.camera.rotation.copy(originalRotation)
    this.camera.matrixWorld.copy(originalMatrixWorld)
    this.camera.matrixWorldInverse.copy(originalMatrixWorldInverse)
    this.camera.projectionMatrix.copy(originalProjectionMatrix)
    this.camera.fov = originalFov

    if (foundDistance !== this.distance) {
      if (this.savedDistance === undefined) {
        this.savedDistance = this.distance
      }
      this.distance = foundDistance
    }
  }

  suggestMode(mode) {
    if (mode !== this.aimView) {
      this.restoreSavedDistance()
    }
    if (this.mainMode === this.aimView) {
      this.mode = mode
      this.isZoomedOut = false
      this.updateCameraButtonClass(mode === this.topView ? "topview" : "aim")
    }
    if (
      this.mainMode === this.spectatorView &&
      (mode === this.topView || mode === this.spectatorView)
    ) {
      this.mode = mode
      this.isZoomedOut = false
      this.updateCameraButtonClass(mode === this.topView ? "topview" : "aim")
    }
  }

  forceMode(mode) {
    if (mode !== this.aimView) {
      this.restoreSavedDistance()
    }
    this.mode = mode
    this.mainMode = mode
    this.isZoomedOut = false
    this.updateCameraButtonClass(mode === this.topView ? "topview" : "aim")
  }

  forceMove(aim: AimEvent) {
    if (this.mode === this.aimView) {
      this.aimView(aim, 1)
    }
  }

  /**
   * v1.2.6 #232：设定回放框定三点（白球 / 被击球 / 对应球袋），
   * 并把相机切到 replayFrameView 模式。每杆前由 Replay 调用。
   */
  setReplayFrame(points: Vector3[]) {
    if (!points || points.length === 0) return
    this.replayFocus = points
    this.mode = this.replayFrameView
    this.mainMode = this.replayFrameView
    this.isZoomedOut = false
    this.updateCameraButtonClass("topview")
  }

  /** v1.2.6 #232：清除回放框定，相机回到常规模式由调用方决定 */
  clearReplayFrame() {
    this.replayFocus = null
  }

  /**
   * v1.2.6 #232：回放帧定相机。
   * 以三点质心为注视中心，按「能框住三者包围圆」计算距离，沿
   * 「白球→球袋」方向在后上方以约 40° 俯角俯瞰，保证白球、被击球、
   * 对应球袋同时入镜。每帧 lerp 平滑过渡，避免镜头突跳。
   */
  replayFrameView(_aim: AimEvent) {
    const pts = this.replayFocus
    if (!pts || pts.length === 0) {
      this.topView(_aim)
      return
    }
    const n = pts.length
    let cx = 0
    let cy = 0
    for (const p of pts) {
      cx += p.x
      cy += p.y
    }
    cx /= n
    cy /= n
    let radius = 0
    for (const p of pts) {
      radius = Math.max(radius, Math.hypot(p.x - cx, p.y - cy))
    }
    radius += R * 3 // 留白，确保三颗球不贴边

    const fovV = (this.adaptiveFov(45) * Math.PI) / 180
    const fovH = 2 * Math.atan(Math.tan(fovV / 2) * this.camera.aspect)
    const fitV = radius / Math.tan(fovV / 2)
    const fitH = radius / Math.tan(fovH / 2)
    const dist = Math.max(fitV, fitH) * 1.12

    // 观察方向：白球(pts[0]) → 球袋(pts[2])，相机置于其反方向后上方
    let dirx = 0
    let diry = 1
    if (n >= 3) {
      dirx = pts[2].x - pts[0].x
      diry = pts[2].y - pts[0].y
      const len = Math.hypot(dirx, diry) || 1
      dirx /= len
      diry /= len
    }
    const elevation = 0.72 // ≈41° 俯角
    const horiz = dist * Math.cos(elevation)
    const vert = dist * Math.sin(elevation) + R * 4

    const target = this.tempVec.set(cx, cy, 0)
    const camPos = this.tempVec2.set(
      cx - dirx * horiz,
      cy - diry * horiz,
      vert
    )
    this.camera.position.lerp(camPos, 0.12)
    this.camera.up.copy(up)
    this.lookTarget.lerp(target, 0.12)
    this.camera.lookAt(this.lookTarget)
  }

  cycleModeToAimz(balls: any[], aim: AimEvent) {
    this.mode = this.aimView
    this.mainMode = this.aimView
    this.stepBackToFitAllBalls(balls, aim)
    if (this.savedDistance === undefined) {
      this.isZoomedOut = false
      this.updateCameraButtonClass("aim")
    } else {
      this.isZoomedOut = true
      this.updateCameraButtonClass("aimz")
    }
  }

  cycleMode(balls: any[], aim: AimEvent) {
    // v1.1.8：关闭「保留三个视角」时，只在第一/二人称（跟随 / 俯视）间切换，
    // 跳过母球视角（aimz 拉远），避免不想要的拉远操作。
    const keepAll = Settings.get().keepAllViews
    if (!keepAll) {
      if (this.mode === this.topView) {
        this.restoreSavedDistance()
        this.mode = this.aimView
        this.mainMode = this.aimView
        this.isZoomedOut = false
        this.updateCameraButtonClass("aim")
      } else {
        this.restoreSavedDistance()
        this.mode = this.topView
        this.mainMode = this.topView
        this.isZoomedOut = false
        this.updateCameraButtonClass("topview")
      }
      return
    }
    if (this.mode === this.aimView && !this.isZoomedOut) {
      this.stepBackToFitAllBalls(balls, aim)
      if (this.savedDistance === undefined) {
        // All balls already in view — skip aimz, go straight to topview
        this.mode = this.topView
        this.mainMode = this.topView
        this.updateCameraButtonClass("topview")
      } else {
        this.isZoomedOut = true
        this.updateCameraButtonClass("aimz")
      }
    } else if (this.mode === this.aimView && this.isZoomedOut) {
      this.restoreSavedDistance()
      this.mode = this.topView
      this.mainMode = this.topView
      this.isZoomedOut = false
      this.updateCameraButtonClass("topview")
    } else {
      this.restoreSavedDistance()
      this.mode = this.aimView
      this.mainMode = this.aimView
      this.isZoomedOut = false
      this.updateCameraButtonClass("aim")
    }
  }

  private updateCameraButtonClass(state: "aim" | "aimz" | "topview") {
    const btn = document.getElementById("camera")
    if (btn) {
      btn.classList.remove("aim", "aimz", "topview")
      btn.classList.add(state)
      // v1.1.59：只更新模式指示子元素 .cam-mode，绝不整体替换 btn.textContent。
      // 之前用 emoji（🎥ᶻ / 🎥ᵀ）整体覆盖按钮，会把精心做好的奶白 SVG 图标抹掉，
      // 而 Android WebView 会把 emoji 渲染成系统默认黄/金色 → 相机图标变金。
      // 现在保留 SVG，仅切换 class + 更新 ᶻ/ᵀ 文本，颜色完全交给 CSS 控制。
      const mode = btn.querySelector(".cam-mode")
      if (mode) {
        mode.textContent = state === "aimz" ? "ᶻ" : state === "topview" ? "ᵀ" : ""
      }
    }
  }

  toggleMode() {
    this.restoreSavedDistance()
    this.isZoomedOut = false
    if (this.mode === this.topView) {
      this.mode = this.aimView
      this.updateCameraButtonClass("aim")
    } else {
      this.mode = this.topView
      this.updateCameraButtonClass("topview")
    }
    this.mainMode = this.mode
  }
}
