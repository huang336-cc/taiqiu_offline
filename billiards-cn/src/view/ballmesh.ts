import {
  IcosahedronGeometry,
  Matrix4,
  Mesh,
  MeshPhongMaterial,
  CircleGeometry,
  MeshBasicMaterial,
  ArrowHelper,
  Color,
  BufferAttribute,
  Vector3,
  MeshStandardMaterial,
  MeshPhysicalMaterial,
  Scene,
  Line,
} from "three"
import { State } from "../model/ball"
import { norm, up, zero } from "./../utils/three-utils"
import { R } from "../model/physics/constants"
import { Trace } from "./trace"
import { BallMaterialFactory } from "./ballmaterialfactory"
import { Session } from "../network/client/session"
import { BallAppearance } from "./ballappearance"
import { Settings } from "../utils/settings"

export class BallMesh {
  private static _ballGeometry: IcosahedronGeometry
  private static _shadowGeometry: CircleGeometry
  private static _shadowMaterial: MeshBasicMaterial
  private static readonly _dottedGeometryCache = new Map<
    number | string,
    IcosahedronGeometry
  >()

  private static getBallGeometry() {
    if (!this._ballGeometry) {
      this._ballGeometry = new IcosahedronGeometry(
        R,
        BallMesh.ballGeometryDetail()
      )
    }
    return this._ballGeometry
  }

  /**
   * v1.3.93：球的几何细分度。
   *
   * 修的问题：用户反馈「锯齿太多，球的锯齿也多」。根因是这里原先直接写
   * `Math.max(1, Session.getLod())` —— 把**画质档位原样**当作二十面体的
   * 细分度 detail 用。而 `IcosahedronGeometry(R, detail)` 的三角面数是
   * `20 * 4^detail`，档位每降一级，面数直接砍到 1/4：
   *
   *   detail=1 →    80 面   ← 画质档 0/1
   *   detail=2 →   320 面
   *   detail=3 →  1280 面   ← 默认档
   *   detail=4 →  5120 面
   *   detail=5 → 20480 面
   *
   * 80 面的球，轮廓是肉眼可辨的多边形；1280 面在中远距离仍见棱角。MSAA
   * 只能抗**边缘走样**，抗不了**几何本身的多边形折线**——这就是为什么
   * 用户觉得「画质调了也没用」。
   *
   * 修法：细分度与画质档解耦，改为「保底 2，高画质档逐级加」：
   *   档 0/1 → detail 2（  320 面，低端机护栏，比原来 ×4）
   *   档 2/3 → detail 3（ 1280 面，默认档持平，但关掉了 flatShading，净收益）
   *   档 4   → detail 4（ 5120 面，比原来持平）
   *   档 5   → detail 5（20480 面，仅最高档）
   *
   * 注意 detail 不能无脑拉满：这是**静态共享几何**（`_ballGeometry` 全局
   * 一份，所有球复用），但在台 16 颗球 × 61440 顶点 ≈ 百万级顶点，手机
   * 上会明显掉帧。所以档位越高给得越保守，且**最高档才给 detail 5**——
   * 中间档直接从 1280 跳到 20480（×16）是没有意义的陡坡。
   */
  private static ballGeometryDetail(): number {
    const lod = Session.getLod()
    if (lod <= 1) return 2
    if (lod <= 3) return 3
    if (lod === 4) return 4
    return 5
  }

  private static getShadowGeometry() {
    if (!this._shadowGeometry) {
      this._shadowGeometry = new CircleGeometry(
        R * 0.9,
        Session.getLod() <= 1 ? 9 : 24
      )
      this._shadowGeometry.applyMatrix4(
        new Matrix4().makeTranslation(0, 0, -R * 0.99)
      )
    }
    return this._shadowGeometry
  }

  private static getShadowMaterial() {
    if (!this._shadowMaterial) {
      this._shadowMaterial = new MeshBasicMaterial({ color: 0x111122 })
    }
    return this._shadowMaterial
  }

  mesh: Mesh
  shadow: Mesh
  spinAxisArrow: ArrowHelper
  trace: Trace
  color: Color
  private ghosts: Line[] = []

  freezeTrace(scene: Scene) {
    const count = this.trace.geometry.drawRange.count
    if (count > 1) {
      const ghost = this.trace.freeze()
      this.ghosts.push(ghost)
      scene.add(ghost)
    }
  }

  clearGhosts(scene: Scene) {
    this.ghosts.forEach((g) => scene.remove(g))
    this.ghosts = []
  }
  constructor(color, label?: number, appearance?: BallAppearance) {
    this.color = new Color(color)
    this.initialiseMesh(this.color, label, appearance)
  }

  updateAll(ball, t) {
    // v1.2.8 #E8：球进洞（State.InPocket）后立刻隐藏 mesh 与接触阴影，
    // 不再残留在袋口可见。复位：若球被重新摆回台面，则恢复可见。
    if (ball.state === State.InPocket) {
      this.mesh.visible = false
      this.shadow.visible = false
      return
    }
    if (!this.mesh.visible) this.mesh.visible = true
    if (!this.shadow.visible && Settings.get().scene !== "snow") {
      this.shadow.visible = true
    }

    const isStationary = ball.state === State.Stationary
    const positionChanged = !this.mesh.position.equals(ball.pos)
    if (isStationary && !positionChanged) {
      return
    }

    this.updatePosition(ball.pos)
    if (this.spinAxisArrow.visible) {
      this.updateArrows(ball.pos, ball.rvel, ball.state)
    }
    if (ball.rvel.lengthSq() !== 0) {
      this.updateRotation(ball.rvel, t)
      this.trace.addTrace(ball.pos, ball.vel)
    }
  }

