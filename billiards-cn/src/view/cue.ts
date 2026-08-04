import { TableGeometry } from "../view/tablegeometry"
import { Table } from "../model/table"
import { upCross, unitAtAngle, norm, roundVec } from "../utils/three-utils"
import { atan2, sin } from "../utils/utils"
import { AimEvent } from "../events/aimevent"
import { AimInputs } from "./dom/aiminputs"
import { Ball, State } from "../model/ball"
import { cueStrike } from "../model/physics/physics"
import { CueMesh } from "./cuemesh"
import { PocketGeometry } from "./pocketgeometry"
import type { View } from "./view"
import { Mesh, Vector3, Object3D, Line } from "three"
import { maxPower, offCenterLimit, R } from "../model/physics/constants"
import { cueIntersectsAnything } from "../utils/cueintersect"
import { id } from "../utils/dom"
import { Settings } from "../utils/settings"

export class Cue {
  mesh: Object3D
  tiltMesh: Object3D
  cueBody: Object3D
  helperMesh: Mesh
  targetLineMesh: Line
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
  /** findAimedBall 专用，避免与上面几个临时向量互相覆盖 */
  private readonly tempVecAim = new Vector3()
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
      this.targetLineMesh = CueMesh.createTargetLine()
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
    this.avoidCueTouchingOtherBall(table)
    this.updateTargetLine(table)
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

