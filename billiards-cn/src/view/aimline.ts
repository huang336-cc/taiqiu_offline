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
import { R } from "../model/physics/constants"
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
 */
const MAX_QUADS = 384
const FLOATS_PER_QUAD = 6 * 3
/** 每顶点额外带 1 个 alpha 分量（v1.3.85：软边渐变） */
const FLOATS_PER_QUAD_ALPHA = 6 * 1

/** 线宽（米）。球直径 2R≈65.5mm，7mm 的线既看得清又不糊住球 */
const LINE_WIDTH = 0.007
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

  constructor(opacity: number) {
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
      color: 0xffffff,
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
      if (this.quads >= MAX_QUADS) return
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
      if (this.quads >= MAX_QUADS) break
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

export class AimLine {
  /** 加入场景的根节点 */
  readonly group = new Group()
  private readonly solid = new Ribbon(0.6)
  private readonly dashed = new Ribbon(0.5)
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
    this.group.renderOrder = 6
  }

  hide() {
    this.solid.hide()
    this.dashed.hide()
  }

  /**
   * 重建两段辅助线。
   *
   * @param table    当前牌桌（读母球、在台球、袋口）
   * @param angle    当前瞄准角（弧度）
   * @param maxLen   无袋口可指时线条的最大长度（米）
   */
  update(table: Table, angle: number, maxLen: number) {
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

    // ---- ① 母球行进线：球心 → 首个碰撞点（球 / 库边 / 袋口） ----
    this.rayTrace(ox, oy, dx, dy, table.balls, cueball, null, maxLen)
    const hitBall = this.trace.ball
    const ghostX = this.trace.x
    const ghostY = this.trace.y

    this.solid.begin()
    this.dashed.begin()

    if (!hitBall) {
      // 前方没有球：只画母球自己的行进线，方便看走位与贴库
      this.solid.trace(ox, oy, ghostX, ghostY, half)
      this.solid.end()
      this.dashed.end()
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
      return
    }
    tx /= tlen
    ty /= tlen

    // 真正的两球表面接触点：幽灵球球心沿目标方向前进 R
    const contactX = ghostX + tx * R
    const contactY = ghostY + ty * R

    // 实线：母球球心 → 碰撞接触点（带拖尾）
    this.solid.trace(ox, oy, contactX, contactY, half)
    // 幽灵球圆环：撞击瞬间母球所在的位置
    this.ring(ghostX, ghostY, R, half * 0.72)
    this.solid.end()

    // ---- ② 虚线：碰撞接触点 → 球袋入袋交点 ----
    // 注意：trace.x / trace.y 现在是「轨迹与袋口圆周的入袋交点」，
    // 而不是袋心。这样在袋口探测锥内微调角度时，交点会沿袋口圆周移动，
    // 虚线终点跟着动，玩家能直观看到角度变化带来的差异。
    this.rayTrace(
      hitBall.pos.x,
      hitBall.pos.y,
      tx,
      ty,
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
    this.dashSegment(contactX, contactY, dashX, dashY, half)
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
  }

  /** 画一段虚线（等长实虚交替，贴台面） */
  private dashSegment(
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
    for (let s = 0; s < total; s += stride) {
      const e = Math.min(s + DASH_LEN, total)
      this.dashed.segment(
        ax + ux * s,
        ay + uy * s,
        ax + ux * e,
        ay + uy * e,
        halfWidth
      )
      if (e >= total) break
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
