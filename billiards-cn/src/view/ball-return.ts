import { Group, Mesh, Scene, Vector3 } from "three"
import { State } from "../model/ball"
import { R } from "../model/physics/constants"
import { PocketGeometry } from "./pocketgeometry"

/**
 * v1.8.3：落袋回球 —— 只走写实桌**模型自带**的金色通道与端部集球槽。
 *
 * 与 v1.8.2 的差别（用户反馈驱动）：
 *  1. 删掉 v1.8.2 自建的「侧裙外 U 形槽 + 自造集球盘」——那两块几何是外挂的，
 *     和模型风格不搭，且把桌腿挡住。现在**一颗新几何都不加**。
 *  2. 不再让所有球从同一个入口出发。v1.8.2 统一从 `X_START=1.44`（近侧长边
 *     右端）出发，导致中袋球也「瞬移到底袋入口」。现在每个球从**自己落袋的
 *     那个袋口正下方**开始，沿所在长边的金色框架滚向 −x 端。
 *  3. 集球槽里不再用固定网格槽位（那会把球整齐堆在一角）。改成 2D 刚体
 *     近似：入槽初速 + 摩擦 + 壁面反弹 + 球间分离，球按顺序自然铺开。
 *
 * 模型实测（tools/render/probe-v183-measure.js）：
 *  - 6 个网兜底 z ≈ −0.202 ~ −0.210，中心与物理袋口重合；
 *  - 两条长边的金色框架在 y ≈ ±0.786，z ∈ [−0.42, −0.198]；
 *  - −x 端有一块 z ≈ −0.453 的底板，x ∈ [−1.51, −1.30]，y ∈ [−0.65, 0.65]
 *    —— 这就是模型自带的集球槽，球最后停在它上面。
 *
 * 仍然是纯视觉代理球：`BallMesh` 在 `State.InPocket` 时隐藏原 mesh，
 * 这里另建同 geometry/material 的代理球沿路径走；物理、碰撞、规则、
 * 回放时间轴零改动。
 */

/** 网兜底部高度（球心贴网底时取 −0.205 + R） */
const NET_BOTTOM_Z = -0.205
/** 长边金色框架内的滑行高度（框架顶 −0.198、底 −0.42，取中段） */
const RAIL_Z = -0.295
/** 集球槽底板 */
const TRAY_FLOOR_Z = -0.453
const TRAY_Z = TRAY_FLOOR_Z + R
/** 长边滑行所在的 y（框架内侧，避开 y=±0.786 的杆件） */
const RAIL_Y = 0.715
/** 转向集球槽的 x */
const X_TURN = -1.335
/**
 * 集球槽是模型端头的**弧形**凹槽（实测：y=0 处 x 中心 ≈ −1.353，
 * y=±0.65 处 ≈ −1.466）。球心沿这条曲线排布才贴合，不会像平铺在直线上。
 */
const TRAY_Y_LIM = 0.635 - R
const TRAY_ARC_HALF_W = 0.048
const TRAY_ENTRY_X = -1.43
const TRAY_ENTRY_Y = 0.50

/** 各段时长/速度 */
const T_DROP = 0.16
const T_RAIL_ENTER = 0.16
const V_RAIL = 1.15
const T_TURN = 0.22
const T_STAGGER = 0.11
/** 槽内摩擦系数与静止阈值 */
const TRAY_DAMP = 2.1
const TRAY_STOP = 0.03

interface TrayBody {
  x: number
  y: number
  vx: number
  vy: number
}

interface ReturnAnim {
  ball: any
  mesh: Mesh
  /** 袋口（模型里球落袋的位置） */
  pocket: Vector3
  /** 所在长边：+1 上边 / −1 下边 */
  side: number
  /** 折线路径（袋口 → 网兜底 → 框架 → 转向点 → 槽口） */
  pts: Vector3[]
  /** 每段时长 */
  durs: number[]
  /** 每段累计起始时间 */
  starts: number[]
  total: number
  delay: number
  t: number
  prev: Vector3
  phase: "route" | "tray"
  body: TrayBody | null
  done: boolean
}