  updatePosition(pos) {
    this.mesh.position.copy(pos)
    this.shadow.position.copy(pos)
  }

  readonly m = new Matrix4()

  updateRotation(rvel, t) {
    const angle = rvel.length() * t
    this.mesh.rotateOnWorldAxis(norm(rvel), angle)
  }

  updateArrows(pos, rvel, state) {
    this.spinAxisArrow.setLength(R + (R * rvel.length()) / 2, R, R)
    this.spinAxisArrow.position.copy(pos)
    this.spinAxisArrow.setDirection(norm(rvel))
    if (state == State.Rolling) {
      this.spinAxisArrow.setColor(0xcc0000)
    } else {
      this.spinAxisArrow.setColor(0x00cc00)
    }
  }

  initialiseMesh(color: Color, label?: number, appearance?: BallAppearance) {
    let geometry: IcosahedronGeometry
    let material:
      MeshPhongMaterial | MeshStandardMaterial | MeshPhysicalMaterial
    const effectiveAppearance =
      appearance ?? (label === undefined ? "dotted" : "projected")

    if (effectiveAppearance === "dotted") {
      /**
       * 缓存 key 必须带上「是否画点」。母球（无点）和同色系彩球（有点）
       * 若共用几何缓存，会出现「母球拿到彩球几何」的错配。
       */
      const isCueBall = color.getHex() === 0xffffff
      const key = isCueBall ? "cue" : color.getHex()
      let cached = BallMesh._dottedGeometryCache.get(key)
      if (!cached) {
        // v1.3.93：与 getBallGeometry 用同一套细分度（原先这里也直接拿
        // Session.getLod() 当 detail 用，低画质档同样出多边形棱角）。
        cached = new IcosahedronGeometry(R, BallMesh.ballGeometryDetail())
        // 母球纯白无标记；其余球用暗红点区分
        BallMesh.addDots(cached, color, isCueBall ? null : 0xaa2222)
        BallMesh._dottedGeometryCache.set(key, cached)
      }
      geometry = cached
      material = BallMaterialFactory.createDottedMaterial(color)
    } else if (effectiveAppearance === "texturedDots") {
      geometry = BallMesh.getBallGeometry()
      material = BallMaterialFactory.createTexturedDotsMaterial(color)
    } else {
      if (label === undefined) {
        throw new Error("Projected ball material requires a label")
      }
      geometry = BallMesh.getBallGeometry()
      material = BallMaterialFactory.createProjectedMaterial(label, color)
    }
    this.mesh = new Mesh(geometry, material)
    this.mesh.name = "ball"
    // Req 3：球体投射真实阴影（雪景中由户外太阳光投到台呢/雪原）。
    // 非雪景无 castShadow 灯光，零额外开销。
    this.mesh.castShadow = true
    this.updateRotation(new Vector3().random(), 100)

    this.shadow = new Mesh(
      BallMesh.getShadowGeometry(),
      BallMesh.getShadowMaterial()
    )
    // 雪景改用真实太阳光阴影，隐藏程序化接触阴影，避免双重阴影
    this.shadow.visible = Settings.get().scene !== "snow"
    this.spinAxisArrow = new ArrowHelper(up, zero, 2, 0x000000, 0.01, 0.01)
    this.spinAxisArrow.visible = false
    this.trace = new Trace(500, color)
  }

  /**
   * 给「无贴图」球体刷顶点色：底色 + 可选的点标记。
   *
   * ⚠️ v1.3.85 修复「母球长红斑」。
   *
   * 病史：本函数原本无条件在 `[0, 96, 111, 156, 186, 195]` 这 6 个面上刷
   * 暗红 `0xaa2222`。但**母球（label === 0，color 0xffffff）也走 "dotted"
   * 分支** —— 它没有 label 判定，于是纯白母球被打上 6 块红斑，看起来像
   * 一颗掉色的旧球，而不是干净的白球。
   *
   * 修复：按球色判定。**纯白球不加点**（真实台球里母球本就是纯白无标），
   * 其余彩球保留点标记以区分花色。
   *
   * @param dotColor  点标记颜色；传 null 表示这颗球不加点
   */
  private static addDots(geometry, baseColor, dotColor: number | null) {
    const count = geometry.attributes.position.count
    const color = new Color(baseColor)

    geometry.setAttribute(
      "color",
      new BufferAttribute(new Float32Array(count * 3), 3)
    )

    const verticies = geometry.attributes.color
    for (let i = 0; i < count / 3; i++) {
      BallMesh.colorVerticesForFace(
        i,
        verticies,
        BallMesh.scaleNoise(color.r),
        BallMesh.scaleNoise(color.g),
        BallMesh.scaleNoise(color.b)
      )
    }

    if (dotColor === null) {
      // 母球：纯白无点
      return
    }

    const red = new Color(dotColor)
    const dots = [0, 96, 111, 156, 186, 195]
    dots.forEach((i) => {
      BallMesh.colorVerticesForFace(i / 3, verticies, red.r, red.g, red.b)
    })
  }

  addToScene(scene) {
    scene.add(this.mesh)
    scene.add(this.shadow)
    scene.add(this.spinAxisArrow)
    scene.add(this.trace.line)
  }

  private static colorVerticesForFace(face, verticies, r, g, b) {
    verticies.setXYZ(face * 3 + 0, r, g, b)
    verticies.setXYZ(face * 3 + 1, r, g, b)
    verticies.setXYZ(face * 3 + 2, r, g, b)
  }

  private static scaleNoise(v) {
    return (1 - Math.random() * 0.25) * v
  }
}
