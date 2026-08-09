import { TableGeometry } from "../view/tablegeometry"
import { Table } from "../model/table"
import { upCross, unitAtAngle, norm, roundVec } from "../utils/three-utils"
import { atan2, sin } from "../utils/utils"
import { AimEvent } from "../events/aimevent"
import { AimInputs } from "./dom/aiminputs"
import { Ball, State } from "../model/ball"
import { cueStrike } from "../model/physics/physics"
import { CueMesh } from "./cuemesh"
import { AimLine } from "./aimline"
import type { View } from "./view"
import { Mesh, Vector3, Object3D } from "three"
import { maxPower, offCenterLimit, R } from "../model/physics/constants"
import { cueIntersectsAnything } from "../utils/cueintersect"
import { id } from "../utils/dom"
import { Settings } from "../utils/settings"

export class Cue {
  mesh: Object3D
  tiltMesh: Object3D
  cueBody: Object3D
  helperMesh: Mesh
  /** 进球辅助线（两段：实线 + 虚线），纯 3D 场景内渲染 */
  aimLine: AimLine
  /** 指向 View 的引用（实时换肤等需要访问场景的场合使用） */
  view?: View
  placerMesh: Object3D
  shadowMesh: Mesh
  t = 0
  hittingAnimation = false
  aimInputs: AimInputs
  aim: AimEvent = new AimEvent()
  /** Analysis-mode-only limits (set by AnalysisPanel) clamping how far the
   * table view can push aim angle / elevation, matching what the analysis
   * panel itself displays as the "aim shift" / "elevation" tolerance window.
   * null outside analysis mode (no restriction). */
  aimLimits: {
    angleMin: number
    angleMax: number
    elevationMin: number
    elevationMax: number
  } | null = null

  length = TableGeometry.tableX * 1

  private hitStatsElement: HTMLElement | null = id("hitStats")
  private readonly tempVec = new Vector3()
  private readonly tempVec2 = new Vector3()
  private readonly tempVec3 = new Vector3()
  hitAnimationWeight: number = 0

  /**
   * 辅助线显示状态（item 1：仅在玩家调整瞄准时显示）。
   *
   * 分两类交互，缺一不可：
   * - 持续型（按住画布拖动、拖微调条/力度条）：用计数器，按下 +1 松开 -1。
   *   不能用「最后一次事件 + 超时」来判断，否则手指按住不动时事件流中断，
   *   辅助线会误判为已松手而闪烁。
   * - 瞬时型（点球自动对准、滚轮微调）：没有松手事件，给一个短暂的保留窗口，
   *   否则用户点完球根本来不及看见辅助线。
   */
  private aimHoldCount = 0
  private aimFlashUntil = 0
  /** 瞬时交互后辅助线保留的时长（毫秒） */
  private static readonly AIM_FLASH_MS = 1200

  /**
   * 逐帧重绘辅助线需要拿到牌桌，而 update(t) 拿不到，
   * 这里缓存最近一次 updateTargetLine 传进来的引用。
   */
  private lastTable: Table | null = null

  /**
   * 横向瞄准滑动条的基准角（滑块居中 = 初始正向瞄准方向）。
   * 进入瞄准状态时由 Aim 控制器写入。
   */
  aimBase = 0

  /**
   * 横向微调滑动条的角度半幅（弧度）。
   * v1.1.31：从 ±2° 收紧到 ±1°，比屏幕拖动瞄准的角分辨率更细微，
   * 专门用于「差一点点」时的极精细修正。
   * 滑块静止时永远居中（基准锁定为当前瞄准角），因此每次拖动的修正量都
   * 相对「当前方向」的 ±1°，松手即归中。
   */
  private static readonly AIM_FINE_HALF_RANGE = (1 * Math.PI) / 180

  constructor() {
    if (typeof document !== "undefined") {
      const cue = CueMesh.createCue(
        (R * 0.07) / 0.5,
        (R * 0.23) / 0.5,
        this.length
      )
      this.mesh = cue.mesh
      this.tiltMesh = cue.tiltMesh
      this.cueBody = cue.cueBody
      this.helperMesh = CueMesh.createHelper()
      this.aimLine = new AimLine()
      this.placerMesh = CueMesh.createPlacer()
      this.shadowMesh = CueMesh.createShadow(this.length)
    }
  }

