/**
 * v1.4.1 AI 力度审计（poweraudit）。
 *
 * 用户反馈：「专业难度会出现瞄准了，但是力度不够的情况」。
 * 根因：professional.ts 的摔袋复核分支把杆法强制改成 −0.45 极限低杆，
 * 但力度下限沿用**按原杆法**反解的 required —— 低杆的母球滚动效率
 * （fSpin≈0.453）远低于中/高杆（0.714/0.865），等效传递只剩 52%~63%，
 * 物体球停在袋口前。
 *
 * 本脚本批量构造进攻场景，跑 Professional 决策取出杆参数，做两件事：
 *   ① 一致性审计：凡最终打点 offset.y=−0.45（收力分支标记），出杆力度
 *      必须不低于「按 −0.45 低杆重新反解」的进袋下限 requiredDraw。
 *      修复前该指标必然出现违例；修复后应为 0。
 *   ② 物理验证：真实模拟每一杆，统计「物体球未进袋且停在袋口 3R 内」
 *      （= 观感「瞄准了但力度不够」）的比例。
 *
 * 用法：npx tsx tools/harness/poweraudit.ts [--n=每袋样本数]
 */
import "./predom"
import { Vector3 } from "three"
import { R } from "../../src/model/physics/constants"
import { Ball, State } from "../../src/model/ball"
import { Table } from "../../src/model/table"
import { TableGeometry } from "../../src/view/tablegeometry"
import { PocketGeometry } from "../../src/view/pocketgeometry"
import { Outcome } from "../../src/model/outcome"
import { AimCalculator } from "../../src/network/bot/aimcalculator"
import { Cue } from "../../src/view/cue"
import { AimEvent } from "../../src/events/aimevent"
import { Professional } from "../../src/network/bot/strategies/professional"
import { DIFFICULTY } from "../../src/network/bot/difficulty"
import { cueSpeedFor } from "../../src/network/bot/powerphysics"

const STEP = 0.001953125
const TX = TableGeometry.tableX
const TY = TableGeometry.tableY

const argv = process.argv.slice(2)
const N = (() => {
  const a = argv.find((s) => s.startsWith("--n="))
  return a ? Number(a.slice(4)) : 24
})()

