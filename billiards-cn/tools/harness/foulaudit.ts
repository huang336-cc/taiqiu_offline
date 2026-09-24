/**
 * v1.4.2 诊断 · 专业档犯规归因：把「犯规」拆成因，看「击球后无球碰库」占多少。
 *
 * botmatch 的 `fouls` 只统计「未先击中目标球」（`!firstHitTarget`），
 * **完全不统计**「击球后无球碰库」——而后者正是用户实测看到的犯规。
 * 八球规则里这一条的判定见 controller/rules/eightball.ts：
 *
 *   若本杆没有任何球落袋，且「首次碰撞之后」没有任何 Cushion 事件 → 犯规。
 *
 * 本脚本按**同一口径**复算，把犯规拆成三类分别计数，用于定位与验证修复：
 *   · noContact   空杆 / 未先击中目标球
 *   · noCushion   击球后无球碰库（用户反馈的这条）
 *   · scratch     摔袋
 *
 * 用法：
 *   npx tsx tools/harness/foulaudit.ts 120 --seed=20260924
 */
import "./predom"
import { Table } from "../../src/model/table"
import { Ball } from "../../src/model/ball"
import { R } from "../../src/model/physics/constants"
import { TableGeometry } from "../../src/view/tablegeometry"
import { Professional } from "../../src/network/bot/strategies/professional"
import { AimCalculator } from "../../src/network/bot/aimcalculator"
import { Cue } from "../../src/view/cue"
import { AimEvent } from "../../src/events/aimevent"
import { EventType } from "../../src/events/eventtype"
import { Outcome, OutcomeType } from "../../src/model/outcome"
import { Vector3 } from "three"
import { DIFFICULTY } from "../../src/network/bot/difficulty"

const STEP = 0.001953125
const MAX_SHOTS = 60
const PHYS_GUARD = 300000

