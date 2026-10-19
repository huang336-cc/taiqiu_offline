import {
  Vector3,
  Mesh,
  CylinderGeometry,
  BoxGeometry,
  MeshPhongMaterial,
  PointLight,
  Group,
} from "three"
import { TableGeometry } from "./tablegeometry"
import { PocketGeometry } from "./pocketgeometry"
import { R } from "../model/physics/constants"
import { Settings, getTableSkin } from "../utils/settings"
import { getClothTexture, getClothNormalTexture } from "./tableskinfactory"

export class TableMesh {
  logger = (_) => {}

  static mesh

  private static readonly cylinderCache = new Map<string, CylinderGeometry>()
  private static readonly boxCache = new Map<string, BoxGeometry>()

  generateTable(hasPockets: boolean) {
    const group = new Group()
    const light = new PointLight(0xf0f0e8, 22)
    light.position.set(0, 0, R * 50)
    group.add(light)
    // v1.3.61：回放 / 图解桌同步当前桌布主题 —— 此前台呢/库边永远是模型
    // 默认的蓝紫色，与玩家选的主题完全脱节；台呢顺带挂上程序化绒面贴图，
    // 结束「回放里是另一张素桌」的割裂感。
    const ts = getTableSkin(Settings.get().tableSkin)
    this.cloth.color.set(ts.clothColor)
    const clothTex = getClothTexture(ts.id)
    if (clothTex) {
      this.cloth.map = clothTex
      this.cloth.needsUpdate = true
    }
    // v1.6.0：回放/图解桌同样挂绒面法线，避免与主桌观感割裂
    const clothN = getClothNormalTexture(ts.id)
    if (clothN) {
      this.cloth.normalMap = clothN
      this.cloth.normalScale.set(0.6, 0.6)
    }
    this.cushion.color.set(ts.cushionColor)
    // 【v1.4.4】与 GLTF 库边（assets.ts）同口径的质感分级。
    // 回放/图解桌此前同样只有一句设色，13 款库边质感一个样。
    // 这里是 MeshPhong（无 metalness/roughness），改用 specular/shininess 表达：
    // 金属感越强 → 高光越亮越锐（镜面感），哑光款 → 高光弱而宽。
    const cm = ts.cushionMetal ?? 0.02
    this.cushion.shininess = 8 + cm * 120
    this.cushion.specular.setScalar(0.03 + cm * 0.5)
    const cg = ts.edgeGlow || ts.frameGlow
    this.cushion.emissive.setHex(cg ? cg : 0x000000)
    this.addCushions(group, hasPockets)

    if (hasPockets) {
      // v1.3.38：去除桌边 12 个 knuckle 小凸点（视觉冗余、用户反馈突兀），
      // 仅保留 6 个球洞（pocketCenters）。物理/碰撞由 PocketGeometry 常量决定，不受影响。
      // 球洞颜色同步当前桌布皮肤（取库边色，与桌面色调协调）。
      const ts = getTableSkin(Settings.get().tableSkin)
      this.pocket.color.set(ts.cushionColor)
      PocketGeometry.pocketCenters.forEach((p) =>
        this.knuckleCylinder(p, group, this.pocket)
      )

      const p = PocketGeometry.pockets.pocketNW.pocket
      const k = PocketGeometry.pockets.pocketNW.knuckleNE
      this.logger(
        "knuckle-pocket gap = " +
          (p.pos.distanceTo(k.pos) - p.radius - k.radius)
      )
    }
    return group
  }

  private readonly cloth = new MeshPhongMaterial({
    // 【v1.4.4】name 必须叫 cloth：台面标志覆盖层靠材质名定位台呢表面高度
    // （与 GLTF 模型的 cloth 材质同口径），否则找不到贴合高度。
    name: "cloth",
    color: 0x243599,
    wireframe: false,
    flatShading: true,
    transparent: false,
  })

  private readonly cushion = new MeshPhongMaterial({
    color: 0x4455a9,
    wireframe: false,
    flatShading: true,
    transparent: false,
  })

  private readonly pocket = new MeshPhongMaterial({
    color: 0x445599,
    wireframe: false,
    flatShading: true,
    transparent: true,
    opacity: 0.3,
  })

  private knuckleCylinder(knuckle, scene, material = this.cloth) {
    const k = this.cylinder(
      knuckle.pos,
      knuckle.radius,
      (R * 0.75) / 0.5,
      scene,
      material
    )
    k.position.setZ((-R * 0.25) / 0.5 / 2)
  }

  private cylinder(pos, radius, depth, scene, material) {
    const key = `${radius}_${depth}`
    let geometry = TableMesh.cylinderCache.get(key)
    if (!geometry) {
      geometry = new CylinderGeometry(radius, radius, depth, 16)
      TableMesh.cylinderCache.set(key, geometry)
    }
    const mesh = new Mesh(geometry, material)
    mesh.position.copy(pos)
    mesh.rotation.x = Math.PI / 2
    scene.add(mesh)
    return mesh
  }

  addCushions(scene, hasPockets) {
    const th = (R * 10) / 0.5
    this.plane(
      new Vector3(0, 0, -R - th / 2),
      2 * TableGeometry.X,
      2 * TableGeometry.Y,
      th,
      scene,
      this.cloth
    )

    const d = (R * 1) / 0.5
    const h = (R * 0.75) / 0.5
    const e = (-R * 0.25) / 0.5 / 2
    const X = TableGeometry.X
    const Y = TableGeometry.Y

    let lengthN = Math.abs(
      PocketGeometry.pockets.pocketNW.knuckleNE.pos.x -
        PocketGeometry.pockets.pocketN.knuckleNW.pos.x
    )
    let lengthE = Math.abs(
      PocketGeometry.pockets.pocketNW.knuckleSW.pos.y -
        PocketGeometry.pockets.pocketSW.knuckleNW.pos.y
    )

    if (!hasPockets) {
      lengthN = 2 * TableGeometry.Y
      lengthE = 2 * TableGeometry.Y + 4 * R
    }

    this.plane(new Vector3(X + d / 2, 0, e), d, lengthE, h, scene)
    this.plane(new Vector3(-X - d / 2, 0, e), d, lengthE, h, scene)

    this.plane(new Vector3(-X / 2, Y + d / 2, e), lengthN, d, h, scene)
    this.plane(new Vector3(-X / 2, -Y - d / 2, e), lengthN, d, h, scene)

    this.plane(new Vector3(X / 2, Y + d / 2, e), lengthN, d, h, scene)
    this.plane(new Vector3(X / 2, -Y - d / 2, e), lengthN, d, h, scene)
  }

  private plane(pos, x, y, z, scene, material = this.cushion) {
    const key = `${x}_${y}_${z}`
    let geometry = TableMesh.boxCache.get(key)
    if (!geometry) {
      geometry = new BoxGeometry(x, y, z)
      TableMesh.boxCache.set(key, geometry)
    }
    const mesh = new Mesh(geometry, material)
    mesh.receiveShadow = true
    mesh.position.copy(pos)
    scene.add(mesh)
  }
}
