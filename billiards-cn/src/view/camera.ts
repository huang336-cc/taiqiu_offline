import { PerspectiveCamera, MathUtils, Vector3, Frustum, Matrix4 } from "three"
import { up, zero, unitAtAngle } from "../utils/three-utils"
import { AimEvent } from "../events/aimevent"
import { CameraTop } from "./cameratop"
import { R } from "../model/physics/constants"
import { Settings } from "../utils/settings"

export class Camera {
  // v1.8.1：瞄准机位再拉远一档。用户反馈「画面几乎全是台呢、看不到球桌与房间」。
  // 距离 R*24→R*32、高度 R*9→R*12、注视抬升 R*6→R*8 —— 三者按比例放大，
  // 俯角 atan((h−lift)/d) 保持 ≈7.1° 不变，所以台呢占比不会上升（注释里
  // 实测过的「抬高就变俯视图」那个坑不会重现），但视锥在远处覆盖的面积
  // 变大，房间与球桌侧裙自然多进来。球在画面里的直径从 62px 降到 47px
  // （1280×720），仍在可瞄范围。
  static defaultHeight = R * 12
  static defaultDistance = R * 32
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
  /**
   * v1.8.4：用户是否手动选过视角。
   *
   * 病根（局域网「对手回合无法切换视角」）：每次进入 WatchAim / Aim 都会
   * `suggestMode(...)`。用户把视角切到「瞄准」后 mainMode 变成 aimView，
   * 下一杆 WatchAim 构造里的 suggestMode(topView) 恰好命中
   * `mainMode === aimView` 分支，于是又被打回俯视 —— 用户点一下被夺走一次，
   * 表现为「对手回合切不了视角」（其实切了，只是下一帧就被改回去）。
   *
   * 现在手动切换会置位，suggestMode 不再覆盖；系统强制场景（回放 / 结算 /
   * 观战）走 forceMode，会清掉这个标记。
   */
  private userPinned = false

  private readonly target = new Vector3()
  private readonly lookTarget = new Vector3()
  private readonly tempVec = new Vector3()
  private readonly tempVec2 = new Vector3()

  private   distance = Camera.defaultDistance
  private fovOffset = Camera.defaultFovOffset
  savedDistance?: number

  elapsed: number
  private t = 0

  /** v1.8.2：记录上一帧的机位，用于检测「刚切进全桌机位」这一瞬间。 */
  private prevMode: any = this.mode
  /** v1.8.2：刚切进全桌机位时直接跳位，不做插值（防过渡帧穿天花板）。 */
  private farSnap = false

