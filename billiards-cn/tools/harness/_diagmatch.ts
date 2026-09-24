/**
 * 诊断：专业档为何卡死 / 清台率反而低。
 *
 * 现象（botmatch 60 局）：
 *   专业档·开启清台顺序  清台=78.3%  卡死=15.0%
 *   专业档·关闭清台顺序  清台=85.0%  卡死= 6.7%
 *   → 「清台顺序」是**负收益**，与我预期的正收益相反。
 *
 * 本脚本逐杆打印专业档的对局过程，定位它到底把局面打成什么样。
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
const MAX_SHOTS = 60
const PHYS_GUARD = 300000

function makeBalls(): Ball[] {
  const balls: Ball[] = [new Ball(new Vector3(0, 0, 0), undefined, 0)]
  for (let l = 1; l <= 7; l++) balls.push(new Ball(new Vector3(0, 0, 0), undefined, l))
  balls.push(new Ball(new Vector3(0, 0, 0), undefined, 8))
  for (let l = 9; l <= 15; l++) balls.push(new Ball(new Vector3(0, 0, 0), undefined, l))
  return balls
}

function placeSpread(balls: Ball[]): boolean {
  const X = TableGeometry.X - 2.2 * R
  const Y = TableGeometry.Y - 2.2 * R
  const placed: Ball[] = []
  for (const b of balls) {
    let ok = false
    for (let a = 0; a < 300 && !ok; a++) {
      const p = new Vector3((Math.random() * 2 - 1) * X, (Math.random() * 2 - 1) * Y, 0)
      let clash = false
      for (const q of placed) {
        if (q.pos.distanceTo(p) < 2.3 * R) { clash = true; break }
      }
      if (!clash) { b.pos.copy(p); b.setStationary(); placed.push(b); ok = true }
    }
    if (!ok) return false
  }
  return true
}

const calc = new AimCalculator()
const strategy = new Professional(DIFFICULTY.Professional)

for (let m = 0; m < 6; m++) {
  const balls = makeBalls()
  const table = new Table(balls)
  table.cue = new Cue()
  table.cueball = balls[0]
  if (!placeSpread(balls)) continue

  const mine = balls.filter((b) => b.label >= 1 && b.label <= 7)
  const theirs = balls.filter((b) => b.label >= 9)
  const remaining = new Set<Ball>(mine)

  const log: string[] = []
  let shots = 0, pots = 0, fouls = 0, scratches = 0
  let streak = 0
  let loopStart: any = null

  while (shots < MAX_SHOTS && remaining.size > 0) {
    const targets = [...remaining]
    const ctx: any = {
      table, cueBall: balls[0], validTargetBalls: targets, ballInHand: false,
      pockets: calc.pockets, ruleName: "eightball",
      opponentBalls: theirs.filter((b) => b.onTable()),
    }
    let events: any[]
    try { events = strategy.aim(ctx, calc) as any[] } catch (e) {
      log.push(`  杆${shots + 1}: 【决策抛异常】${(e as Error).message}`)
      break
    }
    if (!events || events.length === 0) {
      log.push(`  杆${shots + 1}: 【决策返回空】卡死`)
      break
    }
    const hit = events.find((e) => e.type === EventType.HIT) ?? events[events.length - 1]
    if (!hit?.tablejson) { log.push(`  杆${shots + 1}: 【无 HitEvent】卡死`); break }
    const aim = AimEvent.fromJson(hit.tablejson.aim)

    // v1.3.92：每杆前清空 outcome（真实控制器同款做法，见 botmatch.ts 注释）
    table.outcome = []
    table.cue!.aim = aim
    table.cue!.hit(table.cueball)
    let guard = 0
    try { while (!table.allStationary() && guard++ < PHYS_GUARD) table.advance(STEP) }
    catch { log.push(`  杆${shots + 1}: 【物理异常】本局作废`); break }
    shots++

    const outcome = table.outcome
    const pottedMine = Outcome.pots(outcome).filter((b) => b !== balls[0] && remaining.has(b))
    const scratched = Outcome.isCueBallPotted(table.cueball, outcome)
    // v1.3.92：必须用 firstCueContact —— 旧写法（Outcome.firstCollision）
    // 返回的是 outcome 列表里第一条碰撞，不保证球A是母球，会把正常击球
    // 大批误判成犯规（实测清台局的 17/18 杆都被误标）。
    const firstHitTarget = Outcome.firstCueContact(balls[0], outcome, targets)
    if (!firstHitTarget && process.env.FOULDBG) {
      const nm = (x: any) => (x == null ? "-" : x === balls[0] ? "母球" : `#${x.label}`)
      console.log(`      [DBG 杆${shots + 1}] outcome:`)
      outcome.slice(0, 6).forEach((o, i) => {
        console.log(`        [${i}] type=${(o as any).type} A=${nm((o as any).ballA)} B=${nm((o as any).ballB)}`)
      })
      console.log(`        targets=[${targets.map((b) => b.label).join(",")}]`)
    }
    const defKind = strategy.lastDefenseKind

    pots += pottedMine.length
    for (const b of pottedMine) remaining.delete(b)

    // 计算「还剩几颗可打」——用枚举直接问
    let openCount = -1
    try {
      const d = (strategy as any).lastDecision
      if (d) {
        const { enumerateCandidates } = require("../../src/network/bot/decision/offense")
        openCount = enumerateCandidates(d, 0.34).length
      }
    } catch { /* ignore */ }

    // 检测「连击循环」：连续 ≥4 杆都走同一防守类型且一球未进
    if (pottedMine.length === 0 && defKind) {
      streak++
      if (streak === 4) {
        loopStart = {
          shots, defKind, remaining: remaining.size,
          cuePos: balls[0].pos.clone(),
          targets: [...remaining].map((b) => ({
            label: b.label, pos: b.pos.clone(), dist: b.pos.distanceTo(balls[0].pos),
          })),
          others: balls
            .filter((b) => b.onTable() && b !== balls[0] && !remaining.has(b))
            .map((b) => ({ label: b.label, pos: b.pos.clone() })),
        }
      }
    } else {
      streak = 0
    }

    log.push(
      `  杆${String(shots).padStart(2)}: 进${pottedMine.length} ` +
      `${scratched ? "【摔袋】" : ""}${!scratched && !firstHitTarget ? "【首撞犯规】" : ""}` +
      `${defKind ? `[防守:${defKind}]` : "[进攻]"} ` +
      `剩${remaining.size}颗 可打候选=${openCount} ` +
      `力度=${(aim.power / R).toFixed(0)}R`
    )

    if (scratched) {
      scratches++
      balls[0].pos.set(-TableGeometry.X * 0.6, 0, 0)
      balls[0].setStationary()
    } else if (!firstHitTarget) fouls++
  }

  console.log(`\n═══ 第 ${m + 1} 局 ═══`)
  console.log(log.slice(0, 40).join("\n"))
  console.log(
    `  → 清台${remaining.size === 0 ? "成功" : "失败"} 杆数=${shots} 进${pots} 摔袋${scratches} 犯规${fouls}`
  )
  if (loopStart) {
    console.log(`\n  ⚠️ 连击循环起点（杆 ${loopStart.shots}，${loopStart.defKind}）:`)
    console.log(`     母球位置 = (${loopStart.cuePos.x.toFixed(3)}, ${loopStart.cuePos.y.toFixed(3)})`)
    console.log(`     剩余目标球 (${loopStart.remaining} 颗):`)
    for (const t of loopStart.targets) {
      const dx = Math.abs(TableGeometry.X - Math.abs(t.pos.x))
      const dy = Math.abs(TableGeometry.Y - Math.abs(t.pos.y))
      console.log(
        `       label=${t.label} (${t.pos.x.toFixed(3)}, ${t.pos.y.toFixed(3)})  ` +
        `距母球=${(t.dist / R).toFixed(1)}R  贴库(x=${(dx / R).toFixed(1)}R, y=${(dy / R).toFixed(1)}R)`
      )
    }
    console.log(`     其它在台球:`)
    for (const o of loopStart.others) {
      console.log(`       label=${o.label} (${o.pos.x.toFixed(3)}, ${o.pos.y.toFixed(3)})`)
    }
  }
}
