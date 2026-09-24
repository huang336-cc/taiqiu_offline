/**
 * v1.3.95 无头验证 · AI 拿到自由球时会**自己挑位置**，而不是在哪就在哪开打。
 *
 * 背景：玩家犯规后，规则层（`eightball.ts` / `nineball.ts` 的 handleFoul）
 * 会给对手发 `PlaceBallEvent(startPos, undefined, true)`。`startPos` 是**母球
 * 当前**的位置 —— `useStartPos=true` 的本意是「请自己摆」，但旧实现在
 * `boteventhandler.handlePlaceBall` 里无条件 `cueball.pos.copy(event.pos)`，
 * 于是 `decision/ballinhand.ts` 那套「网格粗筛 + 前 12 个候选跑真实物理精算」
 * 的摆位评估**永远走不到**（只在 bot 自己犯规那条支路上被调用），玩家看到的
 * 就是「AI 拿到自由球纹丝不动，站在原地打」。
 *
 * 本探针直接驱动 `BotEventHandler`，锁死四条分支：
 *   T1 自由球（useStartPos=true 且规则允许）→ 必须重新摆位，且位置合法、可打
 *   T2 非自由球（useStartPos=false）        → 照旧用 rules.placeBall()
 *   T3 开球杆的自由球                        → 必须回开球线，不能自行摆位
 *   T4 无自由球机制的规则（allowsPlaceBall=false）→ 用 rules.placeBall()
 *
 * 用法：
 *   npx tsx tools/harness/botballinhand.ts [N]
 */
import "./predom"
import { Table } from "../../src/model/table"
import { Ball, State } from "../../src/model/ball"
import { R } from "../../src/model/physics/constants"
import { TableGeometry } from "../../src/view/tablegeometry"
import { AimEvent } from "../../src/events/aimevent"
import { EventType } from "../../src/events/eventtype"
import { Cue } from "../../src/view/cue"
import { Vector3 } from "three"
import { EightBall } from "../../src/controller/rules/eightball"
import { PlaceBallEvent } from "../../src/events/placeballevent"
import { Session } from "../../src/network/client/session"
import { installPhysicsHooks } from "../../src/network/bot/decision/physicshooks"
import { BotEventHandler } from "../../src/network/bot/boteventhandler"

installPhysicsHooks()

/**
 * BotEventHandler 在构造时会读 `globalThis.location.search` 取难度档。
 * 它在**构造函数**里才读，模块加载阶段不读，所以这里赋值是安全的。
 */
;(globalThis as any).location = { href: "", search: "?bot=Professional" }

const N = parseInt(process.argv[2] ?? "24", 10) || 24

let pass = 0
let fail = 0
function check(name: string, cond: boolean, detail = "") {
  if (cond) {
    pass++
    console.log(`  ✓ ${name}${detail ? "  " + detail : ""}`)
  } else {
    fail++
    console.log(`  ✗ ${name}${detail ? "  " + detail : ""}`)
  }
}