  rotateAim(angle, table: Table) {
    if (!this.aimInputs || this.aimInputs.isDisabled()) {
      return
    }
    this.aim.angle = Math.fround(this.aim.angle + angle)
    if (this.aimLimits) {
      this.aim.angle = Math.min(
        this.aimLimits.angleMax,
        Math.max(this.aimLimits.angleMin, this.aim.angle)
      )
    }
    if (this.mesh) this.mesh.rotation.z = this.aim.angle
    if (this.helperMesh) this.helperMesh.rotation.z = this.aim.angle
    if (this.shadowMesh) this.shadowMesh.rotation.z = this.aim.angle
    this.aimInputs.showOverlap()
    this.aimInputs.updateAimAngleSlider?.()
    this.avoidCueTouchingOtherBall(table)
    this.updateTargetLine(table)
  }

  /**
   * 直接把瞄准角设到目标值（横向滑动条用）。
   * 复用 rotateAim，保证球杆网格、重叠指示、辅助线与限位逻辑全部一致。
   */
  setAimAngle(angle: number, table: Table) {
    this.rotateAim(angle - this.aim.angle, table)
  }

  /** 记录「初始正向瞄准」基准角，滑块居中即对应该角度 */
  setAimBase(angle: number) {
    this.aimBase = angle
  }

  /** 当前瞄准角相对基准的偏移，规整到 (-π, π]。
   *  ±π 这一对等价值有歧义：在边界上让符号与滑动条方向保持一致
   *  （滑块 +1 → +180°，滑块 -1 → -180°），避免「拖到右边却显示 -180°」。 */
  aimAngleOffset(): number {
    let d = this.aim.angle - this.aimBase
    while (d > Math.PI) d -= 2 * Math.PI
    while (d < -Math.PI) d += 2 * Math.PI
    // d 现在落在 [-π, π]，但滑动条的方向是「-π ↔ +π」，
    // 若滑动条希望 +1 对应 +π、-1 对应 -π，这里直接返回即可。
    return d
  }

  /**
   * 滑动条归一化位置 [-1, 1]：
   * 0 = 当前瞄准方向（滑块静止时永远居中，基准锁定为当前瞄准角），
   * 两端 = 当前方向 ±AIM_FINE_HALF_RANGE（普通对局 ±2°，仅微调）。
   * 分析模式则收窄到 aimLimits 给出的窗口。位置与角度线性一一对应。
   */
  aimSliderValue(): number {
    if (this.aimLimits) {
      const { angleMin, angleMax } = this.aimLimits
      const half = (angleMax - angleMin) / 2
      if (half < 1e-6) return 0
      const mid = (angleMin + angleMax) / 2
      return Math.max(-1, Math.min(1, (this.aim.angle - mid) / half))
    }
    return Math.max(
      -1,
      Math.min(1, this.aimAngleOffset() / Cue.AIM_FINE_HALF_RANGE)
    )
  }

  /** 滑动条位置 → 目标瞄准角（aimSliderValue 的逆运算，普通对局为微调窗口） */
  aimAngleFromSlider(value: number): number {
    const v = Math.max(-1, Math.min(1, value))
    if (this.aimLimits) {
      const { angleMin, angleMax } = this.aimLimits
      const half = (angleMax - angleMin) / 2
      const mid = (angleMin + angleMax) / 2
      return mid + v * half
    }
    return this.aimBase + v * Cue.AIM_FINE_HALF_RANGE
  }

  adjustPower(delta) {
    if (!this.aimInputs || this.aimInputs.isDisabled()) {
      return
    }
    this.aim.power = Math.fround(Math.min(maxPower, this.aim.power + delta))
    this.updateAimInput()
  }

  setPower(value: number) {
    if (!this.aimInputs || this.aimInputs.isDisabled()) {
      return
    }
    this.aim.power = Math.fround(value * maxPower)
    this.updateAimInput()
  }

