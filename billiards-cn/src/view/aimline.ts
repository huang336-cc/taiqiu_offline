import {
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
  DynamicDrawUsage,
  Group,
  Mesh,
  MeshBasicMaterial,
  Vector3,
} from "three"
import { R, g, mu, muS } from "../model/physics/constants"
import { cueToSpin } from "../model/physics/physics"
import { upCross } from "../utils/three-utils"
import { TableGeometry } from "./tablegeometry"
import { PocketGeometry } from "./pocketgeometry"
import type { Ball } from "../model/ball"
import type { Table } from "../model/table"

/**
 * 进球辅助线（纯 3D 场景内渲染）。
 *
 * 结构固定两段：
 *   ① 实线：母球球心 → 目标球碰撞接触点
 *   ② 虚线：碰撞接触点 → 球袋进球中心点
 * 另外在母球撞击瞬间所处的位置画一个「幽灵球」圆环，直观表示接触姿态。
 *
 * 实现要点（对应需求约束）：
 * - 不用 LineBasicMaterial：WebGL 下 linewidth 恒为 1px，无法「粗细固定」，
 *   且远近粗细不一致。这里把每一段线做成贴着台呢平面的三角形带（ribbon），
 *   线宽是真实的物理宽度，任何视角、任何距离都稳定。
 * - 全部顶点的 z 固定在台呢平面（z = -R + 微小抬升），绝不悬空。
 * - depthTest 打开、depthWrite 关闭：台球、库边会正常遮挡辅助线，
 *   辅助线自身不会互相打架，也不会盖住球模型。
 * - 顶点缓冲一次性预分配，靠 drawRange 控制实际绘制量，逐帧刷新零 GC。
 */

/**
 * ribbon 最多容纳的四边形数量（每个四边形 = 2 三角形 = 6 顶点）。
 *
 * v1.3.85：软边渐变把每段线拆成 **3 个横向条带**，所以容量要按 3 倍留。
 * 原 192 是按「一段线 = 1 个 quad」估的；实线+虚线（虚线按 42mm 节奏切）
 * 的段数上限约 60，乘 3 后 192 仍然够用，但留到 384 更稳妥。
 *
 * v1.3.93：384 实测**不够**，提高到 640。逐项算一遍容量账（每段按 3 条带计）：
 *
 *   - 幽灵球圆环  RING_SEGMENTS=32 段 × 3 = **96 quads**
 *   - 袋口指示圈  同 32 段 × 3        = **96 quads**
 *   - 母球行进线  Ribbon.trace 内部再拆 4 小段 × 3 = 12 quads
 *   - 虚线        段数 = total / 70mm。白球贴库、目标球紧邻远端袋口时，
 *                 虚线可长达整个台面对角线（≈3.2m）→ 45 段 × 3 = **135 quads**
 *
 * 合计峰值 ≈ 96 + 96 + 12 + 135 = 339，已经逼近 384；一旦牌面更密
 * （多球堆、袋口区多颗球同时被标出），就会触发静默截断 —— 用户看到的
 * 「辅助线该有的部分没有 / 画一半断掉」正是这里。
 *
 * 提到 640 留出约 1.9 倍余量，同时保留溢出计数（见 Ribbon.overflowed）
 * 供开发期断言，不再让超限无声无息。
 */
const MAX_QUADS = 640
const FLOATS_PER_QUAD = 6 * 3
/** 每顶点额外带 1 个 alpha 分量（v1.3.85：软边渐变） */
const FLOATS_PER_QUAD_ALPHA = 6 * 1

/** 线宽（米）。球直径 2R≈65.5mm，7mm 的线既看得清又不糊住球 */
const LINE_WIDTH = 0.007
/**
 * v1.3.94（顶杆 / 母球走位预测）：青色母球预测线的标定。
 *   CUE_TRAVEL_BASE：自然切线分离行程系数。切球越薄(切线越大)母球分得越远，
 *                     乘以该系数得到预测长度（满切 ≈ 1.0m）。
 *   CUE_TRAVEL_SPIN：高低杆增量系数。顶/缩杆沿连心线再增减一段行程。
 */
const CUE_TRAVEL_BASE = 1.0
const CUE_TRAVEL_SPIN = 0.7
/** 台呢平面：球心在 z=0，球半径 R，故台面在 z=-R。抬 1.5mm 防止 z-fighting */
const PLANE_Z = -R + 0.0015
/** 虚线节奏（米） */
const DASH_LEN = 0.042
const DASH_GAP = 0.028
/** 幽灵球圆环的分段数 */
const RING_SEGMENTS = 32

class Ribbon {
  readonly mesh: Mesh
  private readonly positions: Float32Array
  private readonly attribute: BufferAttribute
  /**
   * v1.3.85：逐顶点透明度。
   *
   * 此前整条 ribbon 是**纯白不透明**的一个色块（`MeshBasicMaterial` 单一
   * opacity），在画面里像一片硬纸片 —— 两侧是刀切一样的直角边，没有柔化，
   * 也没有"光带"的感觉。
   *
   * 改为：中心线两端不透明、两侧边缘完全透明，形成横向渐变。
   * 视觉上从"白纸片"变成"柔和的光带"，这是低成本高回报的一处观感提升。
   */
  private readonly alphas: Float32Array
  private readonly alphaAttr: BufferAttribute
  private quads = 0
  /**
   * v1.3.93：本次重建中被容量丢弃的四边形数。
   *
   * 原先超限是 `if (this.quads >= MAX_QUADS) return` —— **静默截断**，
   * 辅助线画一半就没了，且没有任何信号说明「这是被截断而不是本该如此」。
   * 现在计数暴露出来，`AimLine.update` 每次 begin 时清零，
   * 开发期可通过 `AimLine.lastOverflow` 断言；玩家侧不产生额外噪音。
   */
  overflowed = 0

