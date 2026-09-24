/**
 * v1.3.91 无头验证：专业档 AI 的**力度档位分布**与**难度分层失误率**。
 *
 * 用户核心诉求是「不再固定全部使用小力」，因此必须能量化：
 *   - 各力度档（小力/中力/中大力/炸球）的占比，验证「中力主导」；
 *   - 击球难度分桶后的进球率，验证「简单球几乎不失误、难球适度失误」。
 *
 * 用法：
 *   npx tsx tools/harness/botpro.ts 400 [--real8ball] [--rail] [--touching]
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
import { TIER_RANGE, PowerTier } from "../../src/network/bot/decision/power"
import { enumerateCandidates } from "../../src/network/bot/decision/offense"

const STEP = 0.001953125
const REAL_8BALL = process.argv.includes("--real8ball")
const RAIL_MODE = process.argv.includes("--rail")
const TOUCHING = process.argv.includes("--touching")

function makeBalls(): Ball[] {
  const balls: Ball[] = []
  balls.push(new Ball(new Vector3(0, 0, 0), undefined, 0))
  for (let l = 1; l <= 7; l++) balls.push(new Ball(new Vector3(0, 0, 0), undefined, l))
  balls.push(new Ball(new Vector3(0, 0, 0), undefined, 8))
  for (let l = 9; l <= 15; l++) balls.push(new Ball(new Vector3(0, 0, 0), undefined, l))
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

function placeRail(balls: Ball[]): boolean {
  const X = TableGeometry.X - 1.05 * R
  const Y = TableGeometry.Y - 1.05 * R
  const placed: Ball[] = []
  const tryPlace = (b: Ball, onRail: boolean): boolean => {
    for (let a = 0; a < 300; a++) {
      let x: number
      let y: number
      if (onRail) {
        const side = Math.floor(Math.random() * 4)
        const t = (Math.random() * 2 - 1) * 0.9
        if (side === 0) { x = t * X; y = Y }
        else if (side === 1) { x = t * X; y = -Y }
        else if (side === 2) { x = X; y = t * Y }
        else { x = -X; y = t * Y }
      } else {
        x = (Math.random() * 2 - 1) * (X - 4 * R)
        y = (Math.random() * 2 - 1) * (Y - 4 * R)
      }
      let ok = true
      for (const p of placed) {
        if (Math.hypot(p.pos.x - x, p.pos.y - y) < 2.3 * R) { ok = false; break }
      }
      if (ok) { b.pos.set(x, y, 0); b.setStationary(); placed.push(b); return true }
    }
    return false
  }
  if (!tryPlace(balls[0], false)) return false
  for (let i = 1; i < balls.length; i++) {
    if (!tryPlace(balls[i], i % 2 === 0)) return false
  }
  return true
}

function simulate(table: Table, aim: AimEvent) {
  table.cue!.aim = aim
  table.cue!.hit(table.cueball)
  let guard = 0
  while (!table.allStationary() && guard++ < 300000) table.advance(STEP)
}

/** 按出杆速度反推力度档位（与 decision/power.ts 的 TIER_RANGE 对齐） */
function tierOf(power: number): PowerTier {
  for (const t of ["touch", "medium", "firm", "break"] as PowerTier[]) {
    const [lo, hi] = TIER_RANGE[t]
    if (power < hi + 1e-9) return t
  }
  return "break"
}

