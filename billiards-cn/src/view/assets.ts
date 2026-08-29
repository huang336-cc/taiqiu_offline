import {
  Mesh,
  MeshBasicMaterial,
  TextureLoader,
  Texture,
  CanvasTexture,
  BoxGeometry,
  SRGBColorSpace,
  RepeatWrapping,
  Float32BufferAttribute,
  BufferGeometry,
  Group,
  BackSide,
} from "three"
import { RuleFactory } from "../controller/rules/rulefactory"
import { importGltf } from "../utils/gltf"
import { Rules } from "../controller/rules/rules"
import { Sound } from "./sound"
import { TableMesh } from "./tablemesh"
import { TableGeometry } from "./tablegeometry"
import { Settings, getSkin, getEnvScene, getTableSkin } from "../utils/settings"
import { getSceneTexture } from "./scenetexturefactory"
import { buildSceneEnvironment } from "./sceneenvironment"
import { getClothTexture, getFrameTexture } from "./tableskinfactory"

function hex(n: number): string {
  return "#" + (n >>> 0).toString(16).padStart(6, "0").slice(-6)
}

/** 生成一面竖向渐变墙面贴图（顶 wallA → 底 wallB），用于 3D 房间四周。 */
function makeWallTexture(def: {
  wallA: number
  wallB: number
}): CanvasTexture {
  const cv = document.createElement("canvas")
  cv.width = 16
  cv.height = 256
  const ctx = cv.getContext("2d")!
  const g = ctx.createLinearGradient(0, 0, 0, 256)
  g.addColorStop(0, hex(def.wallA))
  g.addColorStop(1, hex(def.wallB))
  ctx.fillStyle = g
  ctx.fillRect(0, 0, 16, 256)
  const tex = new CanvasTexture(cv)
  tex.colorSpace = SRGBColorSpace
  return tex
}

export class Assets {
  /**
   * 取桌台配色。
   *
   * skinId 必须允许显式传入：Settings.get() 是带内存缓存的，实时换肤时
   * 缓存里仍是旧皮肤，若这里只读 Settings，桌布就永远停在上一个颜色
   * （球杆却因为直接收到 skinId 而变色）——这正是「球杆变了桌布没变」的根因。
   */
  private static tableCustomizationFor(
    skinId?: string,
    tableSkinId?: string
  ) {
    const skin = getSkin(skinId ?? Settings.get().skin)
    const ts = getTableSkin(tableSkinId ?? Settings.get().tableSkin)
    // 台球桌皮肤（item 5）拥有球台本体的完整外观：
    // 台呢色 / 库边色 / 桌框色 / 发光 / 纹理；「台球桌颜色(skin)」主要作用于球杆。
    return {
      texturePath: "assets/wave.jpg",
      textureRepeatU: 1,
      textureRepeatV: 2,
      clothColor: ts.clothColor,
      clothColor2: ts.clothColor2,
      cushionColor: ts.cushionColor,
      // v1.3.53：袋口（blackpocket / Material.001）优先跟随桌框发光色；
      // 特效主题外框发光时袋口不再显黑棕，无发光主题保持库边色。
      pocketColor: ts.frameGlow || ts.cushionColor,
      clothshadeColor: skin.clothshadeColor,
      frameColor: ts.frameColor,
      frameGlow: ts.frameGlow,
      edgeGlow: ts.edgeGlow,
      clothTexture: getClothTexture(ts.id),
      frameTexture: getFrameTexture(ts.id),
    }
  }

  ready
  rules: Rules
  background: Mesh
  table: Mesh
  /** 背景未就绪时暂存的场景 id（item 4） */
  pendingScene: string | null = null

  /**
   * 实景照片缓存（Request D-v2）：命中 photo 的场景加载真实照片，
   * 贴到 3D 房间（天空盒）的地面，营造「台球桌放在真实场景里」的 3D 效果；
   * 其余场景地面用程序化贴图。以 scene id 为键缓存，避免重复请求。
   */
  private static photoCache = new Map<string, Texture>()

