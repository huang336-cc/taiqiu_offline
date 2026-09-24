/**
 * v1.3.93 一次性探针：量化 AI 自由球（ball in hand）摆位质量。
 *
 * 背景：用户反馈「专业级难度，在玩家犯规后自由球，设计 ai 摆白球位置，目前 ai 是乱摆白球」。
 * 旧实现是 14×14 网格 + `1/(1+|d−0.5m|)` 打分，只判「不与球重叠」和「视线不被挡」，
 * 不看进球可行性 / 摔袋 / 走位 / 对手威胁。
 *
 * 本脚本对同一批残局，分别用「旧启发式」与「新评估链」选点，对比：
 *   · 选定点的「最容易一杆难度」（越小越好）
 *   · 是否有可打进的球（无候选 = 摆了个打不了的位）
 *   · 选定点是否导致母球摔袋
 *
 * 用法： npx tsx tools/harness/ballinhand.ts [N]
 */
import "./predom"
import { Table } from "../../src/model/table"
import { Ball } from "../../src/model/ball"
import { R } from "../../src/model/physics/constants"
import { Vector3 } from "three"
import { TableGeometry } from "../../src/view/tablegeometry"
import { PocketGeometry } from "../../src/view/pocketgeometry"
import { Professional } from "../../src/network/bot/strategies/professional"
import { AimCalculator } from "../../src/network/bot/aimcalculator"
import { Cue } from "../../src/view/cue"
import { AimEvent } from "../../src/events/aimevent"
import { EventType } from "../../src/events/eventtype"
import { DIFFICULTY } from "../../src/network/bot/difficulty"
import { installPhysicsHooks } from "../../src/network/bot/decision/physicshooks"
import { chooseBallInHandPosition } from "../../src/network/bot/decision/ballinhand"
import {
  enumerateCandidates,
  lineClearance,
  physicsHooksReady,
  refineStopsPhysics,
  remainingCenter,
} from "../../src/network/bot/decision/offense"
import { buildDecisionContext } from "../../src/network/bot/decision/shotcontext"
import { BotShotContext } from "../../src/network/bot/botstrategy"

installPhysicsHooks()

const N = parseInt(process.argv[2] ?? "40", 10) || 40
const profile = DIFFICULTY.Professional

