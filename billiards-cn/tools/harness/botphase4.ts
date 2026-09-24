/**
 * v1.3.91 阶段4 无头验证：炸球评估 + 清台顺序。
 *
 * 指标：
 *   ① 开球杆：炸球方案是否被采用、收益/风险分布、实际摔袋率与散开度
 *   ② 清台顺序：难点球优先 vs 纯收益排序，谁留下的「死局率」更低
 */
import "./predom"
import { Table } from "../../src/model/table"
import { Ball } from "../../src/model/ball"
import { R } from "../../src/model/physics/constants"

const STEP = 0.001953125
import { TableGeometry } from "../../src/view/tablegeometry"
import { Professional } from "../../src/network/bot/strategies/professional"
import { AimCalculator } from "../../src/network/bot/aimcalculator"
import { Cue } from "../../src/view/cue"
import { AimEvent } from "../../src/events/aimevent"
import { EventType } from "../../src/events/eventtype"
import { Outcome, OutcomeType } from "../../src/model/outcome"
import { Vector3 } from "three"
import { DIFFICULTY } from "../../src/network/bot/difficulty"
import { buildDecisionContext } from "../../src/network/bot/decision/shotcontext"
import { enumerateCandidates } from "../../src/network/bot/decision/offense"
import { rankClearance, hardBallCount } from "../../src/network/bot/decision/clearance"

const calc = new AimCalculator()
const TX = TableGeometry.tableX
const TY = TableGeometry.tableY

function makeBalls(): Ball[] {
  const b: Ball[] = [new Ball(new Vector3(0, 0, 0), undefined, 0)]
  for (let l = 1; l <= 7; l++) b.push(new Ball(new Vector3(0, 0, 0), undefined, l))
  b.push(new Ball(new Vector3(0, 0, 0), undefined, 8))
  for (let l = 9; l <= 15; l++) b.push(new Ball(new Vector3(0, 0, 0), undefined, l))
  return b
}

function simulate(table: Table, aim: AimEvent) {
  table.cue!.aim = aim
  table.cue!.hit(table.cueball)
  let guard = 0
  while (!table.allStationary() && guard++ < 300000) table.advance(STEP)
}

/**
 * 八球标准开球摆位：白球置头区，1 号球在脚点，其余球摆成三角框，
 * 8 号在中心。这里做一个「近似三角框」——足够触发 findCluster。
 */
function placeBreak(balls: Ball[]): boolean {
  const cue = balls[0]
  cue.pos.set(-TX * 0.5, (Math.random() * 2 - 1) * 3 * R, 0)
  cue.setStationary()

  // 三角框：顶点在 +x 侧，向 -x 展开 5 排，共 15 颗（1+2+3+4+5）
  const apexX = TX * 0.55
  const gap = 2.02 * R
  const rowDx = gap * Math.sqrt(3) * 0.5
  const rest = balls.slice(1)
  const eight = rest.find((b) => b.label === 8)!
  const others = rest.filter((b) => b.label !== 8)
  for (let i = others.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[others[i], others[j]] = [others[j], others[i]]
  }
  // 按「从顶点向外、每排从左到右」的顺序排好 15 个位置
  const slots: { x: number; y: number }[] = []
  for (let row = 0; row < 5; row++) {
    const x = apexX - row * rowDx
    for (let k = 0; k <= row; k++) {
      slots.push({ x, y: (k - row / 2) * gap })
    }
  }
  const order: Ball[] = []
  let oi = 0
  for (let i = 0; i < slots.length; i++) {
    // 第 3 排（row=2）的正中是 8 号球
    order.push(i === 4 ? eight : others[oi++])
  }
  for (let i = 0; i < slots.length; i++) {
    const { x, y } = slots[i]
    if (Math.abs(x) > TX - R || Math.abs(y) > TY - R) return false
    order[i].pos.set(x, y, 0)
    order[i].setStationary()
  }
  return true
}

