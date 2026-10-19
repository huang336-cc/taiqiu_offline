/**
 * v1.5.7（#85）专业级 AI 解球（kick）力度审计。
 *
 * 用户反馈：「专业级难度的 ai，在两库撞球后经常出现力度不够的问题导致犯规」。
 *
 * 本脚本构造**被做斯诺克**的局面（母球与目标球之间被对方球挡死，直线全挡），
 * 强制 AI 走解球路径，然后统计：
 *   · 解球杆数、首撞合法率（首撞本方球 = 合法）
 *   · 出杆力度（单位 R）与是否撞到 72R / 90R 上限
 *   · 母球实际总路程、撞库次数、停下时离目标球还差多远
 *
 * 用法：npx tsx tools/harness/kickaudit.ts [局数]
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
const PHYS_GUARD = 300000
const N = Number(process.argv[2] || 24)
const VARIANT = (process.argv[3] || "A").toUpperCase() as Variant

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

/**
 * v1.5.7（#85 二轮）：局面变体工厂。
 *
 * 一轮的 A 变体（母球左下角 / 目标右上 / 中间一堵墙）跑出来 24/24 全合法、
 * 力度中位数 47R，**一次都没触发收力链** —— 说明它根本没复现用户现象。
 * 收力链的触发条件是「满力会摔袋 / 停位贴袋口」，所以必须构造
 *   B：目标球**紧贴袋口**（母球撞完它后自己极易滑进袋）
 *   C：母球贴长库中部、**绕两库才能到**的超长路径（5 m 以上，收力就够不着）
 */
type Variant = "A" | "B" | "C"

function placeVariant(v: Variant, balls: Ball[], rnd: () => number): void {
  if (v === "B") return placeNearPocket(balls, rnd)
  if (v === "C") return placeLongTwoRail(balls, rnd)
  return placeSnooker(balls, rnd)
}

