/**
 * v1.3.76 一次性探针：量化「回放跟随镜头方位角」的误差。
 *
 * 背景：用户反馈「回放模式下摄像头方向应与出杆方向一致」。旧实现把方位角取成
 * 「白球 → 目标袋口」，切球时这条线与真正的出杆方向能差很多。本脚本用真实
 * 八球牌面 + 专业档 AI 出杆，逐杆统计三种方位角与「本杆出杆角」的偏差：
 *
 *   errOld  = |出杆角 - atan2(袋口 - 白球)|     ← 旧实现
 *   errMid  = |出杆角 - atan2(被击球 - 白球)|   ← v1.3.76 二级兜底
 *   errNew  = |出杆角 - buildReplayAnchor().yaw| ← v1.3.76 主路径（传 aim.angle）
 *
 * 期望：errNew ≡ 0（直接用了同一个角），errOld 应显著大于 0。
 *
 * 用法： npx tsx tools/harness/replayyaw.ts 300 [--rail]
 */
import "./predom"
import { Table } from "../../src/model/table"
import { Ball } from "../../src/model/ball"
import { R } from "../../src/model/physics/constants"
import { TableGeometry } from "../../src/view/tablegeometry"
import { PocketGeometry } from "../../src/view/pocketgeometry"
import { Professional } from "../../src/network/bot/strategies/professional"
import { AimCalculator } from "../../src/network/bot/aimcalculator"
import { Cue } from "../../src/view/cue"
import { AimEvent } from "../../src/events/aimevent"
import { EventType } from "../../src/events/eventtype"
import { Camera } from "../../src/view/camera"
import { unitAtAngle } from "../../src/utils/three-utils"
import { Vector3 } from "three"
import { DIFFICULTY } from "../../src/network/bot/difficulty"

const RAIL_MODE = process.argv.includes("--rail")
const N = parseInt(process.argv[2] ?? "300", 10) || 300

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

function placeRandom(balls: Ball[]): boolean {
  const X = TableGeometry.X - 2.2 * R
  const Y = TableGeometry.Y - 2.2 * R
  const placed: Ball[] = []
  const tryPlace = (b: Ball): boolean => {
    for (let a = 0; a < 300; a++) {
      const x = (Math.random() * 2 - 1) * X
      const y = (Math.random() * 2 - 1) * Y
      let ok = true
      for (const p of placed) {
        if (Math.hypot(p.pos.x - x, p.pos.y - y) < 2.3 * R) {
          ok = false
          break
        }
      }
      if (ok) {
        b.pos.set(x, y, 0)
        b.setStationary()
        placed.push(b)
        return true
      }
    }
    return false
  }
  for (const b of balls) if (!tryPlace(b)) return false
  return true
}

function placeRail(balls: Ball[]): boolean {
  const X = TableGeometry.X - 1.05 * R
  const Y = TableGeometry.Y - 1.05 * R
  const placed: Ball[] = []
  const tryPlace = (b: Ball, onRail: boolean): boolean => {
    for (let a = 0; a < 300; a++) {
      let x: number
      let y: number
      if (onRail) {
        const side = Math.floor(Math.random() * 4)
        const t = (Math.random() * 2 - 1) * 0.9
        if (side === 0) {
          x = t * X
          y = Y
        } else if (side === 1) {
          x = t * X
          y = -Y
        } else if (side === 2) {
          x = X
          y = t * Y
        } else {
          x = -X
          y = t * Y
        }
      } else {
        x = (Math.random() * 2 - 1) * (X - 4 * R)
        y = (Math.random() * 2 - 1) * (Y - 4 * R)
      }
      let ok = true
      for (const p of placed) {
        if (Math.hypot(p.pos.x - x, p.pos.y - y) < 2.3 * R) {
          ok = false
          break
        }
      }
      if (ok) {
        b.pos.set(x, y, 0)
        b.setStationary()
        placed.push(b)
        return true
      }
    }
    return false
  }
  for (let i = 0; i < balls.length; i++) {
    if (!tryPlace(balls[i], i % 2 === 0)) return false
  }
  return true
}

