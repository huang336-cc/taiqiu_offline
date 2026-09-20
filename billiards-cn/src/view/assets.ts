import {
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  Color,
  TextureLoader,
  BoxGeometry,
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
import { Settings, getSkin, getTableSkin } from "../utils/settings"
import { buildSceneEnvironment, GROUND_Z } from "./sceneenvironment"
import { getClothTexture, getFrameTexture } from "./tableskinfactory"
import {
  getFrameNormalTexture,
  getFrameRoughnessTexture,
} from "./tableskinfactory"

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
      // v1.3.88：桌框木纹的凹凸与光泽贴图。桌框在俯视下占画面 67.5%，
      // 只给颜色贴图会像「上过色的塑料」——木纹之所以可见靠的是纤维
      // 沟槽的明暗差，这必须由法线贴图提供。
      frameNormal: getFrameNormalTexture(ts.id),
      frameRoughness: getFrameRoughnessTexture(ts.id),
    }
  }

  ready
  rules: Rules
  background: Mesh
  table: Mesh

  /**
   * 当前 3D 场景环境（Request D-v3）：足球场/篮球场/雪山场景的真实几何环境。
   * 用几何体（不是照片）从零搭建，台球桌坐在真正的地面上，避免"照片贴面"造成的
   * 透视错乱（用户反馈 v1.0.14 足球场看起来像无限延伸的纯色平面）。
   */
  sceneEnv: Group | null = null

  /**
   * 场景环境缓存（v1.3.63）。
   *
   * 旧实现每次切场景都重建 Group、并且**只 dispose 材质、从不 dispose
   * geometry** —— 8 个场景来回切会持续泄漏 GPU vertex buffer。
   * 改为按 sceneId 缓存（顺带省掉每次上百毫秒的重建），LRU 上限 3：
   * 8 个场景但同屏只可能有一个，3 足够覆盖「A↔B 反复横跳」的常见路径。
   */
  private static envCache = new Map<string, Group>()
  private static readonly ENV_CACHE_LIMIT = 3

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
    // 地面/墙面）。房间尺寸沿用原立方体（80×40×30），台球桌置于房间中央，
    // 得到「台球桌放在真实场景里的 3D 效果」。
    //
    // v1.3.62 修复：z 偏移原为 16 → 盒子占 z[1, 31]，而球桌在 z≈0、
    // 俯视相机在 z=5.363（盒内）。于是房间地板（z=1）悬在球桌正上方 1.2m，
    // 俯视模式下把球桌整个盖死（实测台呢占比 0%，满屏沙色）。
    // 改为让地板落在 GROUND_Z（球桌底沿 -0.203）：z 偏移 = GROUND_Z + 半高 15。
    // 实测俯视台呢 0% → 76.5%，aim 视角台呢占比 39.7% → 39.6%（无影响）。
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
    room.position.set(0, 0, GROUND_Z + 15)
    this.background = room
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

  // v1.3.86：`isTableSize5()` 已删除。
  //
  // 它原本只有一个用途 —— 给 `paintTable` 的 `fixUVs` 参数做门禁，让 UV 修正
  // 只对 5 尺台生效。但实测**所有** GLTF 台球桌模型都没有 TEXCOORD_0，
  // 默认台同样需要修 UV（详见 `customizeTableScene` 的说明），门禁本身即是
  // 那个 bug。修正对所有台尺寸解锁后，这个函数再无调用点。

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
    // ⚠️ v1.3.86：UV 修正不再只针对 5 尺台。
    //
    // 病史：这里原本传 `this.isTableSize5()`，即只有 5 尺台修 UV。但直接
    // 解析 GLTF 的 JSON chunk 逐 primitive 统计 attributes，结果是：
    //
    //     p8.min.gltf           primitives=7   缺UV=7   TEXCOORD=否
    //     snooker.min.gltf      primitives=7   缺UV=7   TEXCOORD=否
    //     threecushion.min.gltf primitives=5   缺UV=5   TEXCOORD=否
    //     d-snooker.min.gltf    primitives=7   缺UV=6   TEXCOORD=是(仅1个)
    //     background.gltf       primitives=1   缺UV=0   TEXCOORD=是
    //
    // 即**四张台球桌模型 26 个 primitive 里 25 个没有 UV**，只有
    // d-snooker 的其中一个带了 TEXCOORD_0。于是默认台（tableSize=10）的
    // 台呢**根本没有 uv 属性**，v1.3.61 挂上去的那张 512² 程序化绒面贴图
    // **每一个像素都采样到 (0,0)** —— 整块台呢实际渲染成一种纯色。这就是
    // 「台呢像一块涂平的硬纸板、完全没有织物层次」的根因，也是 `repeat`
    // 怎么调都看不出变化的解释。
    //
    // 之所以长期没被发现：`verify84j.js` 有 `mapWithoutUv` 断言，但它的
    // 遍历范围只覆盖**场景环境**，球桌不在其中（球桌走 GLTF 分支而非
    // 程序化分支），所以这项检查一直是绿的。v1.3.87 起
    // `verify84j.js` 增补了 `table.*` 一组断言专门守球桌这一侧。
    //
    // 解禁是安全的：`fixClothUVs` 自身有两道守卫 —— 只有「无 uv」或
    // 「uv 已塌缩」时才生成，已有正常 UV 的模型完全不受影响。
    this.paintTable(scene, cfg, true)

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
   * v1.3.63：8 个场景全部有了程序化几何环境（房间 / 沙滩 / 森林 / 雪山 /
   * 足球 / 篮球 / 办公室 / 网咖），立方体房间这条兜底路径已经没人走。这里
   * 保留空实现，是为了让 view.applyScene 的 else 分支不必改动 —— 万一某个
   * 场景的 buildSceneEnvironment 返回 null，也只是没有背景，不会崩。
   */
  recolorScene(_sceneId: string): void {
    /* 立方体房间已退役，无需再按 6 面重新贴图 */
  }

  /**
   * 取场景 3D 环境（Request D-v3）：足球场/篮球场/雪山返回**真正搭建的几何
   * 环境**（草地+白线+球门 / 木地板+球场线+篮筐 / 雪地+山体），其他场景返回
   * null（继续走立方体房间路径）。
   */
  getSceneEnvironment(sceneId: string): Group | null {
    const cached = Assets.envCache.get(sceneId)
    if (cached) {
      // 命中：移到 Map 末尾（Map 保序 ⇒ 首项即最久未用）
      Assets.envCache.delete(sceneId)
      Assets.envCache.set(sceneId, cached)
      this.sceneEnv = cached
      return cached
    }
    const env = buildSceneEnvironment(sceneId)
    if (!env) {
      this.sceneEnv = null
      return null
    }
    Assets.envCache.set(sceneId, env)
    this.evictEnvCache()
    this.sceneEnv = env
    return env
  }

  /** 淘汰超出上限的最久未用环境，并彻底释放其 GPU 资源 */
  private evictEnvCache(): void {
    const cache = Assets.envCache
    while (cache.size > Assets.ENV_CACHE_LIMIT) {
      // 跳过当前正在使用的那个（它可能仍挂在 scene 上）
      let victimKey: string | null = null
      for (const [k, v] of cache) {
        if (v !== this.sceneEnv) {
          victimKey = k
          break
        }
      }
      if (victimKey === null) break
      const victim = cache.get(victimKey)!
      cache.delete(victimKey)
      Assets.disposeEnvGroup(victim)
    }
  }

  /**
   * 彻底释放一个环境 Group 的 GPU 资源。
   *
   * 旧实现只 dispose 材质、从不 dispose geometry —— 8 个场景来回切会持续
   * 泄漏 vertex buffer。这里两者都释放：sceneenvironment.ts 全程只用
   * 「顶点色 MeshBasicMaterial」，**没有任何贴图**，所以不存在误删共享
   * 贴图/材质单例的隐患，可以放心全部 dispose。
   */
  private static disposeEnvGroup(root: Group): void {
    root.traverse((child: any) => {
      if (!child.isMesh && !child.isLine && !child.isPoints) return
      child.geometry?.dispose?.()
      const mat = child.material
      if (Array.isArray(mat)) mat.forEach((m) => m?.dispose?.())
      else mat?.dispose?.()
    })
    root.clear()
  }

  /** 桌台上色的唯一实现，首次加载与实时换肤共用，避免两份逻辑走偏 */
  private paintTable(scene, cfg, fixUVs: boolean): void {
    scene.traverse((child) => {
      if (!child.isMesh) return
      const materials = Array.isArray(child.material)
        ? child.material
        : [child.material]
      for (let mat of materials) {
        const name = mat.name?.toLowerCase() ?? ""
        if (name.includes("clothshade")) {
          mat.color.set(cfg.clothshadeColor)
          mat.needsUpdate = true
        } else if (name.includes("cloth")) {
          if (fixUVs) this.fixClothUVs(child)
          // v1.3.61：台呢升级为带 sheen 的物理材质（见 upgradeClothMaterial），
          // 再上色 + 挂程序化绒面贴图。替换出的新实例要写回 child.material，
          // 否则渲染时用的还是旧材质。
          const upgraded = this.upgradeClothMaterial(mat, cfg.clothColor)
          if (upgraded !== mat) this.replaceMaterial(child, mat, upgraded)
          mat = upgraded
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
          // v1.3.86：木纹贴图此前同样「挂了但无效」—— GLTF 桌框没有 TEXCOORD_0，
          // 采样恒为 (0,0)。这里补三平面 UV（桌框是立体框，必须用 triplanar
          // 而非顶视投影，见 fixFrameUVs）。
          if (fixUVs) this.fixFrameUVs(child)
          mat.color.set(cfg.frameColor)
          if ("emissive" in mat) {
            ;(mat as any).emissive.set(cfg.frameGlow || 0x000000)
            ;(mat as any).emissiveIntensity = cfg.frameGlow ? 0.9 : 0
          }
          if (cfg.frameTexture) {
            mat.map = cfg.frameTexture
          }
          // v1.3.88：木纹凹凸 + 不均匀光泽。没有这两项，俯视下的桌框
          // 就是一整片均匀色块（颜色有变化但不产生明暗），看着像塑料。
          if ("normalMap" in mat) {
            ;(mat as any).normalMap = cfg.frameNormal
            ;(mat as any).normalScale?.set?.(0.85, 0.85)
          }
          if ("roughnessMap" in mat && cfg.frameRoughness) {
            ;(mat as any).roughnessMap = cfg.frameRoughness
            ;(mat as any).roughness = 1
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
          // v1.3.88：**恢复显示**桌沿菱形镶点（224 顶点、尺寸 15559×8387×15
          // 模型单位的扁平小点，沿桌沿均匀分布）。
          //
          // 病史：v1.3.38 因为「视觉上很突兀」把它 `child.visible = false`
          // 直接隐藏了。但菱形镶点是真实球桌的标志性细节 —— 用户要求
          // 「把桌子本身做精致」，而俯视机位下桌框占画面 67.5%，
          // 一排镶点正是打破整片木色单调的关键。
          //
          // 之所以当年「突兀」：GLTF 原定义是 baseColor=0.8 亮银 + metal=0.77
          // + rough=0.29（高反光镜面金属），在暗绿台面上就是一片刺眼的白点。
          // 现在改为**哑光浅金**：降低金属度与镜面强度、提高粗糙度，
          // 让它像嵌进木头的黄铜钉，而不是贴在表面的亮片。
          mat.color.set(0xc9a86a)
          if ("emissive" in mat) {
            ;(mat as any).emissive.set(0x000000)
            ;(mat as any).emissiveIntensity = 0
          }
          ;(mat as any).map = null
          ;(mat as any).metalness = 0.45
          ;(mat as any).roughness = 0.52
          if ("specularIntensity" in mat) { (mat as any).specularIntensity = 0.4 }
          ;(mat as any).envMapIntensity = 0.5
          mat.needsUpdate = true
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
  /**
   * v1.3.61：把 GLTF 加载的台呢材质（MeshStandardMaterial）升级为
   * MeshPhysicalMaterial 并开启 sheen（织物光泽）。
   *
   * 台呢「素」的根源除了没有贴图，还有材质本身：Standard 材质只有漫反射 +
   * 镜面反射两件套，台呢这种织物的主要视觉特征 —— 掠射角泛白（绒毛把光
   * 散射回观察方向，即 backscatter）—— 它根本渲染不出来，桌面因此像一块
   * 哑光塑料。sheen 正是 three.js 为织物准备的通道。
   *
   * 细节：
   * - 缓存按「原材质实例」索引：同一 GLTF 材质常被多个 mesh 共享，避免重复
   *   创建与重复 dispose；实时换肤再进来时原材质还是那一个，直接命中缓存。
   * - 新实例必须继承原材质的 name（"cloth"）—— paintTable 靠名字路由分支，
     丢了名字第二次换肤就匹配不到了。
   * - sheenColor 取台呢色向白色偏移 35%：真实台呢的绒毛泛光比本色亮。
   */
  private clothMatCache = new Map<unknown, MeshPhysicalMaterial>()
  private upgradeClothMaterial(mat: any, clothColor: number): any {
    if (mat && typeof mat.sheen === "number") {
      // 已是物理材质（实时换肤再次进来）：sheenColor 同步为新主题色，
      // 否则绒毛泛光还停留在第一次进入时的主题色上。
      ;(mat as MeshPhysicalMaterial).sheenColor
        .set(clothColor)
        .lerp(new Color(0xffffff), 0.35)
      return mat
    }
    let phys = this.clothMatCache.get(mat)
    if (phys) return phys
    phys = new MeshPhysicalMaterial({
      map: mat?.map ?? null,
      color: mat?.color ? mat.color.clone() : new Color(clothColor),
      roughness: 0.95,
      metalness: 0,
      sheen: 0.55,
      sheenRoughness: 0.5,
      sheenColor: new Color(clothColor).lerp(new Color(0xffffff), 0.35),
    })
    phys.name = mat?.name ?? ""
    this.clothMatCache.set(mat, phys)
    if (mat && typeof mat.dispose === "function") mat.dispose()
    return phys
  }

  /** 把 mesh 材质（单实例或数组）中的 oldM 实例替换为 newM */
  private replaceMaterial(child: any, oldM: unknown, newM: unknown): void {
    if (Array.isArray(child.material)) {
      if (child.material.includes(oldM)) {
        child.material = child.material.map((m) => (m === oldM ? newM : m))
      }
    } else if (child.material === oldM) {
      child.material = newM
    }
  }

  /**
   * 修正台呢 UV：无 uv 或 uv 塌缩时，按顶视平面投影生成。
   *
   * 台呢是一块**水平平面**，所以顶视投影是精确的（不产生任何拉伸），
   * 且 `generatePlanarUVs` 用 `max(rangeX, rangeV)` 归一会保住长宽比 ——
   * 2.54×1.27 的台面得到 `u∈[0,1] v∈[0,0.52]`，贴图不会被拉扁。
   */
  private fixClothUVs(mesh): void {
    const geometry = mesh.geometry as BufferGeometry
    if (!geometry) return
    if (geometry.attributes.uv && !this.uvsAreCollapsed(geometry)) return
    this.generatePlanarUVs(geometry)
  }

  /**
   * 修正桌框 UV（v1.3.86 新增）。
   *
   * 桌框不是平面，而是**一圈有厚度的立体木框** —— 若照搬台呢的顶视投影，
   * 竖直面（框的侧面）会被压成一条线，木纹糊成条纹。
   *
   * 因此改用**三平面（triplanar）投影**：对每个顶点取法线的主导轴，
   * 再用与它垂直的那两个坐标做 UV。
   *   · 法线偏 Z（顶/底面）→ 用 (x, y)
   *   · 法线偏 X（左右侧面）→ 用 (y, z)
   *   · 法线偏 Y（前后侧面）→ 用 (x, z)
   * 这样每个面都拿到「正对该面」的投影，木纹走向自然、无拉伸。
   *
   * 同样按全局尺寸归一，保证各面木纹尺度一致、接缝不明显。
   */
  private fixFrameUVs(mesh): void {
    const geometry = mesh.geometry as BufferGeometry
    if (!geometry) return
    if (geometry.attributes.uv && !this.uvsAreCollapsed(geometry)) return

    const pos = geometry.attributes.position
    const nor = geometry.attributes.normal
    const count = pos.count
    if (!nor) return

    let minX = Infinity, maxX = -Infinity
    let minY = Infinity, maxY = -Infinity
    let minZ = Infinity, maxZ = -Infinity
    for (let i = 0; i < count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i)
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
      if (z < minZ) minZ = z
      if (z > maxZ) maxZ = z
    }
    const scale = Math.max(maxX - minX, maxY - minY, maxZ - minZ) || 1

    const uvs = new Float32Array(count * 2)
    for (let i = 0; i < count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i)
      const nx = Math.abs(nor.getX(i))
      const ny = Math.abs(nor.getY(i))
      const nz = Math.abs(nor.getZ(i))
      let u: number, v: number
      if (nz >= nx && nz >= ny) {
        u = (x - minX) / scale
        v = (y - minY) / scale
      } else if (nx >= ny) {
        u = (y - minY) / scale
        v = (z - minZ) / scale
      } else {
        u = (x - minX) / scale
        v = (z - minZ) / scale
      }
      uvs[i * 2] = u
      uvs[i * 2 + 1] = v
    }
    geometry.setAttribute("uv", new Float32BufferAttribute(uvs, 2))
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
