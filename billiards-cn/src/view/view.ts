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
  PCFShadowMap,
  BasicShadowMap,
  Fog,
  ACESFilmicToneMapping,
  NoToneMapping,
  ToneMapping,
  Object3D,
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
import { getEnvSpec, INDOOR_CEIL_Z } from "./sceneenvironment"

/* ══════════════════════════════════════════════════════════════════════
 * v1.3.85 室内三件套光照常量
 *
 * 目标：把室内环境材质从不受光的 MeshBasicMaterial 升级为 PBR，同时让
 * **画面平均亮度与改造前一致**（「零变形」保底版），再在此基础上加方向感。
 *
 * 推导：PBR 的漫反射走 BRDF_Lambert，含 1/π 因子
 *   out_linear = albedo_linear × (ambient + Σ dir·max(0,N·L)) × (1/π)
 * 改造前 basic 是
 *   out_linear = albedo_linear
 * 两者相等 ⟹ **ambient + Σ dir·max(0,N·L) = π = 3.14159265**
 *
 * 分配：环境光承担 90%（各向同性，不引入新的明暗差异，保证零变形），
 * 方向光承担 10%（制造方向感，代价是朝水平面最多暗 10%）。
 * ══════════════════════════════════════════════════════════════════════ */

/**
 * 室内环境光强度：0.58 × π。
 *
 * ⚠️ v1.3.86 重大调整：从 1.08×π（占 90% 照度）降到 0.58×π（占 58%）。
 *
 * 原设计（v1.3.85）刻意让环境光承担 90% 照度，理由是「各向同性的光给每个
 * 顶点乘同一个常数，不引入任何空间明暗差异，逐像素保持零变形」。这个论证
 * 本身没错 —— 但它同时也是**画面「平涂、像 2D」的根因**：
 * AmbientLight 没有方向、不产生阴影、对每个面的贡献完全相同，90% 的光来自
 * 它，等于「用一盏均匀的灯把房间照亮」，结果必然是没有一处明暗变化。
 *
 * 用户实测反馈「还是以前版本糟糕的情况」「期望效果：不再是糟糕的 2d 场景」
 * 之后，**「零变形」这条旧约束正式让位给立体感**。
 *
 * 新的配比（保持总照度 ≈ π 不变，防止画面整体变暗/变亮）：
 *   amb  = 0.58·π = 1.8221   （58%）
 *   dir  = 1.10    = 1.1000   （29%）  ← 见 INDOOR_DIR_I
 *   hemi = 0.50    = 0.5000   （13%）  ← 见 indoorHemi
 *   合计 = 3.4221 ≈ π·1.089
 *
 * 配比依据：环境光仍占多数（>50%）以保证暗部不会死黑、场景整体不发闷；
 * 但方向光+半球光合计 42%，足以在墙面/家具侧面/地面之间拉开可见的亮度梯度。
 */
const INDOOR_AMB_I = 0.58 * Math.PI // 1.82212

/**
 * 室内方向光强度。
 *
 * ⚠️ v1.3.86：从 0.42066（10%）提到 1.10（29%），并**换了一个真正斜射的方向**。
 *
 * 旧朝向 (0.35, -0.35, 1.0) 归一化后 z 分量高达 0.896 —— 几乎是**垂直向下照**。
 * 垂直光打在地面上，各处 N·L 都接近 1，**产生不了可见的明暗对比**，这正是它
 * 虽然存在、画面却依然平的原因。
 *
 * 新朝向 (0.75, -0.85, 0.42)：z 分量只有 0.42/1.1965 = 0.351，
 * 是**低仰角斜射**。这样：
 *   · 地面（N=+Z）受光中等
 *   · 墙面朝向光源的一侧明显更亮，背光侧进入阴影
 *   · 家具侧面与顶面形成亮度差 → 立体感
 *
 * 强度推导（保持总照度 ≈ π）：
 *   L = normalize(0.75, -0.85, 0.42)，模长 = 1.19648
 *   L = (0.62684, -0.71042, 0.35102)
 *   朝上表面 N·L = 0.35102
 *   要 dir 贡献 1.10 的照度 ⟹ intensity = 1.10 / 0.35102 = 3.1337
 *
 * 校验各朝向的亮度倍数（含 hemi 贡献，见 indoorHemi 的 hemi(N)）：
 *   朝上（地面）    amb + dir×0.351 + hemi×1.00 = 1.822 + 1.100 + 0.500 = 3.422
 *   朝水平受光面   amb + dir×0.627 + hemi×0.50 = 1.822 + 0.690 + 0.250 = 2.762
 *   朝水平背光面   amb + dir×0     + hemi×0.50 = 1.822 + 0.000 + 0.250 = 2.072
 *   朝下（天花板） amb + dir×0     + hemi×0    = 1.822 + 0.000 + 0.000 = 1.822
 *
 * 即：最亮面 3.422 / 最暗面 1.822 = **1.88 倍**的明暗比。
 * 对比旧方案（朝上 3.815 / 水平背光 2.827 = 1.35 倍，且地面上各处几乎相同），
 * 新方案的立体层次显著更强。
 */