/** 复刻 Replay.computeFocusPoints 的几何：[白球, 被击球, 目标袋口] */
function focusPoints(table: Table, aim: AimEvent): Vector3[] {
  const cue = table.cueball
  const cuePos = cue.pos.clone()
  const dir = unitAtAngle(aim.angle) as Vector3
  let best: any = null
  let bestT = Infinity
  for (const b of table.balls) {
    if (b === cue || !b.onTable()) continue
    const vx = b.pos.x - cuePos.x
    const vy = b.pos.y - cuePos.y
    const t = vx * dir.x + vy * dir.y
    if (t <= 0) continue
    const perp = Math.abs(vx * dir.y - vy * dir.x)
    if (perp > 2 * R * 1.02) continue
    if (t < bestT) {
      bestT = t
      best = b
    }
  }
  const struckPos = best
    ? (best.pos as Vector3).clone()
    : cuePos.clone().addScaledVector(dir, 8 * R)
  const pocketDir = struckPos.clone().sub(cuePos)
  if (pocketDir.lengthSq() < 1e-6) pocketDir.copy(dir)
  pocketDir.normalize()
  let bestPocket: Vector3 = PocketGeometry.pocketCenters[0].pos.clone()
  let bestDot = -Infinity
  for (const p of PocketGeometry.pocketCenters) {
    const pd = (p.pos as Vector3).clone().sub(struckPos)
    if (pd.lengthSq() < 1e-6) continue
    pd.normalize()
    const d = pd.dot(pocketDir)
    if (d > bestDot) {
      bestDot = d
      bestPocket = (p.pos as Vector3).clone()
    }
  }
  return [cuePos, struckPos, bestPocket]
}

/** 角度差归一到 [0, π] */
function angDiff(a: number, b: number): number {
  let d = Math.abs(a - b) % (2 * Math.PI)
  if (d > Math.PI) d = 2 * Math.PI - d
  return d
}
const deg = (r: number) => (r * 180) / Math.PI

function pct(arr: number[], p: number): number {
  if (arr.length === 0) return 0
  const s = [...arr].sort((a, b) => a - b)
  return s[Math.min(s.length - 1, Math.floor((s.length - 1) * p))]
}

function stats(name: string, arr: number[]): void {
  const mean = arr.reduce((a, b) => a + b, 0) / (arr.length || 1)
  console.log(
    `  ${name.padEnd(7)} 均值 ${deg(mean).toFixed(1).padStart(5)}°  ` +
      `中位 ${deg(pct(arr, 0.5)).toFixed(1).padStart(5)}°  ` +
      `P90 ${deg(pct(arr, 0.9)).toFixed(1).padStart(5)}°  ` +
      `最大 ${deg(Math.max(...arr)).toFixed(1).padStart(5)}°`
  )
}

function run(): void {
  const calculator = new AimCalculator()
  const strategy = new Professional(DIFFICULTY.Professional)
  const cam = new Camera(16 / 9) as any
  const errOld: number[] = []
  const errMid: number[] = []
  const errNew: number[] = []
  let total = 0

  for (let i = 0; i < N; i++) {
    const balls = makeBalls()
    const table = new Table(balls)
    table.cue = new Cue()
    table.cueball = balls[0]
    const ok = RAIL_MODE ? placeRail(balls) : placeRandom(balls)
    if (!ok) continue
    const targets = balls.filter(
      (b) => b !== balls[0] && b.label !== 8 && b.label <= 7
    )
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

    const pts = focusPoints(table, aim)
    if (pts.length < 3) continue

    // 旧实现：方位角 = 白球 → 袋口
    const oldYaw = Math.atan2(pts[2].y - pts[0].y, pts[2].x - pts[0].x)
    // 二级兜底：白球 → 被击球
    const midYaw = Math.atan2(pts[1].y - pts[0].y, pts[1].x - pts[0].x)

    // v1.3.76 主路径：把 aim.angle 交给 camera，读真实 buildReplayAnchor 的 yaw
    cam.replayShotAngle = aim.angle
    const anchorNew = cam.buildReplayAnchor(pts)
    // 同三点但不出杆角 → 应落到二级兜底
    cam.replayShotAngle = null
    const anchorMid = cam.buildReplayAnchor(pts)

    errOld.push(angDiff(aim.angle, oldYaw))
    errMid.push(angDiff(aim.angle, midYaw))
    errNew.push(angDiff(aim.angle, anchorNew.yaw))
    // 自检：二级兜底分支应与手算 midYaw 一致
    if (Math.abs(angDiff(anchorMid.yaw, midYaw)) > 1e-9) {
      console.log("  !! 二级兜底分支与手算不一致")
    }
    total++
  }

  console.log(`\n采样杆数：${total}${RAIL_MODE ? "（贴库场景）" : "（随机散布）"}`)
  console.log("方位角相对「本杆出杆角」的偏差：")
  stats("errOld", errOld)
  stats("errMid", errMid)
  stats("errNew", errNew)

  const over = (arr: number[], th: number) =>
    ((arr.filter((v) => deg(v) > th).length / (arr.length || 1)) * 100).toFixed(
      1
    )
  console.log(`\n偏差超过阈值的占比：`)
  console.log(
    `  errOld  >30°: ${over(errOld, 30)}%   >45°: ${over(errOld, 45)}%   >60°: ${over(errOld, 60)}%`
  )
  console.log(
    `  errMid  >30°: ${over(errMid, 30)}%   >45°: ${over(errMid, 45)}%   >60°: ${over(errMid, 60)}%`
  )
  console.log(
    `  errNew  >1° : ${over(errNew, 1)}%   （期望 0.0%）`
  )
}

run()