  hit(ball: Ball) {
    const { angle, power, offset, elevation } = this.aim
    this.t = 0
    this.hittingAnimation = true
    ball.state = State.Sliding
    const strike = cueStrike(angle, power, offset, elevation)
    ball.vel.copy(strike.vel)
    ball.rvel.copy(strike.rvel)
    if (this.hitStatsElement) {
      this.hitStatsElement.innerText =
        `Angle: ${angle.toFixed(2)} Power: ${power} ` +
        `Offset: ${offset.x.toFixed(2)}, ${offset.y.toFixed(2)} Elevation: ${elevation.toFixed(0)} ` +
        `Vel: ${ball.vel.length().toFixed(2)}m/s rVel: ${ball.rvel.length().toFixed(2)}rad/s`
    }
  }

  aimAtNext(cueball, ball) {
    if (!ball) {
      return
    }
    const lineTo = norm(this.tempVec.copy(ball.pos).sub(cueball.pos))
    this.aim.angle = atan2(lineTo.y, lineTo.x)
  }

  adjustSpin(delta: Vector3, table: Table) {
    if (!this.aimInputs || this.aimInputs.isDisabled()) {
      return
    }
    const newOffset = this.tempVec3.copy(this.aim.offset).add(delta)
    this.setSpin(newOffset, table)
  }

  setSpin(offset: Vector3, table: Table, avoid = true) {
    if (!this.aimInputs || this.aimInputs.isDisabled()) {
      return
    }
    if (offset.length() > offCenterLimit) {
      offset.normalize().multiplyScalar(offCenterLimit)
    }
    this.aim.offset.copy(roundVec(offset))
    if (avoid) this.avoidCueTouchingOtherBall(table)
    this.updateAimInput()
    // 高低杆 / 加塞打点变化时同步重绘辅助线
    this.updateTargetLine(table)
  }

  setElevation(value: number) {
    if (!this.aimInputs || this.aimInputs.isDisabled()) {
      return
    }
    let elevation = value
    if (this.aimLimits) {
      elevation = Math.min(
        this.aimLimits.elevationMax,
        Math.max(this.aimLimits.elevationMin, elevation)
      )
    }
    this.aim.elevation = elevation
    this.updateAimInput()
  }

  avoidCueTouchingOtherBall(table: Table) {
    // v1.2.5：原逻辑无条件 `offset.y += 0.1`，会把击球点强行上移。
    // 当白球贴着别的球、低杆（下半部分）打点会让球杆与邻球相交时，
    // 用户选中的下半部分会被持续上推而无法保留，表现为「击球点选不中白球下半部分」。
    // 改为沿当前打点方向「朝球心收半径」：保持上下/左右象限不变，仅在不相交的前提下
    // 尽量靠近用户所选方向，从而既能避免球杆穿过邻球，又不锁死任何一侧打点。
    let n = 0
    while (n++ < 20 && this.intersectsAnything(table)) {
      const o = this.aim.offset
      const len = o.length()
      if (len < 1e-4) {
        // 球心仍相交（极罕见，白球与邻球几乎重叠）：轻微上移兜底，避免死循环
        o.y += 0.05
      } else {
        const newLen = Math.max(0, len - 0.1)
        o.multiplyScalar(newLen / len)
      }
      if (o.length() > offCenterLimit) {
        o.normalize().multiplyScalar(offCenterLimit)
      }
    }

    if (n > 1) {
      this.updateAimInput()
    }
  }

  updateAimInput() {
    this.aimInputs?.updateVisualState(this.aim.offset.x, this.aim.offset.y)
    this.aimInputs?.updatePowerSlider(this.aim.power / maxPower)
    this.aimInputs?.updateTiltSlider?.(this.aim.elevation)
    this.aimInputs?.showOverlap()
    // 三处角度输入（滑动条 / 拖拽 / 微调按钮）共用同一份数据，此处统一回灌
    this.aimInputs?.updateAimAngleSlider?.()
  }

  private updateCueRotation() {
    if (this.mesh) this.mesh.rotation.z = this.aim.angle
    if (this.tiltMesh)
      this.tiltMesh.rotation.y = CueMesh.baseTilt + this.aim.elevation
    if (this.helperMesh) this.helperMesh.rotation.z = this.aim.angle
    if (this.shadowMesh) this.shadowMesh.rotation.z = this.aim.angle
  }

