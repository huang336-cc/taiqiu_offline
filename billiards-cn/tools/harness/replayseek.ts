/**
 * v1.3.93 一次性探针：验证回放「拖动进度条后相机是否复位」。
 *
 * 修的问题：seekToFraction 只还原球局布局 + 确定性重跑物理，完全不碰相机。
 * 相机锚点 replayAnchor 只在 setReplayFrame 里被清空，seek 不调它，于是
 * replayFrameView 里的 `this.replayAnchor ?? build(...)` 一直复用拖动前那一杆
 * 的锚点，镜头定死在旧机位。
 *
 * 本脚本直接对 Camera 做受控实验：
 *   1. 用第 A 杆的三点框定建锚点，记下相机位置 posA；
 *   2. 模拟 seek 到第 B 杆 —— 修复前不调 reframe，修复后调 reframeReplayNow；
 *   3. 每帧跑 replayFrameView（fraction=1），看相机最终停在谁那里。
 *
 * 期望：修复后相机位置 == 第 B 杆锚点算出的位置（误差 ~0）；
 *       且不同杆的机位确实不同（说明这个测试有区分度，不是恒等）。
 *
 * 用法： npx tsx tools/harness/replayseek.ts
 */
import "./predom"
import { R } from "../../src/model/physics/constants"
import { Camera } from "../../src/view/camera"
import { expandFocusWithTrack } from "../../src/controller/replay"
import { AimEvent } from "../../src/events/aimevent"
import { EventType } from "../../src/events/eventtype"
import { Vector3 } from "three"

function mkCam(): Camera {
  const cam = new Camera()
  // 给个确定性的画布尺寸，避免依赖真实 DOM
  cam.camera.aspect = 16 / 9
  cam.camera.updateProjectionMatrix()
  return cam
}

function mkAim(x: number, y: number, angle: number): AimEvent {
  return new AimEvent(
    x,
    y,
    0,
    angle,
    false,
    EventType.AIM,
    0,
    0,
    0,
    new Vector3(0, 0, 0),
    false
  ) as unknown as AimEvent
}

/** 构造一杆的三点框定：白球 / 被击球 / 袋口 */
function focus(p0: [number, number], p1: [number, number], p2: [number, number]) {
  return [new Vector3(p0[0], p0[1], 0), new Vector3(p1[0], p1[1], 0), new Vector3(p2[0], p2[1], 0)]
}

function settle(cam: Camera, frames = 120): Vector3 {
  const aim = mkAim(0, 0, 0)
  for (let i = 0; i < frames; i++) cam.update(1 / 60, aim)
  return cam.camera.position.clone()
}

let fail = 0
function check(name: string, cond: boolean, detail: string) {
  console.log(`${cond ? "  ✅" : "  ❌"} ${name}${detail ? "  " + detail : ""}`)
  if (!cond) fail++
}

console.log("=".repeat(72))
console.log("回放 seek 相机复位探针 (v1.3.93)")
console.log("=".repeat(72))

// ---------------------------------------------------------------- 场景 1
console.log("\n[场景 1] 不同杆的三点框定应产出不同机位（测试区分度）")
{
  const cam = mkCam()
  const shotA = focus([-1.0, -0.3], [-0.3, 0.2], [-1.4, -0.7])
  const shotB = focus([0.9, 0.5], [0.3, 0.1], [1.4, 0.72])

  cam.setReplayFrame(shotA, 0.3)
  const posA = settle(cam)

  cam.setReplayFrame(shotB, 0.3)
  const posB = settle(cam)

  const dist = posA.distanceTo(posB)
  check(
    "两杆机位应有明显差异",
    dist > R * 3,
    `posA=(${posA.x.toFixed(3)},${posA.y.toFixed(3)}) posB=(${posB.x.toFixed(3)},${posB.y.toFixed(3)}) 距离=${(dist / R).toFixed(1)}R`
  )
}