function mulberry32(seed: number) {
  return function () {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = Math.imul(t ^ (t >>> 7), 61 | t) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function makeBalls(): Ball[] {
  const balls: Ball[] = [new Ball(new Vector3(0, 0, 0), undefined, 0)]
  for (let l = 1; l <= 7; l++) balls.push(new Ball(new Vector3(0, 0, 0), undefined, l))
  balls.push(new Ball(new Vector3(0, 0, 0), undefined, 8))
  for (let l = 9; l <= 15; l++) balls.push(new Ball(new Vector3(0, 0, 0), undefined, l))
  return balls
}

function placeSpread(balls: Ball[], rnd: () => number): boolean {
  const X = TableGeometry.X - 2.2 * R
  const Y = TableGeometry.Y - 2.2 * R
  const placed: Ball[] = []
  for (const b of balls) {
    let ok = false
    for (let a = 0; a < 300 && !ok; a++) {
      const p = new Vector3((rnd() * 2 - 1) * X, (rnd() * 2 - 1) * Y, 0)
      let clash = false
      for (const q of placed) {
        if (q.pos.distanceTo(p) < 2.3 * R) {
          clash = true
          break
        }
      }
      if (!clash) {
        b.pos.copy(p)
        b.setStationary()
        placed.push(b)
        ok = true
      }
    }
    if (!ok) return false
  }
  return true
}

function simulate(table: Table, aim: AimEvent): boolean {
  table.cue!.aim = aim
  table.cue!.hit(table.cueball)
  let guard = 0
  try {
    while (!table.allStationary() && guard++ < PHYS_GUARD) table.advance(STEP)
  } catch {
    return false
  }
  return true
}

/** 按八球规则口径判定「击球后无球碰库」 */
function noCushionAfterContact(cueball: Ball, outcome: Outcome[]): boolean {
  if (Outcome.pots(outcome).length > 0) return false
  const first = Outcome.firstCollision(Outcome.cueBallFirst(cueball, outcome))
  if (!first) return false // 空杆归到 noContact，不重复计
  const idx = outcome.indexOf(first)
  return !outcome.slice(idx + 1).some((o) => o.type === OutcomeType.Cushion)
}

/** `--noguard`：把合法性闸门的加力阶梯压成 [1]（= 关闭闸门），用于 A/B 对照 */
const NO_GUARD = process.argv.includes("--noguard")
if (NO_GUARD) {
  ;(Professional as any).LEGAL_POWER_MULTS = [1]
}

/** 闸门加力系数分布：key = 系数 ×100（整数），value = 杆数 */
const mulHist = new Map<number, number>()

function recordMul(m: number) {
  const k = Math.round(m * 100)
  mulHist.set(k, (mulHist.get(k) ?? 0) + 1)
}

interface Tally {
  n: number
  shots: number
  pots: number
  noContact: number
  noCushion: number
  scratches: number
  cleared: number
  stuck: number
}

function playMatch(seed: number, acc: Tally) {
  const calculator = new AimCalculator()
  const strategy = new Professional(DIFFICULTY.Professional)
  const balls = makeBalls()
  const table = new Table(balls)
  table.cue = new Cue()
  table.cueball = balls[0]
  if (!placeSpread(balls, mulberry32(seed))) return

  const mine = balls.filter((b) => b.label >= 1 && b.label <= 7)
  const theirs = balls.filter((b) => b.label >= 9)
  const remaining = new Set<Ball>(mine)

  let shots = 0
  while (shots < MAX_SHOTS && remaining.size > 0) {
    const targets = [...remaining]
    const ctx: any = {
      table,
      cueBall: balls[0],
      validTargetBalls: targets,
      ballInHand: false,
      pockets: calculator.pockets,
      ruleName: "eightball",
      opponentBalls: theirs.filter((b) => b.onTable()),
    }
    let events: any[]
    try {
      events = strategy.aim(ctx, calculator) as any[]
    } catch {
      acc.stuck++
      break
    }
    if (!events || events.length === 0) {
      acc.stuck++
      break
    }
    const hit = events.find((e) => e.type === EventType.HIT) ?? events[events.length - 1]
    if (!hit?.tablejson) {
      acc.stuck++
      break
    }
    const aim = AimEvent.fromJson(hit.tablejson.aim)
    recordMul(strategy.lastLegalMul)
    table.outcome = []
    if (!simulate(table, aim)) return
    shots++
    acc.shots++

    const outcome = table.outcome
    const pottedMine = Outcome.pots(outcome).filter(
      (b) => b !== balls[0] && remaining.has(b)
    )
    acc.pots += pottedMine.length
    for (const b of pottedMine) remaining.delete(b)

    const scratched = Outcome.isCueBallPotted(table.cueball, outcome)
    const firstHitTarget = Outcome.firstCueContact(balls[0], outcome, targets)

    if (scratched) {
      acc.scratches++
      balls[0].pos.set(-TableGeometry.X * 0.6, 0, 0)
      balls[0].setStationary()
    } else if (!firstHitTarget) {
      acc.noContact++
    } else if (noCushionAfterContact(balls[0], outcome)) {
      acc.noCushion++
    }
  }
  if (remaining.size === 0) acc.cleared++
}

const N = Number(process.argv.slice(2).find((a) => !a.startsWith("--")) ?? 120)
const SEED_ARG = process.argv.find((a) => a.startsWith("--seed="))
const BASE_SEED = SEED_ARG ? Number(SEED_ARG.split("=")[1]) : 20260924

const acc: Tally = {
  n: 0, shots: 0, pots: 0, noContact: 0, noCushion: 0,
  scratches: 0, cleared: 0, stuck: 0,
}

console.log("=== 专业档犯规归因（八球口径）===")
console.log(`样本=${N} 局  seed=${BASE_SEED}\n`)

for (let i = 0; i < N; i++) {
  const before = acc.shots
  acc.n++
  playMatch(BASE_SEED + i * 7919, acc)
  if (acc.shots === before && acc.n > 0) acc.n--
}

const perShot = (x: number) => ((x / Math.max(1, acc.shots)) * 100).toFixed(2)
console.log(`局数=${acc.n}  总杆数=${acc.shots}  清台=${acc.cleared}  卡死=${acc.stuck}`)
console.log(`进球=${acc.pots}  进袋率/杆=${perShot(acc.pots)}%`)
console.log("")
console.log("--- 犯规分因（每杆占比）---")
console.log(`  未先击中目标球 : ${acc.noContact}  ${perShot(acc.noContact)}%`)
console.log(`  击球后无球碰库 : ${acc.noCushion}  ${perShot(acc.noCushion)}%`)
console.log(`  摔袋          : ${acc.scratches}  ${perShot(acc.scratches)}%`)
console.log(
  `  合计犯规      : ${acc.noContact + acc.noCushion + acc.scratches}  ` +
    `${perShot(acc.noContact + acc.noCushion + acc.scratches)}%`
)
console.log("")
console.log(`--- 合法性闸门加力分布${NO_GUARD ? "（闸门已关闭）" : ""} ---`)
const keys = [...mulHist.keys()].sort((a, b) => a - b)
let esc = 0
for (const k of keys) {
  const c = mulHist.get(k) ?? 0
  if (k > 100) esc += c
  console.log(`  ×${(k / 100).toFixed(2)} : ${c} 杆  ${perShot(c)}%`)
}
console.log(`  加力杆合计 : ${esc}  ${perShot(esc)}%`)
