/**
 * v1.3.91 无头验证：走位质量指标。
 *
 * 用户诉求之一是「多步走位规划：向前预判后续 2~3 颗球的衔接」。
 * 光看进球率/摔袋率无法反映走位好坏，需要专门的度量：
 *
 *   - nextEasyRate：把 AI 打进的那颗球移除后，**在真实停位上**重新评估
 *     「下一杆是否有难度 ≤ 阈值的候选」。这是走位好坏的直接体现 ——
 *     职业选手定义的好走位就是"下一杆还有球可打"。
 *   - avgNextDiff：下一杆最佳候选的难度均值（越低越好）。
 *   - deadRate：停死后完全无候选的比例。
 *
 * 对照方式：--nolookahead 关闭前瞻（depth=0）复现改造前行为。
 *
 * 用法：
 *   npx tsx tools/harness/botpos.ts 400 [--real8ball] [--nolookahead]
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
import { Outcome } from "../../src/model/outcome"
import { Vector3 } from "three"
import { DIFFICULTY } from "../../src/network/bot/difficulty"
import { buildDecisionContext } from "../../src/network/bot/decision/shotcontext"
import { enumerateCandidates } from "../../src/network/bot/decision/offense"

const STEP = 0.001953125
const REAL_8BALL = process.argv.includes("--real8ball")
const NO_LOOKAHEAD = process.argv.includes("--nolookahead")
/** 球型集中在半台 + 带一个球堆：走位规划的收益只有在拥挤局面才显现 */
const CLUSTER = process.argv.includes("--cluster")

function makeBalls(): Ball[] {
  const balls: Ball[] = []
  balls.push(new Ball(new Vector3(0, 0, 0), undefined, 0))
  for (let l = 1; l <= 7; l++)
    balls.push(new Ball(new Vector3(0, 0, 0), undefined, l))
  balls.push(new Ball(new Vector3(0, 0, 0), undefined, 8))
  for (let l = 9; l <= 15; l++)
    balls.push(new Ball(new Vector3(0, 0, 0), undefined, l))
  return balls
}

function placeRandom(balls: Ball[]): boolean {
  const X = TableGeometry.X - 2.2 * R
  const Y = TableGeometry.Y - 2.2 * R
  const placed: Ball[] = []
  const tryPlace = (b: Ball): boolean => {
    for (let a = 0; a < 300; a++) {
      const x = (Math.random() * 2 - 1) * X
      const y = (Math.random() * 2 - 1) * Y
      let ok = true
      for (const p of placed) {
        if (Math.hypot(p.pos.x - x, p.pos.y - y) < 2.3 * R) {
          ok = false
          break
        }
      }
      if (ok) {
        b.pos.set(x, y, 0)
        b.setStationary()
        placed.push(b)
        return true
      }
    }
    return false
  }
  for (const b of balls) if (!tryPlace(b)) return false
  return true
}

/**
 * 拥挤球型：把 7 颗目标球压在球台的一侧半区（并允许它们互相靠近至 2.3R），
 * 这样「打完这颗之后母球停在哪」才会真正决定下一杆有没有球可打。
 */
function placeCluster(balls: Ball[]): boolean {
  const placed: Ball[] = []
  // 母球放另一侧，保证起始有距离
  balls[0].pos.set(-TableGeometry.X * 0.6, 0, 0)
  balls[0].setStationary()
  placed.push(balls[0])
  const zoneX0 = 0.1 * TableGeometry.X
  const zoneY = TableGeometry.Y - 3 * R
  for (let i = 1; i < balls.length; i++) {
    const b = balls[i]
    let ok = false
    for (let a = 0; a < 400 && !ok; a++) {
      const x = zoneX0 + Math.random() * (TableGeometry.X - zoneX0 - 2.5 * R)
      const y = (Math.random() * 2 - 1) * zoneY
      let clash = false
      for (const p of placed) {
        if (Math.hypot(p.pos.x - x, p.pos.y - y) < 2.3 * R) {
          clash = true
          break
        }
      }
      if (!clash) {
        b.pos.set(x, y, 0)
        b.setStationary()
        placed.push(b)
        ok = true
      }
    }
    if (!ok) return false
  }
  return true
}

function simulate(table: Table, aim: AimEvent) {
  table.cue!.aim = aim
  table.cue!.hit(table.cueball)
  let guard = 0
  while (!table.allStationary() && guard++ < 300000) table.advance(STEP)
}