/** 确定性伪随机 —— 保证回归可比 */
function mulberry32(seed: number) {
  return function () {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = Math.imul(t ^ (t >>> 7), 61 | t) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const IX = TableGeometry.tableX - 2.5 * R
const IY = TableGeometry.tableY - 2.5 * R

/** 八球残局：母球 1 颗 + 本方 1..6 + 对手 9..13 + 黑八 */
function makeTable(rnd: () => number): Table {
  const placed: Ball[] = []
  const balls: Ball[] = []
  const labels = [0, 1, 2, 3, 4, 5, 6, 9, 10, 11, 12, 13, 8]
  for (const label of labels) {
    for (let tries = 0; tries < 500; tries++) {
      const p = new Vector3(
        (rnd() * 2 - 1) * IX,
        (rnd() * 2 - 1) * IY,
        0
      )
      if (placed.some((q) => q.pos.distanceTo(p) < 2.4 * R)) continue
      const b = new Ball(p, undefined, label)
      b.setStationary()
      b.state = State.Stationary
      placed.push(b)
      balls.push(b)
      break
    }
  }
  const table = new Table(balls)
  table.cue = new Cue(
    new AimEvent(
      0, 0, 0, 0, false, EventType.AIM, 0, 0, 0, new Vector3(0, 0, 0), false
    ) as unknown as AimEvent,
    table
  )
  return table
}

interface Harness {
  handler: any
  table: Table
  rules: EightBall
  published: any[][]
  recorder: { entries: any[] }
  /** BotEventHandler 的 info 日志 —— 「是否走了摆位评估」的直接证据 */
  infos: string[]
}

/**
 * 构造 BotEventHandler 所需的最小 container。
 * `noPlaceBall` 为真时使用禁止自由球的规则变体（验证 allowsPlaceBall 分支）。
 */
function makeHarness(table: Table, noPlaceBall = false, numEntries = 0): Harness {
  const recorder: { entries: any[] } = { entries: [] }
  for (let i = 0; i < numEntries; i++) {
    recorder.entries.push({
      state: [],
      event: { type: EventType.AIM },
      pots: 0,
      isPartOfBreak: false,
      time: 0,
    })
  }

  const inner: any = {
    table,
    recorder,
    notify: () => {},
    sendEvent: () => {},
    sendScoreUpdate: () => {},
    inferActivePlayer: () => 2,
    sound: {},
    isSinglePlayer: false,
  }

  class RulesUnderTest extends EightBall {
    override allowsPlaceBall(): boolean {
      return !noPlaceBall
    }
  }
  inner.rules = new RulesUnderTest(inner)

  const published: any[][] = []
  const infos: string[] = []
  const logs: any = {
    info: (m: string) => infos.push(m),
    incoming: () => {},
    outgoing: () => {},
    show: () => {},
    hide: () => {},
  }
  const handler = new BotEventHandler(
    logs,
    inner,
    (events: any[]) => {
      published.push(events)
    },
    () => {}
  )
  return { handler, table, rules: inner.rules, published, recorder, infos }
}

/** 摆位评估链是否被调用过（chooseBallInHandPosition 成功分支会打这行日志） */
function ranPlacementSearch(infos: string[]): boolean {
  return infos.some((m) => m.startsWith("Bot ball-in-hand:"))
}

/** 位置合法性：完全在台面内，且不与任何球重叠 */
function legalSpot(table: Table, pos: Vector3): boolean {
  if (Math.abs(pos.x) > TableGeometry.tableX - R) return false
  if (Math.abs(pos.y) > TableGeometry.tableY - R) return false
  for (const b of table.balls) {
    if (b === table.cueball) continue
    if (!b.onTable()) continue
    if (pos.distanceTo(b.pos) < 2 * R * 0.98) return false
  }
  return true
}

console.log("\n=== AI 自由球自行摆位（v1.3.95）===")
console.log(`局数 N=${N}`)

// ── T1：核心修复 —— 自由球必须重新摆位 ──────────────────────────
console.log("\n[T1] 玩家犯规 → 自由球：AI 必须自己挑位置")
{
  const rnd = mulberry32(20260921)
  let moved = 0
  let legalCount = 0
  let shotPublished = 0
  let errors = 0
  const moves: number[] = []

  const infos: string[] = []
  let searches = 0
  for (let i = 0; i < N; i++) {
    const table = makeTable(rnd)
    const { handler, recorder, infos: log } = makeHarness(table, false, 1)
    // 已经打过至少一杆，因此不是开球杆
    const before = table.cueball.pos.clone()
    try {
      handler.handle(new PlaceBallEvent(before.clone(), undefined, true))
    } catch (e) {
      errors++
      console.log(`    [异常] ${(e as Error).message.split("\n")[0]}`)
      continue
    }
    void recorder
    infos.push(...log)
    if (ranPlacementSearch(log)) searches++
    const after = table.cueball.pos.clone()
    const d = before.distanceTo(after)
    moves.push(d)
    if (d > R) moved++
    if (legalSpot(table, after)) legalCount++
    if (table.cueball.state === State.Stationary) shotPublished++
  }

  const avgMove = moves.reduce((a, b) => a + b, 0) / (moves.length || 1)
  check("无异常抛出", errors === 0, `异常局数=${errors}`)
  check(
    "摆位评估链被真正调用",
    searches === N,
    `${searches}/${N}`
  )
  check(
    "每一局都真的重新摆了位（不再原地不动）",
    moved === N,
    `${moved}/${N}，平均位移=${(avgMove / R).toFixed(2)}R`
  )
  check("摆位全部合法（不与球重叠 / 未出台）", legalCount === N, `${legalCount}/${N}`)
  check("母球复位为静止态", shotPublished === N, `${shotPublished}/${N}`)
}

// ── T2：非自由球必须照旧走 rules.placeBall() ────────────────────
console.log("\n[T2] useStartPos=false：不得自行摆位")
{
  const rnd = mulberry32(777)
  const table = makeTable(rnd)
  const { handler, rules, infos } = makeHarness(table, false, 1)
  handler.handle(
    new PlaceBallEvent(table.cueball.pos.clone(), undefined, false)
  )
  const expected = rules.placeBall()
  check(
    "落在规则默认点上",
    table.cueball.pos.distanceTo(expected) < 1e-6,
    `实际=(${table.cueball.pos.x.toFixed(4)}, ${table.cueball.pos.y.toFixed(4)})`
  )
  check("未调用摆位评估", !ranPlacementSearch(infos))
}

// ── T3：开球杆不能自行摆位 ──────────────────────────────────────
console.log("\n[T3] 开球杆：即使是 useStartPos=true 也不得自行摆位")
{
  const rnd = mulberry32(1234)
  const table = makeTable(rnd)
  // recorder.entries 为空 → isFirstShot() 为真 → 判定为开球杆
  const { handler, infos } = makeHarness(table, false, 0)
  const before = table.cueball.pos.clone()
  handler.handle(new PlaceBallEvent(before.clone(), undefined, true))
  check(
    "未调用摆位评估（位置由规则层决定）",
    !ranPlacementSearch(infos),
    `位移=${(before.distanceTo(table.cueball.pos) / R).toFixed(2)}R`
  )
}

// ── T4：无自由球机制的规则（allowsPlaceBall=false）必须照旧 ──────
console.log("\n[T4] allowsPlaceBall=false：不得自行摆位")
{
  const rnd = mulberry32(4321)
  const table = makeTable(rnd)
  const { handler, infos } = makeHarness(table, true, 1)
  const before = table.cueball.pos.clone()
  handler.handle(new PlaceBallEvent(before.clone(), undefined, true))
  check(
    "未调用摆位评估（照旧沿用规则层给的点）",
    !ranPlacementSearch(infos),
    `位移=${(before.distanceTo(table.cueball.pos) / R).toFixed(2)}R`
  )
}

console.log(`\n结果：通过 ${pass} / ${pass + fail}`)
if (fail > 0) process.exit(1)
void Session