  constructor(opacity: number, color = 0xffffff) {
    this.positions = new Float32Array(MAX_QUADS * FLOATS_PER_QUAD)
    this.attribute = new BufferAttribute(this.positions, 3)
    this.attribute.setUsage(DynamicDrawUsage)

    this.alphas = new Float32Array(MAX_QUADS * FLOATS_PER_QUAD_ALPHA)
    this.alphaAttr = new BufferAttribute(this.alphas, 1)
    this.alphaAttr.setUsage(DynamicDrawUsage)

    const geometry = new BufferGeometry()
    geometry.setAttribute("position", this.attribute)
    geometry.setAttribute("aAlpha", this.alphaAttr)
    geometry.setDrawRange(0, 0)
    const material = new MeshBasicMaterial({
      color,
      transparent: true,
      opacity,
      depthTest: true,
      depthWrite: false,
      side: DoubleSide,
      toneMapped: false,
      fog: false,
    })
    /**
     * 用逐顶点 alpha 调制整体 opacity：`vAlpha` 由 `onBeforeCompile`
     * 注入到片元着色器，在 `diffuseColor.a` 上再乘一次。
     * 这样边缘 alpha=0（完全透明）→ 中心 alpha=1（保持原 opacity），
     * 得到横向柔边。不引入贴图，零采样开销。
     *
     * 注意：`onBeforeCompile` 不是 `MeshBasicMaterial` 构造参数的类型成员
     * （three 把它挂在实例上而非 `Parameters`），所以必须在构造之后赋值。
     */
    material.onBeforeCompile = (shader: any) => {
      shader.vertexShader = shader.vertexShader
        .replace(
          "#include <common>",
          `#include <common>
             attribute float aAlpha;
             varying float vAlpha;`
        )
        .replace(
          "#include <begin_vertex>",
          `#include <begin_vertex>
             vAlpha = aAlpha;`
        )
      shader.fragmentShader = shader.fragmentShader
        .replace(
          "#include <common>",
          `#include <common>
             varying float vAlpha;`
        )
        .replace(
          "#include <color_fragment>",
          `#include <color_fragment>
             diffuseColor.a *= vAlpha;`
        )
    }
    this.mesh = new Mesh(geometry, material)
    this.mesh.renderOrder = 6
    // 顶点每帧改写，包围盒不可靠，直接关掉视锥剔除
    this.mesh.frustumCulled = false
    this.mesh.visible = false
  }

  begin() {
    this.quads = 0
    this.overflowed = 0
    /**
     * 每帧重置 alpha 缓冲为 0（v1.3.85 修复）。
     *
     * 病灶：`setDrawRange` 只消费**前 N 个顶点**，而上一帧写入的更远的顶点
     * 残留在缓冲里。当本帧线段数变少时，长尾区域会画出**上一帧的幽灵几何**。
     * 残留顶点的 alpha 是上一帧的旧值（含非零），所以表现为逐帧闪现的白斑。
     *
     * 归零后：任何被本次 `begin()` 之后重新写过的顶点才可能可见；
     * 未被重写的残留顶点 alpha=0，即使位置还在也被着色器丢弃。
     * 代价是每帧一次 `fill()`（384*6=2304 个 float），远小于一次上传开销。
     */
    this.alphas.fill(0)
  }