  setSpin(offset: Vector3, table: Table) {
    if (!this.aimInputs || this.aimInputs.isDisabled()) {
      return
    }
    if (offset.length() > offCenterLimit) {
      offset.normalize().multiplyScalar(offCenterLimit)
    }
    this.aim.offset.copy(roundVec(offset))
    this.avoidCueTouchingOtherBall(table)
    this.updateAimInput()
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
    let n = 0
    while (n++ < 20 && this.intersectsAnything(table)) {
      this.aim.offset.y += 0.1
      if (this.aim.offset.length() > offCenterLimit) {
        this.aim.offset.normalize().multiplyScalar(offCenterLimit)
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
    this.refreshTargetLineVisibility()
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
    if (this.targetLineMesh) this.targetLineMesh.visible = false
  }

  /** 玩家此刻是否正在调整瞄准 */
  private isAiming(): boolean {
    return this.aimHoldCount > 0 || performance.now() < this.aimFlashUntil
  }

  /**
   * 每帧收敛辅助线可见性。
   *
   * updateTargetLine 只负责算几何、在该显示时置 visible=true；
   * 这里负责「不该显示时收起来」，两者职责分开，避免各处调用点漏判。
   */
  private refreshTargetLineVisibility() {
    if (!this.targetLineMesh) return
    if (!this.isAiming()) {
      this.targetLineMesh.visible = false
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
   * 找出当前瞄准方向上最先被击中的球。
   *
   * 不复用 Overlap.getFirst：它的判定阈值是碰撞用的 perpendicular < 2R，
   * 只有几乎正中球心才成立，稍微偏一点就返回空 —— 表现为「辅助线在
   * 绝大多数角度下完全不出现」。辅助线是预测性提示，需要更宽的容差，
   * 因此这里用 2.6R，并且只考虑白球前方（投影距离为正）的在台球。
   */
  private findAimedBall(table: Table, dir: Vector3) {
    const cueball = table.cueball
    let best: { ball: Ball; distance: number } | null = null
    for (const ball of table.balls) {
      if (ball === cueball) continue
      if (!ball.onTable()) continue
      // 用独立的临时向量，避免与 updateTargetLine 里的 tempVec 互相踩踏
      const toBall = this.tempVecAim.copy(ball.pos).sub(cueball.pos)
      const along = toBall.dot(dir)
      if (along <= 0) continue // 在身后
      // 点到射线的垂距
      const perp = Math.sqrt(Math.max(0, toBall.lengthSq() - along * along))
      if (perp > 2.6 * R) continue
      if (!best || along < best.distance) {
        best = { ball, distance: along }
      }
    }
    return best
  }

  /**
   * 被击打球辅助线（items 3 & 7）：
   * - targetLineLength>0 时显示，在跟随（第一人称）与俯视视角下均可见；
   * - 辅助线从目标球球心沿「白球→目标球」方向（ghost ball 原理）延伸，
   *   若该方向与某袋口夹角足够小，则实时指向该袋口。
   *
   * 说明：v1.0.6 曾限制「仅第一人称显示」，但游戏默认进入的是俯视视角，
   * 结果辅助线在任何角度都看不到。俯视恰恰是最需要看进球线路的视角，
   * 因此改为两种主视角都显示。
   *
   * 另：瞄准方向上没有球时不再直接隐藏，而是画出白球自身的行进线。
   * 九球开局白球距球堆约 1.5m，整个球堆张角仅约 ±2.5°，稍微偏一点
   * 前方就真的没有球 —— 若此时隐藏，主观感受就是「任何角度都没有辅助线」。
   */
  updateTargetLine(table: Table) {
    if (!this.targetLineMesh) return
    const len = Settings.get().targetLineLength
    if (len <= 0) {
      this.targetLineMesh.visible = false
      return
    }
    // item 1：只有玩家正在调整瞄准时才画，其余时刻一律收起
    if (!this.isAiming()) {
      this.targetLineMesh.visible = false
      return
    }
    const dir = unitAtAngle(this.aim.angle, this.tempVec2)
    const closest = this.findAimedBall(table, dir)
    if (!closest) {
      // 前方无球：画白球自身的行进线，保证任何角度都有视觉反馈
      const cueStart = table.cueball.pos.clone().addScaledVector(dir, R)
      const cueEnd = table.cueball.pos
        .clone()
        .addScaledVector(dir, R + len * 8 * R)
      this.targetLineMesh.geometry.setFromPoints([cueStart, cueEnd])
      this.targetLineMesh.geometry.computeBoundingSphere()
      this.targetLineMesh.visible = true
      return
    }

    // 目标球被击打后的运动方向（ghost ball 原理）：白球球心 → 目标球球心。
    // 注意：绝对不能用工具函数 norm()，它内部返回的是模块级共享的同一个
    // Vector3 实例，连续调用会就地覆写先前的结果，导致下面的点乘恒等于 1。
    const targetDir = this.tempVec
      .copy(closest.ball.pos)
      .sub(table.cueball.pos)
    if (targetDir.lengthSq() < 1e-9) {
      this.targetLineMesh.visible = false
      return
    }
    targetDir.normalize()

    // 在 6 个袋口中找与目标球运动方向夹角最小的那个
    const pockets = PocketGeometry.pocketCenters
    let bestPocket: Vector3 | null = null
    let bestDot = -1
    for (const p of pockets) {
      const toPocket = this.tempVec3.copy(p).sub(closest.ball.pos)
      if (toPocket.lengthSq() < 1e-9) continue
      toPocket.normalize()
      const d = toPocket.dot(targetDir)
      if (d > bestDot) {
        bestDot = d
        bestPocket = p
      }
    }

    // 线长度映射：len 1~5 → R*5 ~ R*25
    const lineLen = len * 5 * R
    const start = closest.ball.pos.clone().addScaledVector(targetDir, R)
    let endPoint: Vector3
    if (bestPocket && bestDot > 0.7) {
      // 方向大致对准袋口，直接指向袋口中心
      endPoint = bestPocket.clone()
      endPoint.z = start.z
    } else {
      // 否则沿击球方向延伸固定长度
      endPoint = closest.ball.pos.clone().addScaledVector(targetDir, R + lineLen)
    }
    this.targetLineMesh.geometry.setFromPoints([start, endPoint])
    this.targetLineMesh.geometry.computeBoundingSphere()
    this.targetLineMesh.visible = true
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
