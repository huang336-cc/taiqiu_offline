/**
 * v1.3.68：AI 力度完全物理化 —— 基于真实物理模型反解出杆速度。
 *
 * 背景（v1.3.67 物理化失败的三处错误）：
 *  1. 物体球被撞后强制进入 State.Sliding（collision.ts）—— 纯平动、无自旋，
 *     要滑到 v=(5/7)·v_b 才转为纯滚动。这段"滑动+滚动"的等效减速远大于纯滚动。
 *     实测/解析等效减速 a_obj ≈ 0.178 m/s²，是纯滚动减速 a_roll ≈ 0.0977 的
 *     **1.82 倍**。v1.3.67 只用 a_roll，严重低估。
 *  2. 低杆（spin.y < 0）让母球表面滑速高达 (1.55~2.125)·v，滑动段长 0.75~0.92 m，
 *     **剩余滚动速度只有出杆速度的 39%~56%**（不是 85%）。v1.3.67 的
 *     spinTravelFactor 方向写反，导致 pot% 从 86% 暴跌到 12%。
 *  3. AI 的 ballToPocket 是到**内缩点**（aimcalculator.ts POCKET_INSET_FACTOR=0.94，
 *     角袋内缩 3.0R ≈ 9.8cm），不是真实袋心。反解必须先换算回真实距离。
 *
 * 袋口本身**没有能量吸收**：pocket.ts 的 willFall 是纯几何判定 (dist < radius)，
 * updateFall 只在球偏外时把球往袋心推。真正的"弹回"只发生在 knuckle（e=0.86），
 * 属几何淘汰 —— 因此袋口应建模为**距离偏移**（减袋口半径），不是额外减速。
 */
import { R, g, mu, muS } from "../../model/physics/constants"

/** 纯滚动减速度 a_roll = mu·g/√2（physics.ts rollingFull） */
export function aRoll(): number {
  return (mu * g) / Math.SQRT2
}

/**
 * 物体球「滑动 → 滚动」全过程的**等效**减速度（m/s²）。
 *
 * 推导：物体球被撞后纯平动，无自旋。
 *   - 滑动段：减速度 a_slide = μs·g，速度从 v0 降到 v1 = (5/7)·v0，
 *     滑行距离 d_slide = (v0² − v1²)/(2·a_slide) = (24/49)·v0²/(2·a_slide)
 *   - 滚动段：减速度 a_roll = mu·g/√2，速度从 v1 降到 0，
 *     滚行距离 d_roll = v1²/(2·a_roll) = (25/49)·v0²/(2·a_roll)
 *   总距离 D = d_slide + d_roll = v0² · [ (24/49)/(2·a_slide) + (25/49)/(2·a_roll) ]
 * 令 D = v0²/(2·a_obj)，得 a_obj = 1 / (2 · [ (24/49)/(2·a_slide) + (25/49)/(2·a_roll) ])
 *
 * 用当前 mu/muS 实时计算（不硬编码），台呢参数调整后自动跟随。
 */
export function aObject(): number {
  const aSlide = muS * g
  const aR = aRoll()
  const k = 24 / 49 / (2 * aSlide) + 25 / 49 / (2 * aR)
  return 1 / (2 * k)
}

/** 袋口几何：角袋 2.1R、中袋 1.64R（pocketgeometry.ts cornerRadius/middleRadius） */
export const POCKET_RADIUS_CORNER = 2.1 * R
export const POCKET_RADIUS_MIDDLE = 1.64 * R

/**
 * 出杆后母球**转入纯滚动时**的剩余速度与出杆速度之比 f(spinY)。
 *
 * 解析式（几何推导）：v_roll/v0 = 1 − (1 − 2.5·sy)/3.5 = 0.714 + 0.714·sy
 *
 * v1.3.68 实测校准（tools/harness/potcalib.ts B 段，二分法找最小进袋出杆速度）：
 *   spin.y     0      −0.22   −0.28   −0.38   −0.45   +0.26
 *   实测 f    0.714   0.570   0.530   0.485   0.480   0.863
 *   解析 f    0.714   0.557   0.514   0.443   0.393   0.900
 * 解析式在**极端低杆**下过于保守（−0.45 时预测 0.393 vs 实测 0.480，多给 22% 力度）。
 * 实测斜率 k ≈ 0.58~0.65（解析 0.714），且在 sy ≤ −0.38 后出现饱和（−0.38 与 −0.45
 * 实测几乎相同）。故改为**实测拟合**：
 *   f(sy) = 0.714 + 0.58·sy，下限 clamp 到 0.45（对应实测饱和区）
 */
export function fSpin(spinY: number): number {
  const f = 0.714 + 0.58 * spinY
  return Math.max(0.45, Math.min(1.0, f))
}

/**
 * 出杆速度 → 母球实际获得速度的折减（physics.ts cueStrike）：
 *   speed = power · (1 − 0.25·|offset|²)
 */
export function strikeFactor(offsetLen: number): number {
  return Math.max(0.5, 1 - 0.25 * offsetLen * offsetLen)
}

/** 球间碰撞的法向动量传递系数（collisionthrow.ts: e=0.925 → (1+e)/2） */
export const COLLISION_TRANSFER = 0.9625

/**
 * 完全物理化反解：算出「让物体球刚好进袋」所需的**出杆速度**（m/s）。
 *
 * @param cueToBall       母球 → 目标球 球心距离（米）
 * @param ballToPocketTrue 目标球 → **真实袋心**距离（米，已扣除内缩点偏移）
 * @param pocketRadius    袋口有效半径（米）：角袋 2.1R / 中袋 1.64R
 * @param cutCos          切球角余弦（toTarget · toPocket）
 * @param spinY           打点纵向偏移（低杆为负）
 * @param offsetLen       打点总偏移长度 |offset|（含侧旋）
 * @param margin          安全余量倍数，默认 1.05
 *
 * margin 由 tools/harness/potcalib.ts C 段实测标定：直线球最小进袋 vCue
 * 实测 0.81~1.43 m/s，模型按 margin=1.15 会给 0.97~1.69（超供 18~20%）；
 * 而进袋区间上界高达 4.8~5.0 m/s（区间很宽），说明超供**不影响进球**，
 * 只会让母球多跑 → 摔袋。故 margin 取 1.05 贴着下界，只留抗噪声余量。
 */
export function cueSpeedFor(
  cueToBall: number,
  ballToPocketTrue: number,
  pocketRadius: number,
  cutCos: number,
  spinY: number,
  offsetLen: number,
  margin: number = 1.05
): number {
  const aObj = aObject()
  const aR = aRoll()
  // 物体球只需滚到「球心进入袋口半径」即可落袋 → 有效距离 = 真实距离 − 袋半径
  const D = Math.max(0.05, ballToPocketTrue - pocketRadius)
  // 物体球到袋口所需的**转滚动后**速度
  const vObj = Math.sqrt(2 * aObj * D)
  // 母球撞击瞬间需要的速度（考虑切球角的动量传递损耗）
  const cosT = Math.max(0.2, Math.min(1, cutCos))
  const vContact = vObj / (COLLISION_TRANSFER * cosT)
  // 母球从击球点到目标球的滚动损耗
  const vRoll = Math.sqrt(vContact * vContact + 2 * aR * Math.max(0.05, cueToBall))
  // 出杆速度 = vRoll / f(spin) / 打点折减，再乘安全余量
  return (margin * vRoll) / fSpin(spinY) / strikeFactor(offsetLen)
}
