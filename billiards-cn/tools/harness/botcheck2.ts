/**
 * v1.3.74 无头验证：测量专业档 AI 的「击球后无球碰库」犯规（用户实测反馈）。
 *
 * 背景：botcheck.ts 只统计「首撞非本方球」犯规，漏掉了八球规则第 3 条
 * （eightball.ts foulReason：本杆无进球 && 首撞后无任何 Cushion 事件 → 犯规）。
 * v1.3.68/69 力度物理化后 choosePower 反解的是「物体球刚好够到袋口边界」的
 * 最小力度 + 深低杆拉住母球，一旦没进（~17%），物体球半路短停、母球被低杆
 * 拉回，两球都够不到库 → 必犯规。安全球兜底（safetyOrFallback 轻推 0.4×dToPocket）
 * 更是 100% 触发该规则。
 *
 * 统计项：
 *   - noRailFoul：无进球且首撞后无 Cushion（主路径 / 兜底分桶）
 *   - wrongHitFoul：首撞非本方球（botcheck 原有口径）
 *   - scratch / pot / clean：沿用 botcheck 口径
 *   - avgPower 与力度分桶（<30R / 30-60R / >60R）
 *
 * 用法：
 *   npx tsx tools/harness/botcheck2.ts 400 [--real8ball]
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
const REAL_8BALL = process.argv.includes("--real8ball")

function makeBalls(): Ball[] {
  const balls: Ball[] = []
  balls.push(new Ball(new Vector3(0, 0, 0), undefined, 0)) // cue
  for (let l = 1; l <= 7; l++) balls.push(new Ball(new Vector3(0, 0, 0), undefined, l))
  balls.push(new Ball(new Vector3(0, 0, 0), undefined, 8)) // 8
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
  for (const b of balls) {
    if (!tryPlace(b)) return false
  }
  return true
}

function simulate(table: Table, aim: AimEvent) {
  table.cue!.aim = aim
  table.cue!.hit(table.cueball)
  let guard = 0
  while (!table.allStationary() && guard++ < 300000) {
    table.advance(STEP)
  }
}

/** 母球停点离最近库边的距离（米） */
function cueDistToRail(table: Table): number {
  const p = table.cueball.pos
  return Math.min(
    TableGeometry.X - Math.abs(p.x),
    TableGeometry.Y - Math.abs(p.y)
  )
}

function run(N: number) {
  const calculator = new AimCalculator()
  const strategy = new Professional(DIFFICULTY.Professional)
  let scratch = 0,
    pot = 0,
    clean = 0,
    total = 0,
    fallback = 0,
    wrongHit = 0,
    noRail = 0,
    noRailMain = 0,
    noRailFallback = 0,
    powerSum = 0,
    powerN = 0,
    powLow = 0,
    powMid = 0,
    powHigh = 0

  for (let i = 0; i < N; i++) {
    const balls = makeBalls()
    const table = new Table(balls)
    table.cue = new Cue()
    table.cueball = balls[0]
    if (!placeRandom(balls)) continue
    const targets = REAL_8BALL
      ? balls.filter((b) => b.label !== 0 && b.label !== 8 && b.label <= 7)
      : balls.filter((b) => b !== balls[0] && b.label !== 8)
    const ctx = {
      table,
      cueBall: balls[0],
      validTargetBalls: targets,
      ballInHand: false,
      pockets: calculator.pockets,
    }
    let events: any[]
    try {
      events = strategy.aim(ctx as any, calculator) as any[]
    } catch (e) {
      continue
    }
    if (!events || events.length === 0) continue
    const hit =
      events.find((e) => e.type === EventType.HIT) ?? events[events.length - 1]
    if (!hit || !hit.tablejson) continue
    const aim = AimEvent.fromJson(hit.tablejson.aim)
    const pw = aim.power ?? 0
    powerSum += pw
    powerN++
    const pwR = pw / R
    if (pwR < 30) powLow++
    else if (pwR <= 60) powMid++
    else powHigh++

    simulate(table, aim)
    const outcome: Outcome[] = table.outcome
    const cueScratched = Outcome.isCueBallPotted(table.cueball, outcome)
    const pots = Outcome.pots(outcome)
    const targetPotted = pots.some((b) => targets.includes(b))
    const first = Outcome.firstCollision(outcome)
    const firstHitTarget = first ? targets.includes(first.ballB as Ball) : false
    const usedFallback = events.length <= 2
    total++
    if (cueScratched) scratch++
    if (targetPotted) pot++
    if (targetPotted && !cueScratched && firstHitTarget) clean++
    if (first && !firstHitTarget) wrongHit++
    if (!targetPotted && first && firstHitTarget) {
      // 复刻 eightball.foulReason 第 3 条：无进球且首撞后无 Cushion
      const idx = outcome.indexOf(first)
      const cushionAfter = outcome
        .slice(idx + 1)
        .some((o) => o.type === OutcomeType.Cushion)
      if (!cushionAfter) {
        noRail++
        if (usedFallback) noRailFallback++
        else noRailMain++
      }
    }
    if (usedFallback) fallback++
  }

  const pct = (x: number) => ((x / Math.max(1, total)) * 100).toFixed(1)
  const avgPower = powerN ? ((powerSum / powerN) / R).toFixed(1) : "0"
  return { total, pct, avgPower, scratch, pot, clean, fallback, wrongHit, noRail, noRailMain, noRailFallback, powLow, powMid, powHigh }
}

const N = Number(process.argv[2] ?? 400)
console.log(`mode: ${REAL_8BALL ? "real8ball(7 颗)" : "default(14 颗)"}`)
const r = run(N)
console.log(
  `N=${r.total}  scratch=${r.pct(r.scratch)}%  pot=${r.pct(r.pot)}%  cleanPot=${r.pct(r.clean)}%  wrongHit=${r.pct(r.wrongHit)}%`
)
console.log(
  `noRailFoul=${r.pct(r.noRail)}% (主路径 ${r.pct(r.noRailMain)}% + 兜底 ${r.pct(r.noRailFallback)}%)  fallback=${r.pct(r.fallback)}%`
)
console.log(
  `avgPower=${r.avgPower}R  分桶 <30R:${r.pct(r.powLow)}% / 30-60R:${r.pct(r.powMid)}% / >60R:${r.pct(r.powHigh)}%`
)