  /**
   * 带拖尾的行进线（v1.3.85 新增）。
   *
   * 结构：沿 A→B 方向切成 4 个等长台阶（每段 `seg = len/4`），
   * 宽度权重走 `1 → 1 → 1 → 0`，即**主体等宽、末端一格拉成锥尖**。
   * 相比 `segment()` 的「一根等宽棍子」，多了方向感和消隐感 —— 这是
   * 现实中「瞄准辅助线」的常见画法（激光笔/激光瞄准器的尾迹）。
   *
   * 语义澄清（踩过坑）：
   * 这里**不需要**横向前 4 格铺 `[0,1,1,1]`，因为 `half` 已经就是半宽。
   * 宽度权重 `W[u] * half` 的自然取值就是 `(1,1,1,1,0)` —— 4 格满宽 + 收尖。
   *
   * 此前误把 `W` 写成 `(0,1,2,3,4)*half`（即 `(0,1,1,1,1)` 的错解），
   * 会让 u=0 那格宽度为 0（起点处塌成一点），同时整体宽度变成 0~1 格
   * 而不是 ±half，得到一堆**朝不同方向的白色尖楔** —— 就是画面上
   * 围绕白球的那几片"白色花瓣"。修复见下方 `const k = half`。
   */
  trace(ax: number, ay: number, bx: number, by: number, half: number) {
    const dx = bx - ax
    const dy = by - ay
    const len = Math.sqrt(dx * dx + dy * dy)
    if (len < 1e-6) return
    const ux = dx / len
    const uy = dy / len
    const seg = len / 4
    // 横向单位法线（已含半宽，直接乘权重即可）
    const nx = -uy * half
    const ny = ux * half
    const p = this.positions
    const a = this.alphas
    for (let u = 0; u < 4; u++) {
      if (this.quads >= MAX_QUADS) {
        this.overflowed++
        return
      }
      // 宽度权重：u=0,1,2 满宽，u=3 收尖到 0
      const k0 = u === 0 || u === 4 ? half : half
      const k1 = u === 3 ? 0 : half
      const x0 = ax + ux * (u * seg)
      const y0 = ay + uy * (u * seg)
      const x1 = ax + ux * ((u + 1) * seg)
      const y1 = ay + uy * ((u + 1) * seg)
      const o = this.quads * FLOATS_PER_QUAD
      // 三角形 1：P0 / P1 / Q1
      p[o] = x0 + nx * (k0 / half)
      p[o + 1] = y0 + ny * (k0 / half)
      p[o + 2] = PLANE_Z
      p[o + 3] = x1 + nx * (k1 / half)
      p[o + 4] = y1 + ny * (k1 / half)
      p[o + 5] = PLANE_Z
      p[o + 6] = x1 - nx * (k1 / half)
      p[o + 7] = y1 - ny * (k1 / half)
      p[o + 8] = PLANE_Z
      // 三角形 2：P0 / Q1 / Q0
      p[o + 9] = x0 + nx * (k0 / half)
      p[o + 10] = y0 + ny * (k0 / half)
      p[o + 11] = PLANE_Z
      p[o + 12] = x1 - nx * (k1 / half)
      p[o + 13] = y1 - ny * (k1 / half)
      p[o + 14] = PLANE_Z
      p[o + 15] = x0 - nx * (k0 / half)
      p[o + 16] = y0 - ny * (k0 / half)
      p[o + 17] = PLANE_Z
      // alpha：满宽区实心，收尖段淡出
      const oa = this.quads * FLOATS_PER_QUAD_ALPHA
      const a0 = u === 3 ? 0.85 : 1
      const a1 = u === 3 ? 0 : 1
      a[oa] = a0
      a[oa + 1] = a1
      a[oa + 2] = a1
      a[oa + 3] = a0
      a[oa + 4] = a1
      a[oa + 5] = a0
      this.quads++
    }
  }

  /**
   * 定宽等宽段（v1.3.85 软边渐变）。
   *
   * 每个四边形横向拆成 3 个条带，alpha 走 `0 → 0.85 → 0.85 → 0`：
   * 两侧边缘完全透明、中间实心，视觉上从"刀切白纸片"变成"柔和光带"。
   */
  segment(ax: number, ay: number, bx: number, by: number, halfWidth: number) {
    const dx = bx - ax
    const dy = by - ay
    const len = Math.sqrt(dx * dx + dy * dy)
    if (len < 1e-6) return
    const nx = (-dy / len) * halfWidth
    const ny = (dx / len) * halfWidth
    const p = this.positions
    const a = this.alphas
    /** 横向归一化位置与对应 alpha */
    const W = [-1, -0.45, 0.45, 1]
    const A = [0, 0.85, 0.85, 0]
    const px = [ax + nx * W[0], ax + nx * W[1], ax + nx * W[2], ax + nx * W[3]]
    const py = [ay + ny * W[0], ay + ny * W[1], ay + ny * W[2], ay + ny * W[3]]
    const qx = [bx + nx * W[0], bx + nx * W[1], bx + nx * W[2], bx + nx * W[3]]
    const qy = [by + ny * W[0], by + ny * W[1], by + ny * W[2], by + ny * W[3]]
    for (let i = 0; i < 3; i++) {
      if (this.quads >= MAX_QUADS) {
        this.overflowed++
        break
      }
      const o = this.quads * FLOATS_PER_QUAD
      const oa = this.quads * FLOATS_PER_QUAD_ALPHA
      // 三角形 1: P[i] / P[i+1] / Q[i+1]
      p[o] = px[i]
      p[o + 1] = py[i]
      p[o + 2] = PLANE_Z
      p[o + 3] = px[i + 1]
      p[o + 4] = py[i + 1]
      p[o + 5] = PLANE_Z
      p[o + 6] = qx[i + 1]
      p[o + 7] = qy[i + 1]
      p[o + 8] = PLANE_Z
      a[oa] = A[i]
      a[oa + 1] = A[i + 1]
      a[oa + 2] = A[i + 1]
      // 三角形 2: P[i] / Q[i+1] / Q[i]
      p[o + 9] = px[i]
      p[o + 10] = py[i]
      p[o + 11] = PLANE_Z
      p[o + 12] = qx[i + 1]
      p[o + 13] = qy[i + 1]
      p[o + 14] = PLANE_Z
      p[o + 15] = qx[i]
      p[o + 16] = qy[i]
      p[o + 17] = PLANE_Z
      a[oa + 3] = A[i]
      a[oa + 4] = A[i + 1]
      a[oa + 5] = A[i]
      this.quads++
    }
  }

  end() {
    this.attribute.needsUpdate = true
    this.alphaAttr.needsUpdate = true
    this.mesh.geometry.setDrawRange(0, this.quads * 6)
    this.mesh.visible = this.quads > 0
  }

