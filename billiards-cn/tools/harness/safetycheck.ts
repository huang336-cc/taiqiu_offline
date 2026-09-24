/**
 * v1.3.91 无头验证：防守策略池的选用分布与效果（专业级 AI 的核心能力）。
 *
 * 用户明确要求防守要做到「不给对手留有效进攻窗口」，并给出三种职业手段：
 *   ① 贴球防守（小力轻推）② 藏母球做斯诺克 ③ 推远袋口（中力）
 *
 * 本脚本量化：
 *   - 三种方案的**选用分布**（若某个方案 0 次，说明实现有问题）；
 *   - 防守前后的**对手威胁下降幅度**（这是防守有效性的唯一硬指标）；
 *   - 防守杆的犯规率（防守送出犯规比不防守更糟，必须为 0）。
 *
 * 场景：
 *   --snook  模仿 foulsnook.ts 的挡路布局（强制 AI 走防守分支）
 *   --cluster 球挤在半台（走位/防守都吃紧）
 *
 * 用法：
 *   npx tsx tools/harness/safetycheck.ts 300 [--snook|--cluster]
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
import { evalThreat } from "../../src/network/bot/decision/defense"

const STEP = 0.001953125
const SNOOK = process.argv.includes("--snook")
/** 强制防守：全部直线被挡 + 母球贴库，迫使 AI 必走防守分支 */
const FORCED = process.argv.includes("--forced")
const CLUSTER = process.argv.includes("--cluster")

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

