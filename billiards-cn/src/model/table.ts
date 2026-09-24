import { Cushion } from "./physics/cushion"
import { Collision } from "./physics/collision"
import { Knuckle } from "./physics/knuckle"
import { Pocket } from "./physics/pocket"
import { Cue } from "../view/cue"
import { Ball, State } from "./ball"
import { AimEvent } from "../events/aimevent"
import { TableGeometry } from "../view/tablegeometry"
import { Outcome } from "./outcome"
import { PocketGeometry } from "../view/pocketgeometry"
import { bounceHanBlend } from "./physics/physics"
import { zero } from "../utils/three-utils"
import { R } from "./physics/constants"
import { ProximityIndicator } from "../view/proximityindicator"
import { checkProximity } from "../utils/proximity"
import { ShotStartUtils, type ShotStartConditions } from "../utils/shotstart"
import { Vector3 } from "three"

interface Pair {
  a: Ball
  b: Ball
}

export class Table {
  balls: Ball[]
  cue!: Cue
  proximityIndicator!: ProximityIndicator
  proximityEnabled = false
  pairs: Pair[]
  outcome: Outcome[] = []
  time = 0
  cueball: Ball
  cushionModel = bounceHanBlend
  mesh
  /** Initial conditions of the current shot, captured in `hit()` so a depth-
   * exceeded exception can print a recreation link. Undefined until a shot
   * starts. Capture/build/report logic lives in `ShotStartUtils`. */
  shotStartConditions?: ShotStartConditions

  constructor(balls: Ball[]) {
    this.cueball = balls[0]
    // v1.3.94（斯登/跟杆/缩杆）：标记白球，供碰撞冲量只对其施加纵向自旋→速度
    this.cueball.isCue = true
    this.initialiseBalls(balls)
    if (typeof document !== "undefined") {
      this.cue = new Cue()
      this.proximityIndicator = new ProximityIndicator()
    }
  }

  initialiseBalls(balls: Ball[]) {
    this.balls = balls
    this.pairs = []
    for (let a = 0; a < balls.length; a++) {
      for (let b = 0; b < balls.length; b++) {
        if (a < b) {
          this.pairs.push({ a: balls[a], b: balls[b] })
        }
      }
    }
  }

  updateBallMesh(t) {
    this.balls.forEach((a) => {
      a.updateMesh(t)
    })
  }

  advance(t: number) {
    this.time += t * 1000
    // v1.3.95：每一步都要检查有没有球飞出台面。
    // 必须放在 while **之前**：出界的球不会再触发任何碰撞事件，若只在
    // 「发生了碰撞」时才检查，它就永远不会被发现 —— 表现为本杆永不结算。
    this.balls.forEach((a) => this.checkOffTable(a))
    let depth = 0
    while (!this.prepareAdvanceAll(t)) {
      if (depth++ > 100) {
        ShotStartUtils.reportDepthExceeded(this, this.shotStartConditions)
        throw new Error("Depth exceeded resolving collisions")
      }
    }
    this.balls.forEach((a) => {
      a.update(t)
      a.fround()
    })
    if (this.proximityEnabled && this.proximityIndicator) {
      checkProximity(
        this.outcome,
        this.cueball,
        this.balls,
        this.proximityIndicator,
        this.time
      )
    }
  }

  /**
   * Returns true if all balls can advance by t without collision
   *
   */
  prepareAdvanceAll(t: number) {
    return (
      this.pairs.every((pair) => this.prepareAdvancePair(pair.a, pair.b, t)) &&
      this.balls.every((ball) => this.prepareAdvanceToCushions(ball, t))
    )
  }

  /**
   * Returns true if a pair of balls can advance by t without any collision.
   * If there is a collision, adjust velocity appropriately.
   *
   */
  private prepareAdvancePair(a: Ball, b: Ball, t: number) {
    if (Collision.willCollide(a, b, t)) {
      const incidentSpeed = Collision.collide(a, b)
      this.outcome.push(Outcome.collision(a, b, incidentSpeed, this.time))
      return false
    }
    return true
  }