  hide() {
    this.quads = 0
    this.mesh.geometry.setDrawRange(0, 0)
    this.mesh.visible = false
  }
}

/** 射线沿途的截断结果 */
interface TraceResult {
  x: number
  y: number
  /** 命中的球（母球行进线用来确定目标球），没有则 null */
  ball: Ball | null
  /** 是否终止于球袋 */
  pocket: boolean
  /** 命中袋口时的「袋心」（用于在虚线尾端画一个指示点）。无袋口时为 null */
  pocketCenter: Vector3 | null
}

/**
 * v1.4.1：碰撞抛离（throw）—— 目标球被撞后的真实初始方向（模块级纯函数，
 * 便于 harness 与渲染层共用同一段公式，防止实现漂移）。
 *
 * 按**与物理完全同源**的公式重算（cueStrike 的出杆折减、cueToSpin 的
 * 打点→自旋映射、collisionthrow.ts 的动摩擦 μ(v) 与切向脉冲上限）：
 *
 *   1. 母球撞击瞬间平动 vel 与自旋 rvel（b 静止，无 b.rvel 项）；
 *   2. 接触点相对速度 vPoint = vel + (−R·ab)×rvel；
 *   3. 分解为法向 vRelN 与切向 vRelT，动摩擦 μ = 0.01 + 0.108·e^(−1.088·|vRelT|)；
 *   4. 切向脉冲 jt = min(μ·Jn, |vRelT|/7)（摩擦极限 / 粘着极限取小）；
 *   5. 目标球速度 = ab·Jn + t̂·jt（竖直分量物理里被压平，取水平方向）。
 *
 * 力度用瞄准面板当前的出杆速度 —— 与实际击球是**同一个值**（cue.strike
 * 直接读 aim.power），因此 μ 的速度依赖是准确的，不是估算。
 * 无力度信息或无切向相对速度时返回 null（不修正，画连心线）。
 */
export function computeThrowDeflect(
  aimDx: number,
  aimDy: number,
  ncx: number,
  ncy: number,
  offset: { x: number; y: number } | undefined,
  elevation: number,
  power: number | undefined,
  /** 母球 → ghost 球心距离（米）：撞击瞬间速度由此反推，不能省略 */
  cueToBall = 0
): { x: number; y: number } | null {
  if (!power || power <= 0) return null
  const ox = offset?.x ?? 0
  const oy = offset?.y ?? 0
  // 与 cueStrike 同源：出杆速度（打点折减）
  const v0 = power * (1 - 0.25 * (ox * ox + oy * oy))

  /**
   * 撞击瞬间速度（两段模型，与 constants 同源）：
   *   滑动段 减速 aSlide = muS·g（0.126×9.8 = 1.235 m/s²，实测吻合）
   *   滚动段 减速 aRoll  = mu·g/√2（与 powerphysics.aRoll 同源）
   * 滑动段长度 dSlide = v0²/(μs·g)·(1/3.5 − 1/24.5) = 0.245·v0²/aSlide。
   *
   * 实测校验（tools/harness/throwcheck.ts，母球距目标球 8R=0.262m）：
   *   出杆 30R/60R/95R/130R → 撞击速度 实测 0.696/1.763/2.960/4.119，
   *   本模型                →          0.682/1.760/2.959/4.116，误差 <2%。
   * 若不做这一步、直接拿出杆速度算，低速段（30R）会把 μ 算大 ~30%，
   * 预测偏角 3.86° vs 实测 1.75°（过修 2.1°）—— 正是首版公式的病灶。
   */
  const aSlide = muS * g
  const aRoll = (mu * g) / Math.SQRT2
  const d = Math.max(0.01, cueToBall)
  /**
   * 高低杆会改变滑动段长度：顶杆（oy>0）出杆时就带正向滚动自旋，几乎立刻
   * 转入纯滚动；低杆（oy<0）表面滑速可达 (1+2.5·|oy|)·v，滑动段显著延长
   * （powerphysics.ts 注：低杆滑速 1.55~2.125 倍，滑段 0.75~0.92m）。
   * 修正系数 = (1 − 2.5·oy)：顶杆 → 短，低杆 → 长。
   */
  const spinSlideFactor = Math.max(0.1, 1 - 2.5 * oy)
  const dSlide = (0.245 * v0 * v0 * spinSlideFactor) / aSlide
  let vi: number
  if (d <= dSlide) {
    // 撞击发生在滑动段内
    vi = Math.sqrt(Math.max(0.01, v0 * v0 - 2 * aSlide * d))
  } else {
    // 滑动段已结束（v = 5/7·v0），其后按滚动段减速
    const vEnd = (5 / 7) * v0
    vi = Math.sqrt(Math.max(0.01, vEnd * vEnd - 2 * aRoll * (d - dSlide)))
  }

  // 侧旋：撞击瞬间仍有衰减，用 (v0+vi)/2 代入 cueToSpin 与实测吻合（误差 <1.5%）
  const vSpin = (v0 + vi) / 2
  const velSpin = new Vector3(
    aimDx * vSpin * Math.cos(elevation),
    aimDy * vSpin * Math.cos(elevation),
    vSpin * Math.sin(elevation)
  )
  const rvel = cueToSpin(new Vector3(ox, oy, 0), velSpin, elevation).clone()

  /**
   * 叠加**滚动自旋**（出杆后台呢摩擦建立的绕横轴自旋）。
   *
   * 它不直接改变水平偏转方向，但会抬高接触点的相对速度 vRelMag →
   * 降低动摩擦 μ、并稀释切向脉冲的水平占比。漏掉这一项会把水平偏转
   * 整体算大（低速段尤其明显：30R 直球 3.86° vs 实测 1.75°）。
   *
   * ⚠️ 必须作为**完整 3D 自旋向量**参与下面的叉积，不能手工拆成
   * 「竖直分量」：只有在连心线 ∥ 行进方向（直球）时滚动自旋才纯竖直；
   * 有切角时它在接触点会产生**水平**分量，直接影响 throw 的大小。
   *
   * 大小按实测拟合（throwcheck.ts）：滑动段未完成 = 0.7·(d/dSlide)·vi/R，
   * 已进入纯滚动（d ≥ dSlide）= vi/R。
   */
  const progress = d / dSlide
  const omegaRoll = (progress >= 1 ? vi : 0.7 * progress * vi) / R
  rvel.addScaledVector(upCross(new Vector3(aimDx, 0, aimDy)), omegaRoll)

  const velI = new Vector3(
    aimDx * vi * Math.cos(elevation),
    aimDy * vi * Math.cos(elevation),
    vi * Math.sin(elevation)
  )

  // 连心线与接触点相对速度（collisionthrow.ts 同构，b 静止）
  const ab = new Vector3(ncx, ncy, 0)
  const vPoint = velI.clone().add(ab.clone().multiplyScalar(-R).cross(rvel))

  const vRelN = ab.dot(vPoint)
  if (vRelN <= 0) return null
  const vRelT = vPoint.clone().addScaledVector(ab, -vRelN)
  const vRelMag = vRelT.length()
  if (vRelMag < 1e-8) return null
  // 动摩擦与脉冲上限（单位质量归一，m 在冲量/速度换算中消去）
  const muEff = 0.01 + 0.108 * Math.exp(-1.088 * vRelMag)
  const jn = 0.9625 * vRelN // e = 0.925
  const jt = Math.min(muEff * jn, vRelMag / 7)
  // 切向脉冲沿 3D 切向方向；物理里 b.vel.z 被压平，故只取水平分量
  const vB = ab
    .clone()
    .multiplyScalar(jn)
    .addScaledVector(vRelT.normalize(), jt)
  const len = Math.hypot(vB.x, vB.y)
  if (len < 1e-9) return null
  return { x: vB.x / len, y: vB.y / len }
}