function easeIn(u: number): number {
  return u * u
}

function easeOut(u: number): number {
  return 1 - (1 - u) * (1 - u)
}

export class BallReturn {
  readonly group = new Group()
  private readonly anims = new Map<any, ReturnAnim>()
  private readonly upAxis = new Vector3(0, 0, 1)
  private readonly tmpDir = new Vector3()
  private readonly tmpAxis = new Vector3()

  constructor(scene: Scene) {
    this.group.name = "BallReturn"
    const old = scene.getObjectByName("BallReturn")
    if (old) scene.remove(old)
    scene.add(this.group)
  }

  /** 找球落袋的那个袋口（优先用物理 Pocket 引用，其次按位置就近匹配） */
  private pocketOf(ball: any): Vector3 {
    const p = ball.pocket?.pos
    if (p && Number.isFinite(p.x) && Number.isFinite(p.y)) {
      return new Vector3(p.x, p.y, 0)
    }
    let best = PocketGeometry.pocketCenters[0].pos
    let bestD = Infinity
    for (const c of PocketGeometry.pocketCenters) {
      const d = (c.pos.x - ball.pos.x) ** 2 + (c.pos.y - ball.pos.y) ** 2
      if (d < bestD) {
        bestD = d
        best = c.pos
      }
    }
    return new Vector3(best.x, best.y, 0)
  }

  /** 按落袋袋口生成专属路径（中袋与底袋各走各的，不共用入口） */
  private buildRoute(pocket: Vector3): { pts: Vector3[]; durs: number[] } {
    const side = pocket.y >= 0 ? 1 : -1
    // 网兜底：袋口正下方，略向桌心收一点（网兜是锥形）
    const netBottom = new Vector3(
      pocket.x * 0.985,
      pocket.y - side * 0.02,
      NET_BOTTOM_Z + R
    )
    // 落到长边框架：只有 y 方向平移（中袋横向挪 0.05，角袋几乎不动）
    const railStart = new Vector3(pocket.x, side * RAIL_Y, RAIL_Z)
    // 沿长边滚到 −x 端
    const railEnd = new Vector3(X_TURN, side * RAIL_Y, RAIL_Z)
    // 转向集球槽入口
    const trayEntry = new Vector3(TRAY_ENTRY_X, side * TRAY_ENTRY_Y, TRAY_Z + 0.012)

    const pts = [pocket.clone(), netBottom, railStart, railEnd, trayEntry]
    const railLen = Math.abs(railStart.x - railEnd.x)
    const durs = [
      T_DROP,
      T_RAIL_ENTER,
      Math.max(0.35, railLen / V_RAIL),
      T_TURN,
    ]
    return { pts, durs }
  }

  private register(ball: any) {
    const src: Mesh | undefined = ball.ballmesh?.mesh
    if (!src) return
    const mesh = new Mesh(src.geometry, src.material)
    mesh.name = `ReturnBall_${ball.label ?? "cue"}`
    mesh.quaternion.copy(src.quaternion)
    mesh.visible = false
    this.group.add(mesh)

    const pocket = this.pocketOf(ball)
    const { pts, durs } = this.buildRoute(pocket)

    const starts: number[] = []
    let acc = 0
    for (const d of durs) {
      starts.push(acc)
      acc += d
    }

    this.anims.set(ball, {
      ball,
      mesh,
      pocket,
      side: pocket.y >= 0 ? 1 : -1,
      pts,
      durs,
      starts,
      total: acc,
      // 按登记顺序轻微错开，避免多球完全重叠进入同一段
      delay: this.anims.size * T_STAGGER,
      t: 0,
      prev: pocket.clone(),
      phase: "route",
      body: null,
      done: false,
    })
  }

  /** 折线路径在时间 t 的位置 */
  private routePos(a: ReturnAnim, t: number, out: Vector3): void {
    let i = 0
    while (i < a.durs.length - 1 && t > a.starts[i] + a.durs[i]) i++
    const u = Math.min(1, Math.max(0, (t - a.starts[i]) / a.durs[i]))
    // 掉进网兜与从网兜落到框架：加速下落；沿长边匀速；转向入槽减速
    const k = i === 0 || i === 1 ? easeIn(u) : i === 3 ? easeOut(u) : u
    out.copy(a.pts[i]).lerp(a.pts[i + 1], k)
  }

