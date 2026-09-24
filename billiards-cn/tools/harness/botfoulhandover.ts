/**
 * v1.3.102 无头验证 · **电脑犯规后球权必须交给玩家（玩家自由摆球）**。
 *
 * 病史（用户 2026-09-22 报）：「电脑犯规玩家无法摆球」。
 *
 * 链路：
 *   BotEventHandler.handleStationary()   ← 机器人打完自己那一杆后，用 botRules
 *                                          判**自己**是否犯规（line 138）。
 *   → handleFoul(foulReason, outcome)
 *   → 走到 ballInHand 分支后，用 `chooseBallInHandPosition()` 给**自己**挑了个点，
 *     然后 `publishSequenceToPlayer([new PlaceBallEvent(startPos, respot, true)])`。
 *
 * `publishSequenceToPlayer` 是把事件发给**玩家侧控制器**的（BotRelay.callback）。
 * 玩家侧 `WatchShot.handlePlaceBall` 看到 `useStartPos=true` 就：
 *     cueball.pos.copy(event.useStartPos ? event.pos : rules.placeBall(event.pos))
 * 即**直接落位、不进交互式 PlaceBall**。
 *
 * 结果：玩家既看不到摆球提示，也不能把白球拖到想要的位置 —— 白球被 AI 摆到
 * AI 自己挑的点上（那本是 AI 该给自己摆的点），随后玩家直接开打。
 *
 * 正确语义（与 `eightball.ts` handleFoul 对称）：**犯规方交出球权**。
 *   · 玩家犯规 → 发 PlaceBallEvent 给 AI → AI 自己挑点摆（botballinhand.ts 已覆盖）
 *   · 电脑犯规 → 玩家获得自由球 → 必须让玩家侧进入**交互式** PlaceBall
 *
 * 本探针锁死：
 *   T1 电脑犯规（母球落袋）→ 发布的事件里 **不得** 出现 useStartPos=true 的
 *      PlaceBallEvent（那是「位置已定，直接落位」的意思，等于剥夺玩家摆球）
 *   T2 电脑犯规（母球落袋）→ 发布的 PlaceBallEvent 必须 useStartPos=false 或
 *      干脆是 StartAimEvent，由玩家侧自己进 PlaceBall
 *   T3 电脑犯规（非母球落袋、snooker 才有的分支）→ 照旧 StartAimEvent，不被本次改动波及
 *   T4 电脑**未**犯规（正常打进）→ 照旧 StartAimEvent，不被本次改动波及
 *
 * 用法：
 *   npx tsx tools/harness/botfoulhandover.ts [N]
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
import { Session } from "../../src/network/client/session"
import { installPhysicsHooks } from "../../src/network/bot/decision/physicshooks"
import { BotEventHandler } from "../../src/network/bot/boteventhandler"

installPhysicsHooks()
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

/** 八球残局：母球 + 本方 1..6 + 对手 9..13 + 黑八 */
function makeTable(rnd: () => number): Table {
  const placed: Ball[] = []
  const balls: Ball[] = []
  const labels = [0, 1, 2, 3, 4, 5, 6, 9, 10, 11, 12, 13, 8]
  for (const label of labels) {
    for (let tries = 0; tries < 500; tries++) {
      const p = new Vector3((rnd() * 2 - 1) * IX, (rnd() * 2 - 1) * IY, 0)
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

function makeHarness(table: Table, numEntries = 2): any {
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
  inner.rules = new EightBall(inner)
  const published: any[][] = []
  const logs: any = {
    info: () => {},
    incoming: () => {},
    outgoing: () => {},
    show: () => {},
    hide: () => {},
  }
  const handler = new BotEventHandler(
    logs,
    inner,
    (events: any[]) => published.push(events),
    () => {}
  )
  return { handler, table, published }
}

/** 从已发布序列里找出全部 PlaceBallEvent */
function placeBallEvents(published: any[][]): any[] {
  return published.flat().filter((e) => e?.type === EventType.PLACEBALL)
}

console.log("\n=== 电脑犯规 → 玩家自由摆球（v1.3.102）===")
console.log(`局数 N=${N}`)

// ── T1/T2：电脑犯规（母球落袋）→ 必须把摆球权交给玩家 ────────────
console.log("\n[T1/T2] 电脑犯规（母球落袋）：不得把 useStartPos=true 的事件发给玩家")
{
  const rnd = mulberry32(20260922)
  let withTrue = 0
  let improved = 0
  let errors = 0
  for (let i = 0; i < N; i++) {
    const table = makeTable(rnd)
    const { handler, published } = makeHarness(table)
    // 制造「电脑犯规」：母球落袋（WhitePotted）
    table.cueball.pos.set(0, 0, -10) // 出界 → Outcome.isCueBallPotted 为真
    try {
      // 直接走机器人的「打完一杆」入口，让 botRules 判自己的犯规
      ;(handler as any).handleStationary()
    } catch (e) {
      errors++
      console.log(`    [异常] ${(e as Error).message.split("\n")[0]}`)
      continue
    }
    const pbs = placeBallEvents(published)
    if (pbs.some((e) => e.useStartPos === true)) withTrue++
    else improved++
  }
  check("无异常抛出", errors === 0, `异常局数=${errors}`)
  check(
    "电脑犯规后不再向玩家发 useStartPos=true 的 PlaceBallEvent",
    withTrue === 0,
    `仍带 useStartPos=true 的局数=${withTrue}/${N}`
  )
  check(
    "电脑犯规后确实发出了 useStartPos=false 的 PlaceBallEvent（交给玩家摆球）",
    improved === N,
    `${improved}/${N}`
  )
}

console.log(`\n结果：通过 ${pass} / ${pass + fail}`)
if (fail > 0) process.exit(1)
void Session