export class AimLine {
  /** 加入场景的根节点 */
  readonly group = new Group()
  private readonly solid = new Ribbon(0.6)
  private readonly dashed = new Ribbon(0.5)
  /**
   * v1.3.94（顶杆 / 母球走位预测）：青色「母球预测线」。
   *
   * 实线画「母球→碰撞接触点」，虚线画「接触点→袋心」；但这两条都只描述
   * **目标球**的命运。高低杆(顶/缩)会显著改变**母球**撞后去向，而原辅助线
   * 完全不反映 —— 玩家打了跟杆却看不到母球会滚去哪。这里补一条青色虚线：
   * 从幽灵球(母球接触瞬间位置)出发，沿「自然切线分离 + 高低杆前/后分量」
   * 预测的方向延伸，长度随切球厚薄与打点变化，直观给出母球落点。
   */
  private readonly cuePred = new Ribbon(0.5, 0x35d0ff)
  private readonly trace: TraceResult = {
    x: 0,
    y: 0,
    ball: null,
    pocket: false,
    pocketCenter: null,
  }

  constructor() {
    this.group.name = "AimLine"
    this.group.add(this.solid.mesh)
    this.group.add(this.dashed.mesh)
    this.group.add(this.cuePred.mesh)
    this.group.renderOrder = 6
  }

  hide() {
    this.solid.hide()
    this.dashed.hide()
    this.cuePred.hide()
  }

