/**
 * v1.4.0 贴库选袋**决策层**验证（railchoice）。
 *
 * 【为什么不用出杆角反推选袋】
 *   母球的行进方向（cue→ghost）与目标球的出球方向（ball→pocket）在薄切时
 *   可以相差接近 90°，用前者去匹配袋口方向会认错袋（实测把 NE 认成 NW）。
 *   正确做法：由出杆角解出 ghost 点（射线与「距球心 2R」的交点），再取
 *   (ball − ghost) 的方向 = 目标球出球方向，与六个袋口方向匹配。
 *
 * 同时直接挂钩 Professional.rankPlans（私有方法，运行时可拦），把
 * 「候选列表 + 最终选择」原样打印出来，彻底看清决策内幕。
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
import { EventType } from "../../src/events/eventtype"
import { AimEvent } from "../../src/events/aimevent"

const TX = TableGeometry.tableX
const TY = TableGeometry.tableY

const P_NAMES = ["NW", "SW", "N", "S", "NE", "SE"]
const centers = PocketGeometry.pocketCenters.map((p) => p.pos.clone())
const insetCenters = centers.map((p) => p.clone().multiplyScalar(0.94))

/** 由候选的 inset pocket 反查袋名 */
function pocketName(pocket: Vector3): string {
  let best = "?"
  let bd = Infinity
  for (let i = 0; i < insetCenters.length; i++) {
    const d = insetCenters[i].distanceTo(pocket)
    if (d < bd) {
      bd = d
      best = P_NAMES[i]
    }
  }
  return best
}

/**
 * 由出杆角反推袋口：对每个 inset 袋算「期望出杆角」（cue→ghost 的 atan2），
 * 取与实际出杆角夹角最小者。
 *
 * 【为什么不用「最近点法」反推出球方向】
 *   近直球（切角≈1.00）时出杆射线几乎穿过球心，「射线上距球心最近点」
 *   的残差方向被数值噪声主导，会把 NE 直球认成 N（实测踩坑）。
 *   期望角比对法对直球/薄球都稳定。
 */
function pocketAimedAt(cuePos: Vector3, objPos: Vector3, angle: number): string {
  let best = "?"
  let bestDiff = Infinity
  for (let i = 0; i < insetCenters.length; i++) {
    const u = insetCenters[i].clone().sub(objPos).normalize()
    const ghost = objPos.clone().addScaledVector(u, -2 * R)
    const expected = Math.atan2(ghost.y - cuePos.y, ghost.x - cuePos.x)
    let diff = Math.abs(expected - angle)
    while (diff > Math.PI) diff = 2 * Math.PI - diff
    if (diff < bestDiff) {
      bestDiff = diff
      best = P_NAMES[i]
    }
  }
  return best
}

function build(objX: number, cueX: number) {
  const obj = new Ball(new Vector3(objX, TY - 1.5 * R, 0), undefined, 1)
  const cue = new Ball(new Vector3(cueX, TY - 1.5 * R, 0), undefined, 0)
  obj.setStationary()
  cue.setStationary()
  const others: Ball[] = []
  for (let l = 2; l <= 15; l++) {
    const b = new Ball(new Vector3(TX * 3, TY * 3 + l * 0.1, 0), undefined, l)
    b.setStationary()
    b.state = State.InPocket
    others.push(b)
  }
  const table = new Table([cue, obj, ...others])
  table.cue = new Cue()
  table.cueball = cue
  return { table, cue, obj }
}

function askAI(objXR: number, cueXR: number): string {
  const { table, cue, obj } = build(objXR * R, cueXR * R)
  const calculator = new AimCalculator()
  const strategy = new Professional(DIFFICULTY.Professional)

  // 挂钩 rankPlans：捕获候选列表与最终选择
  const orig = (strategy as any).rankPlans.bind(strategy)
  let planDump = ""
  let picked = ""
  ;(strategy as any).rankPlans = (plans: any[], dctx: any) => {
    const pick = orig(plans, dctx)
    planDump = plans
      .map(
        (c) =>
          `${pocketName(c.pocket)}(难${c.difficulty.toFixed(2)},距${(c.ballToPocket / R).toFixed(0)}R,切${c.cutCos.toFixed(2)})`
      )
      .sort()
      .join(" ")
    picked = pick ? pocketName(pick.pocket) : "?"
    return pick
  }

  const ctx: any = {
    table,
    cueBall: cue,
    validTargetBalls: [obj],
    ballInHand: false,
    pockets: calculator.pockets,
    ruleName: "eightball",
    opponentBalls: [],
  }
  let events: any[]
  try {
    events = strategy.aim(ctx, calculator) as any[]
  } catch (e) {
    return `异常 | 候选: ${planDump}`
  }
  if (!events || !events.length) return `无解(防守) | 候选: ${planDump}`
  const hit =
    events.find((e) => e.type === EventType.HIT) ?? events[events.length - 1]
  if (!hit?.tablejson?.aim) return `无出杆 | 候选: ${planDump}`
  const aim = AimEvent.fromJson(hit.tablejson.aim)
  const aimPocket = pocketAimedAt(cue.pos, obj.pos, aim.angle)
  return `rank选=${picked} 出杆=${aimPocket} | 候选: ${planDump}`
}

console.log("\n=== v1.4.0 贴库选袋决策透视（专业档，目标球贴上长库） ===")
console.log("格式：球x/母球x → rankPlans选择 + 实际出杆 + 全部候选")
for (const [objXR, cueXR] of [
  // 中袋是几何最短线路的场景（用户投诉点）
  [4, -10],
  [4, 20],
  [6, -20],
  [6, 20],
  [8, 0],
  [6, 0],
  // 对照
  [-14, -26],
  [16, 0],
]) {
  console.log(`球x=${objXR}R 母球x=${cueXR}R → ${askAI(objXR, cueXR)}`)
}
console.log()
