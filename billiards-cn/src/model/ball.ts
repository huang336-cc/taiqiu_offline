import { Vector3 } from "three"
import { zero, vec, passesThroughZero } from "../utils/three-utils"
import {
  forceRoll,
  rollingFull,
  sliding,
  surfaceVelocityFull,
} from "../model/physics/physics"
import { g } from "../model/physics/constants"
import { BallMesh } from "../view/ballmesh"
import { Pocket } from "./physics/pocket"
import { BallAppearance } from "../view/ballappearance"

export enum State {
  Stationary = "Stationary",
  Rolling = "Rolling",
  Sliding = "Sliding",
  Falling = "Falling",
  /**
   * v1.3.94：空中状态（跳球）。引擎此前严格 2D，此状态不存在；放开竖直
   * 运动后必须有独立分支：空中的球不受台面摩擦、不被 forceRoll 强制前滚、
   * 也不该被判为 Rolling。新增状态必须同步 inMotion()，否则
   * Table.allStationary() 会在球还在空中时返回 true，导致本杆提前结算。
   */
  Airborne = "Airborne",
  InPocket = "InPocket",
}

export class Ball {
  readonly pos: Vector3
  readonly vel: Vector3 = zero.clone()
  readonly rvel: Vector3 = zero.clone()
  readonly futurePos: Vector3 = zero.clone()
  readonly ballmesh!: BallMesh
  state: State = State.Stationary
  pocket: Pocket
  /** v1.3.94（斯登/跟杆/缩杆）：标识白球。碰撞冲量只把纵向自旋→速度作用于
   *  白球，对象球间不施加，避免改变对象球碰撞行为（守住 AI 不退化红线）。
   *  Table 构造时对 balls[0] 置 true（白球恒为 balls[0]，见 table.ts）。 */
  isCue = false

  /**
   * v1.3.95：本杆开始时的位置，由 `Table.hit()` 写入。
   * 球飞出台面后（跳台犯规）要按规则放回原处，就得知道「原处」在哪。
   */
  readonly shotStart: Vector3 = new Vector3()

  /**
   * v1.3.95：本杆是否已经飞出台面。
   *
   * 一旦置位，该球就不再参与后续的碰撞 / 库边判定 —— 否则一个位于库外的球
   * 会被 `Cushion.bounceAny` 算出荒谬的速度（实测 vx 被翻到 -900 m/s），
   * 一步横跨整张台并引发连锁碰撞，最终 `Depth exceeded` 抛错卡死。
   * 由 `Table.checkOffTable` 写入，下一杆 `Table.hit()` 时清零。
   */
  offTable = false

  /**
   * v1.3.95：本杆是否曾经腾空过（哪怕已经落地）。
   *
   * 这是判「是不是真的飞出了球桌」的关键前提：**要离开台面就必须越过库边，
   * 而越过库边只可能发生在腾空时**。因此出界判定只对曾腾空的球生效，
   * 纯地面滚动 / 撞库的球永远不会走到界外，也就不会被误判。
   * 由 `updateAirborne` 置位，下一杆 `Table.hit()` 时清零。
   */
  wasAirborne = false

  public static id = 0
  readonly id = Ball.id++
  readonly label: number | undefined
  readonly appearance: BallAppearance | undefined

  static readonly transition = 0.05

  /**
   * v1.3.65：滚动状态下「线速度低于此值即判定静止」的显式阈值（m/s）。
   *
   * 原逻辑只有一条判据 —— `passesZero()` 里「本步速度增量 ≥ 当前速度」，
   * 且滚动时还额外要求 `|rvel.z| <= |Δw.z|`（见下）。带侧旋的球在线速度早已
   * 归零后，仍要等侧旋一路衰减完才肯判静止（实测约 5 秒），每杆结算被白白
   * 拖后，观感就是「球停了但系统还不出下一杆」。
   *
   * 取 1 cm/s：以滚动减速度 0.0977 m/s² 计，从 0.01 m/s 减到 0 只需 0.1 秒、
   * 位移 0.5 mm，肉眼完全不可见，可以安全截断。
   *
   * 只在 Rolling 分支生效 —— Sliding 状态下「线速度小但角速度大」是合法的
   * 物理状态（高杆/低杆起手瞬间），不能一刀切。
   */
  static readonly haltSpeed = 0.01

  /**
   * v1.3.94（跳球）：判定「这一杆是否让白球离台」的竖直速度门限（m/s）。
   * 取 0.05：以 g=9.8 计对应最大高度 ≈ v²/(2g) ≈ 0.13mm，远小于球半径，
   * 等价于「没离台」。用它做门限可保证平杆/微抬杆行为完全不变。
   */
  static readonly airborneThreshold = 0.05

  constructor(pos, color?, label?: number, appearance?: BallAppearance) {
    this.pos = pos.clone()
    this.label = label
    this.appearance = appearance
    if (typeof document !== "undefined") {
      this.ballmesh = new BallMesh(
        color || 0xeeeeee * Math.random(),
        label,
        appearance
      )
    }
  }

  readonly velBefore: Vector3 = new Vector3()

  update(t) {
    if (this.state == State.Falling) {
      this.updatePosition(t)
      this.pocket?.updateFall(this, t)
    } else if (this.state == State.Airborne) {
      this.updateAirborne(t)
    } else if (this.state == State.Rolling) {
      // A rolling ball can apply the trapezium rule
      // since it is guaranteed to be decelerating
      // this allows 'futurePos' which uses just current vel
      // to be a safe upper bound on actual position
      this.velBefore.copy(this.vel)
      this.updateVelocity(t)
      this.pos.addScaledVector(this.velBefore, t / 2)
      this.pos.addScaledVector(this.vel, t / 2)
    } else {
      // sliding ball more conservative less accurate
      this.updatePosition(t)
      this.updateVelocity(t)
    }
  }

