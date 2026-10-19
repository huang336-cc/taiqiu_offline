/**
 * v1.5.7（#85）「这局面到底有没有解」暴力枚举器。
 *
 * kickaudit 变体 B 里专业档首撞合法率只有 44.4%。在继续调 AI 之前必须先
 * 回答一个前提问题：**这些局面是真的无解，还是 AI 自己找不到解？**
 * 如果暴力枚举也找不到合法杆，那 44.4% 就已经接近上限，再调就是白费。
 *
 * 做法：对同一局面，按「角度 × 力度」网格穷举出杆，每条都用真实物理跑
 * 到底，统计能「首撞 = 本方目标球 且 母球没进袋」的格子数。
 *
 * 用法：npx tsx tools/harness/kickbrute.ts [局数] [B|C] [角度步长°]
 */
import "./predom"
import { Table } from "../../src/model/table"
import { Ball } from "../../src/model/ball"
import { R } from "../../src/model/physics/constants"
import { TableGeometry } from "../../src/view/tablegeometry"
import { Cue } from "../../src/view/cue"
import { AimEvent } from "../../src/events/aimevent"
import { Outcome, OutcomeType } from "../../src/model/outcome"
import { Vector3 } from "three"

const N = Number(process.argv[2] || 6)
const VARIANT = (process.argv[3] || "B").toUpperCase()
const ASTEP = Number(process.argv[4] || 5) // 角度步长（度）
const POWERS = [30, 40, 50, 60, 70] // 单位 R

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

/** 在克隆台上以给定角度/力度打一杆，返回首撞 label（null = 空杆）与母球是否在台 */
function simulate(
  src: Ball[],
  angleRad: number,
  powerR: number
): { first: number | null; cueOn: boolean } {
  const clones = src
    .filter((b) => b.onTable())
    .map((b) => {
      const nb = new Ball(b.pos.clone(), undefined, b.label)
      nb.setStationary()
      return nb
    })
  const probe = new Table(clones)
  probe.cue = new Cue()
  probe.cueball = clones[0]
  const dir = new Vector3(Math.cos(angleRad), Math.sin(angleRad), 0)
  const aim = new AimEvent()
  aim.pos = clones[0].pos.clone()
  aim.dir = dir
  aim.power = powerR * R
  aim.spin = new Vector3(0, 0, 0)
  aim.angle = angleRad
  probe.cue!.aim = aim
  probe.cue!.hit(probe.cueball)
  let guard = 0
  while (!probe.allStationary() && guard++ < 200000) {
    probe.advance(0.001953125)
  }
  let first: number | null = null
  for (const o of probe.outcome) {
    if (o.type !== OutcomeType.Collision) continue
    if (o.ballA === probe.cueball) { first = o.ballB?.label ?? null; break }
    if (o.ballB === probe.cueball) { first = o.ballA?.label ?? null; break }
  }
  return { first, cueOn: probe.cueball.onTable() }
}

function main() {
  let solvable = 0
  for (let i = 0; i < N; i++) {
    const rnd = mulberry32(1000 + i * 7919)
    const balls = makeBalls()
    if (VARIANT === "C") placeC(balls, rnd)
    else placeB(balls, rnd)
    balls.forEach((b) => b.setStationary())
    // 母球必须在台
    const target = balls[1]
    let hits = 0
    let total = 0
    let bestPower = 0
    let bestAngle = 0
    for (let deg = 0; deg < 360; deg += ASTEP) {
      const a = (deg * Math.PI) / 180
      for (const p of POWERS) {
        total++
        const r = simulate(balls, a, p)
        if (r.first === target.label && r.cueOn) {
          hits++
          if (!bestPower) { bestPower = p; bestAngle = deg }
        }
      }
    }
    if (hits > 0) solvable++
    console.log(
      `[${i}] 合法格 ${hits}/${total}${hits ? `  样例: ${bestAngle}° / ${bestPower}R` : "  → 该网格下无解"}`
    )
  }
  console.log(
    `\n=== 变体 ${VARIANT}：${solvable}/${N} 局在 ${ASTEP}°×${POWERS.length} 档网格下存在合法杆 ===`
  )
}

main()