  /**
   * Returns true if ball can advance by t without hitting cushion, knuckle or pocket.
   * If there is a collision, adjust velocity appropriately.
   *
   */
  private prepareAdvanceToCushions(a: Ball, t: number): boolean {
    if (!a.onTable()) {
      return true
    }
    /**
     * v1.3.95：已判出界的球不再参与库边 / 袋口判定。
     *
     * 位于台面之外的球会被 `Cushion.bounceAny` 算出荒谬的速度（实测 vx 被翻到
     * -900+ m/s），表现为一个球一步横跨整张台并连锁引发 `Depth exceeded`。
     * 出界的球已被 `checkOffTable` 停住，这里只需保证它不再被反弹。
     */
    if (a.offTable) {
      return true
    }
    /**
     * v1.3.94（跳球）：空中的球越过库边——库边与袋口都只在贴台时判定。
     * 库边高度取 1.5R；球心高于此值时球体下缘已高过库顶，不再碰撞。
     * 贴台（z≈0）时该判据恒为真，既有行为逐位不变。
     */
    const AIRBORNE_CLEARANCE = R * 1.5
    if (a.pos.z > AIRBORNE_CLEARANCE) {
      return true
    }
    /**
     * v1.3.94（跳球）：球已明显离开台面（中心超出库边线 5R 以上）则不再反弹。
     * 否则跳球飞越库边、落点在界外时，willBounceShortSegment 会对这个「桌外球」
     * 算出荒谬的反弹速度（实测 vx 被翻到 -900+ m/s，球一步横跨整张台），表现
     * 为离谱的横跳。
     * 阈值取 tableX + 5R / tableY + 5R：常规贴库球（球心最多到 tableX-R 附近、
     * 表面刚触库）远未达此值，仍正常反弹；只有真正飞出界的跳球才触发。
     */
    if (
      Math.abs(a.pos.x) >= TableGeometry.tableX + 5 * R ||
      Math.abs(a.pos.y) >= TableGeometry.tableY + 5 * R
    ) {
      return true
    }
    const futurePosition = a.futurePosition(t)
    if (
      Math.abs(futurePosition.y) < TableGeometry.tableY &&
      Math.abs(futurePosition.x) < TableGeometry.tableX
    ) {
      return true
    }

    const result = Cushion.bounceAny(
      a,
      t,
      TableGeometry.hasPockets,
      this.cushionModel
    )
    if (result && result.incidentSpeed) {
      this.outcome.push(
        Outcome.cushion(a, result.incidentSpeed, this.time, result.cushion)
      )
      return false
    }

    if (TableGeometry.hasPockets) {
      const k = Knuckle.findBouncing(a, t)
      if (k) {
        const knuckleIncidentSpeed = k.bounce(a)
        this.outcome.push(Outcome.cushion(a, knuckleIncidentSpeed, this.time))
        return false
      }
      const p = Pocket.findPocket(PocketGeometry.pocketCenters, a, t)
      if (p) {
        const pocketIncidentSpeed = p.fall(a, t)
        this.outcome.push(Outcome.pot(a, pocketIncidentSpeed, this.time))
        return false
      }
    }

    return true
  }

  /**
   * v1.3.95：曾腾空的球越过库线多少才算真的出界（米）。
   *
   * 库判定是围绕 `futurePosition` 做的，而这里看的是**已结算的实际位置**，
   * 高速擦库时两者会有偏差，所以要留容差，不能贴着 0 判。
   */
  private static readonly OFF_AIR_MARGIN = R * 1.2
  /** v1.3.95：袋口豁免半径 —— 落在袋口里的球是进球，不是出界 */
  private static readonly POCKET_SAFE = R * 3.5
  /**
   * v1.3.95：硬兜底。任何球跑到离库这么远，都必然是异常出界
   * （正常贴库的球心不可能离开库线如此之远），必须兜住不能让它一直飞。
   */
  private static readonly OFF_HARD = R * 8

