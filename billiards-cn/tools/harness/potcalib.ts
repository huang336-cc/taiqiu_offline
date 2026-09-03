/**
 * v1.3.68 力度物理化校准实验（potcalib）。
 *
 * 三段隔离测量，用来**证伪或确认** src/network/bot/powerphysics.ts 的解析模型：
 *
 *  A 段（隔离 a_obj，先跑这个最快证伪）
 *    不留母球。直接给物体球一个纯平动初速 v 滚向袋心，
 *    d ∈ {0.3, 0.5, 0.75, 1.0, 1.5, 2.0, 2.5} × 袋型 {角, 中}，
 *    二分找「刚好落袋」的最小速度 v_min。
 *    预期验证：v_min ≈ sqrt(2 · a_obj · D)，其中 D = d − 袋半径。
 *
 *  B 段（隔离 f(spin)）
 *    固定 d_obj = 1.0、cutCos = 1.0，扫描 spin.y ∈ {0, −0.22, −0.28, −0.38, −0.45, +0.26}，
 *    二分找最小进袋「出杆速度」vCue_min，回归 f(sy) = v_roll / v0。
 *    预期验证：f(sy) ≈ 1 − (1 − 2.5·sy)/3.5。
 *
 *  C 段（定 margin）
 *    d_obj × cutCos × 袋型 网格扫 vCue，输出最小进袋速度 + 进袋区间上界，
 *    用来敲定安全余量 margin。
 *
 * 用法：
 *   npx tsx tools/harness/potcalib.ts a          # 只跑 A 段
 *   npx tsx tools/harness/potcalib.ts b          # 只跑 B 段
 *   npx tsx tools/harness/potcalib.ts c          # 只跑 C 段
 *   npx tsx tools/harness/potcalib.ts            # 全跑
 */
import "./predom"
import { Table } from "../../src/model/table"
import { Ball, State } from "../../src/model/ball"
import { R } from "../../src/model/physics/constants"
import { TableGeometry } from "../../src/view/tablegeometry"
import { PocketGeometry } from "../../src/view/pocketgeometry"
import { Outcome } from "../../src/model/outcome"
import { Vector3 } from "three"
import { AimCalculator } from "../../src/network/bot/aimcalculator"
import { Cue } from "../../src/view/cue"
import { AimEvent } from "../../src/events/aimevent"
import {
  aObject,
  aRoll,
  fSpin,
  POCKET_RADIUS_CORNER,
  POCKET_RADIUS_MIDDLE,
} from "../../src/network/bot/powerphysics"

const STEP = 0.001953125
/** 台面半长/半宽，用于摆放球 */
const TX = TableGeometry.X
const TY = TableGeometry.Y

/** 建一张只有母球 + 一颗物体球的极简球桌（其它球挪到台外避免干扰） */
function makeTable(cuePos: Vector3, objPos: Vector3): { table: Table; cue: Ball; obj: Ball } {
  const cue = new Ball(cuePos.clone(), undefined, 0)
  const obj = new Ball(objPos.clone(), undefined, 1)
  // 其余 13 颗塞到台面外（potted），避免碰撞干扰
  const others: Ball[] = []
  for (let l = 2; l <= 15; l++) {
    const b = new Ball(new Vector3(TX * 3, TY * 3 + l * 0.1, 0), undefined, l)
    b.setStationary()
    others.push(b)
  }
  const balls = [cue, obj, ...others]
  const table = new Table(balls)
  table.cue = new Cue()
  table.cueball = cue
  return { table, cue, obj }
}

function runOut(table: Table) {
  let guard = 0
  while (!table.allStationary() && guard++ < 300000) {
    table.advance(STEP)
  }
}

/** 物体球是否落袋 */
function objPotted(table: Table, obj: Ball): boolean {
  return Outcome.pots(table.outcome).includes(obj)
}

/**
 * A 段：物体球纯平动滚向袋心，二分找最小落袋速度。
 * obj 放在距袋口 d 处（沿袋心方向），直接给 vel。
 */