/** 随机散开摆位（非开球），用于清台顺序评估 */
function placeSpread(balls: Ball[]): boolean {
  const X = TX - 2.2 * R
  const Y = TY - 2.2 * R
  const placed: Ball[] = []
  for (const b of balls) {
    let ok = false
    for (let a = 0; a < 300 && !ok; a++) {
      const p = new Vector3((Math.random() * 2 - 1) * X, (Math.random() * 2 - 1) * Y, 0)
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

// ---------- ① 开球杆 ----------
function breakStats(n: number) {
  const strategy = new Professional(DIFFICULTY.Professional)
  let used = 0
  let scratch = 0
  let total = 0
  const scores: number[] = []
  const rewards: number[] = []
  const risks: number[] = []
  let spreadSum = 0

  for (let i = 0; i < n; i++) {
    const balls = makeBalls()
    const table = new Table(balls)
    table.cue = new Cue()
    table.cueball = balls[0]
    if (!placeBreak(balls)) { console.error('[diag] placeBreak 失败'); continue }
    // 开球前记录球堆紧凑度（用目标球两两最近距均值近似）
    const before = balls.slice(1).map((b) => b.pos.clone())
    const ctx: any = {
      table,
      cueBall: balls[0],
      validTargetBalls: balls.filter((b) => b.label >= 1 && b.label <= 7),
      ballInHand: false,
      pockets: calc.pockets,
      ruleName: "eightball",
      opponentBalls: balls.filter((b) => b.label >= 9),
      isBreak: true,
    }
    let events: any[]
    try {
      events = strategy.aim(ctx, calc) as any[]
    } catch {
      continue
    }
    if (!events || !events.length) continue
    const hit = events.find((e) => e.type === EventType.HIT) ?? events[events.length - 1]
    if (!hit?.tablejson) continue
    const aim = AimEvent.fromJson(hit.tablejson.aim)
    const bp = (strategy as any).lastBreakPlan
    total++
    if (bp) {
      used++
      scores.push(bp.score)
      rewards.push(bp.reward)
      risks.push(bp.scratchRisk)
    }
    simulate(table, aim)
    if (Outcome.isCueBallPotted(table.cueball, table.outcome)) scratch++
    // 散开度：球堆位移总和
    let disp = 0
    const after = balls.slice(1)
    for (let k = 0; k < before.length; k++) {
      disp += before[k].distanceTo(after[k].pos)
    }
    spreadSum += disp / before.length
  }
  const avg = (a: number[]) =>
    a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0
  return {
    total,
    used,
    scratchPct: ((scratch / (total || 1)) * 100).toFixed(1),
    avgScore: avg(scores).toFixed(3),
    avgReward: avg(rewards).toFixed(3),
    avgRisk: avg(risks).toFixed(3),
    avgSpread: (avg([spreadSum / (total || 1)]) / R).toFixed(1),
  }
}

// ---------- ② 清台顺序 ----------
function clearanceStats(n: number) {
  let total = 0
  let deadByPriority = 0
  let deadByGreedy = 0
  let harderFirstByPriority = 0
  let harderFirstByGreedy = 0

  for (let i = 0; i < n; i++) {
    const balls = makeBalls()
    const table = new Table(balls)
    table.cue = new Cue()
    table.cueball = balls[0]
    if (!placeSpread(balls)) continue
    const mine = balls.filter((b) => b.label >= 1 && b.label <= 7)
    const theirs = balls.filter((b) => b.label >= 9)
    const ctx: any = {
      table,
      cueBall: balls[0],
      validTargetBalls: mine,
      ballInHand: false,
      pockets: calc.pockets,
      ruleName: "eightball",
      opponentBalls: theirs,
    }
    const d = buildDecisionContext(ctx, DIFFICULTY.Professional, calc, {
      isBreak: true,
      ruleName: "eightball",
      opponentBalls: ctx.opponentBalls,
    })
    const cands = enumerateCandidates(d, 0.15)
    if (cands.length < 2) continue
    total++

    const order = rankClearance(cands, d)
    // 清台顺序的真实排序：按 clearanceFactor 降序（与 professional.ts 一致）
    const factor = (c: any) => 0.75 + 0.25 * (c.clearancePriority ?? 0)
    let priorityBest = cands[0]
    for (const c of cands) {
      if ((c as any).difficulty > 0.75) continue
      if (factor(c) > factor(priorityBest)) priorityBest = c
    }
    // 纯收益排序：按 (1 - difficulty) 降序
    let greedyBest = cands[0]
    for (const c of cands) if (c.difficulty < greedyBest.difficulty) greedyBest = c

    // 「难题优先」是否成立：选中的球是否比贪心选的更难
    if (priorityBest.difficulty > greedyBest.difficulty + 1e-6) harderFirstByPriority++

    // 死局判据：选中之后，剩余球里还有多少「连候选都枚举不出」的球
    const remainsAfter = (skip: Ball) => {
      const rem = mine.filter((b) => b !== skip)
      const virt: any = { ...d, targets: rem }
      const c2 = enumerateCandidates(virt, 0.15)
      const reach = new Set(c2.map((x) => x.ball))
      return rem.filter((b) => !reach.has(b)).length
    }
    const deadP = remainsAfter(priorityBest.ball)
    const deadG = remainsAfter(greedyBest.ball)
    if (deadP > deadG) deadByPriority++
    if (deadG > deadP) deadByGreedy++
  }
  return {
    total,
    harderFirstByPriority,
    deadByPriority,
    deadByGreedy,
    hardLeft: 0,
  }
}

const N = Number(process.argv.slice(2).find((a) => !a.startsWith("--")) ?? 200)
console.log("=== ① 开球杆（八球三角框）===")
const b = breakStats(N)
console.log(
  `N=${b.total}  采用炸球=${b.used}  摔袋=${b.scratchPct}%  平均散开=${b.avgSpread}R`
)
console.log(
  `炸球评估: score=${b.avgScore} reward=${b.avgReward} scratchRisk=${b.avgRisk}`
)

console.log("")
console.log("=== ② 清台顺序（散开局面）===")
const c = clearanceStats(N)
console.log(`N=${c.total}`)
console.log(
  `「难点球优先」选中更难球的比例=${((c.harderFirstByPriority / (c.total || 1)) * 100).toFixed(1)}%`
)
console.log(
  `剩余死局数：优先级排序更差=${c.deadByPriority}  贪心更差=${c.deadByGreedy}`
)
void hardBallCount
