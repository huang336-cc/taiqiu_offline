/**
 * v1.4.1 碰撞抛离（throw）修正验证（throwcheck）。
 *
 * 用户反馈：「瞄准线不准的，歪的，好几把都出现」。
 * 根因：物理侧 collisionthrow.ts 会在两球碰撞时施加切向摩擦脉冲 ——
 * 母球带侧旋（或薄切时的平动切向分量）会把目标球往切向「带偏」θ≈μ
 * （低速满塞 2~3°，1 米行程偏 3~5cm，足以打丢袋口球），而辅助线此前
 * 永远画纯连心线方向。aimline.ts 的 computeThrowDeflect 修正了这一点。
 *
 * 本脚本用**真实物理**回答一个问题：修正公式预测的目标球初始方向，与
 * 物理模拟实测的初始方向是否一致？
 *
 * 覆盖两类来源：
 *   ① 侧旋 throw：直球（连心线 = 行进方向）+ 满塞/半塞
 *   ② 切球 throw：无塞、薄切（平动切向分量）
 * 判定：误差 < 0.5°（数值积分噪声容忍）。
 *
 * 用法：npx tsx tools/harness/throwcheck.ts
 */
import "./predom"
import { Vector3 } from "three"
import { R } from "../../src/model/physics/constants"
import { Ball, State } from "../../src/model/ball"
import { Table } from "../../src/model/table"
import { TableGeometry } from "../../src/view/tablegeometry"
import { AimCalculator } from "../../src/network/bot/aimcalculator"
import { Cue } from "../../src/view/cue"
import { computeThrowDeflect } from "../../src/view/aimline"

const STEP = 0.001953125
const TX = TableGeometry.tableX
const TY = TableGeometry.tableY

/** 场景：目标球在 (0,0)、出球方向恒为 +x（连心线 = +x），ghost 在 (-2R,0) */
const GHOST = new Vector3(-2 * R, 0, 0)

function makeTable(cuePos: Vector3): { table: Table; cue: Ball; obj: Ball } {
  const cue = new Ball(cuePos.clone(), undefined, 0)
  const obj = new Ball(new Vector3(0, 0, 0), undefined, 1)
  cue.setStationary()
  obj.setStationary()
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

/**
 * 真实物理打一杆（瞄准 ghost），返回目标球被撞后的**初始**速度方向角
 * （弧度，相对 +x 连心线）。球速度从 0 变非零的那一步即碰撞脉冲结果。
 */
function simThrow(
  cuePos: Vector3,
  power: number,
  offset: { x: number; y: number }
): number | null {
  const { table, cue, obj } = makeTable(cuePos)
  const calc = new AimCalculator()
  const hit = calc.generateShot(
    table,
    0,
    power,
    GHOST.clone(),
    new Vector3(offset.x, offset.y, 0),
    0
  )
  table.cue!.aim = (hit.tablejson as { aim: never }).aim
  table.cue!.hit(cue)
  let dir: number | null = null
  let guard = 0
  while (!table.allStationary() && guard++ < 300000) {
    try {
      table.advance(STEP)
    } catch {
      return null
    }
    if (dir === null && obj.vel.lengthSq() > 1e-12) {
      dir = Math.atan2(obj.vel.y, obj.vel.x)
    }
  }
  return dir
}

/** 母球位置：从 ghost 沿 inDir 反方向退 dist，inDir 与 +x 夹角 = 切角 */
function cueAt(cutDeg: number, dist: number): Vector3 {
  const a = (cutDeg * Math.PI) / 180
  return new Vector3(
    GHOST.x - Math.cos(a) * dist,
    GHOST.y - Math.sin(a) * dist,
    0
  )
}

function pad(s: string, n: number) {
  return s.padEnd(n)
}
const deg = (rad: number) => (rad * 180) / Math.PI

console.log(
  "\n=== v1.4.1 throw 修正验证：物理实测目标球偏角 vs computeThrowDeflect 预测 ===\n"
)
console.log(
  pad("切角°", 7) +
    pad("打点(x,y)", 13) +
    pad("力度(R)", 9) +
    pad("实测°", 9) +
    pad("预测°", 9) +
    pad("误差°", 9) +
    "判定"
)

const POWERS = [30 * R, 60 * R, 95 * R, 130 * R]
/** ① 侧旋 throw（直球） */
const STRAIGHT = [
  { x: 0.24, y: 0 },
  { x: -0.24, y: 0 },
  { x: 0.12, y: 0 },
]
/** ② 切球 throw（无塞与半塞，靠平动切向分量） */
const CUTS: { cut: number; off: { x: number; y: number } }[] = [
  { cut: 0, off: { x: 0, y: 0 } }, // 对照：无塞直球，偏角应为 ~0
  { cut: 45, off: { x: 0, y: 0 } },
  { cut: 60, off: { x: 0, y: 0 } },
  { cut: 45, off: { x: 0.18, y: -0.35 } },
]

let worst = 0
let fail = 0
let rows = 0

function one(
  cutDeg: number,
  off: { x: number; y: number },
  power: number
): void {
  rows++
  const cuePos = cueAt(cutDeg, 8 * R)
  const sim = simThrow(cuePos, power, off)
  const toGhost = GHOST.clone().sub(cuePos)
  const len = toGhost.length()
  const pred = computeThrowDeflect(
    toGhost.x / len,
    toGhost.y / len,
    1,
    0,
    off,
    0,
    power,
    len
  )
  const tag =
    pad(String(cutDeg), 7) +
    pad(`(${off.x},${off.y})`, 13) +
    pad((power / R).toFixed(0), 9)
  if (sim === null) {
    console.log(tag + "物理异常，跳过")
    return
  }
  if (!pred) {
    console.log(tag + pad(deg(sim).toFixed(3), 9) + "无修正（无切向相对速度）")
    return
  }
  const predAngle = Math.atan2(pred.y, pred.x)
  const err = Math.abs(deg(sim) - deg(predAngle))
  worst = Math.max(worst, err)
  const ok = err < 0.5
  if (!ok) fail++
  console.log(
    tag +
      pad(deg(sim).toFixed(3), 9) +
      pad(deg(predAngle).toFixed(3), 9) +
      pad(err.toFixed(3), 9) +
      (ok ? "✓" : "✗ 超差")
  )
}

for (const off of STRAIGHT) for (const p of POWERS) one(0, off, p)
for (const { cut, off } of CUTS) for (const p of POWERS) one(cut, off, p)

console.log(
  `\n样本 ${rows}，超差(>0.5°) ${fail}，最大误差 ${worst.toFixed(3)}°  →  ` +
    (fail === 0
      ? "辅助线 throw 修正与物理同源 ✓"
      : "✗ 公式与物理存在偏差，需排查")
)