  updateMesh(t) {
    this.ballmesh?.updateAll(this, t)
  }

  /**
   * v1.3.94（跳球）：空中运动积分。只受重力，水平分量空中不衰减（无台面
   * 摩擦）。梯形法积分竖直：z' = z + (vz + vz')·t/2，vz' = vz - g·t。
   * 落地（z ≤ 0）夹回 z=0、清除竖直速度，再按水平/角速度关系交还滚动或滑动。
   */
  private updateAirborne(t: number) {
    // v1.3.95：留下腾空痕迹，供 Table.checkOffTable 判断出界合法性
    this.wasAirborne = true
    const zBefore = this.pos.z
    const vzBefore = this.vel.z
    const vzAfter = vzBefore - g * t
    this.pos.z = zBefore + ((vzBefore + vzAfter) / 2) * t
    this.pos.x += this.vel.x * t
    this.pos.y += this.vel.y * t
    this.vel.z = vzAfter
    if (this.pos.z <= 0) {
      this.pos.z = 0
      this.vel.z = 0
      this.state = this.isRolling() ? State.Rolling : State.Sliding
    }
  }

  private updatePosition(t: number) {
    this.pos.addScaledVector(this.vel, t)
  }

  private updateVelocity(t: number) {
    if (this.inMotion()) {
      if (this.isRolling()) {
        this.state = State.Rolling
        // v1.3.65：线速度已低到肉眼不可见时直接停球，不再等侧旋衰减完
        // （阈值取 1 cm/s，理由见 Ball.haltSpeed 注释）。
        if (this.vel.length() < Ball.haltSpeed) {
          this.setStationary()
          return
        }
        forceRoll(this.vel, this.rvel)
        this.addDelta(t, rollingFull(this.rvel, this.vel, t))
      } else {
        this.state = State.Sliding
        this.addDelta(t, sliding(this.vel, this.rvel))
      }
    }
  }

  private addDelta(t: number, delta: { v: Vector3; w: Vector3 }) {
    // 1. Mutate by t upfront for the check, matching your existing structure
    delta.v.multiplyScalar(t)
    delta.w.multiplyScalar(t)

    // 2. Separate logic: Let passesZero handle the check, and handle the state mutation cleanly
    if (this.passesZero(delta)) {
      this.setStationary()
    } else {
      this.vel.add(delta.v)
      this.rvel.add(delta.w)
    }
  }

  private passesZero(delta: { v: Vector3; w: Vector3 }): boolean {
    // In Sliding state: Both linear and angular friction must overcome momentum to halt.
    // In Rolling state: Breaking traction on either side forces a transition or a halt.
    const vz = passesThroughZero(this.vel, delta.v)
    const wz = passesThroughZero(this.rvel, delta.w)
    const halts = this.state === State.Rolling ? vz || wz : vz && wz

    if (!halts) return false

    // Catch vertical spin (Z-axis) overshoot dynamically.
    // If the step size is larger than remaining angular velocity, it has spent its energy.
    return Math.abs(this.rvel.z) <= Math.abs(delta.w.z)
  }

  setStationary() {
    this.vel.copy(zero)
    this.rvel.copy(zero)
    this.state = State.Stationary
  }

  isRolling() {
    return (
      // v1.3.94：空中的球绝不算 Rolling（滚动是台面约束运动，空中无接触点）
      this.state !== State.Airborne &&
      this.rvel.lengthSq() !== 0 &&
      surfaceVelocityFull(this.vel, this.rvel).length() < Ball.transition
    )
  }

  onTable() {
    return this.state !== State.Falling && this.state !== State.InPocket
  }

  /** v1.3.94：跳球在空中（不受台面摩擦/不参与台面碰撞判定） */
  isAirborne() {
    return this.state === State.Airborne
  }

  inMotion() {
    return (
      this.state === State.Rolling ||
      this.state === State.Sliding ||
      this.isFalling() ||
      // v1.3.94：必须纳入 Airborne！否则 Table.allStationary() 在球还在空中时
      // 返回 true → 本杆提前结算。
      this.state === State.Airborne
    )
  }

  isFalling() {
    return this.state === State.Falling
  }

  futurePosition(t) {
    this.futurePos.copy(this.pos).addScaledVector(this.vel, t)
    return this.futurePos
  }

  fround() {
    this.pos.x = Math.fround(this.pos.x)
    this.pos.y = Math.fround(this.pos.y)
    // v1.3.94：跳球引入竖直运动，z 必须一并量化，否则回放/网络同步漂移
    this.pos.z = Math.fround(this.pos.z)
    this.vel.x = Math.fround(this.vel.x)
    this.vel.y = Math.fround(this.vel.y)
    this.vel.z = Math.fround(this.vel.z)
    this.rvel.x = Math.fround(this.rvel.x)
    this.rvel.y = Math.fround(this.rvel.y)
    this.rvel.z = Math.fround(this.rvel.z)
  }

  serialise() {
    return {
      pos: this.pos.clone(),
      id: this.id,
    }
  }

  static fromSerialised(data) {
    return Ball.updateFromSerialised(new Ball(vec(data.pos)), data)
  }

  static updateFromSerialised(b, data) {
    b.pos.copy(data.pos)
    b.vel.copy(data?.vel ?? zero)
    b.rvel.copy(data?.rvel ?? zero)
    return b
  }
}
