import {
  Scene,
  WebGLRenderer,
  Frustum,
  Matrix4,
  AmbientLight,
  Color,
  Group,
  Mesh,
  MeshBasicMaterial,
  CircleGeometry,
  TextureLoader,
  DoubleSide,
  DirectionalLight,
  HemisphereLight,
  Fog,
  Vector3,
  ACESFilmicToneMapping,
  ToneMapping,
} from "three"
import { Camera } from "./camera"
import { Drawing } from "./drawing"
import { LineData } from "../events/chatevent"
import { AimEvent } from "../events/aimevent"
import { Table } from "../model/table"
import { Grid } from "./grid"
import { renderer, ensureWebRenderer } from "../utils/webgl"
import { Assets } from "./assets"
import { Snooker } from "../controller/rules/snooker"
import { Settings, getEnvScene } from "../utils/settings"
import { R } from "../model/physics/constants"
import { SNOW_SKY_RADIUS } from "./sceneenvironment"
import { TableGeometry } from "./tablegeometry"

export class View {
  readonly scene = new Scene()
  /**
   * v1.1.10：去掉 readonly，允许折叠屏尺寸恢复后惰性重建。
   * 旧逻辑：构造时若容器为 0（折叠瞬间）→ renderer 永久 undefined → 永久黑屏。
   * 新逻辑：renderCamera 在 renderer 缺失且尺寸>0 时主动重建。
   */
  private renderer: WebGLRenderer | undefined
  camera: Camera
  windowWidth = 1
  windowHeight = 1
  private cachedWidth = 1
  private cachedHeight = 1
  private lastFov = 0
  readonly element
  table: Table
  loadAssets = true
  assets: Assets
  drawing: Drawing
  private ambient?: AmbientLight
  /** Req 3：户外平行太阳光（雪景注入，投影到台呢/雪原） */
  private sun?: DirectionalLight
  /** Req 3：天空天光（半球光，天空蓝/地面雪白） */
  private hemi?: HemisphereLight
  /** 雪景放大的相机远裁剪面（需容纳蓝天穹顶与远景雪山） */
  private static readonly SNOW_FAR = SNOW_SKY_RADIUS + 20
  /**
   * 雪景进入前的色调映射模式（用于退出时还原）。
   * 全局默认 NoToneMapping，雪景开启 ACESFilmicToneMapping 防过曝。
   */
  private prevToneMapping: ToneMapping | null = null
  private prevToneMappingExposure: number = 1
  /** 当前 3D 场景环境（足球场/篮球场/雪山）；null 表示用立方体房间 */
  sceneEnv: Group | null = null
  /** item 6：库边木块上的奥特曼 LOGO 圆盘（一次性创建，复用） */
  private cushionLogos: Group | null = null

  // Reuse objects to reduce garbage collection pressure in high-frequency rendering
  private readonly frustum = new Frustum()
  private readonly projScreenMatrix = new Matrix4()

  constructor(element, table, assets) {
    this.element = element
    this.table = table
    this.assets = assets
    this.renderer = renderer(element)

    if (element) {
      this.cachedWidth = element.offsetWidth
      this.cachedHeight = element.offsetHeight
      this.windowWidth = element.offsetWidth
      this.windowHeight = element.offsetHeight

      if (typeof ResizeObserver !== "undefined") {
        const observer = new ResizeObserver(() => {
          this.cachedWidth = element.offsetWidth
          this.cachedHeight = element.offsetHeight
        })
        observer.observe(element)
      }

      // v1.1.10：折叠屏尺寸从 0 恢复时，webgl.ts 的重试调度会回调此钩子，
      // 主动拉起一次渲染器重建 + 渲染。
      ;(globalThis as any).__rendererReady = (el: HTMLElement) => {
        if (el === this.element) {
          this.ensureRendererAndRender()
        }
      }
    }

    this.camera = new Camera(
      element ? element.offsetWidth / element.offsetHeight : 1
    )
    this.drawing = new Drawing(
      this.scene,
      this.element as HTMLCanvasElement,
      () => this.camera.camera,
      () => this.table.balls
    )
    this.initialiseScene()
  }

