import { PerspectiveCamera, MathUtils, Vector3, Frustum, Matrix4 } from "three"
import { up, zero, unitAtAngle } from "../utils/three-utils"
import { AimEvent } from "../events/aimevent"
import { CameraTop } from "./cameratop"
import { R } from "../model/physics/constants"
import { Settings } from "../utils/settings"

/**
 * v1.3.58：回放机位锚点。每一杆击球前由三点框定算一次，出杆后锁定。
 */
interface ReplayAnchor {
  /** 注视中心（三点质心，z 恒为 0） */
  center: Vector3
  /** 框定距离，微调期间保持不变，避免画面忽远忽近 */
  dist: number
  /** dist·cos(REPLAY_ELEVATION)，缓存省一次三角函数 */
  horiz: number
  /** 基准方位角：相机位于 center 的 -dir 方向 */
  yaw: number
  /** 基准高度（z） */
  lift: number
}

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
  /** v1.3.58：回放微调做 NDC 投影时用的暂存向量（tempVec/tempVec2 已被框定占用） */
  private readonly tempVec3 = new Vector3()

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

  /**
   * v1.3.58：回放机位锚点 —— 每一杆击球前算一次，出杆后锁定不再变。
   * 原先 replayFrameView 每帧都按 replayFocus 重新框定，焦点一变镜头就跟着
   * 大幅移动，观感是「镜头乱飞」。现在把框定结果冻结成锚点，只有 nudge
   * 三项微调量会动它，从而实现「出杆后默认锁定机位」。
   */
  private replayAnchor: ReplayAnchor | null = null

  /**
   * v1.3.58：回放需要额外看清的点（通常是「后续进球」的球或袋口）。
   * null 表示锁定机位、不做任何微调。由 Replay 每帧写入。
   */
  replayNudge: Vector3 | null = null

  /** 回放微调的当前值与目标值：绕 center 的方位角偏移、额外抬升、注视点平移 */
  private replayNudgeYaw = 0
  private replayNudgeLift = 0
  private readonly replayNudgeLook = new Vector3()
  private replayNudgeYawTarget = 0
  private replayNudgeLiftTarget = 0
  private readonly replayNudgeLookTarget = new Vector3()

  /** 回放框定的俯角（弧度），约 41° */
  private static readonly REPLAY_ELEVATION = 0.72
  /** 微调的角度上限（弧度，约 32°）—— 再大就不是「适度微调」而是重新框定了 */
  private static readonly REPLAY_NUDGE_MAX_YAW = 0.56
  /** 微调的抬升上限（R 的倍数） */
  private static readonly REPLAY_NUDGE_MAX_LIFT = 14
  /** 微调的注视点平移上限（R 的倍数） */
  private static readonly REPLAY_NUDGE_MAX_LOOK = 12
  /**
   * 微调的平滑系数：每帧只朝目标推进 2%，60fps 下约 0.8 秒走完全程。
   * 这是「平滑缓动、不剧烈跳转」的关键 —— 即便目标突变，镜头也是缓缓跟过去。
   */
  private static readonly REPLAY_NUDGE_LERP = 0.02
  /** 判定「还在安全视野内」的 NDC 阈值，超出才需要微调 */
  private static readonly REPLAY_NUDGE_SAFE_NDC = 0.72

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

  /**
   * v1.3.60：以指定中心点为俯视视线锚点的「聚焦俯视」。
   * 与 topView 不同：相机不放在「(0, -εR, dist)」看原点，而是抬到
   * `center.x, center.y, center.z + dist(radius)` 看 center。
   * 半径 radius 决定相机高度，保证整个 focus 包围圆始终在画面里。
   * 与 Racer 的 frameCameraForShot 俯视分支配对使用。
   */
  topViewAtCenter(center: Vector3, radius: number) {
    this.camera.fov = CameraTop.fov
    const fovRad = (this.camera.fov * Math.PI) / 180
    const tanHalf = Math.tan(fovRad / 2)
    const aspect = Math.max(0.6, this.camera.aspect)
    // 竖直俯视时，纵向半视野 = dist·tan(fov/2)，横向半视野 = 上式 × aspect。
    // 要装下半径 radius 的外接圆，取两者中更紧的那个（宽屏看纵向，竖屏看横向）。
    const distV = radius / tanHalf
    const distH = radius / (tanHalf * aspect)
    // 15% 边距，避免球贴着画面边缘
    const finalDist = Math.max(distV, distH) * 1.15
    const cx = center.x ?? 0
    const cy = center.y ?? 0
    // v1.3.60：这个 -0.01·R 的横向偏移是**必须的**，不是随手写的微调。
    // up 是 (0,0,1)（Z 轴朝上），而俯视的视线方向恰好也是 (0,0,±1)——两者严格
    // 平行会让 lookAt 构造正交基时的叉乘为零，相机朝向退化成未定义（画面乱转
    // 或直接黑屏）。原版 CameraTop.viewPoint 同样靠一个 -0.01·R 的偏移躲开这个
    // 奇异点，这里照抄同样的手法。
    this.camera.position.set(cx, cy - 0.01 * R, finalDist)
    this.camera.up = up
    this.camera.lookAt(cx, cy, 0)
  }

  aimView(aim: AimEvent, fraction = 0.08) {
    const h = this.height
    const pf = this.camera.aspect < 0.8 ? 3 : 1
    // v1.2.33：瞄准视角放宽横向 FOV 上限到 80°。
    // 原 60° 在 iPhone 横屏/超宽屏（可视高度被底部工具栏压缩）下会过度收窄
    // 纵向 FOV，导致白球前方的被击球被切出画面上方。80° 在保留 16:9 观感
    // 的同时，给超宽屏留出足够纵向视野。
    this.camera.fov = this.adaptiveFov(40, 80)
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
  // v1.2.33：新增可选 maxH 参数，供 aimView 等需要更宽纵向视野的模式单独调用。
  private adaptiveFov(baseLandscapeFov: number, maxH?: number): number {
    const aspect = this.camera.aspect
    if (aspect < 0.8) {
      // 竖屏：纵向取较宽值，保持原行为
      return 60 + this.fovOffset
    }
    const baseFov = baseLandscapeFov + this.fovOffset
    const hRad = 2 * Math.atan(Math.tan((baseFov * Math.PI) / 180 / 2) * aspect)
    const hDeg = (hRad * 180) / Math.PI
    const maxHorizontal = maxH ?? Camera.maxHorizontalFovDeg
    if (hDeg <= maxHorizontal) {
      return baseFov
    }
    const targetHRad = (maxHorizontal * Math.PI) / 180
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
} else if (this.mode === this.replayFrameView) {
// v1.3.58：回放每杆击球前调用 —— fraction=1 表示不做插值，
// 一次性把相机摆到本杆机位，实现「每一杆击球前完成相机定位」。
this.replayFrameView(aim, 1)
}
}

  /**
   * v1.2.6 #232：设定回放框定三点（白球 / 被击球 / 对应球袋），
   * 并把相机切到 replayFrameView 模式。每杆前由 Replay 调用。
   */
