/**
 * v1.3.75 无头验证：测量专业档 AI 的「未击打任何球」（空杆 / no contact）。
 *
 * 用户反馈：AI 出杆后母球一颗球都没碰到（回放里看得清清楚楚），属于八球里
 * 最糟的犯规之一（空杆 = 直接送自由球）。botcheck2 只统计「首撞非本方球」
 * 与「无进球且首撞后无碰库」，两者都以"母球碰到了球"为前提，
 * **完全漏掉了母球压根没碰到任何球的那一类**。本脚本专门补这个统计。
 *
 * 口径：
 *   - noContact：整杆 outcome 里没有任何 Collision 事件（母球没碰到任何球）
 *   - cushionFirst：母球第一个事件就是撞库（说明方向就打飞了）
 *   - 主路径 / 兜底（safetyOrFallback）分桶，便于定位是哪条分支出的问题
 *   - 额外记录空杆时的：力度、切球角余弦、母球→目标距离、目标是否贴库
 *
 * 场景：
 *   --real8ball  真实八球（只打 1-7 号）
 *   --rail       贴库场景（目标球贴库，最容易出 ghost ball 越界导致打空）
 *
 * 用法：
 *   npx tsx tools/harness/botcheck3.ts 400 [--real8ball] [--rail]
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
const RAIL_MODE = process.argv.includes("--rail")
/** 母球也贴库（ghost ball 最容易越界、母球最容易先撞库的极端场景） */
const CUE_RAIL = process.argv.includes("--cuerail")
/** 母球紧贴某颗目标球（贴球 / touching ball 场景） */
const TOUCHING = process.argv.includes("--touching")

function makeBalls(): Ball[] {
  const balls: Ball[] = []
  balls.push(new Ball(new Vector3(0, 0, 0), undefined, 0)) // cue
  for (let l = 1; l <= 7; l++)
    balls.push(new Ball(new Vector3(0, 0, 0), undefined, l))
  balls.push(new Ball(new Vector3(0, 0, 0), undefined, 8)) // 8
  for (let l = 9; l <= 15; l++)
    balls.push(new Ball(new Vector3(0, 0, 0), undefined, l))
  return balls
}

/** 随机散布（同 botcheck2） */
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

