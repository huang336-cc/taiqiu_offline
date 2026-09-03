import { Vector3 } from "three"
import { zero, vec, passesThroughZero } from "../utils/three-utils"
import {
  forceRoll,
  rollingFull,
  sliding,
  surfaceVelocityFull,
} from "../model/physics/physics"
import { BallMesh } from "../view/ballmesh"
import { Pocket } from "./physics/pocket"
import { BallAppearance } from "../view/ballappearance"

export enum State {
  Stationary = "Stationary",
  Rolling = "Rolling",
  Sliding = "Sliding",
  Falling = "Falling",
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
      this.rvel.lengthSq() !== 0 &&
      surfaceVelocityFull(this.vel, this.rvel).length() < Ball.transition
    )
  }

  onTable() {
    return this.state !== State.Falling && this.state !== State.InPocket
  }

  inMotion() {
    return (
      this.state === State.Rolling ||
      this.state === State.Sliding ||
      this.isFalling()
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
    this.vel.x = Math.fround(this.vel.x)
    this.vel.y = Math.fround(this.vel.y)
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