setReplayFrame(points: Vector3[]) {
if (!points || points.length === 0) return
this.replayFocus = points
// v1.3.58：每杆重新框定 = 丢弃旧锚点，让 replayFrameView 按新三点重建。
// 配合紧随其后的 forceMove()，实现「下一杆击球时重新完整定位机位」。
this.replayAnchor = null
this.resetReplayNudge()
this.mode = this.replayFrameView
this.mainMode = this.replayFrameView
this.isZoomedOut = false
this.updateCameraButtonClass("topview")
}

/** v1.2.6 #232：清除回放框定，相机回到常规模式由调用方决定 */
clearReplayFrame() {
this.replayFocus = null
this.replayAnchor = null
this.resetReplayNudge()
}

/**
* v1.2.11 #user：仅更新回放框定焦点，不切换相机模式。
* v1.3.58：焦点变化意味着重新框定，锚点一并作废重建，
* 否则镜头会继续沿用旧机位、看上去像没生效。
*/
updateReplayFocus(points: Vector3[]) {
if (!points || points.length === 0) return
this.replayFocus = points
this.replayAnchor = null
}

/** v1.3.58：设置回放微调目标点（后续需要看清的进球位置）。null = 锁定机位。 */
setReplayNudge(point: Vector3 | null) {
this.replayNudge = point
}

/** v1.3.58：清空微调目标并把三项微调量瞬间归零（切杆 / 退出回放时用） */
private resetReplayNudge(): void {
this.replayNudge = null
this.replayNudgeYaw = 0
this.replayNudgeLift = 0
this.replayNudgeYawTarget = 0
this.replayNudgeLiftTarget = 0
this.replayNudgeLook.set(0, 0, 0)
this.replayNudgeLookTarget.set(0, 0, 0)
}