  private removeAnim(ball: any, a: ReturnAnim) {
    this.group.remove(a.mesh)
    this.anims.delete(ball)
  }

  private clearAll() {
    for (const a of this.anims.values()) this.group.remove(a.mesh)
    this.anims.clear()
  }

  /**
   * 集球槽内的 2D 刚体近似：摩擦 + 壁面反弹 + 球间分离。
   * 不用固定槽位，球按进槽顺序自然铺开，不会整齐堆在一角。
   */
  /** −x 端集球槽的 x 中心：中间靠 +x、两端靠 −x，贴合模型弧形端头 */
  private trayCenterX(y: number): number {
    const t = Math.min(1, Math.abs(y) / 0.62)
    return -1.352 - 0.105 * t * t
  }

  private stepTray(dt: number): boolean {
    const list: Array<[any, TrayBody]> = []
    for (const a of this.anims.values()) {
      if (a.body) list.push([a.ball, a.body])
    }
    if (!list.length) return false

    // 1) 积分 + 摩擦
    for (const [, b] of list) {
      b.x += b.vx * dt
      b.y += b.vy * dt
      const damp = Math.exp(-TRAY_DAMP * dt)
      b.vx *= damp
      b.vy *= damp
      if (Math.hypot(b.vx, b.vy) < TRAY_STOP) {
        b.vx = 0
        b.vy = 0
      }
    }

    // 2) 壁面（槽是窄长条：x 方向只有 0.19m，y 方向 1.26m）
    for (const [, b] of list) {
      const cx = this.trayCenterX(b.y)
      if (b.x < cx - TRAY_ARC_HALF_W) {
        b.x = cx - TRAY_ARC_HALF_W
        b.vx = Math.abs(b.vx) * 0.35
      } else if (b.x > cx + TRAY_ARC_HALF_W) {
        b.x = cx + TRAY_ARC_HALF_W
        b.vx = -Math.abs(b.vx) * 0.35
      }
      if (b.y < -TRAY_Y_LIM) {
        b.y = -TRAY_Y_LIM
        b.vy = Math.abs(b.vy) * 0.35
      } else if (b.y > TRAY_Y_LIM) {
        b.y = TRAY_Y_LIM
        b.vy = -Math.abs(b.vy) * 0.35
      }
    }

    // 3) 球间分离（迭代到收敛，保证多球挤压时也能推开）
    const minD = 2 * R
    let overlapping = false
    for (let iter = 0; iter < 8; iter++) {
      let moved = false
      for (let i = 0; i < list.length; i++) {
        for (let j = i + 1; j < list.length; j++) {
          const A = list[i][1]
          const B = list[j][1]
          let dx = B.x - A.x
          let dy = B.y - A.y
          let d = Math.hypot(dx, dy)
          if (d >= minD - 1e-4) continue
          if (d < 1e-6) {
            dx = 1
            dy = 0
            d = 1
          }
          const nx = dx / d
          const ny = dy / d
          const push = (minD - d) / 2 + 1e-4
          A.x -= nx * push
          A.y -= ny * push
          B.x += nx * push
          B.y += ny * push
          // 沿法线交换速度分量（等质量弹性碰撞的简化）
          const rel = (B.vx - A.vx) * nx + (B.vy - A.vy) * ny
          if (rel < 0) {
            const imp = rel * 0.5
            A.vx += nx * imp
            A.vy += ny * imp
            B.vx -= nx * imp
            B.vy -= ny * imp
          }
          moved = true
          overlapping = true
        }
      }
      // 每轮分离后重新夹回槽壁，避免球被推出槽外
      for (const [, b] of list) {
        b.y = Math.min(TRAY_Y_LIM, Math.max(-TRAY_Y_LIM, b.y))
        const cx2 = this.trayCenterX(b.y)
        b.x = Math.min(cx2 + TRAY_ARC_HALF_W, Math.max(cx2 - TRAY_ARC_HALF_W, b.x))
      }
      if (!moved) break
    }
    return overlapping
  }

