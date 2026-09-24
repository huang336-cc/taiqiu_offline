/**
 * v1.4.0 贴库选袋诊断（railpocket）。
 *
 * 用户反馈：「当白球和击打球靠边库时，电脑还是选择打中袋，而不是打远处的
 * 边袋，这个问题还没修好」。
 *
 * 本脚本用**真实物理**（同一套 table.hit + table.advance）回答一个问题：
 *   目标球贴长库、母球也在附近时，
 *     打「正对的中袋」 vs 打「远处的角袋」，哪个真的能进？
 *
 * 【实验设计 —— 隔离变量】
 *   早期版本同时扫了「目标球 x」并把母球固定在目标球后方 10R，结果母球
 *   位置跟着一起变，进球率的变化无法归因。现在改为**固定母球**、只扫
 *   目标球，并额外记录「该线路的离库 cos」与「ghost 离库距离」，
 *   直接检验 `offense.ts` 的 `railPocketSuitability` 判据是否与实测吻合。
 *
 * 用法：
 *   npx tsx tools/harness/railpocket.ts
 *   npx tsx tools/harness/railpocket.ts --n=40    # 每格采样 40 次
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

const STEP = 0.001953125
const TX = TableGeometry.tableX
const TY = TableGeometry.tableY
const X = TableGeometry.X
const Y = TableGeometry.Y

const argv = process.argv.slice(2)
const N = (() => {
  const a = argv.find((s) => s.startsWith("--n="))
  return a ? Number(a.slice(4)) : 32
})()

/** 建桌：母球 + 目标球，其余球判为落袋避免干扰 */
function makeTable(cuePos: Vector3, objPos: Vector3): {
  table: Table
  cue: Ball
  obj: Ball
} {
  const cue = new Ball(cuePos.clone(), undefined, 0)
  const obj = new Ball(objPos.clone(), undefined, 1)
  const others: Ball[] = []
  for (let l = 2; l <= 15; l++) {
    // 直接判为 InPocket：单纯挪远会被越界回位逻辑拉回库边并把物理卡死
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

/** 以计算器给出的理想线打一杆，返回目标球/母球是否落袋 */
function tryShot(
  cuePos: Vector3,
  objPos: Vector3,
  pocketCenter: Vector3,
  power: number,
  aimNoise: number
): { potted: boolean; scratch: boolean } {
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
      return { potted: false, scratch: false }
    }
  }
  const pots = Outcome.pots(table.outcome)
  return { potted: pots.includes(obj), scratch: pots.includes(cue) }
}

function mulberry32(a: number) {
  return function () {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function fmtPct(x: number) {
  return (x * 100).toFixed(1) + "%"
}
function pad(s: string, n: number) {
  return s.padEnd(n)
}

const centers = PocketGeometry.pocketCenters.map((p) => p.pos.clone())
// enumerateCenters 顺序：0=NW 1=SW 2=N 3=S 4=NE 5=SE
const P_NW = centers[0]
const P_N = centers[2]
const P_NE = centers[4]
const P_SE = centers[5]

/** 上长库的出口方向 = +y（袋心在库外） */
const EXIT_Y = 1

console.log(`\n=== v1.4.0 贴库选袋诊断（每格 ${N} 杆，power = 95R） ===`)
console.log(`tableX=${TX.toFixed(4)} tableY=${TY.toFixed(4)}  R=${R}\n`)

/**
 * 【场景 A】目标球贴上长库，母球固定在该库上、位于固定位置。
 * 母球固定在靠近 NW 角袋一侧（x = -20R），模拟「母球与目标球都贴在
 * 同一侧边库」的典型用户场景。
 */
const CUE_FIXED = new Vector3(-20 * R, TY - 1.5 * R, 0)
const BALL_ON_RAIL_Y = TY - 1.5 * R

console.log("【场景 A】目标球贴上长库，母球固定在 (-20R, 贴上长库)")
console.log(
  pad("球x(R)", 9) +
    pad("到N(R)", 9) +
    pad("离库cos", 10) +
    pad("ghost离库", 11) +
    pad("打N袋", 9) +
    pad("打NW袋", 9) +
    pad("打NE袋", 9) +
    "最优"
)

for (const xR of [-14, -10, -6, -2, 2, 6, 10, 16, 24]) {
  const objPos = new Vector3(xR * R, BALL_ON_RAIL_Y, 0)
  const toN = P_N.clone().sub(objPos).normalize()
  const alongN = toN.y * EXIT_Y
  const dN = objPos.distanceTo(P_N)
  // ghost：母球撞上目标球瞬间的球心 = ball - 2R·(ball→pocket)
  const ghostN = objPos.clone().addScaledVector(toN, -2 * R)
  const ghostRail = Math.min(X - Math.abs(ghostN.x), Y - Math.abs(ghostN.y))

  const rnd = mulberry32(4242 + xR * 7)
  const sample = (pk: Vector3) => {
    let pot = 0
    for (let i = 0; i < N; i++) {
      const noise = (rnd() * 2 - 1) * 0.004
      if (tryShot(CUE_FIXED, objPos, pk, 95 * R, noise).potted) pot++
    }
    return pot / N
  }
  const rN = sample(P_N)
  const rNW = sample(P_NW)
  const rNE = sample(P_NE)
  const rates: Array<[string, number]> = [
    ["N", rN],
    ["NW", rNW],
    ["NE", rNE],
  ]
  rates.sort((a, b) => b[1] - a[1])
  const best = rates[0]

  console.log(
    pad(String(xR), 9) +
      pad((dN / R).toFixed(2), 9) +
      pad(alongN.toFixed(3), 10) +
      pad((ghostRail / R).toFixed(2), 11) +
      pad(fmtPct(rN), 9) +
      pad(fmtPct(rNW), 9) +
      pad(fmtPct(rNE), 9) +
      `${best[0]} (${fmtPct(best[1])})`
  )
}

console.log("\n【判据核对】RAIL_MIDDLE_ENTRY_COS = 0.45，RAIL_ENTRY_COS = 0.30")
console.log("  预期：沿库 cos < 0.30 → 中袋必失；0.30~0.45 → 低成功；>0.45 → 可打")
console.log()

/**
 * 【场景 B】目标球贴**右短库**（x = tableX - 1.5R），母球在同一条短库上。
 * 检验「贴库球打两个角袋」时近端与远端的成功率差异。
 */
console.log("【场景 B】目标球贴右短库（近端角袋 vs 远端角袋）")
console.log(pad("球y(R)", 9) + pad("打NE袋", 9) + pad("打SE袋", 9) + "说明")
const CUE_FIXED_B = new Vector3(TX - 1.5 * R, -18 * R, 0)
for (const yR of [14, 8, 2, -4, -10, -16]) {
  const objPos = new Vector3(TX - 1.5 * R, yR * R, 0)
  const rnd = mulberry32(777 + yR * 11)
  const sample = (pk: Vector3) => {
    let pot = 0
    for (let i = 0; i < N; i++) {
      const noise = (rnd() * 2 - 1) * 0.004
      if (tryShot(CUE_FIXED_B, objPos, pk, 95 * R, noise).potted) pot++
    }
    return pot / N
  }
  const rNE = sample(P_NE)
  const rSE = sample(P_SE)
  console.log(
    pad(String(yR), 9) +
      pad(fmtPct(rNE), 9) +
      pad(fmtPct(rSE), 9) +
      (rSE >= rNE - 0.05 ? "近角袋可打" : "近角袋偏差→应打远角袋")
  )
}
console.log()
