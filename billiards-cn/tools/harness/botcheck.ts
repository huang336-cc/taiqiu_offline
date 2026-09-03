/**
 * v1.3.66/67 无头验证：测量专业档 AI 在随机八球布局下的
 *   - 摔袋率 (cue ball potted)
 *   - 犯规率 (首撞非本方球，且非摔袋)
 *   - 进球率 (至少打进一颗本方球)
 *   - 干净进球率 (进球且未摔袋且首撞合法)
 *   - 平均出杆速度（按 choosePower 输出，R 单位）
 *   - 无安全球占比（所有候选 plan 的 scratchRisk 都 < 2.4R）
 *   - 摔袋分桶：主路径（plan>0 选了其中之一）vs 兜底（plan=0 走 safetyOrFallback）
 * 直接 import src 内的模型与策略，headless 跑物理（不依赖渲染 / DOM）。
 *
 * 用法：
 *   npx tsx tools/harness/botcheck.ts 400           # 默认（14 颗全部当合法目标）
 *   npx tsx tools/harness/botcheck.ts 400 --real8ball  # 真实八球：只 7 颗本方球
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

const STEP = 0.001953125
const REAL_8BALL = process.argv.includes("--real8ball")
const RISKY_THRESHOLD = 2.4 * R

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

function run(N: number) {
  const calculator = new AimCalculator()
  const strategy = new Professional(DIFFICULTY.Professional)
  let scratch = 0,
    foul = 0,
    pot = 0,
    clean = 0,
    total = 0,
    scratchMain = 0,
    scratchFallback = 0,
    fallback = 0,
    noSafePlan = 0,
    powerSum = 0,
    powerN = 0

  for (let i = 0; i < N; i++) {
    const balls = makeBalls()
    const table = new Table(balls)
    table.cue = new Cue()
    table.cueball = balls[0]
    if (!placeRandom(balls)) continue
    // 真实八球只取 7 颗本方球当合法目标；默认模式把 14 颗非 8 都当合法
    // （harness 偏乐观，forces 不太会被挡死，与 v1.3.66 行为一致）。
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
      if (i < 3) console.error("[aim err]", (e as Error).message)
      continue
    }
    if (!events || events.length === 0) continue
    const hit = events.find((e) => e.type === EventType.HIT) ?? events[events.length - 1]
    if (!hit || !hit.tablejson) continue
    const aim = AimEvent.fromJson(hit.tablejson.aim)
    powerSum += aim.power ?? 0
    powerN++

    simulate(table, aim)
    const outcome = table.outcome
    const cueScratched = Outcome.isCueBallPotted(table.cueball, outcome)
    const pots = Outcome.pots(outcome)
    const targetPotted = pots.some((b) => targets.includes(b))
    const first = Outcome.firstCollision(outcome)
    const firstHitTarget = first ? targets.includes(first.ballB as Ball) : false
    // 兜底判定：safetyOrFallback 不会产生 farKnuckleHit，只有主路径会。
    // 三事件数组（aim/farKnuckleAim/pocketHit）= 主路径；两事件 = 兜底。
    const usedFallback = events.length <= 2
    total++
    if (cueScratched) {
      scratch++
      if (usedFallback) scratchFallback++
      else scratchMain++
    }
    if (targetPotted) pot++
    if (targetPotted && !cueScratched && firstHitTarget) clean++
    if (!cueScratched && !firstHitTarget) foul++
    if (usedFallback) fallback++
    // noSafePlan 仅主路径有 plan 时可统计（兜底本身就是 plan=0）；
    // 这里用一个保守近似：若用了 fallback，记为 noSafePlan。
    if (usedFallback) noSafePlan++
  }

  const pct = (x: number) => ((x / Math.max(1, total)) * 100).toFixed(1)
  const avgPower = powerN ? ((powerSum / powerN) / R).toFixed(1) : "0"
  return {
    total,
    scratch: pct(scratch),
    scratchMain: pct(scratchMain),
    scratchFallback: pct(scratchFallback),
    foul: pct(foul),
    pot: pct(pot),
    clean: pct(clean),
    fallback: pct(fallback),
    noSafePlan: pct(noSafePlan),
    avgPower,
  }
}

const N = Number(process.argv[2] ?? 400)
console.log(`mode: ${REAL_8BALL ? "real8ball(7 颗)" : "default(14 颗)"}`)
const r = run(N)
console.log(
  `N=${r.total}  scratch=${r.scratch}% (主${r.scratchMain}% + 兜底${r.scratchFallback}%)  foul=${r.foul}%  pot=${r.pot}%  cleanPot=${r.clean}%`
)
console.log(
  `fallback=${r.fallback}%  noSafePlan=${r.noSafePlan}%  avgPower=${r.avgPower}R`
)