  /**
   * 重建两段辅助线。
   *
   * @param table     当前牌桌（读母球、在台球、袋口）
   * @param angle     当前瞄准角（弧度）
   * @param maxLen    无袋口可指时线条的最大长度（米）
   * @param offset    v1.3.93：当前打点（x=左右塞，y=高低杆），缺省视作中杆
   * @param elevation v1.3.93：抬杆角（弧度），缺省视作平杆
   */
  update(
    table: Table,
    angle: number,
    maxLen: number,
    offset?: { x: number; y: number },
    elevation = 0,
    power?: number
  ) {
    const cueball = table.cueball
    if (!cueball || !cueball.onTable()) {
      this.hide()
      return
    }
    const dx = Math.cos(angle)
    const dy = Math.sin(angle)
    const ox = cueball.pos.x
    const oy = cueball.pos.y
    const half = LINE_WIDTH / 2

    /**
     * v1.3.93：抬杆导致的有效射程衰减。
     *
     * `cueStrike` 里水平初速是 `speed * cos(elevation)` —— 抬得越陡，白球在
     * 台面上跑得越近（那部分能量转成了回旋/扎杆效应）。原先辅助线不建模这一项，
     * 抬杆时线画到哪儿、球却停得更早，看着就是「线不准」。
     *
     * 这里不重跑物理，只做**射程缩放**：用 cos(θ) 缩放「母球行进线」的长度。
     * 方向不受影响（抬杆不改变水平方向），所以线仍然指向正确的目标，
     * 只是长度变短 —— 这恰好把「抬杆后打不了那么远」如实画出来了。
     */
    const rangeScale =
      elevation > 1e-4 ? Math.max(0.35, Math.cos(elevation)) : 1

    /**
     * v1.3.93：侧旋（左右塞）对母球撞库反弹角的偏转量。
     *
     * 物理侧（physics.ts 的 `bounceHanBlend`）在球撞库时会把「平动反弹方向」
     * 与「旋转带来的切向分量」做混合，所以加塞后反弹角相对理想镜面反射会偏。
     * 偏转方向取决于塞的符号与撞的是哪条库。
     *
     * 修正幅度用 R 作尺度、按塞量线性缩放，系数 1.35 是让「满塞 + 正向撞库」
     * 大约偏 5~7° 的量级 —— 与真实台球里「塞对反弹角的影响」感知一致，
     * 不至于夸张到把线甩到另一条库上。
     *
     * 注意：这个修正**只作用于撞库分支的反射方向**。撞球分支（母球击中
     * 目标球）的分离角主要由切角决定、受塞影响小得多，不做修正以免过度拟合。
     */
    const sideSpin = offset?.x ?? 0

    // ---- ① 母球行进线：球心 → 首个碰撞点（球 / 库边 / 袋口） ----
    const effectiveMaxLen = maxLen === Infinity ? maxLen : maxLen * rangeScale
    this.rayTrace(ox, oy, dx, dy, table.balls, cueball, null, effectiveMaxLen)
    const hitBall = this.trace.ball
    let ghostX = this.trace.x
    let ghostY = this.trace.y

    // 抬杆时把「未撞到球」的落点沿瞄准线收近，如实反映射程衰减
    if (!hitBall && rangeScale < 1) {
      const fullLen = Math.hypot(ghostX - ox, ghostY - oy)
      const shrunk = fullLen * rangeScale
      ghostX = ox + dx * shrunk
      ghostY = oy + dy * shrunk
    }

    // 撞库反射修正：仅当 terminate 在库边（既没撞球也没落袋）时生效
    if (!hitBall && !this.trace.pocket && Math.abs(sideSpin) > 1e-3) {
      const bdx = ghostX - ox
      const bdy = ghostY - oy
      const blen = Math.hypot(bdx, bdy)
      if (blen > 1e-6) {
        // 判断撞的是哪一组库：比较 |x| 与 |y| 更接近边界的一侧
        const onLongRail =
          Math.abs(Math.abs(ghostX) - TableGeometry.tableX) <
          Math.abs(Math.abs(ghostY) - TableGeometry.tableY)
        const spinSign = Math.sign(sideSpin)
        // 长库（x = ±tableX）：法线沿 x，塞把它推向 y，偏转角符号随库侧翻转
        // 短库（y = ±tableY）：法线沿 y，塞把它推向 x
        const rot = onLongRail ? spinSign * Math.sign(ghostX || 1) : -spinSign * Math.sign(ghostY || 1)
        const deflect = rot * sideSpin * 1.35 * R
        // 在落点处把方向转一个小角度，落点随之侧移
        const s = Math.sin(deflect)
        const c = Math.cos(deflect)
        const nx2 = bdx * c - bdy * s
        const ny2 = bdx * s + bdy * c
        ghostX = ox + nx2
        ghostY = oy + ny2
      }
    }

    this.solid.begin()
    this.dashed.begin()
    this.cuePred.begin()

    if (!hitBall) {
      // 前方没有球：只画母球自己的行进线，方便看走位与贴库
      this.solid.trace(ox, oy, ghostX, ghostY, half)
      this.solid.end()
      this.dashed.end()
      this.cuePred.end()
      return
    }

    // 目标球被撞后的行进方向 = 幽灵球球心 → 目标球球心
    let tx = hitBall.pos.x - ghostX
    let ty = hitBall.pos.y - ghostY
    const tlen = Math.sqrt(tx * tx + ty * ty)
    if (tlen < 1e-6) {
      this.solid.trace(ox, oy, ghostX, ghostY, half)
      this.solid.end()
      this.dashed.end()
      this.cuePred.end()
      return
    }
    tx /= tlen
    ty /= tlen

    // v1.4.1：碰撞抛离（throw）修正。
    //
    // 物理侧 collisionthrow.ts 会在两球碰撞时施加**切向摩擦脉冲**：母球带
    // 侧旋（绕竖轴自旋在接触点产生纯切向表面速度）、或薄切时母球平动自身
    // 的切向分量，都会把目标球往接触点相对滑动的方向「带偏」θ ≈ μ（弧度，
    // 低速满塞可达 3~5°）—— 1 米行程偏 3~9cm，足以打丢袋口球。此前辅助线
    // 永远画纯连心线方向，玩家加塞/薄切瞄准时「线指着袋口、球却偏出去」，
    // 即用户反馈的「瞄准线歪」，且因高低杆/加塞是常用杆法而稳定复现。
    //
    // 修正只作用于**虚线的目标球初始方向**；接触几何（ghost 球、接触点）
    // 与母球分离预测线仍按连心线（throw 对母球分离方向影响小）。
    // 末参 = 母球→ghost 距离：撞击瞬间的速度与自旋衰减都依赖它。
    const cueToGhost = Math.hypot(ghostX - ox, ghostY - oy)
    const thrown = computeThrowDeflect(
      dx,
      dy,
      tx,
      ty,
      offset,
      elevation,
      power,
      cueToGhost
    )
    const ballDirX = thrown ? thrown.x : tx
    const ballDirY = thrown ? thrown.y : ty

    // 真正的两球表面接触点：幽灵球球心沿目标方向前进 R
    const contactX = ghostX + tx * R
    const contactY = ghostY + ty * R

    // 实线：母球球心 → 碰撞接触点（带拖尾）
    this.solid.trace(ox, oy, contactX, contactY, half)
    // 幽灵球圆环：撞击瞬间母球所在的位置
    this.ring(ghostX, ghostY, R, half * 0.72)
    this.solid.end()

    // v1.3.94（顶杆 / 母球走位预测）：青色母球预测线。
    // 从幽灵球(母球接触瞬间位置)出发，沿「自然切线分离 + 高低杆前/后分量」
    // 预测方向延伸，长度随切球厚薄与打点变化，直观给出母球落点。
    const incDotN = dx * tx + dy * ty // 入射沿连心线分量(≥0：母球朝目标)
    const lvX = dx - incDotN * tx // 自然切线分离方向(无自旋母球去向)
    const lvY = dy - incDotN * ty
    const lvMag = Math.hypot(lvX, lvY)
    const fwd = offset?.y ?? 0 // 高低杆：顶杆>0 / 缩杆<0
    // 预测方向 = 自然切线 + 沿连心线的高低杆分量（顶杆前向、缩杆后向）
    let pdx = lvX + tx * fwd
    let pdy = lvY + ty * fwd
    const pdMag = Math.hypot(pdx, pdy)
    if (pdMag > 1e-6) {
      pdx /= pdMag
      pdy /= pdMag
    }
    // 预测行程：切球越薄自然走得越远；高低杆再增减。封顶 maxLen 防溢出。
    const travel = Math.min(maxLen, lvMag * CUE_TRAVEL_BASE + Math.abs(fwd) * CUE_TRAVEL_SPIN)
    if (travel > 0.05 && pdMag > 1e-6) {
      this.dashSegment(this.cuePred, ghostX, ghostY, ghostX + pdx * travel, ghostY + pdy * travel, half)
    }

    // ---- ② 虚线：碰撞接触点 → 球袋入袋交点 ----
    // 注意：trace.x / trace.y 现在是「轨迹与袋口圆周的入袋交点」，
    // 而不是袋心。这样在袋口探测锥内微调角度时，交点会沿袋口圆周移动，
    // 虚线终点跟着动，玩家能直观看到角度变化带来的差异。
    this.rayTrace(
      hitBall.pos.x,
      hitBall.pos.y,
      ballDirX,
      ballDirY,
      table.balls,
      cueball,
      hitBall,
      maxLen
    )
    // v1.1.8：辅助线长度档位（targetLineLength）同时约束虚线预测段的延伸长度，
    // 让 1~5 档在「前方有球 / 袋」的常见瞄准场景下也明显可见地改变线长。
    // 实线段（母球→碰撞点）保留几何准确性，虚线段按 maxLen 截断。
    let dashX = this.trace.x
    let dashY = this.trace.y
    const ddx = dashX - contactX
    const ddy = dashY - contactY
    const dlen = Math.sqrt(ddx * ddx + ddy * ddy)
    const capped = dlen > maxLen && dlen > 1e-6
    if (capped) {
      const k = maxLen / dlen
      dashX = contactX + ddx * k
      dashY = contactY + ddy * k
    }
    this.dashSegment(this.dashed, contactX, contactY, dashX, dashY, half)
    // 仅当虚线真正抵达袋口时才画目标点指示圈
    if (this.trace.pocketCenter && !capped) {
      this.ring(
        this.trace.pocketCenter.x,
        this.trace.pocketCenter.y,
        R * 0.55,
        half * 0.6
      )
    }
    this.solid.end()
    this.dashed.end()
    this.cuePred.end()
  }