function run(N: number) {
  const calculator = new AimCalculator()
  const profile = NO_LOOKAHEAD
    ? { ...DIFFICULTY.Professional, lookaheadDepth: 0, positionPlay: false }
    : DIFFICULTY.Professional
  const strategy = new Professional(profile as typeof DIFFICULTY.Professional)

  let total = 0
  let potted = 0
  let nextEasy = 0
  let dead = 0
  let nextDiffSum = 0
  let nextDiffN = 0
  // 更细的度量：下一杆可打候选数（不只「有没有」，还有「有几个」）
  let followSum = 0
  let followN = 0
  const nextDiffs: number[] = []

  for (let i = 0; i < N; i++) {
    const balls = makeBalls()
    const table = new Table(balls)
    table.cue = new Cue()
    table.cueball = balls[0]
    if (!(CLUSTER ? placeCluster(balls) : placeRandom(balls))) continue
    const targets = REAL_8BALL
      ? balls.filter((b) => b.label !== 0 && b.label !== 8 && b.label <= 7)
      : balls.filter((b) => b !== balls[0] && b.label !== 8)
    const ctx = {
      table,
      cueBall: balls[0],
      validTargetBalls: targets,
      ballInHand: false,
      pockets: calculator.pockets,
      ruleName: "eightball",
    }
    let events: any[]
    try {
      events = strategy.aim(ctx as any, calculator) as any[]
    } catch {
      continue
    }
    if (!events || events.length === 0) continue
    const hit =
      events.find((e) => e.type === EventType.HIT) ?? events[events.length - 1]
    if (!hit || !hit.tablejson) continue
    const aim = AimEvent.fromJson(hit.tablejson.aim)

    // 记录出杆前的局面信息，便于事后在停位上重算
    const cueBefore = balls[0].pos.clone()

    simulate(table, aim)
    total++

    const outcome = table.outcome
    const pots = Outcome.pots(outcome)
    const pottedTargets = pots.filter((b) => targets.includes(b))
    if (pottedTargets.length === 0) continue
    potted++

    // 在真实停位上评估下一杆
    const remaining = targets.filter((b) => !pottedTargets.includes(b) && b.onTable())
    if (remaining.length === 0) continue
    const cue = table.cueball
    if (!cue.onTable()) continue

    const nextCtx: any = {
      table,
      cueBall: cue,
      validTargetBalls: remaining,
      ballInHand: false,
      pockets: calculator.pockets,
      ruleName: "eightball",
    }
    let dctx
    try {
      dctx = buildDecisionContext(
        nextCtx,
        DIFFICULTY.Professional,
        calculator
      )
    } catch {
      continue
    }
    const cands = enumerateCandidates(dctx, 0.15)
    if (cands.length === 0) {
      dead++
      continue
    }
    const threshold = DIFFICULTY.Professional.offenseThreshold ?? 0.72
    const good = cands.filter((c) => c.difficulty <= threshold)
    if (good.length > 0) nextEasy++
    let best = cands[0]
    for (const c of cands) if (c.difficulty < best.difficulty) best = c
    nextDiffSum += best.difficulty
    nextDiffN++
    nextDiffs.push(best.difficulty)
    followSum += good.length
    followN++
    void cueBefore
  }

  const pct = (x: number) => ((x / Math.max(1, potted)) * 100).toFixed(1)
  nextDiffs.sort((a, b) => a - b)
  return {
    total,
    potted,
    nextEasy: pct(nextEasy),
    dead: pct(dead),
    avgNextDiff: nextDiffN ? (nextDiffSum / nextDiffN).toFixed(3) : "-",
    medianNextDiff: nextDiffs.length
      ? nextDiffs[Math.floor(nextDiffs.length / 2)].toFixed(3)
      : "-",
    avgFollowUps: followN ? (followSum / followN).toFixed(2) : "-",
  }
}

const N = Number(process.argv[2] ?? 400)
console.log(
  `mode: ${REAL_8BALL ? "real8ball" : "default"}${NO_LOOKAHEAD ? " + nolookahead" : ""}`
)
const r = run(N)
console.log(
  `N=${r.total}  进球样本=${r.potted}  下一杆有球可打=${r.nextEasy}%  ` +
    `停死=${r.dead}%  下一杆最佳难度 均值=${r.avgNextDiff} 中位=${r.medianNextDiff}  ` +
    `下一杆可打候选数=${r.avgFollowUps}`
)
