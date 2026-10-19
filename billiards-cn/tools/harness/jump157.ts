/**
 * v1.5.7（#86）跳球物理**定量**标定（无头，真实三轴物理）。
 *
 * 用户反馈：「跳球还是不符合物理规律，请实机测试验证」。
 *
 * 上一版取证（浏览器探针 probe-jump157.js，满力 power=0.9）已经量到：
 *   30° → 最高 24.7cm / 飞行 195cm
 *   45° → 最高 54.0cm / 飞行 227cm
 *   72° → 最高 99.4cm / 飞行 133cm   ← 飞一米高，而台面全长只有 2.8m
 * 对照真实跳球（越过一颗球即可：高度 5~20cm、飞越 20~60cm）明显失真。
 *
 * 本脚本用**无头真物理**逐档扫仰角 × 力度，输出高度/飞行距离/落地损失，
 * 并与抛体理论值对照，作为 #86 修复的验收基线。
 *
 * 用法：npx tsx tools/harness/jump157.ts
 */
import "./predom"
import { Table } from "../../src/model/table"
import { Ball, State } from "../../src/model/ball"
import { R, g } from "../../src/model/physics/constants"
import { TableGeometry } from "../../src/view/tablegeometry"
import { Cue } from "../../src/view/cue"
import { AimEvent } from "../../src/events/aimevent"
import { Vector3 } from "three"

const STEP = 0.001953125
const MAX_STEPS = 400000

/** UI 抬杆上限：clampElevation 到 2π/5 = 72°（注意单位是**弧度**） */
const MAX_ELEV_RAD = (2 * Math.PI) / 5

interface Measure {
  vz0: number
  vh0: number
  apex: number
  flightT: number
  flightD: number
  landLoss: number
}

/**
 * 让白球单独在空台上起跳（其余球设为落袋状态），测竖直运动全过程。
 * @param elevDeg 仰角（度）
 * @param powerFrac 力度占 maxPower 的比例
 */
function measure(elevDeg: number, powerFrac: number): Measure | null {
  const X = TableGeometry.tableX
  const cue = new Ball(new Vector3(-X + 0.1, 0, 0), 0xffffff, 0)
  // 其余 15 颗球全部设为「已落袋」，保证白球独跑
  const others: Ball[] = []
  for (let l = 1; l <= 15; l++) {
    const b = new Ball(new Vector3(0, 0, 0), 0xffffff, l)
    b.state = State.InPocket
    others.push(b)
  }
  const balls = [cue, ...others]
  const table = new Table(balls)
  for (const b of table.balls) {
    if (b === cue) b.state = State.Stationary
  }
  table.cue = new Cue()
  table.cueball = cue

  const elev = (elevDeg * Math.PI) / 180
  const power = powerFrac * 160 * R
  const aim = new AimEvent()
  aim.pos = cue.pos.clone()
  aim.dir = new Vector3(1, 0, 0)
  aim.power = power
  aim.spin = new Vector3(0, 0, 0)
  aim.angle = 0
  aim.elevation = elev
  table.cue!.aim = aim
  table.cue!.hit(cue)

  const v0 = cue.vel.clone()
  const vz0 = v0.z
  const vh0 = Math.hypot(v0.x, v0.y)

  let apex = 0
  let steps = 0
  let lift = 0
  let landVh = 0
  // 先跑离地阶段，记录最高点与落地时刻
  while (steps++ < MAX_STEPS) {
    table.advance(STEP)
    if (cue.pos.z > apex) apex = cue.pos.z
    if (cue.pos.z > 1e-6) lift = steps
    if (lift > 0 && cue.pos.z <= 1e-6 && steps > lift) {
      landVh = Math.hypot(cue.vel.x, cue.vel.y)
      break
    }
    if (table.allStationary() && cue.pos.z <= 1e-6) {
      landVh = Math.hypot(cue.vel.x, cue.vel.y)
      break
    }
  }
  const flightT = lift * STEP
  const startX = -X + 0.1
  const flightD = cue.pos.x - startX
  return {
    vz0,
    vh0,
    apex,
    flightT,
    flightD,
    landLoss: vh0 > 0 ? 1 - landVh / vh0 : 0,
  }
}