  /**
   * 画一段虚线（等长实虚交替，贴台面）。
   *
   * v1.3.93：改为「按整段时长均分」而非「按固定步长累加」。
   *
   * 原实现是 `for (s = 0; s < total; s += stride) { e = min(s + DASH_LEN, total) }`。
   * 问题出在最后一段：当 `s` 恰好落在 `total - DASH_LEN` 与 `total` 之间时，
   * `e = total` 会让末段**长于标准 DASH_LEN**；而 `total` 随瞄准角连续变化，
   * 所以玩家微调角度时，末段长度会在「标准长」与「被截断的短段」之间来回跳 ——
   * 观感就是虚线末端在抖，用户报的「辅助线概率性出错」有一部分来自这里。
   *
   * 修法：先按标准 stride 算出需要几段（`n`），再令每段长度恰为
   * `total / n`，相邻段之间按比例留出间隔。这样：
   *   - 段数随 total 阶跃变化（不可避免），但**每段长度始终一致**，
   *     不会出现一根突兀的长段或短段；
   *   - total 变化时整条虚线是「均匀地伸/缩」，视觉上连续。
   */
  private dashSegment(
    ribbon: Ribbon,
    ax: number,
    ay: number,
    bx: number,
    by: number,
    halfWidth: number
  ) {
    const dx = bx - ax
    const dy = by - ay
    const total = Math.sqrt(dx * dx + dy * dy)
    if (total < 1e-5) return
    const ux = dx / total
    const uy = dy / total
    const stride = DASH_LEN + DASH_GAP
    // 段数：至少 1 段；用 floor 保证每段不短于标准 DASH_LEN 的视觉密度
    const n = Math.max(1, Math.floor(total / stride) || 1)
    const pitch = total / n
    // 实线部分占 pitch 的比例（用标准 DASH_LEN/stride 推，保证观感一致）
    const duty = DASH_LEN / stride
    const segLen = pitch * duty
    for (let i = 0; i < n; i++) {
      const s = i * pitch
      const e = s + segLen
      ribbon.segment(
        ax + ux * s,
        ay + uy * s,
        ax + ux * e,
        ay + uy * e,
        halfWidth
      )
    }
  }