function run(N: number) {
  const calculator = new AimCalculator()
  const strategy = new Professional(DIFFICULTY.Professional)
  const tiers: Record<string, number> = { touch: 0, medium: 0, firm: 0, break: 0 }
  // 难度分桶（5 桶），记录每桶的样本数与进球数
  const buckets = Array.from({ length: 5 }, () => ({ n: 0, pot: 0 }))
  let total = 0, pot = 0, scratch = 0, foul = 0
  let powerSum = 0, powerN = 0

  for (let i = 0; i < N; i++) {
    const balls = makeBalls()
    const table = new Table(balls)
    table.cue = new Cue()
    table.cueball = balls[0]
    let ok = RAIL_MODE ? placeRail(balls) : placeRandom(balls)
    if (ok && TOUCHING) {
      const t = balls[1]
      let done = false
      for (let a = 0; a < 200 && !done; a++) {
        const ang = Math.random() * Math.PI * 2
        const p = new Vector3(
          t.pos.x + Math.cos(ang) * 2.02 * R,
          t.pos.y + Math.sin(ang) * 2.02 * R,
          0
        )
        if (Math.abs(p.x) > TableGeometry.X - 1.2 * R || Math.abs(p.y) > TableGeometry.Y - 1.2 * R) continue
        let clash = false
        for (const b of balls) {
          if (b === balls[0] || b === t) continue
          if (b.pos.distanceTo(p) < 2.2 * R) { clash = true; break }
        }
        if (clash) continue
        balls[0].pos.copy(p)
        balls[0].setStationary()
        done = true
      }
      if (!done) ok = false
    }
    if (!ok) continue
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
    const hit = events.find((e) => e.type === EventType.HIT) ?? events[events.length - 1]
    if (!hit || !hit.tablejson) continue
    const aim = AimEvent.fromJson(hit.tablejson.aim)
    const power = aim.power ?? 0
    powerSum += power
    powerN++
    tiers[tierOf(power)]++

    // 难度：从最后一次决策上下文里取（main 路径才有有效值）
    const diff = lastDifficulty(strategy)

    simulate(table, aim)
    const outcome = table.outcome
    const potted = Outcome.pots(outcome).some((b) => targets.includes(b))
    const scratched = Outcome.isCueBallPotted(table.cueball, outcome)
    const first = Outcome.firstCollision(outcome)
    const firstHitTarget = first ? targets.includes(first.ballB as Ball) : false

    total++
    if (potted) pot++
    if (scratched) scratch++
    if (!scratched && !firstHitTarget) foul++

    const bi = Math.min(4, Math.floor(diff * 5))
    buckets[bi].n++
    if (potted) buckets[bi].pot++
  }

  const pct = (x: number) => ((x / Math.max(1, total)) * 100).toFixed(1)
  const tierPct = (t: string) => ((tiers[t] / Math.max(1, powerN)) * 100).toFixed(1)
  return {
    total,
    pot: pct(pot),
    scratch: pct(scratch),
    foul: pct(foul),
    avgPower: powerN ? (powerSum / powerN / R).toFixed(1) : "0",
    tiers: tiers as any,
    tierPct,
    buckets,
    powerN,
  }
}

/** 从 strategy 的最近决策里取「本杆选中的难度」（近似：用最简单候选的难度） */
function lastDifficulty(strategy: Professional): number {
  const d = (strategy as any).lastDecision
  if (!d) return 0.5
  // 用 targets 里最易候选的难度作为本杆难度代理
  try {
    const cands = enumerateCandidates(d, 0.1)
    if (!cands.length) return 0.8
    return Math.min(...cands.map((c: any) => c.difficulty))
  } catch {
    return 0.5
  }
}

const N = Number(process.argv[2] ?? 400)
console.log(
  `mode: ${REAL_8BALL ? "real8ball" : "default"}${RAIL_MODE ? " + rail" : ""}${TOUCHING ? " + touching" : ""}`
)
const r = run(N)
console.log(`N=${r.total}  pot=${r.pot}%  scratch=${r.scratch}%  foul=${r.foul}%  avgPower=${r.avgPower}R`)
console.log(
  `力度档位: 小力=${r.tierPct("touch")}%  中力=${r.tierPct("medium")}%  中大力=${r.tierPct("firm")}%  炸球=${r.tierPct("break")}%`
)
console.log("难度分桶进球率（难度区间 → 样本 / 进球率）:")
const labels = ["0.0-0.2", "0.2-0.4", "0.4-0.6", "0.6-0.8", "0.8-1.0"]
r.buckets.forEach((b, i) => {
  const rate = b.n ? ((b.pot / b.n) * 100).toFixed(1) : "-"
  console.log(`  ${labels[i]}  n=${b.n}  pot=${rate}%`)
})
