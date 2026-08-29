/*!
 * 球杆主题预览 —— three.js 3D 渲染（v1.3.52 改全屏 + 手势，v1.3.54 复用游戏内真实球杆）
 * 由 menu-cn.js 在点击「已选中的球杆卡片」时按需初始化，
 * 使用 window.THREE（dist/three.standalone.js）。
 *
 * v1.3.54 改动（本版重点）：
 *   - 球杆不再由本文件自己拼装。此前预览用的是一套"简化模型"：总长 5.0、杆尾
 *     半径 0.28（长径比 8.9:1），配色只用卡片上的两个色值；而游戏内真实球杆是
 *     长径比 46.7:1（全长 R*43、杆尾半径 (R*0.23)/0.5）+ 程序化分区贴图。
 *     两者完全不同，用户看到的预览"不是真实球杆"。
 *   - 现改为复用游戏内资源：dist/cue-texture-factory.js（由 tools/cue-textures/
 *     从 src/view/cuetexturefactory.ts + src/utils/settings.ts 原样打包）挂
 *     window.CueGameCue，本文件取其真实贴图与真实几何参数组装球杆，
 *     与 src/view/cuemesh.ts 的 cueGeometry() / applyCueTheme() 逐项对齐。
 *   - 删除了本文件里那套与游戏内并存的 THEMES 配置表与木纹/皮革绘制器（约 680 行），
 *     从根源上杜绝"预览与实机不一致"。
 *
 * v1.3.52 改动：
 *   - 预览窗由 300×130 小窗改为全屏；球杆由截断（总长 4.1、无先角/皮头）
 *     改为完整（总长 5.0，含先角 + 皮头）
 *   - 相机改为球坐标轨道：yaw 自由 360°、pitch 限位、双指捏合缩放；取消自动旋转
 *   - 按需渲染（dirty flag）：手指不动时不排任何 rAF，比旧的常驻循环省电
 *
 * 【红线】WebGL 渲染上下文整个页面生命周期只创建一次、永不销毁。
 * 关闭预览时只能 stop()，绝不调用 dispose() / forceContextLoss()——
 * v1.3.32 的「第二次预览白屏」就是这么来的。详见 dispose() 上的说明。
 *
 * 【红线 2】material.map 由 window.CueGameCue 全局缓存持有，
 * 切主题清理子树时只能 dispose geometry/material，**绝不能 dispose map**——
 * 否则缓存里的 Texture 被释放后，再次切回该主题球杆会变纯黑。见 disposeTree()。
 */