/** 确定性伪随机（保证可复现） */
function mulberry32(seed: number) {
  return function () {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const rnd = mulberry32(20260921)

function makeTable(cue: Vector3, sol: Vector3[]): Table {
  const balls: Ball[] = []
  balls.push(new Ball(cue.clone(), undefined, 0))
  // label 分配：前 6 颗 = 本方花色(1..6)，第 7 颗 = 对手花色(7)，第 8 颗 = 黑八(8)
  for (let i = 0; i < sol.length; i++) {
    const label = i < 6 ? i + 1 : i === 6 ? 7 : 8
    balls.push(new Ball(sol[i].clone(), undefined, label))
  }
  const table = new Table(balls, 1, 1)
  table.cue = new Cue(new AimEvent(0, 0, 0, 0, false, EventType.AIM, 0, 0, 0, new Vector3(0, 0, 0), false) as unknown as AimEvent, table)
  table.cueball = balls[0]
  return table
}

function randomWithin(margin = R * 2.5): Vector3 {
  const x = (rnd() * 2 - 1) * (TableGeometry.tableX - margin)
  const y = (rnd() * 2 - 1) * (TableGeometry.tableY - margin)
  return new Vector3(x, y, 0)
}

/** 旧启发式（与改动前的 boteventhandler 实现等价），用于对照 */
function legacyPick(
  table: Table,
  targets: Ball[],
  cueball: Ball
): Vector3 | null {
  const balls = table.balls.filter((b) => b !== cueball && b.onTable())
  const tx = TableGeometry.tableX - R * 1.2
  const ty = TableGeometry.tableY - R * 1.2
  const overlaps = (pos: Vector3) => {
    for (const b of balls) if (pos.distanceTo(b.pos) < 2 * R * 1.02) return true
    return false
  }
  // 注意：这里额外排除 to 位置那颗球自身。
  // 原实现在此处**没有排除**，导致 `lineBlocked(pos, t.pos)` 会把目标球自己
  // 以「距离=0」判成阻挡 → scorePos 恒返回 -1 → bestPos 恒为 null →
  // 永远退回 rules.placeBall() 的开球线默认点。
  // 这正是「AI 乱摆白球」最直接的代码证据。为了让对照有信息量，
  // 这里把它修好再比 —— 即「旧思路发挥到最好能到什么水平」。
  const lineBlocked = (from: Vector3, to: Vector3) => {
    const dir = to.clone().sub(from)
    const len = dir.length()
    if (len < 1e-4) return false
    dir.multiplyScalar(1 / len)
    for (const b of balls) {
      if (b.pos.distanceTo(to) < 1e-6) continue // 跳过 to 处的球自身
      const w = b.pos.clone().sub(from)
      const t = Math.max(0, Math.min(len, w.dot(dir)))
      const proj = from.clone().add(dir.clone().multiplyScalar(t))
      if (proj.distanceTo(b.pos) < 2 * R) return true
    }
    return false
  }
  const scorePos = (pos: Vector3): number => {
    if (overlaps(pos)) return -1
    if (targets.length === 0) return 0.5
    let best = -1
    for (const t of targets) {
      const d = pos.distanceTo(t.pos)
      if (d < 2 * R + 0.05) return -1
      if (lineBlocked(pos, t.pos)) continue
      best = Math.max(best, 1 / (1 + Math.abs(d - 0.5)))
    }
    return best
  }
  let bestPos: Vector3 | null = null
  let bestScore = -1
  const G = 14
  for (let i = 0; i <= G; i++) {
    for (let j = 0; j <= G; j++) {
      const pos = new Vector3(
        -tx + (i * 2 * tx) / G,
        -ty + (j * 2 * ty) / G,
        0
      )
      const s = scorePos(pos)
      if (s > bestScore) {
        bestScore = s
        bestPos = pos
      }
    }
  }
  return bestPos
}

/** 评估「母球摆到 pos 后，最容易一杆的难度」；无候选返回 null */
function evalSpot(
  table: Table,
  cueball: Ball,
  pos: Vector3,
  calculator: AimCalculator,
  shotCtx: BotShotContext
) {
  const saved = cueball.pos.clone()
  try {
    cueball.pos.copy(pos)
    cueball.setStationary()
    const ctx = buildDecisionContext(
      { ...shotCtx, cueBall: cueball },
      profile,
      calculator,
      { ruleName: "eightball" }
    )
    const cands = enumerateCandidates(ctx, profile.minCutCos)
    if (cands.length === 0) return { difficulty: null, scratch: false, count: 0 }
    refineStopsPhysics(ctx, cands, remainingCenter(ctx.targets))
    let easiest = cands[0]
    for (const c of cands) if (c.difficulty < easiest.difficulty) easiest = c
    const scratch = cands.every((c) => c.physicalScratch)
    return { difficulty: easiest.difficulty, scratch, count: cands.length }
  } finally {
    cueball.pos.copy(saved)
    cueball.setStationary()
  }
}

console.log("=".repeat(76))
console.log("AI 自由球摆位质量探针 (v1.3.93)")
console.log("=".repeat(76))
console.log(`物理钩子就绪: ${physicsHooksReady() ? "是 ✅" : "否 ❌（评估会退化）"}`)
console.log(`样本数: ${N}\n`)

let legacyNoShot = 0
let newNoShot = 0
let legacyScratch = 0
let newScratch = 0
let legacyDiffSum = 0
let newDiffSum = 0
let legacyCount = 0
let newCount = 0
let wins = 0
let losses = 0
let ties = 0

for (let s = 0; s < N; s++) {
  // 造一个随机残局：1 颗母球 + 6 颗目标球 + 2 颗对手球
  const cueStart = randomWithin()
  const sol: Vector3[] = []
  const targets: Vector3[] = []
  let guard = 0
  while (sol.length < 8 && guard++ < 2000) {
    const p = randomWithin()
    let ok = true
    for (const q of sol) if (p.distanceTo(q) < 2.2 * R) ok = false
    if (p.distanceTo(cueStart) < 2.2 * R) ok = false
    if (ok) sol.push(p)
  }
  if (sol.length < 8) continue

  const table = makeTable(cueStart, sol)
  const cueball = table.cueball
  const calculator = new AimCalculator(1)
  const allTargets = table.balls.filter((b) => b !== cueball && b.onTable())
  // 简化：本方目标取前 6 颗（label 1..6），对手球为剩余
  const mine = allTargets.filter((b) => (b.label ?? 0) >= 1 && (b.label ?? 0) <= 6)
  const theirs = allTargets.filter((b) => (b.label ?? 0) === 7)
  void targets

  const shotCtx: BotShotContext = {
    table,
    cueBall: cueball,
    validTargetBalls: mine,
    ballInHand: true,
    pockets: calculator.pockets,
    opponentBalls: theirs,
    ruleName: "eightball",
    onEightBall: false,
    isBreak: false,
    potStreak: 0,
  }

  // --- 旧启发式 ---
  const legacyPos = legacyPick(table, mine, cueball)
  const legacyEval = legacyPos
    ? evalSpot(table, cueball, legacyPos, calculator, shotCtx)
    : { difficulty: null, scratch: false, count: 0 }

  // --- 新评估链 ---
  const choice = chooseBallInHandPosition(
    table,
    mine,
    profile,
    calculator,
    shotCtx,
    () => new Vector3(0, 0, 0)
  )
  const newEval = evalSpot(table, cueball, choice.pos, calculator, shotCtx)

  if (legacyEval.difficulty === null) legacyNoShot++
  else legacyDiffSum += legacyEval.difficulty
  if (newEval.difficulty === null) newNoShot++
  else newDiffSum += newEval.difficulty
  if (legacyEval.scratch) legacyScratch++
  if (newEval.scratch) newScratch++
  legacyCount += legacyEval.count
  newCount += newEval.count

  const ld = legacyEval.difficulty
  const nd = newEval.difficulty
  if (ld === null && nd !== null) wins++
  else if (ld !== null && nd === null) losses++
  else if (ld !== null && nd !== null) {
    if (nd < ld - 1e-6) wins++
    else if (nd > ld + 1e-6) losses++
    else ties++
  } else ties++
}

console.log("指标                          旧启发式      新评估链")
console.log("-".repeat(76))
const pct = (n: number) => ((n / N) * 100).toFixed(1) + "%"
console.log(
  `无球可打（摆了个打不了的位）  ${pct(legacyNoShot).padStart(8)}     ${pct(newNoShot).padStart(8)}`
)
console.log(
  `全部候选都会摔袋            ${pct(legacyScratch).padStart(8)}     ${pct(newScratch).padStart(8)}`
)
const avg = (sum: number, n: number) =>
  n > 0 ? (sum / (N - 0)).toFixed(4) : "n/a"
console.log(
  `平均最容易一杆难度           ${avg(legacyDiffSum, legacyCount).padStart(8)}     ${avg(newDiffSum, newCount).padStart(8)}`
)
console.log(
  `平均可进球路数               ${(legacyCount / N).toFixed(2).padStart(8)}     ${(newCount / N).toFixed(2).padStart(8)}`
)
console.log("-".repeat(76))
console.log(`逐局对比：新更好 ${wins} / 旧更好 ${losses} / 持平 ${ties}  （共 ${N} 局）`)
console.log("=".repeat(76))