function mulberry32(a: number) {
  return function () {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function makeTable(cuePos: Vector3, objPos: Vector3): {
  table: Table
  cue: Ball
  obj: Ball
} {
  const cue = new Ball(cuePos.clone(), undefined, 0)
  const obj = new Ball(objPos.clone(), undefined, 1)
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

/** 建议袋口（目标球→该袋的扇形方向在台内）的随机进攻场景 */
function randomScene(rnd: () => number): {
  table: Table
  cue: Ball
  obj: Ball
  pocket: Vector3
  cueToBall: number
  ballToPocket: number
  cutCos: number
} | null {
  const centers = PocketGeometry.pocketCenters.map((p) => p.pos.clone())
  const pocket = centers[Math.floor(rnd() * centers.length)]
  // 目标球：距袋 0.5~1.4m，方向从袋心指向台内 ±40° 扇形
  const inward = pocket
    .clone()
    .multiplyScalar(-1)
    .normalize()
  const spread = (rnd() - 0.5) * (80 * Math.PI) / 180
  const cos = Math.cos(spread)
  const sin = Math.sin(spread)
  const dir = new Vector3(
    inward.x * cos - inward.y * sin,
    inward.y * cos + inward.x * sin,
    0
  )
  const distOP = 0.5 + rnd() * 0.9
  const objPos = pocket.clone().addScaledVector(dir, distOP)
  // 台内约束：x/y 收进库内 1R
  if (Math.abs(objPos.x) > TX - 2 * R) objPos.x = Math.sign(objPos.x) * (TX - 2 * R)
  if (Math.abs(objPos.y) > TY - 2 * R) objPos.y = Math.sign(objPos.y) * (TY - 2 * R)
  // 母球：目标球后方 0.4~1.6m，相对「目标球→袋」反向偏 ±30°
  const back = dir.clone().multiplyScalar(-1)
  const cueSpread = ((rnd() - 0.5) * 60 * Math.PI) / 180
  const ccos = Math.cos(cueSpread)
  const csin = Math.sin(cueSpread)
  const cueDir = new Vector3(
    back.x * ccos - back.y * csin,
    back.y * ccos + back.x * csin,
    0
  )
  const distCB = 0.4 + rnd() * 1.2
  const cuePos = objPos.clone().addScaledVector(cueDir, distCB)
  if (Math.abs(cuePos.x) > TX - 2 * R) cuePos.x = Math.sign(cuePos.x) * (TX - 2 * R)
  if (Math.abs(cuePos.y) > TY - 2 * R) cuePos.y = Math.sign(cuePos.y) * (TY - 2 * R)
  if (cuePos.distanceTo(objPos) < 3 * R) return null

  const { table, cue, obj } = makeTable(cuePos, objPos)
  // cutCos：cue→ghost 方向 与 obj→袋 方向的夹角余弦
  const ghost = objPos
    .clone()
    .addScaledVector(pocket.clone().sub(objPos).normalize(), -2 * R)
  const toGhost = ghost.clone().sub(cuePos).normalize()
  const toPocket = pocket.clone().sub(objPos).normalize()
  const cutCos = Math.max(0.05, toGhost.dot(toPocket))
  return { table, cue, obj, pocket, cueToBall: cuePos.distanceTo(objPos), ballToPocket: objPos.distanceTo(pocket), cutCos }
}

const rnd = mulberry32(20260923)
let total = 0
let drawCapped = 0 // 收力分支触发（offset.y = -0.45）样本
let underPowered = 0 // ① 力度下限违例
let simulated = 0
let missNearPocket = 0 // ② 「瞄准了但力度不够」的物理实锤
let potted = 0
let scratch = 0

for (let i = 0; i < N * 6; i++) {
  const scene = randomScene(rnd)
  if (!scene) continue
  const { table, cue, obj, pocket } = scene
  const calculator = new AimCalculator()
  const strategy = new Professional(DIFFICULTY.Professional)
  // 挂钩 rankPlans：取 AI **实际入选**的候选（决策层自己的几何口径），
  // 审计才能与 power.ts 的 required 反解完全同源。用构造场景的袋会错位
  // （AI 常常改选另一个袋），产生假违例。
  let picked: any = null
  const origRank = (strategy as any).rankPlans.bind(strategy)
  ;(strategy as any).rankPlans = (plans: any[], dctx: any) => {
    const pick = origRank(plans, dctx)
    if (pick) picked = pick
    return pick
  }
  const ctx: any = {
    table,
    cueBall: cue,
    validTargetBalls: [obj],
    ballInHand: false,
    pockets: calculator.pockets,
    ruleName: "eightball",
    opponentBalls: [],
  }
  let events: any[]
  try {
    events = strategy.aim(ctx, calculator)
  } catch {
    continue
  }
  // 取实际出杆（最后一个事件的 tablejson.aim，经 AimEvent.fromJson 与线上同源还原）
  const last = events[events.length - 1]
  if (!last?.tablejson?.aim) continue
  const aimEv = AimEvent.fromJson(last.tablejson.aim)
  if (typeof aimEv.power !== "number" || aimEv.power <= 0) continue
  total++

  // ① 一致性审计：收力分支（极限低杆标记）的力度必须 ≥ 按低杆重算的下限。
  //    下限用角袋半径（2.1R，最宽松口径）计算 —— 若连最宽松下限都violated
  //    才记违例，避免袋型口径差异造成误报。
  if (
    aimEv.offset &&
    Math.abs(aimEv.offset.y + 0.45) < 1e-6 &&
    picked &&
    picked.cueToBall !== undefined
  ) {
    drawCapped++
    // 用入选候选自己的几何（与 power.ts 的 required 反解同源）
    const requiredDraw = cueSpeedFor(
      picked.cueToBall,
      picked.ballToPocketTrue + 2 * picked.pocketRadius,
      picked.pocketRadius,
      picked.cutCos,
      -0.45,
      0.45,
      1.2
    )
    if (aimEv.power < requiredDraw * 0.99) {
      underPowered++
      if (underPowered <= 5) {
        console.log(
          `  ✗ 违例: power=${(aimEv.power / R).toFixed(1)}R < ` +
            `requiredDraw=${(requiredDraw / R).toFixed(1)}R ` +
            `(cue→ball=${picked.cueToBall.toFixed(2)}m ball→pocket=${picked.ballToPocketTrue.toFixed(2)}m cut=${picked.cutCos.toFixed(2)})`
        )
      }
    }
  }

  // ② 物理验证：用 AI 的实际出杆参数打一杆
  const { table: t2, cue: c2, obj: o2 } = makeTable(
    cue.pos.clone(),
    obj.pos.clone()
  )
  t2.cue!.aim = aimEv
  t2.cue!.hit(c2)
  let guard = 0
  while (!t2.allStationary() && guard++ < 300000) {
    try {
      t2.advance(STEP)
    } catch {
      break
    }
  }
  simulated++
  const pots = Outcome.pots(t2.outcome)
  if (pots.includes(o2)) potted++
  else {
    const near = o2.state !== State.InPocket && o2.pos.distanceTo(pocket) < 3 * R
    if (near) missNearPocket++
  }
  if (pots.includes(c2)) scratch++
}

console.log(`\n=== v1.4.1 AI 力度审计（专业档，${total} 杆有效样本） ===`)
console.log(
  `收力分支触发（offset.y=-0.45）: ${drawCapped} 杆` +
    (drawCapped ? `，其中力度下限违例 ${underPowered} 杆` : "")
)
console.log(
  `物理验证 ${simulated} 杆：进袋 ${potted}（${((potted / Math.max(1, simulated)) * 100).toFixed(1)}%），` +
    `母球摔袋 ${scratch}（${((scratch / Math.max(1, simulated)) * 100).toFixed(1)}%），` +
    `「没进且停在袋口 3R 内」${missNearPocket}（${((missNearPocket / Math.max(1, simulated)) * 100).toFixed(1)}%）`
)
console.log(
  underPowered === 0
    ? "\n→ 一致性审计通过：收力分支的力度全部满足低杆反解下限 ✓"
    : `\n→ ✗ 存在 ${underPowered} 杆「改低杆但力度未重算」的违例`
)