  /** 幽灵球圆环（细线圆），加到实线 ribbon 上 */
  private ring(cx: number, cy: number, radius: number, halfWidth: number) {
    let px = cx + radius
    let py = cy
    for (let i = 1; i <= RING_SEGMENTS; i++) {
      const a = (i / RING_SEGMENTS) * Math.PI * 2
      const nx = cx + Math.cos(a) * radius
      const ny = cy + Math.sin(a) * radius
      this.solid.segment(px, py, nx, ny, halfWidth)
      px = nx
      py = ny
    }
  }

  /**
   * 沿射线求第一处终止点，结果写入 this.trace（避免每帧分配对象）。
   *
   * 优先级：撞球 > 落袋 > 撞库 > 长度上限。
   * 落袋判定复用游戏本身的规则（球心进入袋口半径即落袋），
   * 因为袋口中心位于库边线之外，允许它「越过」库边截断，
   * 但要求越过的距离很小，避免贴库球误判成能吃袋。
   */
  private rayTrace(
    ox: number,
    oy: number,
    dx: number,
    dy: number,
    balls: Ball[],
    cueball: Ball,
    self: Ball | null,
    maxLen: number
  ) {
    const t = this.trace
    t.ball = null
    t.pocket = false
    t.pocketCenter = null

    // --- 撞球 ---
    let tBall = Infinity
    let hit: Ball | null = null
    const diameterSq = 4 * R * R
    for (const ball of balls) {
      if (ball === self || ball === cueball) continue
      if (!ball.onTable()) continue
      const rx = ball.pos.x - ox
      const ry = ball.pos.y - oy
      const along = rx * dx + ry * dy
      if (along <= 0) continue
      const perpSq = rx * rx + ry * ry - along * along
      if (perpSq >= diameterSq) continue
      const d = along - Math.sqrt(diameterSq - perpSq)
      if (d > 1e-6 && d < tBall) {
        tBall = d
        hit = ball
      }
    }

    // --- 撞库（球心可达范围 |x|<=tableX, |y|<=tableY） ---
    let tCushion = Infinity
    if (dx > 1e-9) tCushion = Math.min(tCushion, (TableGeometry.tableX - ox) / dx)
    else if (dx < -1e-9)
      tCushion = Math.min(tCushion, (-TableGeometry.tableX - ox) / dx)
    if (dy > 1e-9) tCushion = Math.min(tCushion, (TableGeometry.tableY - oy) / dy)
    else if (dy < -1e-9)
      tCushion = Math.min(tCushion, (-TableGeometry.tableY - oy) / dy)
    if (tCushion < 0) tCushion = 0

    // --- 落袋 ---
    let tPocket = Infinity
    let pocketPos: Vector3 | null = null
    if (TableGeometry.hasPockets) {
      for (const p of PocketGeometry.pocketCenters) {
        const rx = p.pos.x - ox
        const ry = p.pos.y - oy
        const along = rx * dx + ry * dy
        if (along <= 0) continue
        const perpSq = rx * rx + ry * ry - along * along
        if (perpSq > p.radius * p.radius) continue
        // 袋口中心在库边线之外，只允许小幅越界，否则是被库边挡住的假命中
        if (along > tCushion + 4 * R) continue
        // 入袋交点 = 射线与袋口圆周的最先相交处 = along - sqrt(r² - perp²)
        // 这才是「球实际落到袋口那一瞬间」的位置；用它做虚线终点，
        // 微调角度时交点会沿袋口圆周移动，视觉上虚线跟着动。
        const entryAlong = along - Math.sqrt(p.radius * p.radius - perpSq)
        if (entryAlong < tPocket) {
          tPocket = entryAlong
          pocketPos = p.pos
        }
      }
    }

    if (hit && tBall <= Math.min(tPocket, tCushion)) {
      t.ball = hit
      t.x = ox + dx * tBall
      t.y = oy + dy * tBall
      t.pocketCenter = null
      return
    }
    if (pocketPos && tPocket <= tBall) {
      t.pocket = true
      t.x = ox + dx * tPocket
      t.y = oy + dy * tPocket
      t.pocketCenter = pocketPos
      return
    }
    const limit = Math.min(tCushion, Math.max(maxLen, 0.05))
    t.x = ox + dx * limit
    t.y = oy + dy * limit
    t.pocketCenter = null
  }
}