  /**
   * v1.3.95：判定并处理「球飞出台面」。
   *
   * ## 为什么必须区分「是否曾腾空」
   * 要离开台面就必须越过库边，而越过库边**只能**发生在腾空时。所以出界判定
   * 只对 `wasAirborne` 的球生效 —— 纯地面滚动 / 撞库的球永远不会走到界外，
   * 这条判据对它们零影响，不存在「把正常贴库球误判成出界」的风险。
   * 未腾空间的球只在远达 OFF_HARD 时才兜底处理。
   *
   * ## 处置
   * 标记 offTable 并**立即停球**，同时产出 `Outcome.offTable`。停球这一步是
   * 修复卡死的关键：此前没有任何东西让出界的球停下来，`allStationary()`
   * 永远为假 → 本杆永不结算；或者它在库外参与反弹算出荒谬速度 →
   * 连锁到 Depth exceeded。
   */
  private checkOffTable(a: Ball) {
    if (a.offTable || !a.onTable()) return
    const overX = Math.abs(a.pos.x) - TableGeometry.tableX
    const overY = Math.abs(a.pos.y) - TableGeometry.tableY
    const over = Math.max(overX, overY)
    if (over <= 0) return

    if (!a.wasAirborne) {
      if (over <= Table.OFF_HARD) return
    } else if (over <= Table.OFF_AIR_MARGIN) {
      return
    }

    // 落在某个袋口里 → 是正常的进球，交给落袋逻辑
    if (TableGeometry.hasPockets) {
      for (const p of PocketGeometry.pocketCenters) {
        if (
          Math.hypot(a.pos.x - p.pos.x, a.pos.y - p.pos.y) <
          Table.POCKET_SAFE
        ) {
          return
        }
      }
    }

    a.offTable = true
    const speed = a.vel.length()
    // 夹回库线内侧：避免球停在桌子外面很远处（视觉突兀，也方便规则层摆回）
    a.pos.x = Math.max(
      -TableGeometry.tableX,
      Math.min(TableGeometry.tableX, a.pos.x)
    )
    a.pos.y = Math.max(
      -TableGeometry.tableY,
      Math.min(TableGeometry.tableY, a.pos.y)
    )
    a.pos.z = 0
    /**
     * v1.3.95：夹回点**不能压在别的球身上**。
     *
     * 典型场景是跳球：`Collision.willCollide` 的距离里含 z，球可以从贴库球
     * **头顶飞过**，随后越过库边 → 这里把它夹回 ±tableX（正好是贴库球所在）
     * 并把 z 归零 → 两球心距远小于 2R。
     *
     * 静止重叠时 `allStationary()` 仍为真，看上去「正常结算了」，但下一杆任
     * 何一次 movement 都会让 `willCollide` 立刻成立、却又推不开，`prepareAdvanceAll`
     * 永远返回 false → 100 层后抛 Depth exceeded —— 直接表现为整局卡死。
     * （复现见 tools/harness/offtable.ts 的 T8）
     *
     * 处理：沿**库线方向**（与出界轴垂直的那条）左右交替找第一个不重叠且不
     * 出界的点。这一步只是把「 computationally 摆不正」的点挪开，不改变
     * 出界判定本身。
     */
    if (this.overlapsAny(a.pos, a)) {
      const alongY = Math.abs(a.pos.x) >= TableGeometry.tableX - 1e-9
      const probe = new Vector3()
      let moved = false
      for (let k = 1; k <= 600 && !moved; k++) {
        const d = (k * R) / 8
        // 交替向两侧搜索，取离原夹回点最近的可行解
        for (const s of k % 2 === 1 ? [d, -d] : [-d, d]) {
          probe.set(
            alongY ? a.pos.x : a.pos.x + s,
            alongY ? a.pos.y + s : a.pos.y,
            0
          )
          if (
            Math.abs(probe.x) > TableGeometry.tableX ||
            Math.abs(probe.y) > TableGeometry.tableY
          ) {
            continue
          }
          if (!this.overlapsAny(probe, a)) {
            a.pos.copy(probe)
            moved = true
            break
          }
        }
      }
    }
    // 立即停球 —— 本杆因此得以正常结算
    a.setStationary()
    this.outcome.push(Outcome.offTable(a, speed, this.time))
  }