  addLine(data: LineData) {
    this.drawing.addLine(data)
  }

  clearLines() {
    this.drawing.clear()
  }

  undoLine() {
    this.drawing.undo()
  }

  set onLineDrawn(callback: (line: LineData) => void) {
    this.drawing.onLineDrawn = callback
  }

  set onBallTap(callback: (ball: import("../model/ball").Ball) => void) {
    this.drawing.onBallTap = callback
  }

  /** 实时更换皮肤（item 1）：串联球杆换肤 + 桌台重着色 */
  applySkin(skinId: string) {
    this.table.cue.applySkin(skinId)
    if (this.assets.table) {
      // 必须把 skinId 透传下去，桌台不能去读带缓存的 Settings
      this.assets.recolorTable(this.assets.table, skinId)
    }
  }

  /** 实时切换球杆主题（item 2） */
  applyCueTheme(themeId: string) {
    this.table.cue.applyCueTheme(themeId)
  }

  /** 实时更换台球桌皮肤（item 5）：重着色台呢/桌框/装饰边，不影响球杆与物理 */
  applyTableSkin(tableSkinId: string) {
    if (this.assets.table) {
      this.assets.recolorTable(this.assets.table, undefined, tableSkinId)
    }
  }

  update(elapsed, aim: AimEvent) {
    this.camera.update(elapsed, aim)
  }

  sizeChanged() {
    // Avoid reading offsetWidth/offsetHeight in high-frequency loops when ResizeObserver is supported.
    // This prevents layout thrashing.
    if (typeof ResizeObserver === "undefined") {
      return (
        this.windowWidth != this.element?.offsetWidth ||
        this.windowHeight != this.element?.offsetHeight
      )
    }
    return (
      this.windowWidth !== this.cachedWidth ||
      this.windowHeight !== this.cachedHeight
    )
  }

  updateSize() {
    const hasChanged = this.sizeChanged()
    if (hasChanged) {
      if (typeof ResizeObserver === "undefined") {
        this.windowWidth = this.element?.offsetWidth
        this.windowHeight = this.element?.offsetHeight
      } else {
        this.windowWidth = this.cachedWidth
        this.windowHeight = this.cachedHeight
      }
    }
    return hasChanged
  }

  render() {
    // v1.2.26：回放模式下禁止自动切俯视。
    // 原逻辑：任意球缓慢移动（isMovingSlowly）或出框（isInMotionNotVisible）时，
    // 每帧 suggestMode(topView) 把相机切到俯视——这是「回放中每次击球后被切成俯视」
    // 的真正根因。回放由自身 forceMode/suggestMode 选定视角（固定=spectatorView /
    // 俯视=topView），不应被这里的实时逻辑覆盖；故回放模式直接跳过。
    if (
      (this.isInMotionNotVisible() || this.isMovingSlowly()) &&
      !this.camera.isZoomedOut &&
      !document.body.classList.contains("replay-mode")
    ) {
      this.camera.suggestMode(this.camera.topView)
    }
    this.renderCamera(this.camera)
  }

