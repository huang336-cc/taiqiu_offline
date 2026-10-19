/**
 * v1.5.7（#85）解球失败原因**逐档**诊断（零侵入：monkey-patch 私有方法）。
 *
 * kickaudit 变体 B 里专业档首撞合法率只有 27.8%，犯规杆全部走
 * `safety:desp`（认命兜底硬打最近的球 = 对方球）。本脚本回答两个问题：
 *   1. tryKickShot 到底有没有被调用？返回什么？
 *   2. 若返回 null，是「找不到镜像解球线」还是「收力链四档全废」？
 *      四档各自废在哪个判据（母球进袋 / 首撞不对 / 停位贴袋）？
 *
 * 用法：npx tsx tools/harness/kickwhy.ts [局数] [A|B|C]
 */
import "./predom"
import { Table } from "../../src/model/table"
import { Ball } from "../../src/model/ball"
import { R } from "../../src/model/physics/constants"
import { TableGeometry } from "../../src/view/tablegeometry"
import { Professional } from "../../src/network/bot/strategies/professional"
import { AimCalculator } from "../../src/network/bot/aimcalculator"
import { Cue } from "../../src/view/cue"
import { Vector3 } from "three"
import { DIFFICULTY } from "../../src/network/bot/difficulty"
import { EventType } from "../../src/events/eventtype"

const N = Number(process.argv[2] || 6)
const VARIANT = (process.argv[3] || "B").toUpperCase()

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

/** 与 kickaudit 变体 B 完全一致的局面：目标球贴右上角袋 */
function placeB(balls: Ball[], rnd: () => number): void {
  const X = TableGeometry.tableX
  const Y = TableGeometry.tableY
  const cue = balls[0]
  cue.pos.set(-X + 1.6 * R, -Y + 1.6 * R, 0)
  cue.setStationary()
  const tx = X - 2.6 * R - rnd() * 1.2 * R
  const ty = Y - 2.6 * R - rnd() * 1.2 * R
  const target = balls[1]
  target.pos.set(tx, ty, 0)
  target.setStationary()
  const dir = new Vector3(tx - cue.pos.x, ty - cue.pos.y, 0)
  const len = dir.length()
  dir.normalize()
  const perp = new Vector3(-dir.y, dir.x, 0)
  const blockers = [balls[9], balls[10], balls[11]]
  blockers.forEach((b, i) => {
    const f = 0.25 + i * 0.16
    const jitter = (rnd() * 2 - 1) * 1.2 * R
    b.pos.copy(cue.pos).addScaledVector(dir, len * f).addScaledVector(perp, jitter)
    b.setStationary()
  })
  const rest = balls.filter((b) => ![cue, target, ...blockers].includes(b))
  rest.forEach((b, i) => {
    b.pos.set(-X + 2.2 * R + (i % 4) * 2.2 * R, Y - 2.2 * R - Math.floor(i / 4) * 2.2 * R, 0)
    b.setStationary()
  })
}

/** 变体 C：横向墙 + 只能绕两库的长路径 */
function placeC(balls: Ball[], rnd: () => number): void {
  const X = TableGeometry.tableX
  const Y = TableGeometry.tableY
  const cue = balls[0]
  cue.pos.set(-X + 1.6 * R, -Y * (0.1 + 0.3 * rnd()), 0)
  cue.setStationary()
  const target = balls[1]
  target.pos.set(X - 2.4 * R, Y * (0.1 + 0.4 * rnd()), 0)
  target.setStationary()
  const blockers = [balls[9], balls[10], balls[11], balls[12]]
  blockers.forEach((b, i) => {
    b.pos.set(-X + 3.0 * R + i * ((2 * X - 6 * R) / 3), (rnd() * 2 - 1) * 1.0 * R, 0)
    b.setStationary()
  })
  const rest = balls.filter((b) => ![cue, target, ...blockers].includes(b))
  rest.forEach((b, i) => {
    b.pos.set(-X + 2.2 * R + (i % 4) * 2.2 * R, Y - 2.4 * R - Math.floor(i / 4) * 2.2 * R, 0)
    b.setStationary()
  })
}