  allStationary() {
    return this.balls.every((b) => !b.inMotion())
  }

  inPockets(): number {
    return this.balls.reduce((acc, b) => (b.onTable() ? acc : acc + 1), 0)
  }

  hit() {
    this.shotStartConditions = ShotStartUtils.capture(this)
    this.time = 0
    this.cue?.hit(this.cueball)
    this.balls.forEach((b) => {
      // v1.3.95：记录本杆起始状态 —— 出界后要按规则把球放回原处，
      // 且必须清掉上一杆留下的腾空 / 出界痕迹。
      b.shotStart.copy(b.pos)
      b.offTable = false
      b.wasAirborne = false
      b.ballmesh?.trace.reset()
    })
  }

  serialise() {
    return {
      balls: this.balls.map((b) => b.serialise()),
      aim: this.cue?.aim.copy(),
    }
  }

  serialiseHit() {
    const aim = this.cue.aim.copy()
    aim.pos.copy(this.cueball.pos)

    return {
      balls: [this.balls[0].serialise()],
      aim,
    }
  }

  static fromSerialised(data) {
    const table = new Table(data.balls.map((b) => Ball.fromSerialised(b)))
    table.updateFromSerialised(data)
    return table
  }

  updateFromSerialised(data) {
    if (data.balls) {
      data.balls.forEach((b) => Ball.updateFromSerialised(this.balls[b.id], b))
    }
    if (data.aim && this.cue) {
      this.cue.aim = AimEvent.fromJson(data.aim)
    }
  }

  shortSerialise() {
    return this.balls
      .map((b) => [b.pos.x, b.pos.y])
      .reduce((acc, val) => acc.concat(val), [])
  }

  updateFromShortSerialised(data) {
    this.balls.forEach((b, i) => {
      b.pos.x = data[i * 2]
      b.pos.y = data[i * 2 + 1]
      b.pos.z = 0
      b.vel.copy(zero)
      b.rvel.copy(zero)
      b.state = State.Stationary
    })
  }

  addToScene(scene) {
    this.balls.forEach((b) => {
      b.ballmesh?.addToScene(scene)
    })
    if (this.cue) {
      scene.add(this.cue.mesh)
      scene.add(this.cue.helperMesh)
      scene.add(this.cue.placerMesh)
      scene.add(this.cue.shadowMesh)
      scene.add(this.cue.aimLine.group)
    }
    if (this.proximityIndicator) {
      scene.add(this.proximityIndicator.group)
    }
  }

  showTraces(bool) {
    this.balls.forEach((b) => {
      if (b.ballmesh) {
        b.ballmesh.trace.line.visible = bool
        b.ballmesh.trace.reset()
      }
    })
  }

  freezeTraces(scene) {
    this.balls.forEach((b) => b.ballmesh?.freezeTrace(scene))
  }

  showSpin(bool) {
    this.balls.forEach((b) => {
      if (b.ballmesh) {
        b.ballmesh.spinAxisArrow.visible = bool
      }
    })
  }

  halt() {
    this.balls.forEach((b) => {
      b.vel.copy(zero)
      b.rvel.copy(zero)
      b.state = State.Stationary
    })
  }

  overlapsAny(pos, excluding = this.cueball) {
    return this.balls
      .filter((b) => b !== excluding)
      .some((b) => b.pos.distanceTo(pos) < 2 * R)
  }
}