  renderCamera(cam) {
    const sizeChanged = this.updateSize()
    const width = this.windowWidth
    const height = this.windowHeight

    // v1.1.10：渲染器惰性重建。
    // 折叠屏折叠瞬间容器为 0，构造时 renderer() 返回 undefined；
    // 尺寸恢复后在这里主动重建，避免永久黑屏。
    if (!this.renderer && width > 0 && height > 0 && this.element) {
      this.renderer = ensureWebRenderer(this.element)
      if (this.renderer) {
        // 新建的 renderer 需要完整初始化一次尺寸/视口/裁剪
        this.renderer.setSize(width, height)
        this.renderer.setViewport(0, 0, width, height)
        this.renderer.setScissor(0, 0, width, height)
        this.renderer.setScissorTest(true)
        cam.camera.aspect = width / height
        cam.camera.updateProjectionMatrix()
        this.lastFov = cam.camera.fov
        // 重建后需要重新应用场景的 clearColor / toneMapping
        this.applyScene(Settings.get().scene)
      }
    }

    if (sizeChanged) {
      this.renderer?.setSize(width, height)
      this.renderer?.setViewport(0, 0, width, height)
      this.renderer?.setScissor(0, 0, width, height)
      this.renderer?.setScissorTest(true)

      cam.camera.aspect = width / height
    }

    if (sizeChanged || cam.camera.fov !== this.lastFov) {
      cam.camera.updateProjectionMatrix()
      this.lastFov = cam.camera.fov
    }

    this.renderer?.render(this.scene, cam.camera)
  }
  /**
   * v1.1.10：供 index.ts 的 resize/orientationchange 监听器调用。
   * 折叠/旋转后主动触发一次尺寸更新 + 渲染。
   */
  ensureRendererAndRender() {
    if (!this.element) return
    // 强制刷新缓存尺寸（折叠后 ResizeObserver 可能尚未回调）
    this.cachedWidth = this.element.offsetWidth
    this.cachedHeight = this.element.offsetHeight
    this.renderCamera(this.camera)
  }

  private initialiseScene() {
    this.ambient = new AmbientLight(0x009922, 0.3)
    this.scene.add(this.ambient)

    // Req 3：户外平行太阳光 + 天空天光。默认隐藏，仅雪景启用。
    // v1.1.6：太阳光改 Z-up（z=26 高位仰角，xy=±9 略偏东南）；
    //       强度 2.4→1.8，配合雪景 ACES 色调映射避免过曝；
    //       阴影锥缩到 ±4，仅覆盖台呢与母球区域（山体在锥外，省 shadow pass）。
    this.sun = new DirectionalLight(0xfff4e0, 1.8)
    this.sun.position.set(9, -6, 26)
    this.sun.castShadow = true
    // 阴影贴图 2048²→1024²：雪景 + 多球阴影下，2048² 会显著增加显存与
    // 填充率压力，在中低端 GPU 上易触发 WebGL 上下文丢失（表现为黑屏）。
    // 1024² 对台球桌尺度已足够清晰，显存占用降为 1/4。
    this.sun.shadow.mapSize.set(1024, 1024)
    const sc = this.sun.shadow.camera
    sc.near = 0.1
    sc.far = 14
    sc.left = -4
    sc.right = 4
    sc.top = 4
    sc.bottom = -4
    this.sun.shadow.bias = -0.0006
    this.sun.target.position.set(0, 0, -0.18)
    this.sun.visible = false
    this.scene.add(this.sun)
    this.scene.add(this.sun.target)

    // v1.1.6：hemi 颜色偏冷亮（天空浅蓝 / 雪地反光白），强度微调到 0.55
    this.hemi = new HemisphereLight(0xb8d8f5, 0xfafdff, 0.55)
    this.hemi.visible = false
    this.scene.add(this.hemi)
    // Request D-v2：3D 房间（天空盒）作为环境，台球桌置于房间中央，
    // 得到「台球桌放在真实场景里的 3D 效果」。
    if (this.assets.background) this.scene.add(this.assets.background)
    this.scene.add(this.assets.table)
    this.table.mesh = this.assets.table
    // v1.3.46：删除桌面网格线（用户要求桌面不显示网格）。
    // const isSnooker = this.assets.rules.asset === Snooker.tablemodel
    // this.scene.add(new Grid().generateLineSegments(isSnooker))
    // v1.2.11 #F7：删除台面上的奥特曼 LOGO 圆盘（用户要求删除台球桌面上的图标）。
    // this.applyCushionLogos()
    // 初始应用环境场景
    this.applyScene(Settings.get().scene)
  }