/**
* v1.3.58：按三点（白球 / 被击球 / 目标袋口）算出本杆的机位锚点。
* 逻辑与旧 replayFrameView 的框定完全一致，只是把结果固化下来：
* 注视中心 = 三点质心，距离 = 能框住三者包围圆的距离，
* 方位角 = 白球→袋口方向，相机置于其反方向的后上方。
*/
private buildReplayAnchor(pts: Vector3[]) {
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

let dirx = 0
let diry = 1
if (n >= 3) {
dirx = pts[2].x - pts[0].x
diry = pts[2].y - pts[0].y
const len = Math.hypot(dirx, diry) || 1
dirx /= len
diry /= len
}
const horiz = dist * Math.cos(Camera.REPLAY_ELEVATION)
return {
center: new Vector3(cx, cy, 0),
dist,
horiz,
yaw: Math.atan2(diry, dirx),
lift: dist * Math.sin(Camera.REPLAY_ELEVATION) + R * 4,
}
}

/**
* v1.3.58：推进回放微调量。
*
* - 没有 nudge 点 → 目标归零，镜头缓缓回到本杆击球前锁定的机位；
* - nudge 点已在安全视野内 → 同样归零，一动不如一静；
* - nudge 点快出画 → 只推「绕注视中心的方位角 + 相机高度 + 注视点平移」
*   三项，且各自限幅。注意这里**不改距离**，所以远近距离感始终稳定。
* 三项都用 2% 的系数朝目标逼近，即便目标突变镜头也是平滑缓动，不会跳切。
*/
private stepReplayNudge(anchor: ReplayAnchor): void {
const p = this.replayNudge
let need = false
if (p) {
const ndc = this.tempVec3.copy(p).project(this.camera)
// z > 1 表示点在远平面之外（背后或太远），同样视为需要跟
need =
ndc.z > 1 ||
Math.abs(ndc.x) > Camera.REPLAY_NUDGE_SAFE_NDC ||
Math.abs(ndc.y) > Camera.REPLAY_NUDGE_SAFE_NDC
if (need) {
// 方位角：把 nudge 点转回画面中央。相机在 center 的 -dir 侧，
// 因此只需取「目标方位 - 基准方位」反向的一半，就能把点拉回中部。
const toYaw = Math.atan2(p.y - anchor.center.y, p.x - anchor.center.x)
let dy = toYaw - anchor.yaw
while (dy > Math.PI) dy -= 2 * Math.PI
while (dy < -Math.PI) dy += 2 * Math.PI
const maxYaw = Camera.REPLAY_NUDGE_MAX_YAW
this.replayNudgeYawTarget = Math.max(
-maxYaw,
Math.min(maxYaw, -dy * 0.5)
)

// 高度：点偏高就抬一点、偏低就压一点，幅度与偏离程度成正比并限幅
const maxLift = Camera.REPLAY_NUDGE_MAX_LIFT * R
this.replayNudgeLiftTarget = Math.max(
-maxLift,
Math.min(maxLift, ndc.y * maxLift)
)

// 注视点：朝 nudge 点平移一部分，同样限幅，避免注视中心大幅漂移
const look = this.replayNudgeLookTarget.copy(p).sub(anchor.center)
look.z = 0
const maxLook = Camera.REPLAY_NUDGE_MAX_LOOK * R
if (look.length() > maxLook) look.setLength(maxLook)
look.multiplyScalar(0.45)
}
}
if (!need) {
this.replayNudgeYawTarget = 0
this.replayNudgeLiftTarget = 0
this.replayNudgeLookTarget.set(0, 0, 0)
}

const k = Camera.REPLAY_NUDGE_LERP
this.replayNudgeYaw += (this.replayNudgeYawTarget - this.replayNudgeYaw) * k
this.replayNudgeLift += (this.replayNudgeLiftTarget - this.replayNudgeLift) * k
this.replayNudgeLook.lerp(this.replayNudgeLookTarget, k)
}

/**
* v1.2.6 #232：回放帧定相机。
* v1.3.58：改为「锚点 + 限幅微调」模型 —— 锚点是本杆击球前算好的机位，
* 出杆后保持不变；只有 nudge 三项微调量会动，且平滑缓动。
* fraction 传 1 表示不做插值（击球前一次性完成定位）。
*/
replayFrameView(_aim: AimEvent, fraction = 0.12) {
const pts = this.replayFocus
if (!pts || pts.length === 0) {
this.topView(_aim)
return
}
const anchor = this.replayAnchor ?? this.buildReplayAnchor(pts)
if (!this.replayAnchor) this.replayAnchor = anchor

this.stepReplayNudge(anchor)

const yaw = anchor.yaw + this.replayNudgeYaw
const camPos = this.tempVec.set(
anchor.center.x - Math.cos(yaw) * anchor.horiz,
anchor.center.y - Math.sin(yaw) * anchor.horiz,
anchor.lift + this.replayNudgeLift
)
const look = this.tempVec2.copy(anchor.center).add(this.replayNudgeLook)

this.camera.up.copy(up)
this.camera.position.lerp(camPos, fraction)
this.lookTarget.lerp(look, fraction)
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