  update(elapsed, aim: AimEvent) {
    this.elapsed = elapsed
    this.t += elapsed
    if (this.mode === this.farView && this.prevMode !== this.farView) {
      this.farSnap = true
    }
    this.prevMode = this.mode
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
   * v1.8.1：远台视角改成**全桌机位**（原来的「拉远版瞄准」作废）。
   *
   * 用户反馈「希望看到球桌腿和场景背景」。这件事在「跟随母球 + 沿击球方向」
   * 的机位上是**几何上做不到**的：相机永远在台面上方沿台面纵深看，画面下缘
   * 必然先落在台呢上，桌子侧裙与桌腿被台面自己挡住。实测 d=R*44、h=R*30
   * 仍只能看到近端库边的一角。唯一能看到桌腿的构图是离开球台纵轴、站到
   * 桌子斜上方外侧。
   *
   * v1.8.2：用户要求「不要固定机位，让用户自行旋转移动」。改为绕**固定注视
   * 点**做球面运动（yaw / pitch / dist），手势见 `src/view/far-gestures.ts`。
   * 注视点恒为 FAR_TARGET，因此无论怎么转都对着球桌，不会「转丢」；pitch 与
   * dist 有夹限，既不会钻到台面以下，也不会远到看不见球。
   *
   * 初值由 v1.8.1 那组固定机位反解，保证**切换后的首屏构图逐像素不变**：
   *   delta = FAR_POS − FAR_TARGET = (2.35, −2.80, 2.07)
   *   dist  = |delta| ≈ 4.201
   *   pitch = asin(2.07 / dist) ≈ 0.5152 rad (29.5°)
   *   yaw   = atan2(−2.80, 2.35) ≈ −0.8735 rad (−50°)
   *
   * ⚠️ 与回放自由视角 `freeCam` **完全隔离**：`orbitFreeBy` / `zoomFreeBy` /
   * `replayFreeView` 一行不改，两套参数互不污染。
   */
  private static readonly FAR_TARGET = new Vector3(0, -0.05, -0.15)
  private static readonly FAR_FOV = 44
  private static readonly FAR_DELTA = new Vector3(2.35, -2.8, 2.07)
  private static readonly FAR_DIST = Camera.FAR_DELTA.length()
  private static readonly FAR_YAW = Math.atan2(
    Camera.FAR_DELTA.y,
    Camera.FAR_DELTA.x
  )
  private static readonly FAR_PITCH = Math.asin(
    Camera.FAR_DELTA.z / Camera.FAR_DIST
  )
  private static readonly FAR_PITCH_MIN = 0.18
  private static readonly FAR_PITCH_MAX = 1.45
  private static readonly FAR_DIST_MIN = R * 14
  /**
   * v1.8.2：上限必须大于初始 dist≈4.201。沿用回放自由视角的 R*95(=3.11)
   * 会让「第一次滚轮拉远」直接被夹回 3.11，画面反而突然拉近 —— 实机探针
   * S3 抓到。取 R*200≈6.55，比默认远 56%，够看清整个房间。
   */
  private static readonly FAR_DIST_MAX = R * 200

  /**
   * v1.8.2 修复：自由机位必须留在房间内，否则会看到墙的背面。
   *
   * pool_room.glb 房间外壳 bbox 约 x∈[−3.8,3.8]、y∈[−2.9,2.93]、天花板 z≈2.6。
   * 默认机位 (2.35,−2.85,1.92) 已经贴着 −y 墙内侧；一旦用户把 yaw 转向 −y
   * 或滚轮拉远，球面位置就会穿出墙面（实机六角度验收抓到 y=−3.71/−4.04
   * 的三个机位），相机从墙外朝球桌看，整片米色、球桌完全消失。
   *
   * 做法：沿「注视点 → 相机」方向对安全盒求交，把 dist 夹到交点内侧。
   * yaw/pitch 方向完全保留（旋转自由度不受影响），只是拉远时相机停在墙内侧。
   * −y 下界取 −2.85 与默认机位一致，保证首屏构图与 v1.8.1 逐像素相同。
   */
  private static readonly FAR_ROOM_MIN = new Vector3(-3.4, -2.85, 0.45)
  private static readonly FAR_ROOM_MAX = new Vector3(3.4, 2.55, 2.45)

  /**
   * v1.8.9：相机允许的最高 z —— 必须低于当前场景真实天花板，否则会穿顶白屏。
   *
   * 病史：上面 FAR_ROOM_MAX.z=2.45 是按**旧** `pool_room.glb` 天花板(z≈2.6)
   * 定的。v1.8.8 合入的新场景 `pool_scene_room.glb` / `pool_scene_tea.glb`
   * 天花板底只有 z≈2.30~2.32（Crown 装饰更低到 2.16），于是拖动全桌机位
   * 抬高 pitch(>0.75) 时相机 z 被夹到 2.45 —— 已经钻进/穿过天花板板层，
   * 从上方俯拍，米白色天花板挡在相机与球桌之间 = 整片白屏（用户报「挪动
   * 视角遮挡摄像机白屏」）。回放自由视角更严重：原本无任何净空约束，z 可
   * 达 3.09，必然穿顶。
   *
   * 修法：顶棚高度由 View.applyScene 按当前场景注入（室内=天花板底−余量，
   * 户外=保持原 FAR_ROOM_MAX.z 的宽限值）。farPosition 与 replayFreeView
   * 都把相机 z 夹到 `min(净空上界, ceilingZ − 余量)` 之内。
   * 默认取 FAR_ROOM_MAX.z（户外/未注入场景仍按老行为），不改变雪山首屏。
   */
  /**
   * null = 户外 / 无天花板场景，保持原有 z 行为（雪山回放机位不受影响）；
   * 数字 = 当前室内场景天花板底高度，相机必须待在其下方。
   */
  private ceilingZ: number | null = null
  /** 相机中心到天花板必须保留的余量（球桌上方吊灯/装饰的安全间隙）。 */
  private static readonly CEIL_CLEARANCE = 0.18

  /** 由 View.applyScene 注入当前场景的顶棚高度；传 null 表示不限制。 */
  setCeilingZ(z: number | null) {
    this.ceilingZ = z
  }

  /** 当前场景下相机 z 的实际上界（far 视角求交用）。 */
  private cameraCeilZ(): number {
    return this.ceilingZ === null
      ? Camera.FAR_ROOM_MAX.z
      : Math.min(Camera.FAR_ROOM_MAX.z, this.ceilingZ - Camera.CEIL_CLEARANCE)
  }

  /**
   * v1.8.11：瞄准视角（aimView）专用净空余量。
   *
   * 回放/far 视角用 CEIL_CLEARANCE=0.18 即可（它们在房间中部、注视点也在台面），
   * 但瞄准视角的相机是**贴着击球方向、随用户上下拖动自由升高**的：茶室的横梁
   * 底 z≈1.93、天花板板层 z[2.30,2.40]，而顶棚隐藏阈值是 INDOOR_CEIL_Z−0.05
   * =2.80。旧逻辑把相机 z 直接设成 height（上限 R*120≈3.93），于是拖动经过
   * z∈[1.90,2.80] 这段时相机钻到横梁/天花板板层里、顶棚却仍渲染 → 米色白屏
   * （用户报「挪动视角白屏」，v1.8.9/v1.8.10 只修了 far/replay，漏了这个主视角）。
   * 取 0.5 → 室内相机 z 上限 = 天花板底−0.5（room 1.82 / tea 1.80），
   * 稳稳落在横梁 1.93 下方；默认机位 z=0.393 远低于上限，构图零改动。
   */
  private static readonly AIM_CEIL_CLEARANCE = 0.5

  /** 把任意 z 夹到当前场景天花板下方。clearance 默认用于 far/回放视角；瞄准视角传更大值。 */
  private clampCameraZ(z: number, clearance = Camera.CEIL_CLEARANCE): number {
    return this.ceilingZ === null
      ? z
      : Math.min(z, this.ceilingZ - clearance)
  }

  /**
   * v1.8.10：视线注视点抬升（look-at lift）——「自由视角看不到茶室牌匾」修复。
   *
   * 病史：v1.8.9 修白屏时把相机 z 夹在天花板下（室内 ≤2.12），这是对的，
   * 但两个可拖动视角的注视点仍死死锁在台面中心（farView lookAt(FAR_TARGET)、
   * replayFreeView lookAt(zero)），视线俯角过大。茶室牌匾挂在北墙 z≈1.4，
   * 于是永远落在画面上缘之外 —— 用户越往上拖（想抬头看）相机越贴近台面
   * 正上方、视线越俯，反而更看不到，主观感受就是「视角太矮、看不到牌匾」。
   *
   * 数学验证（透视投影，16:9 / fov36）：牌匾在 z=1.4 的远墙，球台在 z=0。
   * 两者能否同框取决于相机的**水平离台距离 horiz**：
   *   - 近机位（horiz≈1.0）垂直视场窄，看球为主 —— 不能抬注视点，否则球台出画；
   *   - 拉远（horiz≥2.4~2.6）垂直视场变宽，抬高注视点即可把墙上装饰纳入画面。
   * 故按 horiz 做 smoothstep 自适应抬升：近机位 0（看球构图完全不变），
   * 拉远时平滑抬到上限。户外场景（ceilingZ=null）恒为 0，雪山构图不受影响。
   *
   * ⚠️ 只动 lookAt 目标点，**相机位置一个像素都不改** —— v1.8.9 的防穿顶
   * 安全盒 / clampCameraZ 完全保留，不会重新引入白屏。
   */
  private static readonly FAR_LOOK_LIFT_MAX = 1.0
  private static readonly FAR_LOOK_LIFT_H0 = 1.2
  private static readonly FAR_LOOK_LIFT_H1 = 2.6
  private static readonly FREE_LOOK_LIFT_MAX = 0.6
  private static readonly FREE_LOOK_LIFT_H0 = 1.0
  private static readonly FREE_LOOK_LIFT_H1 = 2.4

  private lookLift(horiz: number, max: number, h0: number, h1: number): number {
    if (this.ceilingZ === null) return 0
    const t = Math.max(0, Math.min(1, (horiz - h0) / (h1 - h0)))
    return t * t * (3 - 2 * t) * max // smoothstep
  }

  farCam = {
    yaw: Camera.FAR_YAW,
    pitch: Camera.FAR_PITCH,
    dist: Camera.FAR_DIST,
    target: Camera.FAR_TARGET.clone(),
  }
  private readonly farPos = new Vector3()

  /** 全桌机位：绕固定注视点的球面相机。 */
  private farPosition(out: Vector3): Vector3 {
    const cp = Math.cos(this.farCam.pitch)
    const sp = Math.sin(this.farCam.pitch)
    const dx = cp * Math.cos(this.farCam.yaw)
    const dy = cp * Math.sin(this.farCam.yaw)
    const dz = sp
    const t = this.farCam.target
    const MIN = Camera.FAR_ROOM_MIN
    const MAX = Camera.FAR_ROOM_MAX
    // 沿方向向量求到安全盒六个面的正距离，取最近的那个作为 dist 上限。
    // 方向分量为 0 时该轴不约束（返回 Infinity）。
    const limit = (d: number, origin: number, lo: number, hi: number) => {
      if (Math.abs(d) < 1e-6) return Infinity
      return ((d > 0 ? hi : lo) - origin) / d
    }
    const dist = Math.min(
      this.farCam.dist,
      limit(dx, t.x, MIN.x, MAX.x),
      limit(dy, t.y, MIN.y, MAX.y),
      // v1.8.9：z 上界改用当前场景顶棚高度，不再用固定 MAX.z(2.45)。
      // 新房间天花板 2.32 / dice 2.30，夹到 2.32−0.18=2.14 以内，杜绝穿顶白屏。
      limit(dz, t.z, MIN.z, this.cameraCeilZ())
    )
    return out.set(t.x + dist * dx, t.y + dist * dy, t.z + dist * dz)
  }

  /** 单指 / 鼠标拖动：向右拖场景右转、向下拖压低机位（与主流轨道相机一致）。 */
  orbitFarBy(dx: number, dy: number) {
    this.farCam.yaw -= dx * 0.005
    this.farCam.pitch = Math.max(
      Camera.FAR_PITCH_MIN,
      Math.min(Camera.FAR_PITCH_MAX, this.farCam.pitch - dy * 0.005)
    )
  }

  /** 双指捏合 / 滚轮：factor > 1 拉远、< 1 拉近。 */
  zoomFarBy(factor: number) {
    this.farCam.dist = Math.max(
      Camera.FAR_DIST_MIN,
      Math.min(Camera.FAR_DIST_MAX, this.farCam.dist * factor)
    )
  }

  farView(_: AimEvent) {
    // 自适应 FOV 在 16:9 上把 44° 收窄到约 32.7°（横向上限 60°）。
    this.camera.fov = this.adaptiveFov(Camera.FAR_FOV)
    this.farPosition(this.farPos)
    /**
     * 从别的视角切进来时**直接跳位**：topView 在 z=5.36（房顶上方）、
     * aimView 在 z=0.39，大跨度插值在低帧率设备（软件渲染）上要好几秒收敛，
     * 中途相机会穿过天花板 —— 实测截到过整片白的过渡帧。
     * 手势改动 farCam 时走 lerp(0.45)，既有跟手感又不会留下插值残影。
     */
    if (this.farSnap) {
      this.camera.position.copy(this.farPos)
      this.farSnap = false
    } else {
      this.camera.position.lerp(this.farPos, 0.45)
    }
    this.camera.up = up
    // v1.8.10：拉远看房间时抬高注视点，把墙上牌匾/吊灯纳入画面；
    // 近机位抬升量为 0，看球构图与 v1.8.9 完全一致。用 farPos 算水平离台距离。
    const farHoriz = Math.hypot(this.farPos.x, this.farPos.y)
    const farLift = this.lookLift(
      farHoriz,
      Camera.FAR_LOOK_LIFT_MAX,
      Camera.FAR_LOOK_LIFT_H0,
      Camera.FAR_LOOK_LIFT_H1
    )
    this.lookTarget.set(
      this.farCam.target.x,
      this.farCam.target.y,
      this.farCam.target.z + farLift
    )
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
  private static readonly AIM_LOOK_LIFT = R * 8

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
    // v1.8.11：主视角防穿顶白屏（「挪动视角遮挡摄像机白屏」的真正根因）。
    // 旧代码直接 z=h，用户上下拖把相机升到 z∈[1.90,2.80] 时会钻进茶室横梁
    // (1.93)/天花板板层(2.30)，而顶棚隐藏阈值是 2.80、此时仍渲染 → 米色白屏。
    // 夹到天花板下方 0.5（room 1.82 / tea 1.80，均在横梁下方）；户外不约束。
    this.camera.position.z = this.clampCameraZ(h, Camera.AIM_CEIL_CLEARANCE)
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
    // v1.8.4：用户手动选过视角就不再自动改写，否则「切了又被拉回」。
    if (this.userPinned) {
      return
    }
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
    // v1.8.4：系统强制场景（回放 / 结算 / 观战全景）重置用户选择，
    // 否则回到对局后玩家的旧选择会一直压住自动机位。
    this.userPinned = false
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
    // v1.8.9：回放自由视角原本无任何房间净空约束，室内场景 pitch 拉高时
    // z 可达 3.09，必然穿出天花板白屏。目标位与平滑后的实际位都夹一次。
    this.target.z = this.clampCameraZ(this.target.z)
    // 位置平滑逼近手势目标
    this.camera.position.lerp(this.target, 0.3)
    this.camera.position.z = this.clampCameraZ(this.camera.position.z)
    this.camera.up = up
    // v1.8.10：拉远看房间时抬高注视点，把墙上牌匾纳入画面；
    // 近机位抬升量为 0，仍对着球台 —— 看球构图与 v1.8.9 完全一致。
    const freeHoriz = Math.hypot(this.camera.position.x, this.camera.position.y)
    const freeLift = this.lookLift(
      freeHoriz,
      Camera.FREE_LOOK_LIFT_MAX,
      Camera.FREE_LOOK_LIFT_H0,
      Camera.FREE_LOOK_LIFT_H1
    )
    this.lookTarget.set(0, 0, freeLift)
    this.camera.lookAt(this.lookTarget)
  }

  cycleModeToAimz(balls: any[], aim: AimEvent) {
    this.userPinned = true
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
    // v1.8.4：这是「用户主动点视角按钮」的唯一入口 —— 置位后不再被
    // suggestMode 自动改写（局域网对手回合切不了视角的根因）。
    this.userPinned = true
    // v1.1.8：关闭「保留三个视角」时，只在第一/二人称（跟随 / 俯视）间切换，
    // 跳过母球视角（aimz 拉远），避免不想要的拉远操作。
    // v1.8.1：把「全桌视角」（far）加进这条精简循环 —— 用户明确要求
    // 「能看到球桌腿与场景背景」，far 是唯一能看到桌腿的机位，若仍只在
    // keepAllViews 时可达，默认设置下就永远点不到。
    const keepAll = Settings.get().keepAllViews
    if (!keepAll) {
      if (this.mode === this.topView) {
        this.restoreSavedDistance()
        this.mode = this.aimView
        this.mainMode = this.aimView
        this.isZoomedOut = false
        this.updateCameraButtonClass("aim")
      } else if (this.mode === this.farView) {
        // 全桌 → 俯视（俯视是看球势的常用档，放在最后一跳）
        this.restoreSavedDistance()
        this.mode = this.topView
        this.mainMode = this.topView
        this.isZoomedOut = false
        this.updateCameraButtonClass("topview")
      } else {
        // 瞄准 → 全桌（用户「想看到桌腿与房间」时点一下就到）
        this.restoreSavedDistance()
        this.mode = this.farView
        this.mainMode = this.farView
        this.isZoomedOut = false
        this.updateCameraButtonClass("far")
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
    this.userPinned = true
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
