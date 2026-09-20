/**
 * v1.3.77 一次性探针：验证「AI 被对方花色球挡路时不再坚决犯规」。
 *
 * 场景构造（比随机散布狠得多）：
 *   - 本方 7 颗球随机散布；
 *   - 对每颗本方球以 BLOCK_PROB 概率把一颗对方球**刻意摆在
 *     「母球→该球」连线的 25%~65% 处**（占住球心连线，直线必挡）；
 *   - 其余对方球与黑8 随机散布。
 * 统计：
 *   - foul：首撞非本方球（对方花色 / 未清完撞黑8）
 *   - 组 B（kick 被禁用）：把 tryKickShot 临时替换为 null，量化一库解球的贡献
 *
 * 用法： npx tsx tools/harness/foulsnook.ts 300
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
const N = parseInt(process.argv[2] ?? "300", 10) || 300
const BLOCK_PROB = 0.6 // 六成本方球被直线挡死

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

function areaOk(pos: Vector3, placed: Ball[], margin = 2.25 * R): boolean {
  if (
    Math.abs(pos.x) > TableGeometry.X - 1.2 * R ||
    Math.abs(pos.y) > TableGeometry.Y - 1.2 * R
  )
    return false
  for (const p of placed) {
    if (p.pos.distanceTo(pos) < margin) return false
  }
  return true
}

/**
 * 布局：母球 + 本方 7 颗随机；对每颗本方球按概率在「母球→球」连线中段
 * 放一颗挡路对方球；黑8 与剩余对方球随机。
 */
function placeSnook(balls: Ball[]): boolean {
  const X = TableGeometry.X - 2.2 * R
  const Y = TableGeometry.Y - 2.2 * R
  const placed: Ball[] = []
  const cue = balls[0]
  // 母球放中心附近（让挡路布局更典型）
  for (let a = 0; a < 300; a++) {
    const x = (Math.random() * 2 - 1) * X * 0.4
    const y = (Math.random() * 2 - 1) * Y * 0.4
    const p = new Vector3(x, y, 0)
    if (areaOk(p, placed)) {
      cue.pos.copy(p)
      cue.setStationary()
      placed.push(cue)
      break
    }
  }
  if (!placed.includes(cue)) return false

  const mine = balls.slice(1, 8) // 1-7
  const opponents = balls.filter((b) => b.label >= 9) // 9-15
  let oppIdx = 0

  for (const t of mine) {
    // 本方球随机放
    let ok = false
    for (let a = 0; a < 300 && !ok; a++) {
      const p = new Vector3(
        (Math.random() * 2 - 1) * X,
        (Math.random() * 2 - 1) * Y,
        0
      )
      if (areaOk(p, placed)) {
        t.pos.copy(p)
        t.setStationary()
        placed.push(t)
        ok = true
      }
    }
    if (!ok) return false
    // 挡路对方球：摆在「母球→t」连线的 25%~65% 处
    if (Math.random() < BLOCK_PROB && oppIdx < opponents.length) {
      const frac = 0.25 + Math.random() * 0.4
      const dir = t.pos.clone().sub(cue.pos)
      const blocker = opponents[oppIdx]
      // 挡在 ghost 一侧更贴近实战（挡的是瞄准线不是球心连线也行，这里挡球心）
      for (let a = 0; a < 30; a++) {
        const f = frac + (Math.random() - 0.5) * 0.08
        const p = cue.pos.clone().addScaledVector(dir, f)
        if (areaOk(p, placed, 2.3 * R)) {
          blocker.pos.copy(p)
          blocker.setStationary()
          placed.push(blocker)
          oppIdx++
          break
        }
      }
    }
  }
  // 黑8 与剩余对方球随机
  const rest = balls.filter((b) => b.label === 8 || (b.label >= 9 && !placed.includes(b)))
  for (const b of rest) {
    let ok = false
    for (let a = 0; a < 300 && !ok; a++) {
      const p = new Vector3(
        (Math.random() * 2 - 1) * X,
        (Math.random() * 2 - 1) * Y,
        0
      )
      if (areaOk(p, placed)) {
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

function simulate(table: Table, aim: AimEvent) {
  table.cue!.aim = aim
  table.cue!.hit(table.cueball)
  let guard = 0
  while (!table.allStationary() && guard++ < 300000) {
    table.advance(STEP)
  }
}

function run(label: string, disableKick: boolean): void {
  const proto = Professional.prototype as any
  if (disableKick) proto.tryKickShot = () => null
  const calculator = new AimCalculator()
  const strategy = new Professional(DIFFICULTY.Professional)
  let total = 0
  let foul = 0
  let pot = 0
  let scratch = 0
  let kickHit = 0 // 首撞前母球先撞库（疑似解球成功路径）且首撞合法

  for (let i = 0; i < N; i++) {
    const balls = makeBalls()
    const table = new Table(balls)
    table.cue = new Cue()
    table.cueball = balls[0]
    if (!placeSnook(balls)) continue
    const targets = balls.filter((b) => b !== balls[0] && b.label !== 8 && b.label <= 7)
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
    simulate(table, aim)
    const outcome: Outcome[] = table.outcome
    const firstCollision = Outcome.firstCollision(outcome)
    total++
    const pottedCue = outcome.some(
      (o) => o.type === OutcomeType.CueBallPotted
    )
    if (pottedCue) scratch++
    // 首撞是否合法（本方 1-7）
    if (firstCollision && firstCollision.type === OutcomeType.Collision) {
      const hitLabel = (firstCollision as any).ballB?.label
      const legal = typeof hitLabel === "number" && hitLabel >= 1 && hitLabel <= 7
      if (!legal && !pottedCue) foul++
    }
    if (
      outcome.some(
        (o) =>
          o.type === OutcomeType.Pot &&
          typeof (o as any).ballA?.label === "number" &&
          (o as any).ballA.label >= 1 &&
          (o as any).ballA.label <= 7
      )
    )
      pot++
    // 首撞前有 Cushion 事件且首撞合法 → 疑似 kick 解球
    const firstCushionIdx = outcome.findIndex(
      (o) => o.type === OutcomeType.Cushion
    )
    const firstCollIdx = outcome.findIndex(
      (o) => o.type === OutcomeType.Collision
    )
    if (
      firstCushionIdx !== -1 &&
      firstCollIdx !== -1 &&
      firstCushionIdx < firstCollIdx
    ) {
      const fc = Outcome.firstCollision(outcome)
      const hitLabel = fc ? (fc as any).ballB?.label : undefined
      if (typeof hitLabel === "number" && hitLabel >= 1 && hitLabel <= 7)
        kickHit++
    }
  }
  const pct = (a: number) => ((a / (total || 1)) * 100).toFixed(1) + "%"
  console.log(
    `[${label}] N=${total}  首撞犯规=${pct(foul)}  进本方球=${pct(pot)}  摔袋=${pct(scratch)}  首撞前碰库(疑似解球)=${pct(kickHit)}`
  )
}

import { OutcomeType } from "../../src/model/outcome"

run("新代码-完整", false)
run("新代码-无kick解球", true)