function main() {
  const profile = DIFFICULTY.Professional
  const TIMES: number[] = []
  let tryCalls = 0
  let tryOk = 0
  let despFirst = 0

  for (let i = 0; i < N; i++) {
    const rnd = mulberry32(1000 + i * 7919)
    const balls = makeBalls()
    const table = new Table(balls)
    table.cue = new Cue()
    table.cueball = balls[0]
    if (VARIANT === "C") placeC(balls, rnd)
    else placeB(balls, rnd)

    const calculator = new AimCalculator()
    const strategy = new Professional(profile) as any
    const mine = [balls[1]]
    const theirs = [balls[9], balls[10], balls[11], balls[12]].filter((b) => b.onTable())

    // ── monkey-patch 私有方法，记录调用与返回 ──
    const log: string[] = []
    const origTry = strategy.tryKickShot.bind(strategy)
    strategy.tryKickShot = (...a: unknown[]) => {
      tryCalls++
      const r = origTry(...a)
      if (r) tryOk++
      log.push(`tryKickShot → ${r ? "OK" : "null"}`)
      return r
    }
    const origStop = strategy.probeKickStop.bind(strategy)
    strategy.probeKickStop = (...a: unknown[]) => {
      const r = origStop(...a)
      log.push(`  probeKickStop(${((a[2] as number) / R).toFixed(1)}R) → ${r ? "在台" : "进袋"}`)
      return r
    }
    const origFirst = strategy.probeFirstHitLabel.bind(strategy)
    strategy.probeFirstHitLabel = (...a: unknown[]) => {
      const r = origFirst(...a)
      log.push(`  probeFirstHit → ${r}`)
      return r
    }

    const ctx: any = {
      table,
      cueBall: balls[0],
      validTargetBalls: mine,
      ballInHand: false,
      pockets: calculator.pockets,
      ruleName: "eightball",
      opponentBalls: theirs,
    }
    let events: any[] = []
    const t0 = Date.now()
    try {
      events = strategy.aim(ctx, calculator) as any[]
    } catch (e) {
      console.log(`[${i}] 抛异常 ${(e as Error)?.message}`)
      continue
    }
    const dt = Date.now() - t0
    TIMES.push(dt)
    const path = strategy.lastShotPath
    const hit = events.find((e: any) => e?.type === EventType.HIT) ?? events[events.length - 1]
    // 真打一遍看首撞
    let firstLabel: number | null = null
    if (hit?.tablejson) {
      table.outcome = []
      table.cue!.aim = hit.tablejson.aim
      table.cue!.hit(table.cueball)
      let g = 0
      while (!table.allStationary() && g++ < 300000) table.advance(0.001953125)
      for (const o of table.outcome) {
        if ((o.type as string) !== "collision" && (o.type as string) !== "Collision") continue
        if (o.ballA === balls[0]) { firstLabel = o.ballB?.label ?? null; break }
        if (o.ballB === balls[0]) { firstLabel = o.ballA?.label ?? null; break }
      }
    }
    const foul = firstLabel !== 1
    if (path === "safety:desp" && foul) despFirst++
    console.log(`[${i}] path=${path} 首撞=${firstLabel} ${foul ? "❌犯规" : "✅合法"}  决策耗时 ${dt}ms`)
    log.forEach((l) => console.log("      " + l))
  }

  console.log(`\n=== 汇总（变体 ${VARIANT}，${N} 局）===`)
  console.log(`  tryKickShot 调用 ${tryCalls} 次，成功 ${tryOk} 次`)
  console.log(`  safety:desp 首撞犯规 ${despFirst} 局`)
  TIMES.sort((a, b) => a - b)
  const med = TIMES[Math.floor(TIMES.length / 2)] ?? 0
  console.log(
    `  单杆决策耗时: 中位 ${med}ms  最大 ${TIMES[TIMES.length - 1] ?? 0}ms  平均 ${Math.round(
      TIMES.reduce((a, b) => a + b, 0) / Math.max(1, TIMES.length)
    )}ms`
  )
}

main()