/** 贴库场景：一半目标球紧贴库边；--cueRail 时母球也贴库 */
function placeRail(balls: Ball[], cueOnRail: boolean): boolean {
  const X = TableGeometry.X - 1.05 * R
  const Y = TableGeometry.Y - 1.05 * R
  const placed: Ball[] = []
  const tryPlace = (b: Ball, onRail: boolean): boolean => {
    for (let a = 0; a < 300; a++) {
      let x: number
      let y: number
      if (onRail) {
        // 贴四条库边之一（离库 1.05R，几乎贴死）
        const side = Math.floor(Math.random() * 4)
        const t = (Math.random() * 2 - 1) * 0.9
        if (side === 0) {
          x = t * X
          y = Y
        } else if (side === 1) {
          x = t * X
          y = -Y
        } else if (side === 2) {
          x = X
          y = t * Y
        } else {
          x = -X
          y = t * Y
        }
      } else {
        x = (Math.random() * 2 - 1) * (X - 4 * R)
        y = (Math.random() * 2 - 1) * (Y - 4 * R)
      }
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
  // 母球第一个放，是否贴库由 --cueRail 决定
  if (!tryPlace(balls[0], cueOnRail)) return false
  for (let i = 1; i < balls.length; i++) {
    // 其余球一半贴库；--cueRail 时让目标球尽量靠近母球所在的那条库
    if (!tryPlace(balls[i], i % 2 === 0)) return false
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

function distToRail(p: Vector3): number {
  return Math.min(
    TableGeometry.X - Math.abs(p.x),
    TableGeometry.Y - Math.abs(p.y)
  )
}

function run(N: number) {
  const calculator = new AimCalculator()
  const strategy = new Professional(DIFFICULTY.Professional)
  let total = 0
  let noContact = 0
  let noContactMain = 0
  let noContactFallback = 0
  let cushionFirst = 0
  let fallback = 0
  let pot = 0
  let scratch = 0
  const samples: string[] = []

  for (let i = 0; i < N; i++) {
    const balls = makeBalls()
    const table = new Table(balls)
    table.cue = new Cue()
    table.cueball = balls[0]
    let ok = RAIL_MODE
      ? placeRail(balls, CUE_RAIL)
      : placeRandom(balls)
    if (ok && TOUCHING) {
      // 把母球挪到 1 号球旁边紧贴（2.02R），模拟 touching ball。
      // 必须保证不与其它任何球重叠，否则物理会爆 NaN（此前台面直接崩掉）。
      const t = balls[1]
      let done = false
      for (let a = 0; a < 200 && !done; a++) {
        const ang = Math.random() * Math.PI * 2
        const p = new Vector3(
          t.pos.x + Math.cos(ang) * 2.02 * R,
          t.pos.y + Math.sin(ang) * 2.02 * R,
          0
        )
        if (
          Math.abs(p.x) > TableGeometry.X - 1.2 * R ||
          Math.abs(p.y) > TableGeometry.Y - 1.2 * R
        ) {
          continue
        }
        let clash = false
        for (const b of balls) {
          if (b === balls[0] || b === t) continue
          if (b.pos.distanceTo(p) < 2.2 * R) {
            clash = true
            break
          }
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
    const usedFallback = events.length <= 2

    simulate(table, aim)
    const outcome: Outcome[] = table.outcome
    const firstCollision = Outcome.firstCollision(outcome)
    const firstCushion = outcome.find((o) => o.type === OutcomeType.Cushion)
    total++
    if (usedFallback) fallback++

    if (!firstCollision) {
      noContact++
      if (usedFallback) noContactFallback++
      else noContactMain++
      if (samples.length < 8) {
        // 沿出杆方向做一次射线检测：母球能不能真的碰到点什么
        const a = aim.angle ?? 0
        const dir = new Vector3(Math.cos(a), Math.sin(a), 0)
        let nearest = Infinity
        let nearestLabel = -1
        for (const b of balls) {
          if (b === balls[0] || !b.onTable()) continue
          const rel = b.pos.clone().sub(balls[0].pos)
          const along = rel.dot(dir)
          if (along <= 0) continue
          const perp = Math.sqrt(
            Math.max(0, rel.lengthSq() - along * along)
          )
          if (perp < nearest) {
            nearest = perp
            nearestLabel = b.label ?? -1
          }
        }
        const onTable = balls
          .filter((b) => b !== balls[0] && b.onTable())
          .map(
            (b) =>
              `#${b.label}(${(b.pos.x / R).toFixed(1)},${(b.pos.y / R).toFixed(1)})`
          )
          .join(" ")
        samples.push(
          `angle=${deg}° power=${((aim.power ?? 0) / R).toFixed(1)}R ` +
            `offset=(${(aim.offset?.x ?? 0).toFixed(2)},${(aim.offset?.y ?? 0).toFixed(2)}) ` +
            `branch=${usedFallback ? "fallback" : "main"} ` +
            `最近垂距=${(nearest / R).toFixed(2)}R(#${nearestLabel})` +
            `\n    cue=(${(balls[0].pos.x / R).toFixed(1)},${(balls[0].pos.y / R).toFixed(1)}) ` +
            `球: ${onTable}`
        )
      }
    } else if (
      firstCushion &&
      outcome.indexOf(firstCushion) < outcome.indexOf(firstCollision)
    ) {
      cushionFirst++
    }
    if (Outcome.pots(outcome).some((b) => targets.includes(b))) pot++
    if (Outcome.isCueBallPotted(table.cueball, outcome)) scratch++
  }

  const pct = (x: number) => ((x / Math.max(1, total)) * 100).toFixed(1)
  return {
    total,
    pct,
    noContact,
    noContactMain,
    noContactFallback,
    cushionFirst,
    fallback,
    pot,
    scratch,
    samples,
  }
}

const N = Number(process.argv[2] ?? 400)
console.log(
  `mode: ${REAL_8BALL ? "real8ball" : "default"} ${RAIL_MODE ? "+ rail" : ""} ${CUE_RAIL ? "+ cuerail" : ""} ${TOUCHING ? "+ touching" : ""}`
)
const r = run(N)
console.log(
  `N=${r.total}  noContact=${r.pct(r.noContact)}% (主路径 ${r.pct(
    r.noContactMain
  )}% + 兜底 ${r.pct(r.noContactFallback)}%)  库先于球=${r.pct(
    r.cushionFirst
  )}%  fallback=${r.pct(r.fallback)}%`
)
console.log(`pot=${r.pct(r.pot)}%  scratch=${r.pct(r.scratch)}%`)
if (r.samples.length) {
  console.log("空杆样本：")
  for (const s of r.samples) console.log("  " + s)
}
