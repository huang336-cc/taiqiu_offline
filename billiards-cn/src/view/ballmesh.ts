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
    number,
    IcosahedronGeometry
  >()

  private static getBallGeometry() {
    if (!this._ballGeometry) {
      this._ballGeometry = new IcosahedronGeometry(
        R,
        Math.max(1, Session.getLod())
      )
    }
    return this._ballGeometry
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
      const key = color.getHex()
      let cached = BallMesh._dottedGeometryCache.get(key)
      if (!cached) {
        cached = new IcosahedronGeometry(R, Math.max(1, Session.getLod()))
        BallMesh.addDots(cached, color)
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

  private static addDots(geometry, baseColor) {
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

    const red = new Color(0xaa2222)
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