function segmentA() {
  console.log("\n=== A 段：物体球等效减速 a_obj 测量 ===")
  const aObjModel = aObject()
  const aRollModel = aRoll()
  console.log(
    `模型值: a_roll=${aRollModel.toFixed(5)}  a_obj=${aObjModel.toFixed(5)}  ` +
      `比值=${(aObjModel / aRollModel).toFixed(3)}`
  )
  console.log("袋型     d(m)   D=d-R(m)   实测v_min   模型预测   误差")

  const cases: Array<{ name: string; center: Vector3; radius: number }> = [
    { name: "角袋", center: PocketGeometry.pocketCenters[0].pos.clone(), radius: POCKET_RADIUS_CORNER },
    { name: "中袋", center: PocketGeometry.pocketCenters[2].pos.clone(), radius: POCKET_RADIUS_MIDDLE },
  ]

  for (const c of cases) {
    for (const d of [0.3, 0.5, 0.75, 1.0, 1.5, 2.0, 2.5]) {
      // 物体球放在袋心沿台心方向退 d 米处
      const toCenter = new Vector3(-c.center.x, -c.center.y, 0).normalize()
      const objPos = c.center.clone().addScaledVector(toCenter, d)
      // 越过台面就跳过
      if (Math.abs(objPos.x) > TX - 2 * R || Math.abs(objPos.y) > TY - 2 * R) continue

      // 二分：找最小能落袋的速度
      let lo = 0.05
      let hi = 3.0
      const pottedAt = (v: number): boolean => {
        const { table, obj } = makeTable(new Vector3(0, 0, 0), objPos)
        // 母球挪到台外，不参与
        table.cueball.pos.set(TX * 3, TY * 3, 0)
        table.cueball.setStationary()
        obj.vel.copy(toCenter.clone().multiplyScalar(-1).multiplyScalar(v))
        obj.state = State.Sliding
        runOut(table)
        return objPotted(table, obj)
      }
      if (!pottedAt(hi)) {
        console.log(`${c.name}   ${d.toFixed(2)}   —     未落袋(>3.0)   —         —`)
        continue
      }
      for (let i = 0; i < 22; i++) {
        const mid = (lo + hi) / 2
        if (pottedAt(mid)) hi = mid
        else lo = mid
      }
      const vMin = hi
      const D = Math.max(0.05, d - c.radius)
      const predicted = Math.sqrt(2 * aObjModel * D)
      const err = ((vMin - predicted) / predicted) * 100
      console.log(
        `${c.name}   ${d.toFixed(2)}   ${D.toFixed(4)}     ${vMin.toFixed(4)}      ` +
          `${predicted.toFixed(4)}     ${err >= 0 ? "+" : ""}${err.toFixed(1)}%`
      )
    }
  }
}

/**
 * B 段：隔离 f(spin)。固定 d_obj=1.0、cutCos=1.0（直线球），
 * 扫 spin.y 找最小进袋出杆速度，反推 v_roll/v0。
 */
function segmentB() {
  console.log("\n=== B 段：低杆/高杆剩余滚动比 f(spin) 测量 ===")
  console.log("spin.y   实测vCue_min   模型f(sy)   实测f(实测/无旋基准)   模型预测vCue")

  const dObj = 1.0
  const center = PocketGeometry.pocketCenters[0].pos.clone()
  const toCenter = new Vector3(-center.x, -center.y, 0).normalize()
  const objPos = center.clone().addScaledVector(toCenter, dObj)
  const D = Math.max(0.05, dObj - POCKET_RADIUS_CORNER)
  const vObjNeeded = Math.sqrt(2 * aObject() * D)

  // 基准：无旋 (spin.y = 0) 的最小出杆速度
  const minCueFor = (spinY: number): number => {
    // 母球放在物体球正后方 0.5m（直线球）
    const cuePos = objPos.clone().addScaledVector(toCenter, 0.5)
    let lo = 0.05
    let hi = 4.0
    const pottedAt = (v: number): boolean => {
      const { table, cue, obj } = makeTable(cuePos, objPos)
      const aim = new AimEvent()
      aim.pos.copy(cue.pos)
      aim.i = 0
      const dir = objPos.clone().sub(cuePos)
      aim.angle = Math.atan2(dir.y, dir.x)
      aim.power = v
      aim.offset = new Vector3(0, spinY, 0)
      table.cue!.aim = aim
      table.cue!.hit(cue)
      runOut(table)
      return objPotted(table, obj)
    }
    if (!pottedAt(hi)) return NaN
    for (let i = 0; i < 20; i++) {
      const mid = (lo + hi) / 2
      if (pottedAt(mid)) hi = mid
      else lo = mid
    }
    return hi
  }

  const baseline = minCueFor(0)
  if (Number.isNaN(baseline)) {
    console.log("基准（无旋）未能在 4.0 m/s 内落袋，B 段跳过")
    return
  }

  for (const sy of [0, -0.22, -0.28, -0.38, -0.45, 0.26]) {
    const v = minCueFor(sy)
    const fModel = fSpin(sy)
    // 实测 f: 出杆速度反比于 f（f 越小，同样滚动速度需要越大出杆速度）
    const fMeasured = Number.isNaN(v) ? NaN : baseline / v
    const predictedCue = baseline * (fSpin(0) / fModel)
    console.log(
      `${sy.toFixed(2).padStart(6)}   ${Number.isNaN(v) ? "—" : v.toFixed(4)}        ` +
        `${fModel.toFixed(3)}       ${Number.isNaN(fMeasured) ? "—" : fMeasured.toFixed(3)}` +
        `              ${predictedCue.toFixed(4)}`
    )
  }
}