  /**
   * item 6：库边品牌 LOGO
   *
   * 在四条长边的中部和两条短边的中部各放置一枚奥特曼 LOGO 圆盘，
   * 浮在台呢上方的库边木条表面上，从俯视与瞄准两种镜头下都能看到。
   *
   * LOGO 直接加到主 scene（不挂到 table 子树），使用 TableGeometry 提供的
   * 物理坐标；高度根据场景中所有可见 mesh 的实际渲染高度自适应，
   * 与 GLTF 模型的内部缩放/拉伸规则完全解耦。
   */
  private applyCushionLogos() {
    if (this.cushionLogos) return
    const X = TableGeometry.X
    const Y = TableGeometry.Y
    // 圆盘直径：约为库边宽度（≈ 2R）的 72%
    const radius = (2 * 0.03275 * 0.72) / 2

    const group = new Group()
    group.name = "CushionLogos"
    // 位置（以物理坐标轴为准，X 沿长边，Y 沿短边）：
    //   长边（y=±Y）上各放 2 枚，左右对称
    //   短边（x=±X）上各放 1 枚，位于中段
    const xOff = X * 0.62
    const placements: Array<{ pos: [number, number]; rotZ: number }> = [
      // 上长边
      { pos: [xOff, Y], rotZ: 0 },
      { pos: [-xOff, Y], rotZ: 0 },
      // 下长边
      { pos: [xOff, -Y], rotZ: 0 },
      { pos: [-xOff, -Y], rotZ: 0 },
      // 左右短边
      { pos: [X, 0], rotZ: Math.PI / 2 },
      { pos: [-X, 0], rotZ: Math.PI / 2 },
    ]
    for (const p of placements) {
      const m = new Mesh(
        new CircleGeometry(radius, 36),
        new MeshBasicMaterial({
          color: 0xffffff,
          transparent: true,
          side: DoubleSide,
          toneMapped: false,
          fog: false,
          depthWrite: false,
        })
      )
      m.position.set(p.pos[0], p.pos[1], 0)
      /* v1.2.8 #E5：LOGO 圆盘「水平平铺」在台呢上，而非「立」在台上。
         本游戏为 Z-up（见 v1.1.6 注释），CircleGeometry 默认在 XY 平面、法线 +Z（即朝上），
         圆盘天然贴合台面。原 rotation.x = -π/2 会把法线拧到 +Y（水平方向），
         导致圆盘竖立在台面上、像一块立牌 —— 这正是用户反馈的「立在台球桌上」。
         改为 0：圆盘法线回到 +Z，平躺于台呢，俯视/斜俯视下即「平铺」效果。
         rotation.z = rotZ 仍用于在盘面内旋转短边 LOGO 的方向。 */
      m.rotation.x = 0
      m.rotation.z = p.rotZ
      m.renderOrder = 5
      m.userData.pendingLogo = true
      group.add(m)
    }

    this.scene.add(group)
    this.cushionLogos = group

    // 异步加载 LOGO 贴图，加载完成后再贴上去
    const onReady = () =>
      this.liftLogosAboveCloth(group, this.assets.table)
    new TextureLoader().load(
      "assets/cushion-icon.png",
      (tex) => {
        // 三套兼容写法设置 sRGB：直接赋值 / 通过 SRGBColorSpace 常量
        try {
          ;(tex as any).colorSpace = "srgb"
        } catch (e) {
          /* 老版 three.js 不支持 colorSpace 字段，跳过 */
        }
        try {
          ;(tex as any).colorSpace =
            (window as any).THREE?.SRGBColorSpace ?? "srgb"
        } catch (e) {
          /* 旧版本无 SRGBColorSpace，跳过 */
        }
        group.traverse((o) => {
          const mm = o as Mesh
          if (!mm.isMesh) return
          const mat = mm.material as MeshBasicMaterial
          mat.map = tex
          mat.color.set(0xffffff)
          mat.needsUpdate = true
          delete mm.userData.pendingLogo
        })
        onReady()
      },
      undefined,
      () => {
        // 加载失败：保留占位白圆盘，不影响其它游戏逻辑
        group.traverse((o) => {
          const mm = o as Mesh
          if (!mm.isMesh) return
          mm.userData.pendingLogo = false
        })
        onReady()
      }
    )
  }