  /**
   * 每帧驱动（挂在 Container 的 frame hook 上）。
   * 返回 true 表示还有球在动 —— 调用方据此续 lastEventTime，
   * 否则球全静止 60s 后容器会停 render，动画被冻住。
   */
  update(dt: number, balls: any[], replayMode: boolean): boolean {
    // 回放 seek 会把球直接置成 InPocket 且不产生 outcome，会冒幽灵球：跳过
    if (replayMode) {
      if (this.anims.size) this.clearAll()
      return false
    }

    // 复位自愈：球被重新摆回台面（respot / 新一局 / updateFromShortSerialised）
    for (const [ball, a] of this.anims) {
      if (ball.state !== State.InPocket) this.removeAnim(ball, a)
    }
    for (const ball of balls) {
      if (ball.state === State.InPocket && !this.anims.has(ball)) this.register(ball)
    }

    let active = false
    const pos = new Vector3()

    for (const a of this.anims.values()) {
      a.t += dt
      const t = a.t - a.delay
      if (t <= 0) {
        a.mesh.visible = false
        active = true
        continue
      }
      a.mesh.visible = true

      if (a.phase === "route") {
        this.routePos(a, t, pos)
        // 滚动：路径段都带水平位移，按位移方向自转（掉进网兜那段也滚）
        this.tmpDir.subVectors(pos, a.prev)
        const ds = this.tmpDir.length()
        if (ds > 1e-6) {
          this.tmpDir.multiplyScalar(1 / ds)
          this.tmpAxis.copy(this.upAxis).cross(this.tmpDir)
          if (this.tmpAxis.lengthSq() > 1e-8) {
            this.tmpAxis.normalize()
            a.mesh.rotateOnWorldAxis(this.tmpAxis, ds / R)
          }
        }
        a.mesh.position.copy(pos)
        a.prev.copy(pos)

        if (t >= a.total) {
          // 入槽：给一个朝槽内、朝向对侧的速度，之后交给 2D 物理
          a.phase = "tray"
          // 按登记序号给不同初速：同一袋口连续落袋的球不会精确叠在一点
          const idx = Math.round(a.delay / T_STAGGER)
          a.body = {
            x: this.trayCenterX(a.side * TRAY_ENTRY_Y),
            y: a.side * TRAY_ENTRY_Y,
            vx: -0.12 - (idx % 3) * 0.05,
            vy: -a.side * (0.42 + idx * 0.07),
          }
          a.mesh.position.set(a.body.x, a.body.y, TRAY_Z)
          a.prev.copy(a.mesh.position)
        } else {
          active = true
        }
        continue
      }

      // 槽内：先积分再取位置（stepTray 统一推进所有球）
      active = true
    }

    // 槽内物理统一推进（所有 body 一起算，球间碰撞才正确）
    const stillOverlap = this.stepTray(dt)
    for (const a of this.anims.values()) {
      if (a.phase !== "tray") continue
      const b = a.body!
      // 位移自转
      this.tmpDir.set(b.x - a.prev.x, b.y - a.prev.y, 0)
      const ds = this.tmpDir.length()
      if (ds > 1e-6) {
        this.tmpDir.multiplyScalar(1 / ds)
        this.tmpAxis.copy(this.upAxis).cross(this.tmpDir)
        if (this.tmpAxis.lengthSq() > 1e-8) {
          this.tmpAxis.normalize()
          a.mesh.rotateOnWorldAxis(this.tmpAxis, ds / R)
        }
      }
      // 即使已停稳也要同步位置：分离约束可能仍在轻微推动它
      a.mesh.position.set(b.x, b.y, TRAY_Z)
      a.prev.set(b.x, b.y, TRAY_Z)
      if (b.vx !== 0 || b.vy !== 0 || stillOverlap) {
        active = true
      } else {
        a.done = true
      }
    }

    return active
  }
}