function main() {
  console.log("=== v1.5.7（#86）跳球物理标定（无头真物理）===")
  console.log(`  台面半长 ${TableGeometry.tableX.toFixed(3)}m  球半径 ${R}  g=${g}`)
  console.log(`  UI 抬杆上限 ${((MAX_ELEV_RAD * 180) / Math.PI).toFixed(0)}°（弧度 ${MAX_ELEV_RAD.toFixed(4)}）\n`)

  const powers = [0.45, 0.7, 0.9]
  for (const p of powers) {
    console.log(`── 力度 ${(p * 100).toFixed(0)}%（${(p * 160 * R).toFixed(3)} m/s）──`)
    console.log(
      "  仰角    vz0(m/s)  vh0(m/s)   实测最高   理论最高   飞行时间   飞行距离   落地水平损失"
    )
    for (const deg of [0, 15, 30, 45, 60, 72]) {
      const m = measure(deg, p)
      if (!m) {
        console.log(`  ${String(deg).padStart(3)}°   测量失败`)
        continue
      }
      const theoryApex = (m.vz0 * m.vz0) / (2 * g)
      const theoryT = (2 * m.vz0) / g
      console.log(
        `  ${String(deg).padStart(3)}°   ${m.vz0.toFixed(3).padStart(8)}  ${m.vh0
          .toFixed(3)
          .padStart(8)}   ${(m.apex * 100).toFixed(1).padStart(7)}cm  ${(theoryApex * 100)
          .toFixed(1)
          .padStart(7)}cm  ${m.flightT.toFixed(3).padStart(7)}s(${theoryT
          .toFixed(3)
          .padStart(5)}s)  ${(m.flightD * 100).toFixed(1).padStart(7)}cm  ${(m.landLoss * 100)
          .toFixed(1)
          .padStart(8)}%`
      )
    }
    console.log("")
  }

  // ── 验收判据 ──
  console.log("── 验收判据（对照真实跳球：高度 5~20cm、飞越 20~60cm）──")
  let pass = 0
  let fail = 0
  const check = (name: string, cond: boolean, detail: string) => {
    if (cond) {
      pass++
      console.log(`  ✓ ${name}  ${detail}`)
    } else {
      fail++
      console.log(`  ✗ ${name}  ${detail}`)
    }
  }
  const p90 = 0.9
  const m30 = measure(30, p90)!
  const m45 = measure(45, p90)!
  const m72 = measure(72, p90)!
  const m0 = measure(0, p90)!
  // ① 满力最大仰角不得飞过 30cm（旧版 99.4cm —— 飞一米高，明显失真）
  check(
    "满力 72° 最高点 ≤ 30cm",
    m72.apex <= 0.3,
    `实测 ${(m72.apex * 100).toFixed(1)}cm（旧版 99.4cm）`
  )
  // ② 满力 45° 应落在 8~20cm（够越过一颗球且贴真实）
  check(
    "满力 45° 最高点 ∈ [8,20]cm",
    m45.apex >= 0.08 && m45.apex <= 0.2,
    `实测 ${(m45.apex * 100).toFixed(1)}cm`
  )
  // ③ 满力飞行距离不得超过半张台（1.4m），否则成了「抛球」不是「跳球」
  check(
    "满力飞行距离 ≤ 1.4m（半张台）",
    Math.max(m30.flightD, m45.flightD, m72.flightD) <= 1.4,
    `最远 ${(Math.max(m30.flightD, m45.flightD, m72.flightD) * 100).toFixed(1)}cm`
  )
  // ④ 仰角越大跳得越高（单调性）
  check(
    "仰角越大跳得越高",
    m30.apex < m45.apex && m45.apex < m72.apex,
    `${(m30.apex * 100).toFixed(1)} < ${(m45.apex * 100).toFixed(1)} < ${(m72.apex * 100).toFixed(1)}cm`
  )
  // ⑤ 仰角越大飞得越近（能量分给竖直方向了）
  check(
    "仰角越大飞得越近",
    m72.flightD < m45.flightD,
    `72°→${(m72.flightD * 100).toFixed(1)}cm  45°→${(m45.flightD * 100).toFixed(1)}cm`
  )
  // ⑥ 零仰角不跳
  check("0° 抬杆不跳", m0.apex < 0.001, `实测 ${(m0.apex * 100).toFixed(3)}cm`)
  // ⑦ 越过一颗球（球心需升高 2R = 6.55cm）至少要 45° 左右
  const need = 2 * R
  check(
    "45° 足以越过一颗球（需升高 2R）",
    m45.apex >= need,
    `45°→${(m45.apex * 100).toFixed(1)}cm  门槛 ${(need * 100).toFixed(2)}cm`
  )
  console.log(`\n  通过 ${pass} / 失败 ${fail}`)
  if (fail > 0) process.exitCode = 1
}

main()