  /**
   * 把 LOGO 抬到主场景中所有可见 mesh 的世界空间最大 z 之上 ~0.0015 处。
   * 这样无论 GLTF 模型被 scaleTableModel 怎样拉伸/缩放，LOGO 都会自然落在
   * 台呢顶面之上，不会陷进几何里。
   */
  private liftLogosAboveCloth(group: Group, tableRoot: any) {
    let maxWorldZ = -Infinity
    tableRoot.updateMatrixWorld(true)
    tableRoot.traverse((o: any) => {
      if (!o.isMesh) return
      const box = o.geometry?.boundingBox
      if (!box) return
      // mesh 的 world matrix 应用到 bounding box 的 8 个角，取最大 z
      const m = o.matrixWorld
      const corners = [
        [box.min.x, box.min.y, box.min.z, 1],
        [box.min.x, box.min.y, box.max.z, 1],
        [box.min.x, box.max.y, box.min.z, 1],
        [box.min.x, box.max.y, box.max.z, 1],
        [box.max.x, box.min.y, box.min.z, 1],
        [box.max.x, box.min.y, box.max.z, 1],
        [box.max.x, box.max.y, box.min.z, 1],
        [box.max.x, box.max.y, box.max.z, 1],
      ]
      for (const c of corners) {
        const wx = m.elements[0] * c[0] + m.elements[4] * c[1] + m.elements[8] * c[2] + m.elements[12]
        const wy = m.elements[1] * c[0] + m.elements[5] * c[1] + m.elements[9] * c[2] + m.elements[13]
        const wz = m.elements[2] * c[0] + m.elements[6] * c[1] + m.elements[10] * c[2] + m.elements[14]
        if (wz > maxWorldZ) maxWorldZ = wz
      }
    })
    if (!isFinite(maxWorldZ)) return
    // 库边通常比台呢顶面高 0.02（球桌物理尺寸），所以再往上抬一点点
    const lift = maxWorldZ + 0.005
    group.children.forEach((c) => {
      const cm = c as Mesh
      cm.position.set(cm.position.x, cm.position.y, lift)
    })
  }

  /**
   * item 6：库边品牌 LOGO
   *
   * 在四条长边的中部和两条短边的中部各放置一枚奥特曼 LOGO 圆盘，
   * 浮在台呢上方的库边木条表面上，从俯视与瞄准两种镜头下都能看到。
   *
   * LOGO 位置基于 TableGeometry 提供的物理坐标（不受模型内部缩放影响），
   * 高度则根据球桌实际 mesh 的 bounding box 抬到台呢顶面之上，
   * 与 GLTF 模型缩放后尺寸自动适配。
   */

