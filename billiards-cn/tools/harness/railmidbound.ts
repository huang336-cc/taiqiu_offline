/**
 * v1.4.0 中袋穿越点阈值校准（railmidbound）。
 *
 * 目的：railMidMouthExcess 用「内缩袋心（×0.94）直线」计算穿越点，
 * 阈值取 middleKnuckleInset = 2.6R。本脚本在阈值附近密采，
 * 实测进球率是否在 excess ≈ 0 处骤降 —— 验证判据口径自洽。
 *
 * 运行：npx tsx tools/harness/railmidbound.ts
 */
import "./predom"
import { Vector3 } from "three"
import { R } from "../../src/model/physics/constants"
import { Ball, State } from "../../src/model/ball"
import { Table } from "../../src/model/table"
import { Outcome } from "../../src/model/outcome"
import { PocketGeometry } from "../../src/view/pocketgeometry"
import { TableGeometry } from "../../src/view/tablegeometry"
import { AimCalculator } from "../../src/network/bot/aimcalculator"
import { Cue } from "../../src/view/cue"

const TX = TableGeometry.tableX
const TY = TableGeometry.tableY

const centers = PocketGeometry.pocketCenters.map((p) => p.pos.clone())
const P_N = centers[2] // 外袋心
const P_N_INSET = P_N.clone().multiplyScalar(AimCalculator.POCKET_INSET_FACTOR)

const CUE = new Vector3(-20 * R, TY - 1.5 * R, 0)
const BALL_Y = TY - 1.5 * R
const STEP = 0.001953125

function makeTable(cuePos: Vector3, objPos: Vector3) {
  const cue = new Ball(cuePos.clone(), undefined, 0)
  const obj = new Ball(objPos.clone(), undefined, 1)
  const others: Ball[] = []
  for (let l = 2; l <= 15; l++) {
    const b = new Ball(new Vector3(TX * 3, TY * 3 + l * 0.1, 0), undefined, l)
    b.setStationary()
    b.state = State.InPocket
    others.push(b)
  }
  const table = new Table([cue, obj, ...others])
  table.cue = new Cue()
  table.cueball = cue
  return { table, cue, obj }
}

function tryShot(
  cuePos: Vector3,
  objPos: Vector3,
  pocketCenter: Vector3,
  power: number,
  aimNoise: number
): boolean {
  const { table, cue, obj } = makeTable(cuePos, objPos)
  const calc = new AimCalculator()
  const pocketInset = pocketCenter
    .clone()
    .multiplyScalar(AimCalculator.POCKET_INSET_FACTOR)
  const aimPoint = calc.getAimPoint(cue.pos, obj.pos, [pocketInset])
  const hit = calc.generateShot(table, aimNoise, power, aimPoint)
  table.cue!.aim = (hit.tablejson as { aim: never }).aim
  table.cue!.hit(cue)
  let guard = 0
  while (!table.allStationary() && guard++ < 300000) {
    // 极端噪声下偶发两球挤在库角无法解算 —— 记为不进（与决策层无关）
    try {
      table.advance(STEP)
    } catch {
      return false
    }
  }
  return Outcome.pots(table.outcome).includes(obj)
}

function mulberry32(a: number) {
  return function () {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ 0
    return ((t ^ (t >>> 16)) >>> 0) / 4294967296
  }
}

function sample(cuePos: Vector3, objPos: Vector3, pk: Vector3, n: number, power: number) {
  let pot = 0
  for (let i = 0; i < n; i++) {
    const noise = (rnd() * 2 - 1) * 0.004
    if (tryShot(cuePos, objPos, pk, power, noise)) pot++
  }
  return pot / n
}

let rnd: () => number = mulberry32(1)
const fmt = (x: number) => (x * 100).toFixed(1) + "%"

console.log(`\n=== 中袋穿越点阈值校准（每格 40 杆，power=95R） ===`)
console.log(
  `内缩袋心 y=${(P_N_INSET.y / R).toFixed(2)}R  外袋心 y=${(P_N.y / R).toFixed(2)}R`
)
console.log(`判据：excess = |crossX(内缩直线)| − 2.6R，>0 = 口外(判必失)\n`)
console.log(
  "球x(R)".padEnd(9) +
    "crossX_in(R)".padEnd(13) +
    "excess(R)".padEnd(12) +
    "打N袋".padEnd(9) +
    "打NE袋".padEnd(9)
)

for (const xR of [-6, -5, -4.5, -4, -3.5, -3, -2.5, -2, 2, 2.5, 3, 3.5, 4, 4.5, 5]) {
  rnd = mulberry32(4242 + Math.round(xR * 10) * 7)
  const obj = new Vector3(xR * R, BALL_Y, 0)
  // 内缩直线穿越点（与 railMidMouthExcess 完全一致）
  const dy = P_N_INSET.y - obj.y
  const t = (TY - obj.y) / dy
  const crossX = obj.x + t * (P_N_INSET.x - obj.x)
  const excess = Math.abs(crossX) - PocketGeometry.middleKnuckleInset
  const rN = sample(CUE, obj, P_N, 40, 95 * R)
  const rNE = sample(CUE, obj, centers[4], 40, 95 * R)
  const exStr =
    (excess / R >= 0 ? "+" : "") + (excess / R).toFixed(2) + "R"
  console.log(
    String(xR).padEnd(9) +
      (crossX / R).toFixed(2).padEnd(13) +
      exStr.padEnd(12) +
      fmt(rN).padEnd(9) +
      fmt(rNE).padEnd(9)
  )
}