/** B：目标球紧贴右上角袋 —— 母球撞完后极易自己滑进同一个袋 */
function placeNearPocket(balls: Ball[], rnd: () => number): void {
  const X = TableGeometry.tableX
  const Y = TableGeometry.tableY
  const cue = balls[0]
  cue.pos.set(-X + 1.6 * R, -Y + 1.6 * R, 0)
  cue.setStationary()
  // 目标球离角袋 2.6R（贴袋但不进袋），母球撞它后极易跟着进袋
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

/** C：母球贴左长库中部，目标球贴右长库，中间横向铺满墙 → 只能绕两库 */
function placeLongTwoRail(balls: Ball[], rnd: () => number): void {
  const X = TableGeometry.tableX
  const Y = TableGeometry.tableY
  const cue = balls[0]
  // 母球贴左库、纵向中偏下
  cue.pos.set(-X + 1.6 * R, -Y * (0.1 + 0.3 * rnd()), 0)
  cue.setStationary()
  // 目标球贴右库、纵向中偏上（横向直线被墙挡死）
  const target = balls[1]
  target.pos.set(X - 2.4 * R, Y * (0.1 + 0.4 * rnd()), 0)
  target.setStationary()
  // 墙：横向铺在 y≈0 一带，把左右两侧彻底隔开
  const blockers = [balls[9], balls[10], balls[11], balls[12]]
  blockers.forEach((b, i) => {
    b.pos.set(
      -X + 3.0 * R + i * ((2 * X - 6 * R) / 3),
      (rnd() * 2 - 1) * 1.0 * R,
      0
    )
    b.setStationary()
  })
  const rest = balls.filter((b) => ![cue, target, ...blockers].includes(b))
  rest.forEach((b, i) => {
    b.pos.set(-X + 2.2 * R + (i % 4) * 2.2 * R, Y - 2.4 * R - Math.floor(i / 4) * 2.2 * R, 0)
    b.setStationary()
  })
}

/**
 * 构造「被做斯诺克」局面：母球贴左下角，本方 1 号球在右上区域，
 * 母球→1号 的直线上铺 3 颗对方球做墙（留 2.2R 以上间隙不重叠）。
 */
function placeSnooker(balls: Ball[], rnd: () => number): void {
  const X = TableGeometry.tableX
  const Y = TableGeometry.tableY
  const cue = balls[0]
  // 母球：贴左下角
  cue.pos.set(-X + 1.6 * R, -Y + 1.6 * R, 0)
  cue.setStationary()
  // 目标球（本方 1 号）：右上区域随机
  const tx = X * (0.15 + 0.5 * rnd())
  const ty = Y * (0.15 + 0.6 * rnd())
  const target = balls[1]
  target.pos.set(tx, ty, 0)
  target.setStationary()
  // 挡墙：母球→目标 连线上取 3 个点，各放一颗对方球
  const dir = new Vector3(tx - cue.pos.x, ty - cue.pos.y, 0)
  const len = dir.length()
  dir.normalize()
  const perp = new Vector3(-dir.y, dir.x, 0)
  const blockers = [balls[9], balls[10], balls[11]]
  blockers.forEach((b, i) => {
    const f = 0.28 + i * 0.18
    const jitter = (rnd() * 2 - 1) * 1.2 * R
    b.pos.copy(cue.pos).addScaledVector(dir, len * f).addScaledVector(perp, jitter)
    b.setStationary()
  })
  // 其余球放到右下角远处，不干扰
  const rest = balls.filter((b) => ![cue, target, ...blockers].includes(b))
  rest.forEach((b, i) => {
    b.pos.set(X - 2.2 * R - (i % 4) * 2.2 * R, -Y + 2.2 * R + Math.floor(i / 4) * 2.2 * R, 0)
    b.setStationary()
  })
}

interface Row {
  powerR: number
  path: string
  def: string
  firstHit: number | null
  legal: boolean
  rails: number
  travel: number
  gapToTarget: number
}

function railsAndTravel(table: Table, cueBall: Ball): { rails: number; travel: number } {
  // 重新跑一遍不现实（已 simulate），这里用 outcome 里的 cushion 事件计数
  let rails = 0
  for (const o of table.outcome) {
    if ((o.type as string) === "cushion" || (o.type as string) === "Cushion") rails++
  }
  void cueBall
  return { rails, travel: 0 }
}

async function main() {
  const profile = DIFFICULTY.Professional
  const rows: Row[] = []

  for (let i = 0; i < N; i++) {
    const rnd = mulberry32(1000 + i * 7919)
    const balls = makeBalls()
    const table = new Table(balls)
    table.cue = new Cue()
    table.cueball = balls[0]
    placeVariant(VARIANT, balls, rnd)

    const calculator = new AimCalculator()
    const strategy = new Professional(profile)
    const mine = [balls[1]] // 只剩 1 号球（其余已清）
    const theirs = [balls[9], balls[10], balls[11]].filter((b) => b.onTable())

    const ctx: any = {
      table,
      cueBall: balls[0],
      validTargetBalls: mine,
      ballInHand: false,
      pockets: calculator.pockets,
      ruleName: "eightball",
      opponentBalls: theirs,
    }

    let events: any[]
    try {
      events = strategy.aim(ctx, calculator) as any[]
    } catch (e) {
      console.log(`[${i}] 决策抛异常: ${(e as Error)?.message}`)
      continue
    }
    if (!events || events.length === 0) { console.log(`[${i}] 无解（stuck）`); continue }
    const hit = events.find((e) => e.type === EventType.HIT) ?? events[events.length - 1]
    if (!hit?.tablejson) { console.log(`[${i}] 无 tablejson`); continue }
    const aim = AimEvent.fromJson(hit.tablejson.aim)
    const powerR = (aim.power ?? 0) / R

    table.outcome = []
    // 采样母球轨迹
    const track: Vector3[] = []
    table.cue!.aim = aim
    table.cue!.hit(table.cueball)
    let guard = 0
    try {
      while (!table.allStationary() && guard++ < PHYS_GUARD) {
        if (guard % 20 === 0) track.push(balls[0].pos.clone())
        table.advance(STEP)
      }
    } catch { /* 引擎防御，跳过本局 */ continue }
    track.push(balls[0].pos.clone())

    let travel = 0
    for (let k = 1; k < track.length; k++) travel += track[k].distanceTo(track[k - 1])

    const outcome = table.outcome
    const firstHitTarget = Outcome.firstCueContact(balls[0], outcome, mine)
    // 首撞（不管是不是目标）
    let firstHit: number | null = null
    for (const o of outcome) {
      if (o.type !== OutcomeType.Collision) continue
      if (o.ballA === balls[0]) { firstHit = o.ballB?.label ?? null; break }
      if (o.ballB === balls[0]) { firstHit = o.ballA?.label ?? null; break }
    }
    const { rails } = railsAndTravel(table, balls[0])
    const gap = balls[0].onTable() ? balls[0].pos.distanceTo(balls[1].pos) : -1

    rows.push({
      powerR: +powerR.toFixed(1),
      path: (strategy as any).lastShotPath ?? "?",
      def: (strategy as any).lastDefenseKind ?? "-",
      firstHit,
      // v1.5.7：firstCueContact 返回 **boolean**，不能用 `!== null` 判
      // （布尔值永不为 null，会把所有首撞犯规都记成合法 —— 一轮审计的
      //  「24/24 全合法」就是这么来的假象）。
      legal: firstHitTarget === true,
      rails,
      travel: +travel.toFixed(2),
      gapToTarget: +gap.toFixed(3),
    })
  }

  console.log(`\n=== 专业档解球审计（${rows.length} 局）===`)
  console.log("  #   力度(R)  路径              防守      首撞  合法  库数  路程(m)  离目标(m)")
  rows.forEach((r, i) => {
    console.log(
      `  ${String(i).padStart(2)}  ${String(r.powerR).padStart(7)}  ${r.path.padEnd(16)} ${r.def.padEnd(9)} ` +
      `${String(r.firstHit).padStart(4)}  ${r.legal ? " 是 " : " 否 "}  ${String(r.rails).padStart(3)}  ` +
      `${String(r.travel).padStart(7)}  ${String(r.gapToTarget).padStart(8)}`
    )
  })
  const legal = rows.filter((r) => r.legal).length
  const capped = rows.filter((r) => r.powerR >= 71.5 && r.powerR <= 72.5).length
  const capped90 = rows.filter((r) => r.powerR >= 89.5 && r.powerR <= 90.5).length
  const kickish = rows.filter((r) => String(r.path).includes("ick") || r.def === "kick").length
  console.log(`\n  解球路径杆数: ${kickish}`)
  console.log(`  首撞合法: ${legal}/${rows.length} (${((legal / Math.max(1, rows.length)) * 100).toFixed(1)}%)`)
  console.log(`  力度撞 72R 上限: ${capped}    撞 90R 上限: ${capped90}`)
  console.log(`  力度中位数: ${rows.map((r) => r.powerR).sort((a, b) => a - b)[Math.floor(rows.length / 2)]} R`)
}

main().catch((e) => { console.error("FATAL", e); process.exit(1) })