  /**
   * 当前 3D 场景环境（Request D-v3）：足球场/篮球场/雪山场景的真实几何环境。
   * 用几何体（不是照片）从零搭建，台球桌坐在真正的地面上，避免"照片贴面"造成的
   * 透视错乱（用户反馈 v1.0.14 足球场看起来像无限延伸的纯色平面）。
   */
  sceneEnv: Group | null = null

  sound: Sound

  constructor(ruletype) {
    this.rules = RuleFactory.create(ruletype, null)
    this.rules.tableGeometry()
  }

  loadFromWeb(ready) {
    this.ready = ready
    this.sound = new Sound(true)
    // Request D-v2：用代码自建带 6 面分组的 BoxGeometry 房间作环境（原
    // background.gltf 是普通 BufferGeometry，无材质分组，无法把照片单独贴到
    // 地面/墙面）。房间尺寸与位姿沿用原立方体（80×40×30，z 偏移 16），
    // 台球桌置于房间中央，得到「台球桌放在真实场景里的 3D 效果」。
    const room = new Mesh(
      new BoxGeometry(1, 1, 1),
      new MeshBasicMaterial({
        color: 0x808080,
        side: BackSide,
        toneMapped: false,
        fog: false,
      })
    )
    room.scale.set(80, 40, 30)
    room.position.set(0, 0, 16)
    this.background = room
    this.applySceneToBackground(this.pendingScene ?? Settings.get().scene)
    this.pendingScene = null
    this.done()
    importGltf(this.rules.asset, (m) => {
      this.rules.scaleTableModel?.(m.scene)
      // 皮肤着色必须对所有台尺寸生效。
      // 此前被 isTableSize5() 包住，而默认 tableSize=10，导致球台配色
      // 从未被应用——这正是「首页换了皮肤，进游戏台布没变」的根因。
      this.customizeTableScene(m.scene)
      this.table = m.scene
      // Req 3：让台呢/库边等网格可接收户外太阳光阴影（雪景中台呢上自然出现阴影）。
      // 同时整桌可投影到雪原，形成自然的接地阴影。非雪景无 castShadow 灯光，零额外开销。
      m.scene.traverse((child: any) => {
        if (!child.isMesh) return
        child.receiveShadow = true
        child.castShadow = true
      })
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
    const cfg = Assets.tableCustomizationFor(
      undefined,
      Settings.get().tableSkin
    )

    // 同步阶段：修正台呢 UV，并直接按皮肤给台呢 / 库边 / 阴影 / 桌框上色。
    //
    // 注意：台呢颜色此前只在下面的贴图异步回调里设置，而贴图 assets/wave.jpg
    // 实际并不存在（fork 上游时遗留），加载必然失败 -> 回调不执行 ->
    // 台呢永远停留在模型自带的蓝色，导致「首页换皮肤进游戏后台布没变」。
    // 因此颜色必须在同步阶段就落定，贴图只作为可选增强。
    //
    // UV 修正只针对 5 尺台模型（其台呢 UV 是塌缩的）。
    this.paintTable(scene, cfg, this.isTableSize5())

    // 异步阶段：旧 wave.jpg 贴图缺失则静默跳过（颜色与程序化纹理已在上面生效）。
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
   * tableSkinId 同理传入（item 5 台球桌皮肤实时切换）。
   */
  recolorTable(scene, skinId?: string, tableSkinId?: string): void {
    const cfg = Assets.tableCustomizationFor(skinId, tableSkinId)
    this.paintTable(scene, cfg, false)
  }

  /**
   * 取场景实景照片贴图（Request D-v2）：命中 photo 的场景加载真实照片并缓存，
   * 用于 3D 房间地面的贴图；无照片则返回 null（改用程序化地面贴图）。
   */
  static getPhotoTexture(sceneId: string): Texture | null {
    const def = getEnvScene(sceneId)
    if (!def.photo) return null
    const cached = Assets.photoCache.get(sceneId)
    if (cached) return cached
    const tex = new TextureLoader().load(
      def.photo,
      (t) => {
        t.colorSpace = SRGBColorSpace
        t.needsUpdate = true
      },
      undefined,
      () => {
        /* 照片缺失则回退到程序化贴图，不影响游戏 */
        Assets.photoCache.delete(sceneId)
      }
    )
    tex.colorSpace = SRGBColorSpace
    Assets.photoCache.set(sceneId, tex)
    return tex
  }

  /**
   * 应用环境场景（item 4 / Request D-v2）：把 3D 房间（天空盒）内部按 6 面
   * 分别贴图——地面放实景照片（或程序化贴图），四周墙面用场景色渐变，顶面更暗，
   * 台球桌置于房间中央，从而得到「台球桌放在真实场景里的 3D 效果」。
   * 背景为异步加载，未就绪时暂存，待加载完成回调里补应用。
   */
  recolorScene(sceneId: string): void {
    this.applySceneToBackground(sceneId)
  }

  /**
   * 取场景 3D 环境（Request D-v3）：足球场/篮球场/雪山返回**真正搭建的几何
   * 环境**（草地+白线+球门 / 木地板+球场线+篮筐 / 雪地+山体），其他场景返回
   * null（继续走立方体房间路径）。
   */
  getSceneEnvironment(sceneId: string): Group | null {
    // 释放旧环境：仅 dispose 单次引用的材质，跳过被多 mesh 引用的「共享材质」，
    // 防止误销毁模块级单例（足球/篮球场景里有此情况，会导致场景切换后渲染断裂）。
    if (this.sceneEnv) {
      const refCount = new Map<unknown, number>()
      this.sceneEnv.traverse((o) => {
        const m = o as Mesh
        if (m.isMesh && m.material) {
          const mats = Array.isArray(m.material) ? m.material : [m.material]
          for (const mm of mats) {
            refCount.set(mm, (refCount.get(mm) || 0) + 1)
          }
        }
      })
      this.sceneEnv.traverse((o) => {
        const m = o as Mesh
        if (m.isMesh && m.material) {
          const mats = Array.isArray(m.material) ? m.material : [m.material]
          for (const mm of mats) {
            if (
              refCount.get(mm) === 1 &&
              mm &&
              typeof mm.dispose === "function"
            ) {
              mm.dispose()
            }
          }
        }
      })
      this.sceneEnv = null
    }
    const env = buildSceneEnvironment(sceneId)
    this.sceneEnv = env
    return env
  }

  private applySceneToBackground(sceneId: string): void {
    if (!this.background) {
      this.pendingScene = sceneId
      return
    }
    const def = getEnvScene(sceneId)
    const photo = Assets.getPhotoTexture(sceneId)

    // 地面：实景照片（或程序化贴图，其足球/篮球等已带场地线，质感更真）
    const floorMat = new MeshBasicMaterial({
      map: photo ?? getSceneTexture(sceneId),
      side: BackSide,
      toneMapped: false,
      fog: false,
    })
    // 四周墙面：场景色竖直渐变（不抢戏，让地面照片更突出）
    const wallMat = new MeshBasicMaterial({
      map: makeWallTexture(def),
      side: BackSide,
      toneMapped: false,
      fog: false,
    })
    // 顶面：更暗的场景色
    const ceilMat = new MeshBasicMaterial({
      color: def.wallB,
      side: BackSide,
      toneMapped: false,
      fog: false,
    })

    // BoxGeometry 的 6 个面材质槽：0:+x 1:-x 2:+y(顶) 3:-y(地) 4:+z 5:-z
    // 地面(3)与前后墙(4,5)用实景照片（桌面在场景里、身后即真实场景），
    // 两侧墙(0,1)用场景色渐变，顶面(2)更暗。floorMat 在多个面共享实例。
    const mats = [wallMat, wallMat, ceilMat, floorMat, floorMat, floorMat]

    this.background.traverse((child) => {
      if (!child.isMesh) return
      // 背景是「盒子房间」，玩家从内部往外看。把每个 mesh 的材质替换为
      // 一个不受光照、雾效与色调映射影响的 MeshBasicMaterial 数组（6 面），
      // 保证贴图原色显示，从根本上杜绝「贴图存在但渲染全黑」。
      const oldMats = Array.isArray(child.material)
        ? child.material
        : [child.material]
      child.material = mats
      for (const om of oldMats) {
        if (om && typeof om.dispose === "function") om.dispose()
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
          if (cfg.clothTexture) {
            mat.map = cfg.clothTexture
          }
          mat.needsUpdate = true
        } else if (name.includes("cushion")) {
          mat.color.set(cfg.cushionColor)
          mat.needsUpdate = true
        } else if (name.includes("wood")) {
          // 桌框：底色 + 发光（emissive）。无发光时 emissive 置黑。
          mat.color.set(cfg.frameColor)
          if ("emissive" in mat) {
            ;(mat as any).emissive.set(cfg.frameGlow || 0x000000)
            ;(mat as any).emissiveIntensity = cfg.frameGlow ? 0.9 : 0
          }
          if (cfg.frameTexture) {
            mat.map = cfg.frameTexture
          }
          mat.needsUpdate = true
        } else if (name === "blackpocket" || name.includes("pocket")) {
          // v1.3.53-fix：袋口（球洞）颜色不再固定使用深色库边色；
          // 当主题带桌框发光色（frameGlow）时，改为与发光色同步，使明亮外框下的袋口
          // 不再显黑棕；无发光主题仍回退到库边色，保持原有协调感。
          // v1.3.41-fix：同步 roughness/metalness/ior/specular，避免原黑色高光材质
          // 改成亮色后仍显灰白/反光；关闭自发光与多余纹理，让颜色真正统一。
          mat.color.set(cfg.pocketColor)
          if ("emissive" in mat) {
            ;(mat as any).emissive.set(0x000000)
            ;(mat as any).emissiveIntensity = 0
          }
          ;(mat as any).map = null
          ;(mat as any).roughness = 0.8
          ;(mat as any).metalness = 0
          if ("ior" in mat) { (mat as any).ior = 1.5 }
          if ("specularIntensity" in mat) { (mat as any).specularIntensity = 0 }
          mat.needsUpdate = true
        } else if (name === "material.001" || name === "material_001") {
          // GLTF 模型中未被命名的金属/包边件（Blender 默认名 Material.001），
          // 通常是袋口包边或角落金属件。v1.3.53-fix：与 blackpocket 统一逻辑，
          // 带桌框发光色时同步发光色，使袋口包边与明亮外框一致；无发光时回退库边色。
          // v1.3.41-fix：关闭自发光与光滑金属感，否则在亮色主题下会发白突兀。
          mat.color.set(cfg.pocketColor)
          if ("emissive" in mat) {
            ;(mat as any).emissive.set(0x000000)
            ;(mat as any).emissiveIntensity = 0
          }
          ;(mat as any).map = null
          ;(mat as any).roughness = 0.75
          ;(mat as any).metalness = 0
          if ("ior" in mat) { (mat as any).ior = 1.5 }
          if ("specularIntensity" in mat) { (mat as any).specularIntensity = 0 }
          mat.needsUpdate = true
        } else if (name === "diamond") {
          // v1.3.38-fix：隐藏 GLTF 模型桌边 diamond（菱形瞄准标记）小凸点，
          // 用户反馈其视觉上很突兀。直接隐藏 mesh，不动物理。
          child.visible = false
        }
      }
    })
  }

  /**
   * 桌沿装饰发光边：已移除。
   *
   * 旧版在球台外沿叠加一圈细发光环，但坐标错算（innerX/outerX 取
   * `TableGeometry.X + 1.2/+1.9`，而 X 已经是 1.4，+1.2 后内圈已达 2.6，
   * 是真实桌面的 ~2 倍）导致从默认相机角度看，整圈发光环的近/远两侧
   * 投影到画面中央、形成「球桌中央多了一块矩形色块」的视觉 bug。
   * 改用 paintTable 给桌框/库边上色 + emissive 即可达到边框发光效果，
   * 此处仅删去该 mesh，不再绘制额外几何体。
   */
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