/**
 * C 段：d_obj × cutCos × 袋型 网格扫，输出最小进袋速度 + 区间上界。
 */
function segmentC() {
  console.log("\n=== C 段：网格扫（最小进袋 vCue / 上界）===")
  console.log("袋型   d_obj  cutCos   vCue_min   vCue_max(仍进袋)")

  for (const c of [
    { name: "角袋", center: PocketGeometry.pocketCenters[0].pos.clone(), radius: POCKET_RADIUS_CORNER },
    { name: "中袋", center: PocketGeometry.pocketCenters[2].pos.clone(), radius: POCKET_RADIUS_MIDDLE },
  ]) {
    const toCenter = new Vector3(-c.center.x, -c.center.y, 0).normalize()
    for (const dObj of [0.5, 1.0, 1.5, 2.0, 2.5]) {
      for (const cutCos of [1.0, 0.85, 0.7, 0.5, 0.34]) {
        const objPos = c.center.clone().addScaledVector(toCenter, dObj)
        if (Math.abs(objPos.x) > TX - 2 * R || Math.abs(objPos.y) > TY - 2 * R) continue
        // 母球放在与「物体球→袋」成 cutCos 夹角的方向上，距物体球 0.6m
        const toPocket = c.center.clone().sub(objPos).normalize()
        const theta = Math.acos(Math.max(-1, Math.min(1, cutCos)))
        const backDir = toPocket.clone().applyAxisAngle(new Vector3(0, 0, 1), Math.PI - theta)
        const cuePos = objPos.clone().addScaledVector(backDir, 0.6)
        if (Math.abs(cuePos.x) > TX - 2 * R || Math.abs(cuePos.y) > TY - 2 * R) continue

        // 用 AimCalculator 算 ghost 瞄准点（与 AI 真实路径一致）
        const calc = new AimCalculator()
        const pocketInset = c.center.clone().multiplyScalar(0.94)
        const aimPoint = calc.getAimPoint(cuePos, objPos, [pocketInset])

        const pottedAt = (v: number): boolean => {
          const { table, cue, obj } = makeTable(cuePos, objPos)
          const aim = new AimEvent()
          aim.pos.copy(cue.pos)
          aim.i = 0
          const dir = aimPoint.clone().sub(cuePos)
          aim.angle = Math.atan2(dir.y, dir.x)
          aim.power = v
          aim.offset = new Vector3(0, -0.22, 0)
          table.cue!.aim = aim
          table.cue!.hit(cue)
          runOut(table)
          return objPotted(table, obj)
        }

        let lo = 0.05
        let hi = 5.0
        if (!pottedAt(hi)) {
          console.log(`${c.name}   ${dObj.toFixed(2)}   ${cutCos.toFixed(2)}    未落袋`)
          continue
        }
        for (let i = 0; i < 18; i++) {
          const mid = (lo + hi) / 2
          if (pottedAt(mid)) hi = mid
          else lo = mid
        }
        const vMin = hi
        // 上界：从 vMin 往上找仍进袋的最大速度
        let vMax = vMin
        for (let v = vMin + 0.15; v <= 5.0; v += 0.15) {
          if (pottedAt(v)) vMax = v
          else break
        }
        console.log(
          `${c.name}   ${dObj.toFixed(2)}   ${cutCos.toFixed(2)}    ${vMin.toFixed(4)}    ${vMax.toFixed(4)}`
        )
      }
    }
  }
}

const which = (process.argv[2] ?? "all").toLowerCase()
if (which === "a" || which === "all") segmentA()
if (which === "b" || which === "all") segmentB()
if (which === "c" || which === "all") segmentC()
