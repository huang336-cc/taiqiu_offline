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

/** 单个 ribbon 最多容纳的四边形数量（每个四边形 = 2 三角形 = 6 顶点） */
const MAX_QUADS = 192
const FLOATS_PER_QUAD = 6 * 3

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
  private quads = 0

  constructor(opacity: number) {
    this.positions = new Float32Array(MAX_QUADS * FLOATS_PER_QUAD)
    this.attribute = new BufferAttribute(this.positions, 3)
    this.attribute.setUsage(DynamicDrawUsage)
    const geometry = new BufferGeometry()
    geometry.setAttribute("position", this.attribute)
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
    this.mesh = new Mesh(geometry, material)
    this.mesh.renderOrder = 6
    // 顶点每帧改写，包围盒不可靠，直接关掉视锥剔除
    this.mesh.frustumCulled = false
    this.mesh.visible = false
  }

  begin() {
    this.quads = 0
  }

  /** 追加一段贴台面的等宽线段 */
  segment(ax: number, ay: number, bx: number, by: number, halfWidth: number) {
    if (this.quads >= MAX_QUADS) return
    const dx = bx - ax
    const dy = by - ay
    const len = Math.sqrt(dx * dx + dy * dy)
    if (len < 1e-6) return
    const nx = (-dy / len) * halfWidth
    const ny = (dx / len) * halfWidth
    const p = this.positions
    let o = this.quads * FLOATS_PER_QUAD
    // 三角形 1
    p[o++] = ax - nx; p[o++] = ay - ny; p[o++] = PLANE_Z
    p[o++] = ax + nx; p[o++] = ay + ny; p[o++] = PLANE_Z
    p[o++] = bx + nx; p[o++] = by + ny; p[o++] = PLANE_Z
    // 三角形 2
    p[o++] = ax - nx; p[o++] = ay - ny; p[o++] = PLANE_Z
    p[o++] = bx + nx; p[o++] = by + ny; p[o++] = PLANE_Z
    p[o++] = bx - nx; p[o++] = by - ny; p[o++] = PLANE_Z
    this.quads++
  }

  end() {
    this.attribute.needsUpdate = true
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
      this.solid.segment(ox, oy, ghostX, ghostY, half)
      this.solid.end()
      this.dashed.end()
      return
    }

    // 目标球被撞后的行进方向 = 幽灵球球心 → 目标球球心
    let tx = hitBall.pos.x - ghostX
    let ty = hitBall.pos.y - ghostY
    const tlen = Math.sqrt(tx * tx + ty * ty)
    if (tlen < 1e-6) {
      this.solid.segment(ox, oy, ghostX, ghostY, half)
      this.solid.end()
      this.dashed.end()
      return
    }
    tx /= tlen
    ty /= tlen

    // 真正的两球表面接触点：幽灵球球心沿目标方向前进 R
    const contactX = ghostX + tx * R
    const contactY = ghostY + ty * R

    // 实线：母球球心 → 碰撞接触点
    this.solid.segment(ox, oy, contactX, contactY, half)
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
