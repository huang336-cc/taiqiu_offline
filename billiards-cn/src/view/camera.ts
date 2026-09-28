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
   * v1.3.100：远台跟随视角（farView）——「拉远版的瞄准视角」。
   *
   * 需求变更：v1.3.99 的 farView 是**固定在球台 +Y 端线外**的静态机位，
   * 用户要求改成**跟随球杆**：相机站在母球后方、沿当前出杆方向看向前方，
   * 与 aimView 同源，只是**距离更远、高度更高**，因此一屏能看见更完整的
   * 台面与房间，适合观察全局球势。
   *
   * 与 aimView 的差异（都在同一套「母球后方 + 出杆方向」几何上）：
   *   - 距离：aimView 用 `this.distance`（默认 R*24 ≈ 0.79m，贴台）；
   *     farView 用 `FAR_DISTANCE = R*73 ≈ 2.39m`，明显退远。
   *   - 高度：aimView 用 `this.height`（默认 R*9 ≈ 0.295m，近台面平视）；
   *     farView 用 `FAR_HEIGHT = 1.10m`，略高于瞄准、略带俯瞰。
   *   - 注视抬升：aimView 用 `AIM_LOOK_LIFT = R*6`；farView 用
   *     `FAR_LOOK_LIFT = R*10`（≈0.33m），因相机更高，需同步抬高注视点
   *     才能让视线不过分下压、把房间带进画面。
   *
   * 坐标系：世界 Z-up，球台居中于原点，台面在 z≈0。房间天花板 z=2.85，
   * 相机高度 1.10m 远低于天花板，不会穿顶。
   *
   * 横屏专用：本版**只做横屏**（竖屏不做），因此不做竖屏 FOV 收窄分支，
   * 统一走 `adaptiveFov`（横屏受 60° 横向上限约束）。
   */
  private static readonly FAR_DISTANCE = R * 73
  private static readonly FAR_HEIGHT = 1.10
  private static readonly FAR_FOV = 42
  private static readonly FAR_LOOK_LIFT = R * 10

  farView(aim: AimEvent) {
    // 横屏专用：与 aimView 同款自适应 FOV（横屏横向上限 60°）
    this.camera.fov = this.adaptiveFov(Camera.FAR_FOV)
    // 相机站在母球后方，沿出杆反方向退 FAR_DISTANCE —— 与 aimView 完全同源，
    // 因此会随球杆方向实时跟随（每杆出杆方向变化，机位随之旋转）。
    this.target
      .copy(aim.pos)
      .addScaledVector(unitAtAngle(aim.angle, this.tempVec), -Camera.FAR_DISTANCE)
    this.camera.position.lerp(this.target, 0.12)
    this.camera.position.z = Camera.FAR_HEIGHT
    this.camera.up = up
    // 注视母球前方、抬高 FAR_LOOK_LIFT，使视线不过分下压
    this.lookTarget.copy(aim.pos).addScaledVector(up, Camera.FAR_LOOK_LIFT)
    this.camera.lookAt(this.lookTarget)
  }

  /**
   * v1.3.60：以指定中心点为俯视视线锚点的「聚焦俯视」。
   * 与 topView 不同：相机不放在「(0, -εR, dist)」看原点，而是抬到
   * `center.x, center.y, center.z + dist(radius)` 看 center。
   * 半径 radius 决定相机高度，保证整个 focus 包围圆始终在画面里。
   * v1.5.4（#70）：原配套的 frameCameraForShot 俯视分支已随回放跟随视角移除，
   * 本方法暂留作通用聚焦俯视工具（当前无调用方）。
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

  /**
   * v1.3.86：瞄准机位「注视点抬升」常量 —— 把房间拉进画面的**唯一有效杠杆**。
   *
   * 病史（这条是几十个版本「场景优化看不见」的总根因）：
   *
   * 瞄准机位的视线俯角满足
   *     俯角 = atan( (height − lookLift) / distance )
   * 而画面上缘的仰角满足（六点实测逐字吻合）
   *     上缘仰角 = fov/2 − 俯角
   *
   * 旧值是 `lookLift = R*2`、`height = R*9`、`distance = R*24`，于是
   *     俯角 = atan(0.295 − 0.066) / 0.786) ≈ 16.3°，fov/2 ≈ 25.1°
   *     上缘仰角 ≈ +8.8°  —— 看似为正，但**画面里 68% 是台呢**。
   *
   * 原因是几何上的：相机只在台面上方 0.295 m 处平视，台呢是一个几乎
   * 无限延伸的平面；上缘那 8.8° 的仰角只够看见台面「极远处」的收束带，
   * 也就是环境在画面里只剩窄窄一条。实测 `aim` 机位台呢占比 68~69%。
   *
   * ⚠️ **抬高相机是反向的**：height 变大 → 俯角变大（比 fov 变大更快），
   * 上缘反而更低。实测 height 从 R*9 升到 R*30，台呢占比 67.8% → **91.1%**，
   * 画面退化成俯视平面图。所以「机位抬高」这条思路整体作废。
   *
   * 正解是把**注视点抬高**让视线变平。实测（室内场景）：
   *     lookLift  R*2 → 68%    R*4 → 61%    R*6 → 51%    R*8 → 41%
   * 取 `R*6`：台呢从 68% 降到 51%，画面里同时保有「球桌质感」与
   * 「可辨识的房间」（木地板、踢脚线、球杆架、置球、投影）。
   *
   * 取值依据：再往上（R*9 及以后）台呢跌破 40%，球桌开始像平面图而不是
   * 一张桌子，失去台球游戏的主体感；R*6 是「room 可读 / 桌子仍是桌子」的
   * 平衡点。
   */
  private static readonly AIM_LOOK_LIFT = R * 6

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
    /**
     * v1.3.86：注视点抬升从 `R*2` 提到 `AIM_LOOK_LIFT`（= R*6）。
     *
     * 旧注释（v1.1.42）说「抬到 +2R 让相机略抬头，更多地看正前方」——
     * 意图是对的，但抬升量太小，视线仍然近乎贴着台呢平推，画面被台呢铺满。
     * 详见 `AIM_LOOK_LIFT` 的完整推导与实测数据。
     */
    this.lookTarget.copy(aim.pos).addScaledVector(up, Camera.AIM_LOOK_LIFT)
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
}
}

  /**
   * v1.5.4（#70）：回放自由视角。
   *
   * 需求：回放模式删除「跟随视角」（旧 replayFrameView 每杆自动框定机位，
   * 用户无法控制镜头），改为用户自行调节的**自由视角**。
   *
   * 几何：相机永远绕**台面中心**（原点，z=0 台面）做球面运动 ——
   *   - freeCam.yaw：方位角（绕竖直轴）
   *   - freeCam.pitch：俯仰角（0=贴台平视，π/2=正上方俯瞰）
   *   - freeCam.dist：到台面中心的距离
   * 注视点恒为台面中心（lookAt(zero)），因此**无论怎么转都对着球台**；
   * pitch/dist 有上下限，保证不会钻到台面以下、也不会远到看不见球。
   *
   * 手势（见 Replay 控制器的指针绑定）：
   *   - 单指拖动 → 转动方位角/俯仰角
   *   - 双指捏合 / 滚轮 → 拉近拉远
   */
  freeCam = { yaw: Math.PI * 0.75, pitch: 0.72, dist: R * 42 }
  private static readonly FREE_PITCH_MIN = 0.18
  private static readonly FREE_PITCH_MAX = 1.45
  private static readonly FREE_DIST_MIN = R * 14
  private static readonly FREE_DIST_MAX = R * 95

  /**
   * 自由视角：单指拖动旋转。dx/dy 为像素增量。
   *
   * 方向约定与主流轨道相机一致（也是用户直觉）：
   *   - 向右拖（dx>0）→ 场景向右转，相机绕台逆时针走 → yaw 减小；
   *   - 向下拖（dy>0）→ 相机压低、视线更贴近台面 → pitch 减小。
   * pitch 夹在 [FREE_PITCH_MIN, FREE_PITCH_MAX]，保证既不会钻到台面以下，
   * 也不会越过正上方翻过去。
   */
  orbitFreeBy(dx: number, dy: number) {
    this.freeCam.yaw -= dx * 0.005
    this.freeCam.pitch = Math.max(
      Camera.FREE_PITCH_MIN,
      Math.min(Camera.FREE_PITCH_MAX, this.freeCam.pitch - dy * 0.005)
    )
  }

  /** 自由视角：缩放。factor > 1 拉远、< 1 拉近。 */
  zoomFreeBy(factor: number) {
    this.freeCam.dist = Math.max(
      Camera.FREE_DIST_MIN,
      Math.min(Camera.FREE_DIST_MAX, this.freeCam.dist * factor)
    )
  }

  /** 切换到自由视角模式（由 Replay 控制器调用） */
  forceFreeView() {
    this.mode = this.replayFreeView
    this.mainMode = this.replayFreeView
    this.isZoomedOut = false
    this.updateCameraButtonClass("topview")
  }

  replayFreeView(_: AimEvent) {
    this.camera.fov = this.adaptiveFov(45)
    const cp = Math.cos(this.freeCam.pitch)
    const sp = Math.sin(this.freeCam.pitch)
    this.target.set(
      this.freeCam.dist * cp * Math.cos(this.freeCam.yaw),
      this.freeCam.dist * cp * Math.sin(this.freeCam.yaw),
      this.freeCam.dist * sp
    )
    // 位置平滑逼近手势目标，注视点恒为台面中心 —— 永远对着球台
    this.camera.position.lerp(this.target, 0.3)
    this.camera.up = up
    this.camera.lookAt(zero)
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
    } else if (this.mode === this.topView) {
      // v1.3.99：俯视 → 远台（静态框全台）
      this.restoreSavedDistance()
      this.mode = this.farView
      this.mainMode = this.farView
      this.isZoomedOut = false
      this.updateCameraButtonClass("far")
    } else {
      // v1.3.99：远台 → 瞄准，闭合「瞄准 → 俯视 → 远台」三态循环
      this.restoreSavedDistance()
      this.mode = this.aimView
      this.mainMode = this.aimView
      this.isZoomedOut = false
      this.updateCameraButtonClass("aim")
    }
  }

  private updateCameraButtonClass(state: "aim" | "aimz" | "topview" | "far") {
    const btn = document.getElementById("camera")
    if (btn) {
      btn.classList.remove("aim", "aimz", "topview", "far")
      btn.classList.add(state)
      // v1.1.59：只更新模式指示子元素 .cam-mode，绝不整体替换 btn.textContent。
      // 之前用 emoji（🎥ᶻ / 🎥ᵀ）整体覆盖按钮，会把精心做好的奶白 SVG 图标抹掉，
      // 而 Android WebView 会把 emoji 渲染成系统默认黄/金色 → 相机图标变金。
      // 现在保留 SVG，仅切换 class + 更新 ᶻ/ᵀ 文本，颜色完全交给 CSS 控制。
      const mode = btn.querySelector(".cam-mode")
      if (mode) {
        // v1.3.99：新增远台模式字母 ᶠ（与 ᶻ/ᵀ 同为上标小写体）
        mode.textContent =
          state === "aimz" ? "ᶻ" : state === "topview" ? "ᵀ" : state === "far" ? "ᶠ" : ""
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