  private applyHitAnimation(swing: number) {
    if (this.hittingAnimation) {
      this.hitAnimationWeight = 1
    } else {
      this.hitAnimationWeight *= 0.97
    }

    let curveVal = this.hitAnimationCurve(this.t)
    if (curveVal < 0) {
      const powerRatio = this.aim.power / maxPower
      const factor = 0.5 + 0.5 * powerRatio
      curveVal *= factor
    }
    const hitOffset = this.hitAnimationWeight * curveVal * 2 * R
    const strokeX = (1 - this.hitAnimationWeight) * swing - hitOffset
    const strokeZ = (0.15 + Math.min(this.t / 5, 0.25)) * hitOffset

    if (this.cueBody) {
      this.cueBody.position.set(
        -this.length / 2 - R * 1.1 + strokeX,
        this.aim.offset.x * R,
        Math.max(-0.5 * R, strokeZ + this.aim.offset.y * R)
      )
    }

    return strokeX
  }

  private updateCuePosition(pos: Vector3, strokeX: number) {
    if (this.mesh) this.mesh.position.copy(pos)

    // Project local strokeX through tilt onto the horizontal plane for shadow
    const unitToBall = unitAtAngle(this.aim.angle, this.tempVec)
    const sideVec = upCross(unitToBall).normalize()
    const elevation = this.tiltMesh ? (this.tiltMesh.rotation.y as number) : 0

    const localX = strokeX - R
    const localZ = this.cueBody ? this.cueBody.position.z : 0
    const projectedX =
      localX * Math.cos(elevation) + localZ * Math.sin(elevation)

    if (this.shadowMesh) {
      this.shadowMesh.position
        .copy(pos)
        .addScaledVector(sideVec, this.cueBody ? this.cueBody.position.y : 0)
        .addScaledVector(unitToBall, projectedX + R * Math.cos(elevation))
      this.shadowMesh.position.z = -R * 0.99
      this.shadowMesh.scale.x = Math.cos(elevation)
    }

    if (this.helperMesh) this.helperMesh.position.copy(pos)
    if (this.placerMesh) {
      this.placerMesh.position.copy(pos)
      this.placerMesh.rotation.z = this.t
    }
  }

  moveTo(pos) {
    this.aim.pos.copy(pos)
    this.updateCueRotation()
    const swing =
      (sin(this.t * 1.5 + Math.PI / 2) - 1) *
      2 *
      R *
      (this.aim.power / maxPower)
    const strokeX = this.applyHitAnimation(swing)
    this.updateCuePosition(pos, strokeX)
  }

  hitAnimationCurve(t: number) {
    const pts = [
      { t: 0, v: -2 },
      { t: 1, v: -1 },
      { t: 2, v: 1 },
      { t: 3, v: 2 },
    ]
    if (t <= pts[0].t) return pts[0].v
    if (t >= pts[pts.length - 1].t) return pts[pts.length - 1].v
    const i = pts.findIndex((p, idx) => t >= p.t && t <= pts[idx + 1]?.t)
    const p1 = pts[i],
      p2 = pts[i + 1]
    const p0 = pts[Math.max(0, i - 1)],
      p3 = pts[Math.min(pts.length - 1, i + 2)]
    const lt = (t - p1.t) / (p2.t - p1.t),
      lt2 = lt * lt,
      lt3 = lt2 * lt
    return (
      p0.v * (-0.5 * lt3 + lt2 - 0.5 * lt) +
      p1.v * (1.5 * lt3 - 2.5 * lt2 + 1) +
      p2.v * (-1.5 * lt3 + 2 * lt2 + 0.5 * lt) +
      p3.v * (0.5 * lt3 - 0.5 * lt2)
    )
  }

  update(t) {
    this.t += t
    this.moveTo(this.aim.pos)
    this.refreshTargetLine()
  }

  /** 持续型瞄准交互开始（按住画布拖动、按住滑条） */
  beginAimInteraction() {
    this.aimHoldCount++
  }

  /** 持续型瞄准交互结束 */
  endAimInteraction() {
    this.aimHoldCount = Math.max(0, this.aimHoldCount - 1)
  }

  /** 瞬时型瞄准交互（点球对准、滚轮），给一个短暂的可见窗口 */
  flashAimInteraction() {
    this.aimFlashUntil = performance.now() + Cue.AIM_FLASH_MS
  }

