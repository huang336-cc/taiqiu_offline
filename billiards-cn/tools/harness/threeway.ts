/**
 * v1.4.0 三档 AI 贴库选袋对比（threeway）。
 *
 * 用户实际对战对象是 ClawBreak（稳健）/ TheFarJaw（激进）—— 这两档
 * **没有决策层**，选袋完全走 AimCalculator.findBestPocket（切角分 +
 * v1.4.0 railMidMouthPenalty）。Professional 走 enumerateCandidates +
 * rankPlans（railchoice.ts 已覆盖）。本脚本挂钩 findBestPocket /
 * rankPlans，验证三档在「白球和目标球都贴库」场景下都改选角袋。
 *
 * 运行：npx tsx tools/harness/threeway.ts
 */
import "./predom"
import { Vector3 } from "three"
import { R } from "../../src/model/physics/constants"
import { Ball, State } from "../../src/model/ball"
import { Table } from "../../src/model/table"
import { TableGeometry } from "../../src/view/tablegeometry"
import { PocketGeometry } from "../../src/view/pocketgeometry"
import { AimCalculator } from "../../src/network/bot/aimcalculator"
import { DIFFICULTY } from "../../src/network/bot/difficulty"
import { ClawBreak } from "../../src/network/bot/strategies/clawbreak"
import { TheFarJaw } from "../../src/network/bot/strategies/thefarjaw"
import { Professional } from "../../src/network/bot/strategies/professional"

const TX = TableGeometry.tableX
const TY = TableGeometry.tableY

const centers = PocketGeometry.pocketCenters.map((p) => p.pos.clone())
const insetCenters = centers.map((p) =>
  p.clone().multiplyScalar(AimCalculator.POCKET_INSET_FACTOR)
)
const P_NAMES = ["NW", "SW", "N", "S", "NE", "SE"]

function pocketName(p: Vector3): string {
  let best = -1
  let bestD = Infinity
  insetCenters.forEach((c, i) => {
    const d = c.distanceTo(p)
    if (d < bestD) {
      bestD = d
      best = i
    }
  })
  return P_NAMES[best]
}

function build(objX: number, cueX: number) {
  const obj = new Ball(new Vector3(objX * R, TY - 1.5 * R, 0), undefined, 1)
  const cue = new Ball(new Vector3(cueX * R, TY - 1.5 * R, 0), undefined, 0)
  obj.setStationary()
  cue.setStationary()
  const others: Ball[] = []
  for (let l = 2; l <= 15; l++) {
    const b = new Ball(new Vector3(TX * 3, TY * 3 + l * 0.1, 0), undefined, l)
    b.setStationary()
    b.state = State.InPocket
    others.push(b)
  }
  const table = new Table([cue, obj, ...others])
  return { table, cue, obj }
}

/** 挂钩 findBestPocket，记录稳健/激进档选袋 */
function hookFindBest(calc: AimCalculator): () => string {
  let picked = "?"
  const orig = calc.findBestPocket.bind(calc)
  calc.findBestPocket = (cuePos, targetPos, pockets) => {
    const pick = orig(cuePos, targetPos, pockets)
    picked = pocketName(pick)
    return pick
  }
  return () => picked
}

function askSimple(
  StrategyCls: any,
  profile: any,
  objXR: number,
  cueXR: number
): string {
  const { table, cue, obj } = build(objXR, cueXR)
  const calculator = new AimCalculator()
  const readPick = hookFindBest(calculator)
  const strategy = new StrategyCls(profile)
  const ctx: any = {
    table,
    cueBall: cue,
    validTargetBalls: [obj],
    ballInHand: false,
    pockets: calculator.pockets,
    ruleName: "eightball",
    opponentBalls: [],
  }
  try {
    strategy.aim(ctx, calculator)
  } catch (e) {
    return `异常:${(e as Error).message.slice(0, 30)}`
  }
  return readPick()
}

function askPro(objXR: number, cueXR: number): string {
  const { table, cue, obj } = build(objXR, cueXR)
  const calculator = new AimCalculator()
  const strategy = new Professional(DIFFICULTY.Professional)
  let picked = "?"
  const orig = (strategy as any).rankPlans.bind(strategy)
  ;(strategy as any).rankPlans = (plans: any[], dctx: any) => {
    const pick = orig(plans, dctx)
    picked = pick ? pocketName(pick.pocket) : "防守"
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
  try {
    strategy.aim(ctx, calculator)
  } catch (e) {
    return `异常:${(e as Error).message.slice(0, 30)}`
  }
  return picked
}

console.log(`\n=== v1.4.0 三档 AI 贴库选袋对比（球与母球都贴上长库） ===`)
console.log(
  "场景".padEnd(24) +
    "稳健ClawBreak".padEnd(16) +
    "激进TheFarJaw".padEnd(16) +
    "专业Professional"
)
const CASES: Array<[string, number, number, string]> = [
  // [说明, 球x(R), 母球x(R), 期望]
  ["中袋正下方,母球左8R", 0, -8, "NE/NW(非N)"],
  ["中袋正下方,母球右8R", 0, 8, "NE/NW(非N)"],
  ["球-8R,母球-20R", -8, -20, "NW(非N)"],
  ["球+8R,母球+20R", 8, 20, "NE(非N)"],
  ["球+4R,母球+20R(厚切)", 4, 20, "N或NE"],
  ["球-4R,母球-20R(厚切)", -4, -20, "N或NW"],
  ["球-6R,母球-20R", -6, -20, "NW(非N)"],
]
for (const [label, objX, cueX, expect] of CASES) {
  const a = askSimple(ClawBreak, DIFFICULTY.ClawBreak, objX, cueX)
  const b = askSimple(TheFarJaw, DIFFICULTY.TheFarJaw, objX, cueX)
  const p = askPro(objX, cueX)
  console.log(
    label.padEnd(24) + a.padEnd(16) + b.padEnd(16) + p.padEnd(16) +
      `  期望: ${expect}`
  )
}
console.log()