const INDOOR_DIR_I = 1.1 / 0.35102 // 3.1337

/**
 * 室内半球光强度（v1.3.86 新增）。
 *
 * 半球光按法线的 z 分量在「天空色」与「地面色」之间插值，模拟「上方来光、
 * 地面反射回补」这一真实室内最重要的间接光。它直接给出**朝上比朝下亮**的
 * 基础梯度 —— 这是「立体感」的最低成本来源，也是最自然的一层。
 *
 * hemi(N) = intensity × lerp(groundColor, skyColor, N.z/2+0.5)
 * 取 sky=白、ground=浅灰白（0xb8bcc4），则：
 *   N.z = +1（朝上）→ 全 sky  → 系数 1.00
 *   N.z =  0（水平）→ 各半    → 系数 0.50
 *   N.z = −1（朝下）→ 全 ground → 系数 0.00
 *
 * 0.50 这个值的选取：它单独贡献朝上/朝下 0.50 的亮度差，
 * 约占总照度 15%，与方向光的 29% 叠加后共同撑起立体感，
 * 同时不至于让天花板死黑（天花板仍有 amb 的 1.822 托底）。
 */
const INDOOR_HEMI_I = 0.5
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
  /**
   * v1.3.85：室内三件套专用环境光（v1.3.86 起降为辅助角色）。
   *
   * 室内环境物体是 PBR 材质（见 sceneenvironment.envMaterial 的 pbr 参数），
   * BRDF_Lambert 含 1/π 因子，因此照度总和需满足
   * `ambient + Σ dir·max(0,N·L) + hemi(N) ≈ π`，画面才不会整体变暗/变亮。
   *
   * v1.3.85 时它承担 90% 照度，理由是「不引入任何空间明暗差异 → 零变形」。
   * v1.3.86 把它降到 58% —— 那条「零变形」约束正是画面平涂像 2D 的根因，
   * 已让位给立体感。它现在的作用只剩「给暗部托底，避免死黑」。
   */
  private indoorAmb?: AmbientLight
  /**
   * v1.3.86：室内半球光（新增）—— 立体感的第一层来源。
   *
   * 按法线 z 分量在 sky/ground 之间插值：朝上的面最亮、朝下的面最暗，
   * 天然给出「上亮下暗」的基础梯度。这模拟的是真实室内最主导的间接光：
   * 天光/顶灯从上方来，地面再反射回补。
   *
   * ⚠️ v1.3.85 的注释曾明确写着「不用 HemisphereLight，它会破坏零变形」——
   * 那句话在新目标（要立体感）下已失效，故此处显式推翻。
   *
   * 颜色取 sky=纯白、ground=0xb8bcc4（冷浅灰）：
   * 顶点色已烘焙了各场景色偏，所以这盏灯**不能带明显色相**，
   * ground 端只做极轻的冷偏，模拟地面反光的冷调。
   */
  private indoorHemi?: HemisphereLight
  /**
   * v1.3.85：室内方向光（立体感的主要来源，v1.3.86 大幅加强）。
   *
   * v1.3.86 的两处关键改动：
   *   ① 强度 0.42066（10%）→ 3.1337（29%）
   *   ② 朝向 (0.35,-0.35,1.0)（z=0.896，近乎垂直）→
   *          (0.75,-0.85,0.42)（z=0.351，低仰角斜射）
   * 第 ② 条才是关键 —— 垂直光打在地面上各处 N·L 都接近 1，
   * 产生不了可见的明暗对比，所以旧方案虽然「有方向光」画面依然平。
   *
   * ⚠️ 颜色必须是纯白：顶点色已烘焙了各场景色偏（room 暖黄 /
   * cybercafe 冷蓝），带色光会二次染色。
   */
  private indoorDir?: DirectionalLight
  /**
   * 各场景的色调映射（v1.3.63：表驱动，每次显式赋值）。
   *
   * 旧实现是「进雪景存下旧值 → 出雪景还原」。但 renderer 惰性重建后
   * （renderCamera 里的 ensureWebRenderer）会以当前场景再次调 applyScene，
   * 此时 prevToneMapping 被记成 ACES，退出雪景后 ACES 就永久残留了。
   * 表驱动与调用时序无关。未列出的场景一律 NoToneMapping
   * （全局默认，见 utils/webgl.ts）。
   */
  private static readonly SCENE_TONE: Record<
    string,
    { mapping: ToneMapping; exposure: number }
  > = {
    // 雪景：ACES 防雪面高光裁到纯白
    snow: { mapping: ACESFilmicToneMapping, exposure: 0.95 },
  }
  /** 当前 3D 场景环境（足球场/篮球场/雪山）；null 表示用立方体房间 */
  sceneEnv: Group | null = null
  /** 室内场景的顶棚分组（无室内环境时为 null），按相机高度逐帧显隐 */
  private ceiling: Object3D | null = null
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
    // 相机升到层高之上（俯视档）就藏起顶棚，否则顶棚会挡在相机与球桌之间。
    // 相机在层高之下时顶棚在头顶，本来也不入画，所以这个开关没有任何副作用。
    const cg = this.ceiling
    if (cg) cg.visible = this.camera.camera.position.z < INDOOR_CEIL_Z - 0.05
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

    // v1.3.85：室内三件套的真实光源（配合 PBR 化的环境材质）。
    // v1.3.86：改为「环境光 58% + 方向光 29% + 半球光 13%」三灯组合 ——
    //          原先 90% 环境光主导的配比必然平涂，是「画面像 2D」的根因。
    // 强度与朝向的推导见文件头 INDOOR_AMB_I / INDOOR_DIR_I / INDOOR_HEMI_I 注释。
    // 三盏都先建成隐藏，由 applyScene 按 spec.indoor 显式开关。
    this.indoorAmb = new AmbientLight(0xffffff, INDOOR_AMB_I)
    this.indoorAmb.visible = false
    this.scene.add(this.indoorAmb)

    // 半球光：朝上亮、朝下暗的基础梯度，立体感的第一层来源。
    this.indoorHemi = new HemisphereLight(0xffffff, 0xb8bcc4, INDOOR_HEMI_I)
    this.indoorHemi.visible = false
    this.scene.add(this.indoorHemi)

    // 方向光：低仰角斜射（z 分量仅 0.351），负责制造可见的明暗对比。
    this.indoorDir = new DirectionalLight(0xffffff, INDOOR_DIR_I)
    this.indoorDir.position.set(0.75, -0.85, 0.42)
    this.indoorDir.target.position.set(0, 0, 0)
    this.indoorDir.visible = false
    // v1.3.86：开启阴影 —— 球桌投影到地面是「接地感」的关键，
    // 环境物体全部关闭投影时，桌子看起来是「飘」在地面上的。
    this.indoorDir.castShadow = true
    // 阴影贴图 1024²（不用 2048²）：本项目历史上出现过 WebGL 上下文丢失导致的
    // 闪退（v1.3.84f），2048² 的显存与填充率压力在中低端 GPU 上会放大该风险。
    this.indoorDir.shadow.mapSize.set(1024, 1024)
    const dsc = this.indoorDir.shadow.camera
    dsc.near = 0.1
    dsc.far = 12
    // frustum 收窄到球桌周围 ±3m：场景环境物体在 6m 外，不需要参与投影，
    // 收窄可显著减少 shadow pass 的几何量。3m 足以覆盖球桌 + 近处家具。
    dsc.left = -3
    dsc.right = 3
    dsc.top = 3
    dsc.bottom = -3
    this.indoorDir.shadow.bias = -0.0008
    // 斜射光下自阴影（shadow acne）更明显，normalBias 沿法线推移采样点，
    // 对「桌面投影到地面」这种大面积平铺阴影尤其有效。
    this.indoorDir.shadow.normalBias = 0.02
    this.scene.add(this.indoorDir)
    this.scene.add(this.indoorDir.target)

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
      // 室内顶棚：俯视相机会升到层高之上，不藏起来就直接把房间看穿。
      // 按名字抓一次引用，之后每帧只需改一个 visible。
      this.ceiling = env.getObjectByName("CeilingGroup") ?? null
      if (this.ceiling) this.ceiling.visible =
        this.camera.camera.position.z < INDOOR_CEIL_Z - 0.05
      if (this.assets.background) this.assets.background.visible = false
    } else {
      this.assets.recolorScene(sceneId)
      if (this.assets.background) this.assets.background.visible = true
    }
    // 不再 scene.background = null —— 这会让 canvas 透出 body 背景色，
    // 表现为桌面外一片漆黑。改为设一个与 wallA 一致的纯色背景，雪山的
    // skyDome 会渲染在它之上。
    const def = getEnvScene(sceneId)
    this.scene.background = new Color(def.wallA)

    /**
     * v1.3.63：光照 / 雾 / 远裁剪面改由 ENV_SPECS 表驱动。
     *
     * 原先是 `if (sceneId === "snow")` 一个分支 —— 7 个新场景各来一遍
     * 就得复制 7 份，且 far 与天穹半径的自洽性只能靠注释约定。
     * 数值与 v1.3.62 完全一致（雪山 golden 验证通过）。
     */
    const spec = getEnvSpec(sceneId)

    if (this.sun) this.sun.visible = spec.outdoor
    if (this.hemi) this.hemi.visible = spec.outdoor

    /**
     * v1.3.85：室内三件套的真实光源开关。
     *
     * 同样必须「显式赋值」而非「存旧值再还原」—— 本方法会被调用两次
     * （构造后一次、renderer 惰性重建后一次），保存/还原的写法在第二次
     * 调用时会把旧值记成已修改后的状态，导致残留（sun/hemi 在 v1.3.63
     * 就是为了这个坑才改成表驱动）。
     */
    if (this.indoorAmb) this.indoorAmb.visible = spec.indoor
    if (this.indoorHemi) this.indoorHemi.visible = spec.indoor
    if (this.indoorDir) this.indoorDir.visible = spec.indoor

    /**
     * v1.3.86：阴影总开关。
     *
     * 户外（雪山）本来就有 sun.castShadow，靠 spec.outdoor 打开；
     * 室内现在也投阴影（indoorDir.castShadow），因此两者取「或」。
     * 其余场景（沙滩/足球/篮球/UFC）既无阳光也无室内方向光，
     * shadowMap 保持关闭 —— 不产生任何额外开销。
     */
    if (this.renderer) {
      const wantShadow = spec.outdoor || spec.indoor
      if (this.renderer.shadowMap.enabled !== wantShadow) {
        this.renderer.shadowMap.enabled = wantShadow
        // 切换开关后必须让所有材质重新编译着色器，否则阴影不会生效
        this.renderer.shadowMap.needsUpdate = true
      }
      this.renderer.shadowMap.type = spec.indoor
        ? PCFShadowMap
        : BasicShadowMap
    }

    // 远裁剪面：必须能容纳天穹（天穹半径 + 相机最大偏心 22.2）
    this.camera.camera.far = spec.far
    this.camera.camera.updateProjectionMatrix()

    this.scene.fog = spec.fog
      ? new Fog(spec.fog.color, spec.fog.near, spec.fog.far)
      : null

    if (this.ambient) {
      const amb = spec.amb ?? { color: def.amb, intensity: def.ambI }
      this.ambient.color.setHex(amb.color)
      this.ambient.intensity = amb.intensity
    }

    // 真实太阳阴影与程序化接触阴影互斥（避免双重阴影）
    this.setBallsFakeShadow(!spec.realShadow)

    // 色调映射：表驱动显式赋值（v1.3.63，见 View.SCENE_TONE）
    if (this.renderer) {
      const tone = View.SCENE_TONE[sceneId]
      this.renderer.toneMapping = tone ? tone.mapping : NoToneMapping
      this.renderer.toneMappingExposure = tone ? tone.exposure : 1
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