// ---------------------------------------------------------------- 场景 2
console.log("\n[场景 2] seek 后相机应切到目标杆机位（修复的核心）")
{
  const shotA = focus([-1.0, -0.3], [-0.3, 0.2], [-1.4, -0.7])
  const shotB = focus([0.9, 0.5], [0.3, 0.1], [1.4, 0.72])

  // --- 修复前行为：seek 不碰相机，只重建球局 ---
  const camOld = mkCam()
  camOld.setReplayFrame(shotA, 0.3)
  const posAOld = settle(camOld)
  // 模拟 seek 到 B 杆（旧代码啥也不做）
  const posAfterSeekOld = settle(camOld)

  // --- 修复后行为：seek 调 reframeReplayNow ---
  const camNew = mkCam()
  camNew.setReplayFrame(shotA, 0.3)
  settle(camNew)
  camNew.reframeReplayNow(shotB, 0.3)
  const posAfterSeekNew = settle(camNew)

  // 期望的真实目标机位
  const camRef = mkCam()
  camRef.setReplayFrame(shotB, 0.3)
  const posBRef = settle(camRef)

  const errOld = posAfterSeekOld.distanceTo(posBRef)
  const errNew = posAfterSeekNew.distanceTo(posBRef)

  console.log(
    `     修复前 相机停在 posA 附近: 到 B 杆目标机位偏差 ${(errOld / R).toFixed(1)}R`
  )
  console.log(
    `     修复后 相机切到目标杆    : 到 B 杆目标机位偏差 ${(errNew / R).toFixed(2)}R`
  )

  check(
    "修复前确实复现了「视角定死在旧杆」的 bug",
    errOld > R * 3,
    `偏差 ${(errOld / R).toFixed(1)}R（应远大于 0，证明 bug 真实存在）`
  )
  check(
    "修复后相机正确切到目标杆机位",
    errNew < R * 0.05,
    `偏差 ${(errNew / R).toFixed(4)}R（应≈0）`
  )
}

// ---------------------------------------------------------------- 场景 3
console.log("\n[场景 3] 连续多次 seek 后仍能对上（无累积漂移）")
{
  const shots = [
    focus([-1.0, -0.3], [-0.3, 0.2], [-1.4, -0.7]),
    focus([0.9, 0.5], [0.3, 0.1], [1.4, 0.72]),
    focus([-0.5, 0.6], [0.2, 0.4], [-1.4, 0.72]),
    focus([0.6, -0.5], [-0.2, -0.2], [1.4, -0.72]),
  ]
  const cam = mkCam()
  cam.setReplayFrame(shots[0], 0.1)
  settle(cam)

  let maxErr = 0
  // 来回乱拖
  for (const idx of [2, 0, 3, 1, 3, 0, 2]) {
    cam.reframeReplayNow(shots[idx], 0.1)
    const got = settle(cam)
    const ref = mkCam()
    ref.setReplayFrame(shots[idx], 0.1)
    const want = settle(ref)
    maxErr = Math.max(maxErr, got.distanceTo(want))
  }
  check(
    "反复拖动不累积漂移",
    maxErr < R * 0.05,
    `最大偏差 ${(maxErr / R).toFixed(4)}R`
  )
}

// ---------------------------------------------------------------- 场景 4
console.log("\n[场景 4] 轨迹并入框定后，远走位的白球应仍在画面内")
{
  const cam = mkCam()
  // 极端走位：白球与目标球、袋口全挤在**左上角一小片区域**（三点包围圆很小，
  // 相机因此凑得很近），但白球撞完后要横穿到**右下角**。这正是用户说的
  // 「看不见白球」——三点框定只顾击球瞬间，不管白球去哪了。
  const base = focus([-1.30, 0.60], [-1.20, 0.50], [-1.44, 0.72])
  const track: [number, number, number][] = [
    [-1.3, 0.6, 0],
    [-0.7, 0.3, 0],
    [0.0, -0.1, 0],
    [0.7, -0.4, 0],
    [1.25, -0.6, 0],
  ]

  const merged = expandFocusWithTrack(base, track)

  cam.setReplayFrame(base, 0.35)
  const posNoTrack = settle(cam)

  const cam2 = mkCam()
  cam2.setReplayFrame(merged, 0.35)
  const posWithTrack = settle(cam2)

  const endPt = new Vector3(
    track[track.length - 1][0],
    track[track.length - 1][1],
    0
  )
  const inView = (c: Camera) => {
    const ndc = endPt.clone().project(c.camera)
    return ndc.z < 1 && Math.abs(ndc.x) <= 1 && Math.abs(ndc.y) <= 1
  }

  const okOld = inView(cam)
  const okNew = inView(cam2)
  console.log(
    `     白球走位终点 ${okOld ? "在" : "不在"} 画面内（不含轨迹框定，旧行为）`
  )
  console.log(
    `     白球走位终点 ${okNew ? "在" : "不在"} 画面内（含轨迹框定，新行为）`
  )
  check(
    "旧行为确实把白球走丢了（复现 bug）",
    !okOld,
    "三点点位挤在角落时，镜头拉得很近，白球一横穿就出画"
  )
  check("含轨迹框定后走位终点进入画面", okNew, "这就是「看不见白球」的修复")
  check(
    "轨迹框定确实改变了机位（而非无操作）",
    posNoTrack.distanceTo(posWithTrack) > R * 0.5,
    `视距变化 ${(posNoTrack.distanceTo(posWithTrack) / R).toFixed(1)}R`
  )
}

console.log("\n" + "=".repeat(72))
console.log(fail === 0 ? "✅ 全部通过" : `❌ ${fail} 项未通过`)
console.log("=".repeat(72))
process.exit(fail === 0 ? 0 : 1)