;(function (global) {
  "use strict"
  var THREE = global.THREE
  if (!THREE) {
    console.error("[cuePreview3D] window.THREE 未加载，无法初始化 3D 预览")
    return
  }

  // ---------- 颜色工具 ----------
  function hexToNum(hex) { return parseInt((hex || "#000000").replace("#", ""), 16) }

  function parseColor(hex) {
    var n = hexToNum(hex)
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 }
  }

  function rgbToHex(c) {
    return "#" + ((1 << 24) + (clamp(c.r) << 16) + (clamp(c.g) << 8) + clamp(c.b)).toString(16).slice(1)
  }

  function clamp(v) { return Math.max(0, Math.min(255, Math.round(v))) }

  function makeFloorTexture() {
    var size = 512
    var canvas = document.createElement("canvas")
    canvas.width = size; canvas.height = size
    var ctx = canvas.getContext("2d")
    var grad = ctx.createRadialGradient(size / 2, size / 2, 20, size / 2, size / 2, size * 0.7)
    grad.addColorStop(0, "rgba(30,45,75,0.55)")
    grad.addColorStop(0.6, "rgba(12,18,35,0.35)")
    grad.addColorStop(1, "rgba(10,16,32,0)")
    ctx.fillStyle = grad
    ctx.fillRect(0, 0, size, size)
    var tex = new THREE.CanvasTexture(canvas)
    tex.wrapS = THREE.ClampToEdgeWrapping
    tex.wrapT = THREE.ClampToEdgeWrapping
    return tex
  }

  function useLowQuality(renderer) {
    if (!renderer) return true
    var cap = renderer.capabilities
    if (!cap) return true
    if (cap.maxVertexTextures === 0) return true
    return false
  }

  // ---------- 球杆几何组装（v1.3.54：复用游戏内真实球杆） ----------

  /**
   * 游戏内资源入口。
   *
   * dist/cue-texture-factory.js 由 tools/cue-textures/ 从 src/view/cuetexturefactory.ts
   * 与 src/utils/settings.ts 原样打包而来（three 走 external→window.THREE），挂
   * window.CueGameCue。预览因此与游戏共用同一份程序化贴图代码与同一组几何参数，
   * 不再是"另起炉灶的简化模型"——v1.3.54 之前就是这样：预览自己维护了一套
   * L=5.0 / 杆尾半径 0.28（长径比 8.9:1）的胖棒槌，与游戏内真实球杆的 46.7:1
   * 完全不同，用户一眼就能看出"不是真实球杆"。
   */
  function gameCue() {
    var G = global.CueGameCue
    if (!G || !G.CUE_GEOM || !G.getCueTexture) {
      throw new Error("cue-texture-factory.js 未加载（window.CueGameCue 缺失）")
    }
    return G
  }

  /**
   * 与 src/view/cuemesh.ts 的 shade() 完全一致：amount>0 提亮，<0 压暗。
   * auto（随台面）主题用它从台呢色派生杆身 / 杆尾颜色。
   */
  function shade(hex, amount) {
    var r = (hex >> 16) & 0xff
    var g = (hex >> 8) & 0xff
    var b = hex & 0xff
    function f(c) {
      return Math.max(0, Math.min(255, Math.round(
        amount >= 0 ? c + (255 - c) * amount : c * (1 + amount)
      )))
    }
    return (f(r) << 16) | (f(g) << 8) | f(b)
  }

  /**
   * 组装球杆。四段圆柱 cueButt / cueShaft / cueFerrule / cueTip，周向分段 9，
   * 与 src/view/cuemesh.ts 的 cueGeometry() + applyCueTheme() 逐项对齐：
   *   - 比例：杆尾 0.28 / 杆身 0.71 / 先角 0.007，皮头厚 0.0055
   *   - 半径：杆尾端 (R*0.23)/0.5、杆头端 (R*0.07)/0.5、杆尾顶端 ×0.9、皮头顶端 ×0.93
   *   - 材质：MeshPhongMaterial；杆身/杆尾套游戏内分区贴图，auto 时由台呢色派生
   * 几何按游戏内真实尺寸建好后再整体缩放到预览世界尺度（总长 5.0），
   * 这样相机 / 地面 / 倒影 / 光环的既有常量全部沿用，改动收敛在几何与材质上。
   */
  function buildCue(opts) {
    var G = gameCue()
    var GEO = G.CUE_GEOM
    var themeId = opts.cueTheme || "auto"
    var theme = G.getCueTheme(themeId)
    var skin = G.getSkin(opts.skin)
    var cloth = G.getTableSkin(opts.tableSkin).clothColor

    var S = 5.0 / GEO.length // 统一缩放到预览世界尺度（总长 5.0）
    var L = GEO.length * S
    var tipR = GEO.tipRadius * S
    var buttR = GEO.buttRadius * S
    var buttL = L * GEO.buttLengthRatio
    var shaftL = L * GEO.shaftLengthRatio
    var ferruleL = L * GEO.ferruleLengthRatio
    var tipH = GEO.tipHeight * S
    var seg = GEO.segments

    // 杆身 / 杆尾两张分区贴图（auto 返回 null，走下面的颜色派生分支）
    var shaftTex = G.getCueTexture(themeId)
    var buttTex = G.getCueButtTexture(themeId)

    var group = new THREE.Group()

    function phong(color, shininess) {
      return new THREE.MeshPhongMaterial({ color: color, shininess: shininess })
    }
    function add(geo, mat, y, name) {
      var m = new THREE.Mesh(geo, mat)
      m.name = name
      m.position.y = y
      group.add(m)
      return m
    }

    // applyCueTheme() 的等价实现：贴图优先，无贴图时按台呢色派生；
    // 光泽优先取主题 finish，其次才是几何默认值（有贴图时不覆盖，与游戏内一致）。
    function applyTheme(mat, isButt) {
      var tex = isButt ? buttTex : shaftTex
      if (tex) {
        mat.map = tex
        mat.color.setHex(0xffffff)
      } else {
        mat.map = null
        mat.color.setHex(isButt ? shade(cloth, -0.28) : shade(cloth, 0.12))
      }
      if (theme.finish) {
        mat.shininess = isButt ? theme.finish.butt : theme.finish.shaft
      } else if (!tex) {
        mat.shininess = isButt ? 80 : 50
      }
      mat.needsUpdate = true
    }

    // cueGeometry() 的四段材质基色：杆身/杆尾取皮肤色（随后被 applyTheme 覆盖），
    // 先角为浅米白硬材质、皮头取皮肤 tipColor。
    var shaftMat = phong(skin.shaftColor, 50)
    var buttMat = phong(skin.buttColor, 80)
    applyTheme(shaftMat, false)
    applyTheme(buttMat, true)

    var buttY = -L / 2
    add(new THREE.CylinderGeometry(buttR * GEO.buttTopRatio, buttR, buttL, seg),
      buttMat, buttY + buttL / 2, "cueButt")
    var shaftY = buttY + buttL
    add(new THREE.CylinderGeometry(tipR, buttR * GEO.buttTopRatio, shaftL, seg),
      shaftMat, shaftY + shaftL / 2, "cueShaft")
    var ferruleY = shaftY + shaftL
    add(new THREE.CylinderGeometry(tipR, tipR, ferruleL, seg),
      phong(GEO.ferruleColor, GEO.ferruleShininess), ferruleY + ferruleL / 2, "cueFerrule")
    var tipY = ferruleY + ferruleL
    add(new THREE.CylinderGeometry(tipR * GEO.tipTopRatio, tipR, tipH, seg),
      phong(skin.tipColor, GEO.tipShininess), tipY + tipH / 2, "cueTip")

    return group
  }

  // ---------- v1.3.52 轨道相机常量 ----------
  var FOV = 34 // 与 new PerspectiveCamera 的第一个参数保持一致
  var HALF_LEN = 2.5 // 完整球杆半长（含先角 + 皮头，总长 5.0）
  // v1.3.54：球杆最大半径（杆尾端）不再是写死的 0.28。
  // 预览改用游戏内真实球杆后，半径由 CUE_GEOM 按真实长径比 46.7:1 反算：
  //   buttR = ((R*0.23)/0.5) × (5.0 / (R*43)) ≈ 0.0535
  // 旧值 0.28 对应长径比仅 8.9:1，正是预览"看着不像球杆"的根因。
  // 用惰性求值：CueGameCue 尚未加载时（模块初始化阶段）先退回旧值，
  // buildCue() 真正建几何前必然已加载，届时取到的是真实值。
  var HALF_RAD = 0.28
  function syncHalfRad() {
    var G = global.CueGameCue
    if (G && G.CUE_GEOM) {
      HALF_RAD = G.CUE_GEOM.buttRadius * (5.0 / G.CUE_GEOM.length)
      FIT_R = Math.sqrt(HALF_LEN * HALF_LEN + 2 * HALF_RAD * HALF_RAD)
    }
    return HALF_RAD
  }
  var FILL_H = 0.92 // 水平留边：球杆最多占到可视宽度的 92%
  var FILL_V = 0.86 // 垂直留边：给顶部主题名、底部操作提示留白
  var ZOOM_MIN = 0.35 // 缩放绝对下限（兜底，见下方 SAFE_CLEAR 说明）
  var ZOOM_MAX = 1.6
  // 球杆包围球半径：sqrt(HALF_LEN² + 2·HALF_RAD²)。
  // 真实球杆下 = sqrt(2.5² + 2×0.0535²) ≈ 2.5011（旧简化模型为 2.5311）。
  // 用于缩放下限——相机距离小于它就会退进球杆内部，看到背面 / 内壁，画面发黑或过曝。
  // v1.3.54：HALF_RAD 会随 syncHalfRad() 变化，故 FIT_R 也一并重算（见 syncHalfRad）。
  var FIT_R = Math.sqrt(HALF_LEN * HALF_LEN + 2 * HALF_RAD * HALF_RAD)
  // 相机与包围球表面之间保留的最小间隙。v1.3.52-fix：ZOOM_MIN 原先写死 0.35，
  // 在横屏（baseDist≈4.27）下对应相机距离仅 1.50，远小于包围球半径 2.53——
  // 双指捏合到底时相机直接穿进球杆里：实测 yaw=88° 时画面平均亮度从 51 崩到 4.7
  // （全黑），yaw=30° 时又过曝到 172。改为按下限动态求解：
  //   zoomMin = max(ZOOM_MIN, (FIT_R + SAFE_CLEAR) / baseDist)
  // 横屏得 0.756（可再拉近约 25%），竖屏 baseDist≈9.90 得 0.316、由绝对下限兜到 0.35。
  var SAFE_CLEAR = 0.7
  // pitch 限位。横屏下限 -18° 是硬边界：相机 y = d·sin(pitch) + pan，再低就会
  // 掉到地板 y=-1.35 以下，倒影直接穿帮。看端盖细节靠 yaw 转到杆头正对相机，
  // 不需要大俯仰；限制 pitch 还能让球杆始终接近水平，占满屏幕宽度、细节最大。
  var PITCH_MIN_H = -18
  var PITCH_MAX_H = 20
  var PITCH_LIMIT_V = 70 // 竖屏时地面已隐藏，可以随便俯仰
  // 求 baseDist 时的采样姿态：取这些姿态下需求距离的最大值，保证全角度不出画。
  // 只需采 0°~180°：包围盒 [±2.5, ±0.28, ±0.28] 中心对称，(yaw, pitch) 与
  // (yaw+180, −pitch) 完全等价；实测 0~180 与 0~360 逐点扫描结果逐位一致。
  // pitch 只采「下限 / 0 / 上限」三档：以 0.5° 步长稠密扫描确认最差点必然落在这三档。
  // 步长 6°（31 个样本）是精度与耗时的平衡点：15° 会漏掉真正的最差点、导致 0.48%
  // 出画；6° 的残余出画仅 0.006%（≈0.03px，肉眼不可见），relayout 全程约 4ms。
  var FIT_YAW_STEP = 6
  var FIT_PITCHES = [-18, 0, 20]
  var CENTER_ITERS = 18 // 居中二分次数，残差约 2e-5 NDC（≈0.02px）
  var FIT_ITERS = 22 // 距离二分次数

  // ---------- 主类 ----------
  function CuePreview3D(canvas) {
    this.canvas = canvas
    this.renderer = null
    this.scene = null
    this.camera = null
    this.cue = null
    this.reflection = null
    this.cuePivot = null
    this.reflectionPivot = null
    this.floor = null
    this.ring = null
    this.raf = null
    this.running = false
    this.quality = "high"
    // v1.3.54：球杆几何与贴图全部由 cueTheme / skin / tableSkin 三个游戏内 ID 决定，
    // 走 window.CueGameCue 取真实资源（见 buildCue）。
    // wood / dark / metal / tip 只剩一个用途：倒影的整体压暗色（dark）与兼容旧调用方。
    this.theme = {
      wood: "#d2b48c", dark: "#1a1a1a", metal: "#c9a24b", tip: "#2f7d4f",
      pattern: "auto",
      cueTheme: "auto", // 球杆主题 ID（CUE_THEMES[].id，与 kind 同名）
      skin: "classic", // SKINS[].id：皮头色 / 杆身杆尾基色
      tableSkin: "classic" // TABLE_SKINS[].id：auto 主题的颜色派生源
    }
    // v1.3.52：球坐标轨道相机（角度单位：度）。yaw 自由 360°；pitch 限位见下方
    // PITCH_MIN_H / PITCH_MAX_H / PITCH_LIMIT_V。zoom 是基准距离的倍数，由双指捏合控制。
    this.orbit = { yaw: 30, pitch: 12, zoom: 1 }
    this.baseDist = 4.5 // 由 relayout() 按画布宽高比算出的静态基准距离
    this.zoomMin = ZOOM_MIN // 由 relayout() 按 baseDist 与包围球半径算出，保证相机不进球杆内部
    this.vertical = false // 竖屏：球杆改为竖直放置并隐藏地面/倒影
    this._raf = null // 按需渲染的 rAF 句柄（与 start/stop 用的 this.raf 相互独立）
    this._fitA = 0 // relayout 记忆化：上次拟合用的宽高比（0 = 从未拟合过）
    this._fitVert = null // relayout 记忆化：上次拟合时的朝向
    this._onResize = this._onResize.bind(this)
    this._loop = this._loop.bind(this)
  }

  CuePreview3D.prototype.init = function () {
    var THREE = global.THREE
    var self = this
    try {
      this.renderer = new THREE.WebGLRenderer({
        canvas: this.canvas, antialias: true, alpha: true, preserveDrawingBuffer: false
      })
      // v1.3.52：全屏下 DPR2 约 1000 万像素，对中低端机压力过大，上限压到 1.5
      this.renderer.setPixelRatio(Math.min(global.devicePixelRatio || 1, 1.5))
      this.renderer.setClearColor(0x0a1020, 1)
      this.renderer.outputColorSpace = THREE.SRGBColorSpace
      this.renderer.toneMapping = THREE.ACESFilmicToneMapping
      this.renderer.toneMappingExposure = 1.05
      if (useLowQuality(this.renderer)) {
        this.quality = "low"
        this.renderer.toneMapping = THREE.NoToneMapping
      }
    } catch (e) {
      console.error("[cuePreview3D] WebGLRenderer 创建失败", e)
      return
    }

    this.scene = new THREE.Scene()
    // v1.3.52：机位不再写死。相机改为球坐标轨道（yaw / pitch / zoom），由 applyCamera()
    // 每次渲染前按 orbit 状态计算；基准距离 baseDist 由 relayout() 依画布宽高比算出。
    // 旧的 (-2.2, 1.4, 2.8) / lookAt(0.6,0,0) 是为 300×130 小窗调的，全屏后宽高比
    // 从 2.3 变成 2.17~0.46，固定机位会让球杆严重偏小或偏位。
    // FOV 仍保持 34°：26°~40° 之间近端膨胀比只从 1.16 变到 1.23，改了不划算。
    this.camera = new THREE.PerspectiveCamera(34, 1, 0.1, 100)

    var hemi = new THREE.HemisphereLight(0xaec4e8, 0x070a12, 0.65)
    this.scene.add(hemi)
    // 主光：更暖更强，突出杆身材质高光
    var key = new THREE.DirectionalLight(0xfff4e0, 1.8)
    key.position.set(4, 7, 7)
    this.scene.add(key)
    // 轮廓光：从后下方打，让横置杆身有立体边缘
    var rim = new THREE.DirectionalLight(0xffd080, 0.9)
    rim.position.set(-5, -1, -5)
    this.scene.add(rim)
    var fill = new THREE.DirectionalLight(0xc8ddff, 0.6)
    fill.position.set(0, -3, 6)
    this.scene.add(fill)
    var back = new THREE.DirectionalLight(0x4a6a9a, 0.35)
    back.position.set(0, 5, -6)
    this.scene.add(back)

    // v1.3.54：完整球杆（含先角+皮头，总长 5.0）。摆放统一交给 applyLayout()：
    // 横屏放平到 X 轴且 position.x = 0（完整杆中心就在原点；旧值 -0.45 是为
    // 截断杆 local Y∈[-2.5,1.6] 居中的，全杆时会整体偏左）；竖屏保持竖直。
    // 建几何前先同步真实半径，保证 relayout() 的包围球 / 缩放下限用的是同一套尺寸。
    syncHalfRad()
    this.cue = buildCue(this.theme)
    this.cuePivot = new THREE.Group()
    this.cuePivot.add(this.cue)
    this.scene.add(this.cuePivot)

    this.reflection = buildCue(this.theme)
    this.reflection.traverse(function (o) {
      if (o.isMesh) {
        o.material = o.material.clone()
        o.material.transparent = true
        o.material.opacity = 0.18
        o.material.color = new THREE.Color(hexToNum(self.theme.dark || "#1a1a1a")).lerp(new THREE.Color(0x000000), 0.45)
      }
    })
    this.reflectionPivot = new THREE.Group()
    this.reflectionPivot.add(this.reflection)
    this.reflectionPivot.position.y = -1.35
    // v1.3.38-fix：横置后 cue 长轴已沿 X，对 pivot 做 scale.y = -0.85 才能正确镜像到地面（ floor.y=-1.35 ），
    // 若对 cue 本身 scale.y 会把它沿长轴压短，导致反射错位、出现“断节”。
    this.reflectionPivot.scale.y = -0.85
    this.scene.add(this.reflectionPivot)

    var floor = new THREE.Mesh(
      new THREE.PlaneGeometry(40, 40),
      new THREE.MeshBasicMaterial({ map: makeFloorTexture(), transparent: true, opacity: 0.9, depthWrite: false })
    )
    floor.rotation.x = -Math.PI / 2
    floor.position.y = -1.35
    this.floor = floor // v1.3.52：竖屏布局需隐藏（竖直的杆会穿过 y=-1.35 的地面）
    this.scene.add(floor)

    // 地台装饰：极简化——仅保留一圈极淡的提示光环，去掉刻度等科技感元素，突出球杆本体。
    // v1.3.52：光环半径 3.3 → 3.9。旧值是按截断杆（长 4.1）调的，完整杆长 5.0 时偏小。
    var ringMat = new THREE.MeshBasicMaterial({ color: 0x5c7fb8, transparent: true, opacity: 0.12, side: THREE.DoubleSide, depthWrite: false })
    var ring = new THREE.Mesh(new THREE.RingGeometry(3.9, 3.99, 96), ringMat)
    ring.position.y = -1.345
    ring.rotation.x = -Math.PI / 2
    this.ring = ring // v1.3.52：竖屏布局需隐藏
    this.scene.add(ring)

    this.applyLayout() // 先按当前宽高比摆好球杆朝向
    this._resize() // 内部会调 relayout()：算 baseDist、设 aspect、渲染首帧
    this.bindControls() // 单指旋转 / 双指捏合
    global.addEventListener("resize", this._onResize)
    global.addEventListener("orientationchange", this._onResize)
  }

  CuePreview3D.prototype._resize = function () {
    if (!this.renderer) return
    this.relayout()
    // 兜底：方向切换或浮层刚从 display:none 变成 flex 时，clientWidth 可能还没
    // 更新到最终值，下一帧再算一次，确保拿到真实尺寸。
    var self = this
    global.requestAnimationFrame(function () { self.relayout() })
  }

  CuePreview3D.prototype._onResize = function () { this._resize() }

  /**
   * 只记录颜色（倒影压暗色 + 兼容旧调用方），**不重建几何**。
   * v1.3.54 起几何与贴图由 setCueTheme() 决定，重建统一收敛到那里，
   * 避免一次打开预览重复建两遍球杆。
   */
  CuePreview3D.prototype.setTheme = function (wood, dark, metal, tip, pattern) {
    if (wood) this.theme.wood = wood
    if (dark) this.theme.dark = dark
    if (metal) this.theme.metal = metal
    if (tip) this.theme.tip = tip
    if (pattern) this.theme.pattern = pattern
  }

  /**
   * 设置球杆主题并重建球杆（v1.3.54）。
   * @param {string} themeId    球杆主题 ID（CUE_THEMES[].id，如 "qingzhutingfeng" / "auto"）
   * @param {string} skinId     皮肤 ID（SKINS[].id），决定皮头色与杆身杆尾基色
   * @param {string} tableSkinId 桌皮 ID（TABLE_SKINS[].id），auto 主题由此派生颜色
   */
  CuePreview3D.prototype.setCueTheme = function (themeId, skinId, tableSkinId) {
    if (themeId) this.theme.cueTheme = themeId
    if (skinId) this.theme.skin = skinId
    if (tableSkinId) this.theme.tableSkin = tableSkinId
    if (this.scene) this._rebuild()
  }

  /**
   * 重建球杆与倒影两棵子树。
   *
   * v1.3.52：先把旧的两棵子树彻底 dispose 再移除。旧代码只 remove 不 dispose，
   * 每次切主题都泄漏一整套 geometry/material + 2 张 512×512 程序化贴图；
   * 19 个主题连切一遍会累积约 40MB 显存，中低端机有 OOM 风险。
   * 注意：disposeTree 只作用于 cuePivot / reflectionPivot 子树，
   * 绝不碰 renderer / scene / camera（见文件顶部红线的说明）。
   */
  CuePreview3D.prototype._rebuild = function () {
    disposeTree(this.cuePivot)
    disposeTree(this.reflectionPivot)
    if (this.cuePivot) this.scene.remove(this.cuePivot)
    if (this.reflectionPivot) this.scene.remove(this.reflectionPivot)
    // 摆放（放平/竖直、居中）统一由 applyLayout() 负责，这里不再写死
    syncHalfRad()
    this.cue = buildCue(this.theme)
    this.cuePivot = new THREE.Group()
    this.cuePivot.add(this.cue)
    this.scene.add(this.cuePivot)
    var self = this
    this.reflection = buildCue(this.theme)
    this.reflection.traverse(function (o) {
      if (o.isMesh) {
        o.material = o.material.clone()
        o.material.transparent = true
        o.material.opacity = 0.18
        o.material.color = new THREE.Color(hexToNum(self.theme.dark || "#1a1a1a")).lerp(new THREE.Color(0x000000), 0.45)
      }
    })
    this.reflectionPivot = new THREE.Group()
    this.reflectionPivot.add(this.reflection)
    this.reflectionPivot.position.y = -1.35
    this.reflectionPivot.scale.y = -0.85
    this.scene.add(this.reflectionPivot)
    this.applyLayout()
    // v1.3.54-fix：必须补一次 relayout。
    // 旧代码重建完就只 requestRender，画布尺寸 / 朝向 / baseDist 全部沿用上次的值。
    // 若用户「在预览关闭状态下转屏」，resize 事件发生时浮层是 display:none，
    // canvas.clientWidth 为 0，relayout 会退回 200×140 兜底并把 vertical 算成 false；
    // 再打开预览时走的就是这条重建路径，于是渲染缓冲停在 200×140 被拉伸到全屏、
    // aspect 1.429（实际 0.47）、球杆朝向也判断错。实测已复现，故在此补一次重算。
    // 开销可忽略：relayout 内部按宽高比记忆化，比例没变时只做 setSize + 一帧渲染。
    this._resize()
  }

  // v1.3.52：自动旋转已取消，视角完全交给手指。保留这个 API 只为兼容调用方
  // （menu-cn.js），传 true 时改成"渲染一帧"，不再启动任何动画循环。
  CuePreview3D.prototype.setAutoRotate = function (b) {
    if (b) this.requestRender()
  }

  CuePreview3D.prototype.start = function () { this.requestRender() }

  CuePreview3D.prototype.stop = function () {
    this.running = false
    if (this.raf != null) { global.cancelAnimationFrame(this.raf); this.raf = null }
    if (this._raf != null) { global.cancelAnimationFrame(this._raf); this._raf = null }
  }

  // v1.3.52：_loop 不再驱动自转/浮动（那两者依赖常驻 rAF），退化为单帧执行体。
  CuePreview3D.prototype._loop = function () { this.renderOnce() }

  /** 同步渲染一帧。 */
  CuePreview3D.prototype.renderOnce = function () {
    if (!this.renderer || !this.scene || !this.camera) return
    this.applyCamera()
    this.renderer.render(this.scene, this.camera)
  }

  /**
   * 按需渲染（dirty flag）：同一帧内的 N 次手势事件只合并成一次渲染；
   * 手指停下后不再排任何 rAF。取消自转后画面本就静止，比旧的常驻循环省电。
   */
  CuePreview3D.prototype.requestRender = function () {
    if (this._raf != null) return
    var self = this
    this._raf = global.requestAnimationFrame(function () {
      self._raf = null
      self.renderOnce()
    })
  }

  // ---------- v1.3.52：轨道相机 ----------

  /**
   * 按当前宽高比摆放球杆：横屏放平到 X 轴，竖屏保持竖直。
   * 竖屏下细长杆横放会缩得很小——横放需要水平 FOV 覆盖 5.0，而竖屏 hFov 只有
   * 约 16°，相机得退到 17.8 才装得下，球杆反而只占屏幕中间一小条；竖放能占满高度。
   */
  CuePreview3D.prototype.applyLayout = function () {
    if (!this.cue || !this.reflection) return
    var vert = !!this.vertical
    // 球杆沿 Y 轴建模：rotation.z = -π/2 放平到 X 轴；不转即保持竖直
    this.cue.rotation.z = vert ? 0 : -Math.PI / 2
    this.cue.position.set(0, 0, 0) // 完整杆中心就在原点
    this.reflection.rotation.z = vert ? 0 : -Math.PI / 2
    this.reflection.position.set(0, 0, 0)
    // 竖屏隐藏地面 / 光环 / 倒影：竖直的杆会穿过 y=-1.35 的地面
    if (this.floor) this.floor.visible = !vert
    if (this.ring) this.ring.visible = !vert
    if (this.reflectionPivot) this.reflectionPivot.visible = !vert
  }

  /**
   * 画布尺寸或方向变化后重算布局朝向 + 静态基准距离 baseDist。
   * baseDist 取多组姿态下需求距离的最大值：保证转到任何角度都不出画，
   * 也避免逐帧改距离造成画面"呼吸"（动态距离在转到杆头时会把相机推远 30%，
   * 与"看清端盖"的目标正好相反）。
   */
  CuePreview3D.prototype.relayout = function () {
    if (!this.renderer || !this.camera) return
    var w = this.canvas.clientWidth || 200
    var h = this.canvas.clientHeight || 140
    var A = w / h
    var vert = A < 1
    if (vert !== this.vertical) {
      this.vertical = vert
      this.applyLayout()
      // 竖屏 pitch 限位不同，切换后夹回合法区间
      var lo = vert ? -PITCH_LIMIT_V : PITCH_MIN_H
      var hi = vert ? PITCH_LIMIT_V : PITCH_MAX_H
      this.orbit.pitch = Math.max(lo, Math.min(hi, this.orbit.pitch))
    }
    this.renderer.setSize(w, h, false)
    this.camera.aspect = A
    this.camera.updateProjectionMatrix()
    // 记忆化：宽高比与朝向都没变就不必重算——拟合要跑 31×3 个姿态、约 4ms，
    // 而 resize / orientationchange 在真机上常常连发多次（软键盘、状态栏收放）。
    if (this._fitA === A && this._fitVert === vert) {
      this.requestRender()
      return
    }
    var pitches = vert ? [-PITCH_LIMIT_V, 0, PITCH_LIMIT_V] : FIT_PITCHES
    var maxD = 0
    for (var y = 0; y <= 180 + 1e-6; y += FIT_YAW_STEP) {
      for (var j = 0; j < pitches.length; j++) {
        var d = this.fitDistance(A, y, pitches[j])
        if (d > maxD) maxD = d
      }
    }
    this.baseDist = maxD
    // 缩放下限：相机距离 = baseDist × zoom，必须大于「包围球半径 + 间隙」，
    // 否则捏合到底时相机会穿进球杆内部（见 SAFE_CLEAR 注释）。
    // 竖屏 baseDist 大，算出来的值很小，由 ZOOM_MIN 兜底。
    this.zoomMin = Math.max(ZOOM_MIN, (FIT_R + SAFE_CLEAR) / maxD)
    // 转屏（横→竖）会让 zoomMin 变大，若当前 zoom 已越界就夹回来，
    // 否则用户会在竖屏下看到一个「相机在杆里」的画面
    if (this.orbit.zoom < this.zoomMin) this.orbit.zoom = this.zoomMin
    this._fitA = A
    this._fitVert = vert
    this.requestRender()
  }

  /** 当前布局下球杆包围盒的半尺寸 [x, y, z]。 */
  CuePreview3D.prototype._half = function () {
    return this.vertical ? [HALF_RAD, HALF_LEN, HALF_RAD] : [HALF_LEN, HALF_RAD, HALF_RAD]
  }

  /** 给定 yaw/pitch（弧度），算出相机的三个基向量：right / up / u（由 target 指向相机）。 */
  function basis(th, ph) {
    return {
      rx: Math.cos(th), ry: 0, rz: -Math.sin(th),
      ux: -Math.sin(th) * Math.sin(ph), uy: Math.cos(ph), uz: -Math.cos(th) * Math.sin(ph),
      vx: Math.sin(th) * Math.cos(ph), vy: Math.sin(ph), vz: Math.cos(th) * Math.cos(ph)
    }
  }

  /**
   * 求居中平移量 x，使该轴上包围盒的投影居中，即
   *     max_c((a_c − x) / w_c) + min_c((a_c − x) / w_c) = 0
   * 其中 a_c 是角点在该轴基向量上的投影，w_c = 深度 × tan(半视角) > 0。
   *
   * 关键性质：把相机沿 right / up 平移 T = dr·r + du·u 时，由于 {r, u, v} 正交，
   *   depth = d − (P − T)·v = d − P·v        ← 与平移量无关
   *   xc    = (P − T)·r     = P·r − dr       ← 只含 dr
   *   yc    = (P − T)·u     = P·u − du       ← 只含 du
   * 于是两轴彻底解耦，且各角点 (a_c − x)/w_c 关于 x 线性递减，max / min 保序，
   * 目标函数是 x 的分段线性严格递减函数 → 二分必然收敛，不存在迭代发散的可能。
   *
   * v1.3.52-fix：旧版用的是不动点迭代 `du += m·d·tanV`，步长里用的是"包围盒中心
   * 深度 d"，但球杆近端角点的实际深度只有 d−2.5（约近 2.5 倍）。步长因此超调约
   * 2.5 倍，在球杆几乎正对镜头（yaw≈85°~95°）时来回震荡不收敛，包围盒偏心高达
   * 0.40 NDC（画面的一半），球杆会被推到屏幕外。改成二分后偏心恒为 0。
   */
  function solveCenter(a, w) {
    var maxa = 0
    var maxw = 0
    for (var i = 0; i < 8; i++) {
      if (Math.abs(a[i]) > maxa) maxa = Math.abs(a[i])
      if (w[i] > maxw) maxw = w[i]
    }
    // 框根：x = ±(maxa + maxw) 时所有角点同号，两端必然异号
    var lo = -maxa - maxw
    var hi = maxa + maxw
    for (var it = 0; it < CENTER_ITERS; it++) {
      var mid = (lo + hi) * 0.5
      var mn = Infinity
      var mx = -Infinity
      for (var i = 0; i < 8; i++) {
        var v = (a[i] - mid) / w[i]
        if (v < mn) mn = v
        if (v > mx) mx = v
      }
      // g(mid) = mn + mx 关于 mid 严格递减：g > 0 说明还偏小，把下界抬上去
      if (mn + mx > 0) lo = mid
      else hi = mid
    }
    return (lo + hi) * 0.5
  }

  /**
   * 精确求居中平移量，并顺带返回居中后的投影跨度。
   * 返回 { dr, du, sx, sy, ox, oy }：dr/du 为平移量，sx/sy 为 NDC 全跨度，
   * ox/oy 为残余偏心（理论为 0，实际是二分残差，量级 1e-5）。
   */
  CuePreview3D.prototype.computePan = function (d, th, ph, half, aspect) {
    var b = basis(th, ph)
    var tanV = Math.tan(FOV * Math.PI / 360)
    var A = (typeof aspect === "number" && aspect > 0)
      ? aspect
      : (this.camera ? this.camera.aspect : 1)
    var tanH = tanV * A
    var ax = []
    var ay = []
    var wx = []
    var wy = []
    for (var c = 0; c < 8; c++) {
      var px = (c & 1) ? half[0] : -half[0]
      var py = (c & 2) ? half[1] : -half[1]
      var pz = (c & 4) ? half[2] : -half[2]
      // 深度与平移量无关（见 solveCenter 注释），这里直接用未平移的原始角点
      var depth = d - (px * b.vx + py * b.vy + pz * b.vz)
      if (depth < 0.05) depth = 0.05
      ax.push(px * b.rx + pz * b.rz)
      ay.push(px * b.ux + py * b.uy + pz * b.uz)
      wx.push(depth * tanH)
      wy.push(depth * tanV)
    }
    var dr = solveCenter(ax, wx)
    var du = solveCenter(ay, wy)
    var minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
    for (var c = 0; c < 8; c++) {
      var nx = (ax[c] - dr) / wx[c]
      var ny = (ay[c] - du) / wy[c]
      if (nx < minX) minX = nx
      if (nx > maxX) maxX = nx
      if (ny < minY) minY = ny
      if (ny > maxY) maxY = ny
    }
    return {
      dr: dr, du: du,
      sx: maxX - minX, sy: maxY - minY,
      ox: (minX + maxX) / 2, oy: (minY + maxY) / 2
    }
  }

  /**
   * 求指定姿态下"居中后刚好装下球杆"的最小相机距离（半跨度正好等于 FILL）。
   *
   * v1.3.52-fix：旧版把「距离」与「居中平移」交替迭代——由 |xc| 反解 d、再用新 d
   * 重算平移，往复 4 次。这在球杆正对镜头时会以约 0.5 的公比缓慢下滑，6 次迭代后
   * 仍偏大约 1%，且收敛性没有保证。改为对距离直接二分：
   *   ① 先取 pan=0 时反解的距离作上界。未居中时 max|n| ≥ 跨度/2，故它必为真值上界；
   *   ② 居中后的半跨度随距离单调递减（已按 0.6→60 逐点验证）→ 二分收敛。
   * 只装框球杆本体，不含倒影——倒影是 opacity 0.18 的装饰，下缘轻微出画不影响观感。
   */
  CuePreview3D.prototype.fitDistance = function (A, yawDeg, pitchDeg) {
    var th = yawDeg * Math.PI / 180
    var ph = pitchDeg * Math.PI / 180
    var b = basis(th, ph)
    var tanV = Math.tan(FOV * Math.PI / 360)
    var tanH = tanV * A
    var half = this._half()
    // ① 上界：pan=0 时逐角点反解，取最大值。
    // d ≥ |xc|/(fillH·tanH) + k 中的 k = P·v 是角点沿视线的前后偏移——
    // 朴素式 2.5/tan(hFov/2) 漏掉了它（近端比中心近约 0.36），会低估约 9%。
    var hi = 0.5
    for (var c = 0; c < 8; c++) {
      var px = (c & 1) ? half[0] : -half[0]
      var py = (c & 2) ? half[1] : -half[1]
      var pz = (c & 4) ? half[2] : -half[2]
      var xc = px * b.rx + pz * b.rz
      var yc = px * b.ux + py * b.uy + pz * b.uz
      var k = px * b.vx + py * b.vy + pz * b.vz
      var nh = Math.abs(xc) / (FILL_H * tanH) + k
      var nv = Math.abs(yc) / (FILL_V * tanV) + k
      if (nh > hi) hi = nh
      if (nv > hi) hi = nv
    }
    // 保险①：理论上界已足够，但若因数值边界装不下则向上加倍，保证右端点可行
    for (var g = 0; g < 40; g++) {
      var s = this.computePan(hi, th, ph, half, A)
      if (s.sx / (2 * FILL_H) <= 1 && s.sy / (2 * FILL_V) <= 1) break
      hi *= 2
    }
    // 保险②：向下找第一个"装不下"的点作左端点，确保根被区间框住
    var lo = hi * 0.5
    for (var g = 0; g < 40; g++) {
      var s = this.computePan(lo, th, ph, half, A)
      if (s.sx / (2 * FILL_H) > 1 || s.sy / (2 * FILL_V) > 1) break
      hi = lo
      lo *= 0.5
    }
    // ② 二分
    for (var it = 0; it < FIT_ITERS; it++) {
      var mid = (lo + hi) * 0.5
      var s = this.computePan(mid, th, ph, half, A)
      if (s.sx / (2 * FILL_H) > 1 || s.sy / (2 * FILL_V) > 1) lo = mid
      else hi = mid
    }
    return (lo + hi) * 0.5
  }

  /** 按 orbit 状态摆放相机。每次渲染前调用。 */
  CuePreview3D.prototype.applyCamera = function () {
    var o = this.orbit
    var d = this.baseDist * o.zoom
    var th = o.yaw * Math.PI / 180
    var ph = o.pitch * Math.PI / 180
    var b = basis(th, ph)
    var pan = this.computePan(d, th, ph, this._half(), this.camera ? this.camera.aspect : 1)
    var tx = pan.dr * b.rx + pan.du * b.ux
    var ty = pan.du * b.uy
    var tz = pan.dr * b.rz + pan.du * b.uz
    this.camera.up.set(0, 1, 0)
    this.camera.position.set(
      tx + d * b.vx,
      ty + d * b.vy,
      tz + d * b.vz
    )
    this.camera.lookAt(tx, ty, tz)
  }

  /**
   * 拖动改变视角。水平拖 = 绕球杆方位角（自由 360°）；垂直拖 = 俯仰（限位）。
   * 横屏 pitch 下限 -18° 是硬边界：再低相机 y 会掉到地板 y=-1.35 以下，倒影穿帮。
   * 看端盖细节靠 yaw 转到杆头正对相机，不需要大俯仰。
   */
  CuePreview3D.prototype.orbitBy = function (dYaw, dPitch) {
    var o = this.orbit
    o.yaw += dYaw
    if (o.yaw > 360) o.yaw -= 360
    if (o.yaw < -360) o.yaw += 360
    var lo = this.vertical ? -PITCH_LIMIT_V : PITCH_MIN_H
    var hi = this.vertical ? PITCH_LIMIT_V : PITCH_MAX_H
    o.pitch = Math.max(lo, Math.min(hi, o.pitch + dPitch))
  }

  /** 双指捏合 / 滚轮设置相机距离，内部换算成 zoom 并夹在 [0.35, 1.6]。 */
  CuePreview3D.prototype.setDist = function (d) {
    this.orbit.zoom = Math.max(this.zoomMin, Math.min(ZOOM_MAX, d / this.baseDist))
  }

  /**
   * 重置到统一的展示角度。每次打开预览时由 menu-cn.js 调用，
   * 这样连续看几款主题时起始机位一致，便于横向对比。
   */
  CuePreview3D.prototype.resetView = function () {
    this.orbit.yaw = 30
    this.orbit.pitch = 12
    this.orbit.zoom = 1
  }

  // ---------- v1.3.52：手势（单指旋转 / 双指捏合）----------
  // 移植自 src/view/dom/aimslider.ts:113-190，那套实现已在真机上验证过
  // Android WebView 的几个坑，下面按编号标注。
  CuePreview3D.prototype.bindControls = function () {
    var self = this
    var cv = this.canvas
    var pts = {}
    var ids = []
    var lastX = 0
    var lastY = 0
    var didDrag = false
    var downT = 0
    var pinchD0 = 0
    var dist0 = 0

    function cnt() { return ids.length }
    function spread() {
      var a = pts[ids[0]]
      var b = pts[ids[1]]
      if (!a || !b) return 1
      var dx = a.x - b.x
      var dy = a.y - b.y
      return Math.sqrt(dx * dx + dy * dy) || 1
    }

    function onDown(e) {
      // 坑①：preventDefault 必须在第一行。晚于它，浏览器可能把这次按下判定为
      // "点击并取消"，立刻派发 pointercancel，表现为"按住完全没反应"。
      try { e.preventDefault() } catch (err) { /* 个别环境不支持，忽略 */ }
      // 坑②：绝不调用 setPointerCapture。部分 Android WebView 在 pointerdown 上
      // preventDefault 后再 setPointerCapture，会立刻派发 pointercancel 结束拖动。
      if (!pts[e.pointerId]) {
        pts[e.pointerId] = { x: e.clientX, y: e.clientY }
        ids.push(e.pointerId)
      }
      lastX = e.clientX
      lastY = e.clientY
      didDrag = false
      downT = Date.now()
      if (cnt() === 2) {
        pinchD0 = spread()
        dist0 = self.baseDist * self.orbit.zoom
      }
      // 坑③：用 window 捕获阶段监听，手指滑出 canvas 之外也能持续收到事件
      if (cnt() === 1) global.addEventListener("pointermove", onMove, true)
      global.addEventListener("pointerup", onUp, true)
      global.addEventListener("pointercancel", onUp, true)
    }

    function onMove(e) {
      var p = pts[e.pointerId]
      if (!p) return
      p.x = e.clientX
      p.y = e.clientY
      var dx = e.clientX - lastX
      var dy = e.clientY - lastY
      // 增量式：天然支持中途抬指后的重锚
      lastX = e.clientX
      lastY = e.clientY
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) didDrag = true
      var r = cv.getBoundingClientRect()
      var rw = r.width || 1
      var rh = r.height || 1
      if (cnt() >= 2) {
        // 双指：捏合缩放。注意是 d0/d（张开→距离变大→d 变小→拉近）
        self.setDist(dist0 * (pinchD0 / spread()))
      } else {
        // 单指：整屏宽拖过 = 转 180°，与 OrbitControls 同向
        self.orbitBy(-(dx / rw) * 180, (dy / rh) * 180)
      }
      self.requestRender()
    }

    function onUp(e) {
      var i = ids.indexOf(e.pointerId)
      // 坑④：可能收到非本轮的 pointerId（多指 / 异常序列），直接忽略
      if (i < 0) return
      delete pts[e.pointerId]
      ids.splice(i, 1)
      // 坑⑤：捏合中抬起一根手指后必须重锚，否则剩下一根会造成视角跳变
      if (cnt() === 1) {
        var p = pts[ids[0]]
        if (p) { lastX = p.x; lastY = p.y }
        pinchD0 = 0
      }
      if (cnt() === 0) {
        global.removeEventListener("pointermove", onMove, true)
        global.removeEventListener("pointerup", onUp, true)
        global.removeEventListener("pointercancel", onUp, true)
      }
    }

    cv.addEventListener("pointerdown", onDown)
    cv.addEventListener("contextmenu", function (e) { e.preventDefault() })
    // 坑⑥：src/index.ts 的 setupMobileBehaviour() 只编译进 dist/index.js，
    // menu.html 没加载它，所以这里要自己屏蔽 Safari 的手势事件，
    // 否则 iOS 上会同时触发页面级双指缩放。
    var gs = ["gesturestart", "gesturechange", "gestureend"]
    for (var i = 0; i < gs.length; i++) {
      cv.addEventListener(gs[i], function (e) { e.preventDefault() })
    }
    // 桌面端滚轮缩放（便于在电脑上验证）
    cv.addEventListener("wheel", function (e) {
      e.preventDefault()
      self.setDist(self.baseDist * self.orbit.zoom * (e.deltaY > 0 ? 1.08 : 0.92))
      self.requestRender()
    }, { passive: false })
  }

  /**
   * 释放一棵子树的 geometry / material / texture。
   * 只作用于 cuePivot、reflectionPivot 这类模型子树，绝不碰 renderer / scene / camera。
   */
  function disposeTree(root) {
    if (!root) return
    root.traverse(function (o) {
      if (o.geometry) o.geometry.dispose()
      var m = o.material
      if (!m) return
      var arr = Object.prototype.toString.call(m) === "[object Array]" ? m : [m]
      for (var i = 0; i < arr.length; i++) {
        // v1.3.54-fix：**绝不能 dispose material.map**。
        // 杆身/杆尾贴图来自 window.CueGameCue 的全局缓存（同一主题多次预览、
        // 甚至游戏内都在共用同一张 Texture）。一旦在这棵子树里把它 dispose 掉，
        // 下次切回该主题拿到的还是缓存里那个已释放 GPU 资源的对象，
        // 球杆会直接变成纯黑/纯白。贴图由工厂统一持有、随页面生命周期存在。
        arr[i].dispose()
      }
    })
  }

  /**
   * 【红线 · 全项目禁止调用】
   * v1.3.32 曾出现「第一次预览正常、第二次及以后全白」，根因就是关闭时调了
   * dispose() → renderer.dispose() + forceContextLoss() 释放了 WebGL 上下文，
   * 而真机 WebView 在首个 context 被销毁后再次创建会失败或拿到损坏的 context。
   * 现行策略：renderer 整个页面生命周期只创建一次、永不销毁，关闭时只 stop()。
   * 本方法仅为完整性保留，menu-cn.js 里没有任何地方调用它，请不要新增调用。
   * 需要释放模型资源时请用 disposeTree()（只作用于模型子树）。
   */
  CuePreview3D.prototype.dispose = function () {
    this.stop()
    global.removeEventListener("resize", this._onResize)
    global.removeEventListener("orientationchange", this._onResize)
    if (this.scene) {
      this.scene.traverse(function (o) {
        if (o.geometry) o.geometry.dispose()
        if (o.material) {
          var mats = Array.isArray(o.material) ? o.material : [o.material]
          mats.forEach(function (m) { if (m.map) m.map.dispose(); m.dispose() })
        }
      })
    }
    if (this.renderer) {
      this.renderer.dispose()
      if (this.renderer.forceContextLoss) this.renderer.forceContextLoss()
    }
    this.renderer = null; this.scene = null; this.camera = null
    this.cue = null; this.reflection = null
    this.cuePivot = null; this.reflectionPivot = null
  }

  global.CuePreview3D = CuePreview3D
})(typeof self !== "undefined" ? self : this)