/** 挡路布局（同 foulsnook.ts）：把对方球摆在母球→本方球连线上 */
function placeSnook(balls: Ball[]): boolean {
  const X = TableGeometry.X - 2.2 * R
  const Y = TableGeometry.Y - 2.2 * R
  const placed: Ball[] = []
  const cue = balls[0]
  for (let a = 0; a < 300; a++) {
    const p = new Vector3(
      (Math.random() * 2 - 1) * X * 0.4,
      (Math.random() * 2 - 1) * Y * 0.4,
      0
    )
    if (areaOk(p, placed)) {
      cue.pos.copy(p)
      cue.setStationary()
      placed.push(cue)
      break
    }
  }
  if (!placed.includes(cue)) return false

  const mine = balls.slice(1, 8)
  const opponents = balls.filter((b) => b.label >= 9)
  let oppIdx = 0
  for (const t of mine) {
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
    if (Math.random() < 0.6 && oppIdx < opponents.length) {
      const frac = 0.25 + Math.random() * 0.4
      const dir = t.pos.clone().sub(cue.pos)
      const blocker = opponents[oppIdx]
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
  const rest = balls.filter(
    (b) => b.label === 8 || (b.label >= 9 && !placed.includes(b))
  )
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

/**
 * 强制防守布局：把母球放到「所有本方球都被对方球挡死」的位置，
 * 或至少让全部候选难度都超过进攻阈值 —— 这时 AI 必然走防守分支。
 * 做法：母球贴库放一角，7 颗本方球散开但每颗前方都摆一颗对方球。
 */
function placeForcedDefense(balls: Ball[]): boolean {
  const X = TableGeometry.X - 2.2 * R
  const Y = TableGeometry.Y - 2.2 * R
  const placed: Ball[] = []
  const cue = balls[0]
  // 母球贴左库（制造出杆角度受限）。
  // v1.3.91：必须落在球心可及范围内（|x| <= X），用 -X 而非 -X+0.6R ——
  // 后者反而把母球推到台外，Table 构造时抛错、样本被整体跳过（N=0）。
  cue.pos.set(-X, (Math.random() * 2 - 1) * Y * 0.5, 0)
  cue.setStationary()
  placed.push(cue)

  const mine = balls.slice(1, 8)
  const opponents = balls.filter((b) => b.label >= 9)
  let oppIdx = 0
  for (const t of mine) {
    let ok = false
    for (let a = 0; a < 400 && !ok; a++) {
      const p = new Vector3(
        (Math.random() * 2 - 1) * X,
        (Math.random() * 2 - 1) * Y,
        0
      )
      if (areaOk(p, placed, 2.3 * R)) {
        t.pos.copy(p)
        t.setStationary()
        placed.push(t)
        ok = true
      }
    }
    if (!ok) return false
    // 必挡：在母球→本方球连线中点放一颗对方球
    if (oppIdx < opponents.length) {
      const dir = t.pos.clone().sub(cue.pos)
      const blocker = opponents[oppIdx]
      for (let a = 0; a < 40; a++) {
        const f = 0.4 + Math.random() * 0.2
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
  const rest = balls.filter(
    (b) => b.label === 8 || (b.label >= 9 && !placed.includes(b))
  )
  for (const b of rest) {
    let ok = false
    for (let a = 0; a < 400 && !ok; a++) {
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

/** 拥挤布局：本方球挤在半台 */
function placeCluster(balls: Ball[]): boolean {
  const placed: Ball[] = []
  balls[0].pos.set(-TableGeometry.X * 0.6, 0, 0)
  balls[0].setStationary()
  placed.push(balls[0])
  const zoneX0 = 0.1 * TableGeometry.X
  const zoneY = TableGeometry.Y - 3 * R
  for (let i = 1; i < balls.length; i++) {
    const b = balls[i]
    let ok = false
    for (let a = 0; a < 400 && !ok; a++) {
      const x =
        zoneX0 + Math.random() * (TableGeometry.X - zoneX0 - 2.5 * R)
      const y = (Math.random() * 2 - 1) * zoneY
      let clash = false
      for (const p of placed) {
        if (Math.hypot(p.pos.x - x, p.pos.y - y) < 2.3 * R) {
          clash = true
          break
        }
      }
      if (!clash) {
        b.pos.set(x, y, 0)
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
  while (!table.allStationary() && guard++ < 300000) table.advance(STEP)
}

function run(N: number) {
  const calculator = new AimCalculator()
  const strategy = new Professional(DIFFICULTY.Professional)
  const kinds: Record<string, number> = {
    touch: 0,
    snooker: 0,
    pushaway: 0,
    kick: 0,
    desperate: 0,
    none: 0,
  }
  let total = 0
  let foul = 0
  let scratch = 0
  let threatBeforeSum = 0
  let threatAfterSum = 0
  let defenseN = 0
  let skipped = 0

  for (let i = 0; i < N; i++) {
    const balls = makeBalls()
    const table = new Table(balls)
    table.cue = new Cue()
    table.cueball = balls[0]
    const ok = FORCED
      ? placeForcedDefense(balls)
      : CLUSTER
        ? placeCluster(balls)
        : placeSnook(balls)
    if (!ok) { skipped++; continue }

    const mine = balls.filter(
      (b) => b.label >= 1 && b.label <= 7
    )
    const theirs = balls.filter((b) => b.label >= 9)
    const ctx = {
      table,
      cueBall: balls[0],
      validTargetBalls: mine,
      ballInHand: false,
      pockets: calculator.pockets,
      ruleName: "eightball",
      opponentBalls: theirs,
    }

    // 防守前的对手威胁（站在当前母球位置评估）
    const dctxBefore: any = {
      table,
      cue: balls[0],
      targets: mine,
      allBalls: balls.filter((b) => b !== balls[0]),
      opponentBalls: theirs,
      onEightBall: false,
      pockets: calculator.pockets,
      profile: DIFFICULTY.Professional,
      calculator,
      ruleName: "eightball",
      cueOnRail: false,
      cueTouching: false,
      touchingBall: null,
      isBreak: false,
      potStreak: 0,
      pressure: 0,
    }
    const before = evalThreat(dctxBefore, balls[0].pos)

    let events: any[]
    try {
      events = strategy.aim(ctx as any, calculator) as any[]
    } catch {
      continue
    }
    if (!events || events.length === 0) continue
    const hit =
      events.find((e) => e.type === EventType.HIT) ?? events[events.length - 1]
    if (!hit || !hit.tablejson) continue
    const aim = AimEvent.fromJson(hit.tablejson.aim)

    // 防守分支的唯一可靠标记：strategy 记录的本杆方案类型。
    // （不能用 events.length <= 2 —— 主路径在贴球等场景也会出 2 事件。）
    const kind = (strategy as any).lastDefenseKind as string | null
    const usedDefense = kind !== null
    if (usedDefense) {
      kinds[kind as string] = (kinds[kind as string] ?? 0) + 1
      defenseN++
    } else {
      kinds.none++
    }

    simulate(table, aim)
    total++

    // 防守后：球停下来了，评估对手在新局面下的威胁
    if (usedDefense) {
      const cueNow = table.cueball
      if (cueNow.onTable()) {
        const dctxAfter: any = { ...dctxBefore, cue: cueNow }
        const after = evalThreat(dctxAfter, cueNow.pos)
        threatBeforeSum += before
        threatAfterSum += after
      }
    }

    const outcome: Outcome[] = table.outcome
    const firstCollision = Outcome.firstCollision(outcome)
    const pottedCue = Outcome.isCueBallPotted(table.cueball, outcome)
    if (pottedCue) scratch++
    if (firstCollision && firstCollision.type === OutcomeType.Collision) {
      const hitLabel = (firstCollision as any).ballB?.label
      const legal =
        typeof hitLabel === "number" && hitLabel >= 1 && hitLabel <= 7
      if (!legal && !pottedCue) foul++
    }
  }

  const pct = (a: number) => ((a / (total || 1)) * 100).toFixed(1) + "%"
  // kinds.kind     的分母是「走防守分支的杆数」(defenseN)
  // kinds.none     的分母是「总杆数」(total，即未走防守的进攻杆)
  // 两者分母不同，必须分开算 —— 否则 none 会算出 >100% 的占比。
  const share = (k: string) => {
    if (k === "none") return total ? ((kinds.none / total) * 100).toFixed(1) + "%" : "-"
    return defenseN ? ((kinds[k] / defenseN) * 100).toFixed(1) + "%" : "-"
  }
  return {
    total,
    defenseN,
    skipped,
    foul: pct(foul),
    scratch: pct(scratch),
    threatBefore: defenseN ? (threatBeforeSum / defenseN).toFixed(3) : "-",
    threatAfter: defenseN ? (threatAfterSum / defenseN).toFixed(3) : "-",
    share,
    kinds,
  }
}

const N = Number(
  process.argv.slice(2).find((a) => !a.startsWith("--")) ?? 300
)
console.log(
  `mode: ${FORCED ? "forced(强制防守)" : CLUSTER ? "cluster(拥挤)" : "snook(挡路)"}`
)
const r = run(N)
console.log(
  `N=${r.total}  走防守分支=${r.defenseN} 杆  首撞犯规=${r.foul}  摔袋=${r.scratch}`
)
console.log(
  `防守方案选用: 贴球=${r.share("touch")}  斯诺克=${r.share(
    "snooker"
  )}  推远袋口=${r.share("pushaway")}  认命=${r.share(
    "desperate"
  )}  一库解球=${r.share("kick")}  无标记=${r.share("none")}`
)
console.log(
  `对手威胁: 防守前=${r.threatBefore}  防守后=${r.threatAfter}`
)