  /** 立即收起辅助线：击球、摆球、回放等离开瞄准的场合 */
  hideTargetLine() {
    this.aimHoldCount = 0
    this.aimFlashUntil = 0
    this.aimLine?.hide()
  }

  /** 玩家此刻是否正在调整瞄准 */
  private isAiming(): boolean {
    return this.aimHoldCount > 0 || performance.now() < this.aimFlashUntil
  }

  /**
   * 每帧刷新辅助线。
   *
   * 逐帧重算而不是「事件触发时重算」，是因为需求要求转动视角、改打点、
   * 摆球移动母球时线路都要实时跟上；每帧只涉及十几个球与 6 个袋口的
   * 向量运算，代价可以忽略，却省掉了到处补调用点的遗漏风险。
   */
  private refreshTargetLine() {
    if (!this.aimLine) return
    if (!this.isAiming()) {
      this.aimLine.hide()
      return
    }
    if (this.lastTable) {
      this.updateTargetLine(this.lastTable)
    }
  }

  placeBallMode() {
    if (this.mesh) this.mesh.visible = false
    if (this.shadowMesh) this.shadowMesh.visible = false
    if (this.placerMesh) this.placerMesh.visible = true
    this.aim.angle = 0
  }

  aimMode() {
    if (this.mesh) this.mesh.visible = true
    if (this.shadowMesh) this.shadowMesh.visible = true
    if (this.placerMesh) this.placerMesh.visible = false
  }

  spinOffset(aim: AimEvent = this.aim) {
    return upCross(unitAtAngle(aim.angle, this.tempVec2))
      .multiplyScalar(aim.offset.x * R)
      .setZ(aim.offset.y * R)
  }

  intersectsAnything(table: Table, aim: AimEvent = this.aim) {
    return cueIntersectsAnything(table, aim, this.spinOffset(aim))
  }

  showHelper(b) {
    if (this.helperMesh) this.helperMesh.visible = b
  }

  /**
   * 进球辅助线（两段式）：
   *   ① 实线：母球球心 → 目标球碰撞接触点（并在撞击位置画幽灵球圆环）
   *   ② 虚线：碰撞接触点 → 球袋进球中心点
   *
   * 具体几何、截断（撞球 / 撞库 / 落袋）与 ribbon 网格构建都在 AimLine 里，
   * 这里只负责「该不该画」以及把当前瞄准状态喂进去。
   *
   * 触发时机：仅在玩家调整瞄准（按住拖动 / 拖滑条 / 点球后的短暂窗口）时显示，
   * 出杆瞬间由 hideTargetLine() 立刻收起。
   */
  updateTargetLine(table: Table) {
    this.lastTable = table
    if (!this.aimLine) return
    const settings = Settings.get()
    // 设置面板总开关，或长度档位拖到 0，都视为关闭本功能
    if (!settings.aimLine || settings.targetLineLength <= 0) {
      this.aimLine.hide()
      return
    }
    if (!this.isAiming()) {
      this.aimLine.hide()
      return
    }
    // 档位 0=关闭，1=短，2=中，3=最长（最长=白球→被击球→袋口，不截断）
    // 各档对应「无袋口可指时」虚线延伸的最大长度（米）；最长档用 Infinity 表示延伸到袋口。
    const TARGET_LINE_MAX: number[] = [0, 0.5, 1.4, Infinity]
    const maxLen = TARGET_LINE_MAX[settings.targetLineLength] ?? 0
    this.aimLine.update(table, this.aim.angle, maxLen)
  }

  /** 实时更换皮肤（item 1）：重设球杆各段材质颜色，并套用当前球杆主题 */
  applySkin(skinId: string) {
    CueMesh.applySkin(this.cueBody, skinId)
    CueMesh.applyCueTheme(this.cueBody, Settings.get().cueTheme, skinId)
  }

  /** 单独切换球杆主题（item 2），颜色按当前皮肤恢复 */
  applyCueTheme(themeId: string) {
    CueMesh.applyCueTheme(this.cueBody, themeId, Settings.get().skin)
  }

  toggleHelper() {
    if (this.helperMesh) this.showHelper(!this.helperMesh.visible)
  }
}
