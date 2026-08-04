import {
  Mesh,
  TextureLoader,
  RepeatWrapping,
  Float32BufferAttribute,
  BufferGeometry,
} from "three"
import { RuleFactory } from "../controller/rules/rulefactory"
import { importGltf } from "../utils/gltf"
import { Rules } from "../controller/rules/rules"
import { Sound } from "./sound"
import { TableMesh } from "./tablemesh"
import { TableGeometry } from "./tablegeometry"
import { Settings, getSkin, getEnvScene } from "../utils/settings"
import { getSceneTexture } from "./scenetexturefactory"

export class Assets {
  /**
   * 取桌台配色。
   *
   * skinId 必须允许显式传入：Settings.get() 是带内存缓存的，实时换肤时
   * 缓存里仍是旧皮肤，若这里只读 Settings，桌布就永远停在上一个颜色
   * （球杆却因为直接收到 skinId 而变色）——这正是「球杆变了桌布没变」的根因。
   */
  private static tableCustomizationFor(skinId?: string) {
    const skin = getSkin(skinId ?? Settings.get().skin)
    return {
      texturePath: "assets/wave.jpg",
      textureRepeatU: 1,
      textureRepeatV: 2,
      clothColor: skin.clothColor,
      cushionColor: skin.cushionColor,
      clothshadeColor: skin.clothshadeColor,
    }
  }

  ready
  rules: Rules
  background: Mesh
  table: Mesh
  /** 背景未就绪时暂存的场景 id（item 4） */
  pendingScene: string | null = null

  sound: Sound

  constructor(ruletype) {
    this.rules = RuleFactory.create(ruletype, null)
    this.rules.tableGeometry()
  }

  loadFromWeb(ready) {
    this.ready = ready
    this.sound = new Sound(true)
    importGltf("models/background.gltf", (m) => {
      this.background = m.scene
      this.applySceneToBackground(this.pendingScene ?? Settings.get().scene)
      this.pendingScene = null
      this.done()
    })
    importGltf(this.rules.asset, (m) => {
      this.rules.scaleTableModel?.(m.scene)
      // 皮肤着色必须对所有台尺寸生效。
      // 此前被 isTableSize5() 包住，而默认 tableSize=10，导致球台配色
      // 从未被应用——这正是「首页换了皮肤，进游戏台布没变」的根因。
      this.customizeTableScene(m.scene)
      this.table = m.scene
      TableMesh.mesh = m.scene.children[0]
      this.done()
    })
  }

  createLocal() {
    this.sound = new Sound(false)
    TableMesh.mesh = new TableMesh().generateTable(TableGeometry.hasPockets)
    this.table = TableMesh.mesh
  }

  static localAssets(ruletype = "") {
    const assets = new Assets(ruletype)
    assets.createLocal()
    return assets
  }

  private isTableSize5(): boolean {
    const urlParams = new URLSearchParams(globalThis.location?.search ?? "")
    return parseFloat(urlParams.get("tableSize") || "10") === 5
  }

  private customizeTableScene(scene): void {
    const cfg = Assets.tableCustomizationFor()

    // 同步阶段：修正台呢 UV，并直接按皮肤给台呢 / 库边 / 阴影上色。
    //
    // 注意：台呢颜色此前只在下面的贴图异步回调里设置，而贴图 assets/wave.jpg
    // 实际并不存在（fork 上游时遗留），加载必然失败 -> 回调不执行 ->
    // 台呢永远停留在模型自带的蓝色，导致「首页换皮肤进游戏后台布没变」。
    // 因此颜色必须在同步阶段就落定，贴图只作为可选增强。
    //
    // UV 修正只针对 5 尺台模型（其台呢 UV 是塌缩的）。
    this.paintTable(scene, cfg, this.isTableSize5())

    // 异步阶段：贴图存在时叠加纹理（缺失则静默跳过，颜色已在上面生效）
    new TextureLoader().load(
      cfg.texturePath,
      (texture) => {
        texture.wrapS = texture.wrapT = RepeatWrapping
        texture.repeat.set(cfg.textureRepeatU, cfg.textureRepeatV)
        scene.traverse((child) => {
          if (!child.isMesh) return
          const materials = Array.isArray(child.material)
            ? child.material
            : [child.material]
          for (const mat of materials) {
            if (mat.name?.toLowerCase() === "cloth") {
              mat.map = texture
              mat.color.set(cfg.clothColor)
              mat.needsUpdate = true
            }
          }
        })
      },
      undefined,
      () => {
        /* 贴图缺失不影响皮肤配色，忽略 */
      }
    )
  }

