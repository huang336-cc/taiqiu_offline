/**
 * v1.4.0 候选枚举透视（railcands）。
 *
 * `railchoice.ts` 显示 AI 在贴库局面下本来就选角袋 —— 那中袋是在哪一层
 * 被筛掉/压后的？本脚本把决策内部逐层摊开：
 *   · enumerateCandidates 出了哪些「球×袋」候选
 *   · 每个候选的 difficulty / pocketValue / offenseScore
 *   · rankPlans 最终选了谁
 * 以便确认 v1.4.0 的修复是否作用在正确的层。
 */
import "./predom"
import { Table } from "../../src/model/table"
import { Ball, State } from "../../src/model/ball"
import { R } from "../../src/model/physics/constants"
import { TableGeometry } from "../../src/view/tablegeometry"
import { PocketGeometry } from "../../src/view/pocketgeometry"
import { Vector3 } from "three"
import { AimCalculator } from "../../src/network/bot/aimcalculator"
import { Cue } from "../../src/view/cue"
import { Professional } from "../../src/network/bot/strategies/professional"
import { DIFFICULTY } from "../../src/network/bot/difficulty"
import { enumerateCandidates, remainingCenter } from "../../src/network/bot/decision/offense"
import { buildDecisionContext } from "../../src/network/bot/decision/shotcontext"
import { EventType } from "../../src/events/eventtype"
import { AimEvent } from "../../src/events/aimevent"

const TY = TableGeometry.tableY

const P_NAMES = ["NW", "SW", "N", "S", "NE", "SE"]
const centers = PocketGeometry.pocketCenters.map((p) => p.pos.clone())

function build(objX: number, cueX: number) {
  const obj = new Ball(new Vector3(objX, TY - 1.5 * R, 0), undefined, 1)
  const cue = new Ball(new Vector3(cueX, TY - 1.5 * R, 0), undefined, 0)
  obj.setStationary()
  cue.setStationary()
  const others: Ball[] = []
  for (let l = 2; l <= 15; l++) {
    const b = new Ball(new Vector3(TableGeometry.tableX * 3, TY * 3 + l * 0.1, 0), undefined, l)
    b.setStationary()
    b.state = State.InPocket
    others.push(b)
  }
  const table = new Table([cue, obj, ...others])
  table.cue = new Cue()
  table.cueball = cue
  return { table, cue, obj }
}

function inspect(objXR: number, cueXR: number) {
  const { table, cue, obj } = build(objXR * R, cueXR * R)
  const calculator = new AimCalculator()
  const profile = DIFFICULTY.Professional
  const strategy = new Professional(profile)

  const ctx: any = {
    table,
    cueBall: cue,
    validTargetBalls: [obj],
    ballInHand: false,
    pockets: calculator.pockets,
    ruleName: "eightball",
    opponentBalls: [],
  }
  const dctx = buildDecisionContext(ctx, profile, calculator, {
    ruleName: "eightball",
    opponentBalls: [],
    onEightBall: false,
  })

  console.log(`\n━━ 目标球 x=${objXR}R（离库cos 由 N 袋方向决定），母球 x=${cueXR}R`)
  for (const strict of [true, false]) {
    const cands = enumerateCandidates(
      dctx,
      strict ? Math.min(profile.minCutCos, 0.25) : profile.minCutCos,
      { strict }
    )
    const tag = strict ? "strict" : "宽松(降级口径)"
    if (cands.length === 0) {
      console.log(`  [${tag}] 无候选`)
      continue
    }
    const rows = cands
      .map((c) => {
        const pi = centers.findIndex(
          (p) => p.distanceTo(c.pocket) < 1e-6
        )
        return {
          pocket: P_NAMES[pi] ?? "?",
          d: c.difficulty,
          ballToPocket: c.ballToPocket / R,
          cut: c.cutCos,
        }
      })
      .sort((a, b) => a.d - b.d)
    console.log(
      `  [${tag}] ${cands.length} 个候选：` +
        rows
          .map(
            (r) =>
              `${r.pocket}(难${r.d.toFixed(3)}, 距${r.ballToPocket.toFixed(1)}R, 切${r.cut.toFixed(2)})`
          )
          .join("  ")
    )
  }

  // 最终出杆
  const events = strategy.aim(ctx, calculator) as any[]
  const hit =
    events?.find((e) => e.type === EventType.HIT) ?? events?.[events.length - 1]
  if (hit?.tablejson?.aim) {
    const aim = AimEvent.fromJson(hit.tablejson.aim)
    let best = ""
    let bestDot = -2
    for (let i = 0; i < centers.length; i++) {
      const toP = centers[i].clone().sub(obj.pos).normalize()
      const aimDir = new Vector3(Math.cos(aim.angle), Math.sin(aim.angle), 0)
      const d = aimDir.dot(toP)
      if (d > bestDot) {
        bestDot = d
        best = P_NAMES[i]
      }
    }
    console.log(`  ⇒ 实际出杆瞄准：${best}`)
  } else {
    console.log(`  ⇒ 无出杆（防守/无解）`)
  }
  void remainingCenter
}

console.log("\n=== v1.4.0 候选枚举透视（贴库局面） ===")
inspect(4, -10)
inspect(6, -20)
inspect(8, 0)
inspect(-14, -26)
console.log()