  /** 应用环境场景（item 4 / Request D-v3）：3D 几何场景或立方体房间 + 环境光 + 兜底色 */
  applyScene(sceneId: string) {
    // Request D-v3：足球场/篮球场/雪山用真正搭建的几何 3D 环境，
    // 其他场景继续用立方体房间（贴图天空盒）。
    if (this.sceneEnv) {
      this.scene.remove(this.sceneEnv)
      this.sceneEnv = null
    }
    const env = this.assets.getSceneEnvironment(sceneId)
    if (env) {
      this.scene.add(env)
      this.sceneEnv = env
      if (this.assets.background) this.assets.background.visible = false
    } else {
      this.assets.recolorScene(sceneId)
      if (this.assets.background) this.assets.background.visible = true
    }
    // 不再 scene.background = null —— 这会让 canvas 透出 body 背景色，
    // 表现为桌面外一片漆黑。改为设一个与 wallA 一致的纯色背景，雪山的
    // skyDome 会渲染在它之上。
    const defEarly = getEnvScene(sceneId)
    this.scene.background = new Color(defEarly.wallA)

    const def = getEnvScene(sceneId)

    if (sceneId === "snow") {
      // Req 2/3/4：雪山启用户外光照 + 阴影 + 大气透视 + 远景远裁剪面
      if (this.sun) this.sun.visible = true
      if (this.hemi) this.hemi.visible = true
      if (this.ambient) {
        // 降低环境光填充，让太阳光主导，阴影更自然
        this.ambient.color.setHex(0xdfeaff)
        this.ambient.intensity = 0.32
      }
      // 放大远裁剪面以容纳蓝天穹顶（半径 145）与远景雪山（外缘 120）
      this.camera.camera.far = View.SNOW_FAR
      this.camera.camera.updateProjectionMatrix()
      /**
       * 大气透视：v1.3.62d 从 (30, 250) 推到 (70, 320)。
       *
       * 原参数下近景山脊（r=26~62）就被雾化 0~13%，远山（62~120）更是
       * 21%~41% —— 雾把山体的明暗差按 (1-fogFactor) 线性压缩，
       * 实测山体亮度中位数被抬到 196、p90 只有 215，全挤在亮部发灰。
       * 推远后：近景山脊完全不雾化，远山最多 20%，既保住对比度
       * 又保留「远山淡入天色」的纵深感。
       */
      this.scene.fog = new Fog(0xd3e9f7, 70, 320)
      // 雪景：用真实太阳光阴影，隐藏程序化接触阴影，避免双重阴影
      this.setBallsFakeShadow(false)
      // v1.1.6：开启 ACES 色调映射防过曝（雪面高光不再裁到纯白）
      if (this.renderer) {
        this.prevToneMapping = this.renderer.toneMapping
        this.prevToneMappingExposure = this.renderer.toneMappingExposure
        this.renderer.toneMapping = ACESFilmicToneMapping
        this.renderer.toneMappingExposure = 0.95
      }
    } else {
      // 其他场景：关闭户外光照与阴影，恢复原始近裁剪/远裁剪与无雾
      if (this.sun) this.sun.visible = false
      if (this.hemi) this.hemi.visible = false
      this.scene.fog = null
      this.camera.camera.far = R * 1000
      this.camera.camera.updateProjectionMatrix()
      if (this.ambient) {
        this.ambient.color.setHex(def.amb)
        this.ambient.intensity = def.ambI
      }
      // 非雪景：使用程序化接触阴影
      this.setBallsFakeShadow(true)
      // 退出雪景时还原色调映射
      if (this.renderer && this.prevToneMapping !== null) {
        this.renderer.toneMapping = this.prevToneMapping
        this.renderer.toneMappingExposure = this.prevToneMappingExposure
        this.prevToneMapping = null
      }
    }

    // 非黑兜底色
    this.renderer?.setClearColor(new Color(def.wallA), 1)
  }

  /** 切换所有球的程序化接触阴影显隐（雪景隐藏，改用真实太阳光阴影） */
  private setBallsFakeShadow(visible: boolean): void {
    const balls = this.table?.balls
    if (!balls) return
    for (const b of balls) {
      const bm = (b as any).ballmesh
      if (bm && bm.shadow) bm.shadow.visible = visible
    }
  }

  ballToCheck = 0

  isInMotionNotVisible() {
    const frustum = this.viewFrustum()
    const b = this.table.balls[this.ballToCheck++ % this.table.balls.length]
    // 守卫：若某球尚未完成网格初始化（ballmesh 未就绪），直接返回 false，
    // 避免访问 undefined 抛出未捕获异常——否则在重场景（多球）下可能杀掉
    // 整个动画循环，表现为永久黑屏。
    const bm = (b as any).ballmesh
    if (!bm || !bm.mesh) return false
    return b.inMotion() && !frustum.intersectsObject(bm.mesh)
  }

  isMovingSlowly() {
    // 白球击球后，球缓慢移动时切换上帝视角
    const slowThreshold = 0.15
    return this.table.balls.some(
      (b) => b.inMotion() && b.vel.length() > 0 && b.vel.length() < slowThreshold
    )
  }

  viewFrustum() {
    const c = this.camera.camera
    this.frustum.setFromProjectionMatrix(
      this.projScreenMatrix.multiplyMatrices(
        c.projectionMatrix,
        c.matrixWorldInverse
      )
    )
    return this.frustum
  }
}