  /**
   * 实时更换皮肤（item 1）：按指定皮肤重设台呢/库边/阴影颜色。
   *
   * skinId 由调用方显式传入（不读 Settings 缓存），否则实时切换会失效。
   */
  recolorTable(scene, skinId?: string): void {
    this.paintTable(scene, Assets.tableCustomizationFor(skinId), false)
  }

  /**
   * 应用环境场景（item 4）：把程序化墙面贴图套到背景盒子房间的内壁上。
   * 背景为异步加载，未就绪时暂存，待加载完成回调里补应用。
   */
  recolorScene(sceneId: string): void {
    this.applySceneToBackground(sceneId)
  }

  private applySceneToBackground(sceneId: string): void {
    if (!this.background) {
      this.pendingScene = sceneId
      return
    }
    const tex = getSceneTexture(sceneId)
    this.background.traverse((child) => {
      if (!child.isMesh) return
      const mats = Array.isArray(child.material)
        ? child.material
        : [child.material]
      for (const mat of mats) {
        mat.map = tex
        mat.color.setHex(0xffffff)
        mat.needsUpdate = true
      }
    })
  }

  /** 桌台上色的唯一实现，首次加载与实时换肤共用，避免两份逻辑走偏 */
  private paintTable(scene, cfg, fixUVs: boolean): void {
    scene.traverse((child) => {
      if (!child.isMesh) return
      const materials = Array.isArray(child.material)
        ? child.material
        : [child.material]
      for (const mat of materials) {
        const name = mat.name?.toLowerCase() ?? ""
        if (name.includes("clothshade")) {
          mat.color.set(cfg.clothshadeColor)
          mat.needsUpdate = true
        } else if (name.includes("cloth")) {
          if (fixUVs) this.fixClothUVs(child)
          mat.color.set(cfg.clothColor)
          mat.needsUpdate = true
        } else if (name.includes("cushion")) {
          mat.color.set(cfg.cushionColor)
          mat.needsUpdate = true
        }
      }
    })
  }

  private fixClothUVs(mesh): void {
    const geometry = mesh.geometry as BufferGeometry
    if (!geometry) return
    if (geometry.attributes.uv && !this.uvsAreCollapsed(geometry)) return
    this.generatePlanarUVs(geometry)
  }

  private uvsAreCollapsed(geometry: BufferGeometry): boolean {
    const uv = geometry.attributes.uv
    if (!uv) return false
    const u0 = uv.getX(0)
    const v0 = uv.getY(0)
    for (let i = 1; i < uv.count; i++) {
      if (uv.getX(i) !== u0 || uv.getY(i) !== v0) return false
    }
    return true
  }

  private generatePlanarUVs(geometry: BufferGeometry): void {
    const pos = geometry.attributes.position
    const count = pos.count

    let minX = Infinity,
      maxX = -Infinity
    let minY = Infinity,
      maxY = -Infinity

    for (let i = 0; i < count; i++) {
      const x = pos.getX(i)
      const y = pos.getY(i)
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }

    const rangeX = maxX - minX
    const rangeV = maxY - minY
    const scale = Math.max(rangeX, rangeV)

    const uvs = new Float32Array(count * 2)
    for (let i = 0; i < count; i++) {
      uvs[i * 2] = (pos.getX(i) - minX) / scale
      uvs[i * 2 + 1] = (pos.getY(i) - minY) / scale
    }

    geometry.setAttribute("uv", new Float32BufferAttribute(uvs, 2))
  }

  private done() {
    if (this.background && this.table) {
      this.ready()
    }
  }
}
