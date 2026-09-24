/*!
 * 皮肤 / 场景 / 台球桌缩略图 —— three.js 真 3D 离屏渲染（v1.3.103）
 *
 * 由 dist/menu-cn.js 在缩略图进入视口时按需加载，使用 window.THREE
 * （dist/three.standalone.js）与 window.CueGameSkin（dist/skin-factory.js）/
 * window.CueGameCue（dist/cue-texture-factory.js）。
 *
 * 为什么要有这个文件：
 *   菜单卡片上的三类缩略图（19 款球杆主题 / 13 款台球桌外观 / 6 个环境场景）
 *   此前是 `menu-cn.js` 里用 canvas 2D **手绘的示意图**（drawCuePreview /
 *   drawTableSkinPreview / drawScenePreview），与游戏内真实贴图毫无关联 ——
 *   用户看到的是"画出来的一根杆 / 一块布"，而不是"这款皮肤长什么样"。
 *   本文件改为：直接取游戏内的**真实贴图工厂与真实几何参数**，用 three 离屏
 *   渲染出一张真 3D 图（260×120，2× 于卡片色块的 130×60）。
 *
 * 【红线 1】WebGL context 只建一次、永不 dispose。
 *   本模块只创建 **1 个** 离屏 renderer（ThumbRenderer），全程复用：
 *   每张图渲染前 setSize / 清屏，渲染后 toDataURL。因为需要读回像素，
 *   它的 preserveDrawingBuffer 必须是 true —— 这与全屏球杆预览
 *   （cue-preview-3d.js，preserveDrawingBuffer:false）是**两个独立的
 *   context**，互不影响，且都不 dispose。
 *
 * 【红线 2】贴图由 window.CueGameSkin / CueGameCue 的模块级缓存持有，
 *   切皮肤清理子树时只 dispose geometry/material，**绝不能 dispose map**，
 *   否则缓存里的 Texture 被释放后再次渲染同款皮肤会变纯黑。
 *
 * 【只渲染皮肤本身】（产品约束）
 *   球桌不带球、场景不带家具/看台 —— 缩略图只展示材质与主体轮廓，
 *   避免小图里元素杂乱、喧宾夺主。
 */
;(function (global) {
  "use strict"

  var THREE = global.THREE
  if (!THREE) {
    console.error("[skinPreview3D] window.THREE 未加载，无法初始化缩略图渲染")
    return
  }

  function skin() {
    var s = global.CueGameSkin
    if (!s) throw new Error("skin-factory.js 未加载（window.CueGameSkin 缺失）")
    return s
  }
  function cue() {
    var c = global.CueGameCue
    if (!c) throw new Error("cue-texture-factory.js 未加载（window.CueGameCue 缺失）")
    return c
  }

  /** 缩略图输出尺寸：CSS 侧 130×60，这里 2× 渲染保证清晰度 */
  var OUT_W = 260
  var OUT_H = 120
  /** 统一的深色背景，与菜单暗色主题一致 */
  var BG = 0x0b1018
  /**
   * 真实球杆总长（米）。用于球杆机位的距离标定 —— 与 CUE_GEOM 一致。
   * 硬编码而不每次从 CueGameCue 取，是为了让 buildCueThumb 之外的地方
   * （capture 里的机位计算）也能拿到，且不引入对 window.CueGameCue 的
   * 加载时序依赖（球杆机位算距离时它可能还没 load 完）。
   * R = 0.03275，R*43 = 1.40825。
   */
  var CUE_LEN = 0.03275 * 43

  // ---------- 小工具 ----------

  /**
   * 释放子树里的 geometry/material（**绝不碰 map**，见红线 2）。
   *
   * ⚠️ 这是「只清 geometry/material」版本 —— 用于球杆/场景两类
   * （它们的贴图全部来自 CueGameCue / CueGameSkin 的全局缓存，不能 dispose）。
   * 球桌那类会额外用自己降采样出来的小贴图，由 disposeTreeDeep 处理。
   */
  function disposeTree(root) {
    if (!root) return
    root.traverse(function (o) {
      if (o.geometry) o.geometry.dispose()
      if (o.material) {
        var ms = Array.isArray(o.material) ? o.material : [o.material]
        ms.forEach(function (m) {
          // 只 dispose 材质本身，不 dispose m.map / normalMap / roughnessMap —— 它们是全局缓存的
          m.dispose()
        })
      }
    })
    if (root.parent) root.parent.remove(root)
  }

  /**
   * 释放**缩略图自建的**贴图（downscaleTexture 产出的小 CanvasTexture）。
   * 这些贴图不被任何全局缓存持有，不释放会随浏览会话累积泄漏显存。
   * 用 `__thumbTex` 标记来区分「自建」与「缓存共享」，只释放前者。
   */
  function disposeThumbTextures(root) {
    if (!root) return
    root.traverse(function (o) {
      if (!o.material) return
      var ms = Array.isArray(o.material) ? o.material : [o.material]
      ms.forEach(function (m) {
        var keys = ["map", "normalMap", "roughnessMap", "metalnessMap", "emissiveMap", "aoMap"]
        keys.forEach(function (k) {
          var t = m[k]
          if (t && t.__thumbTex) t.dispose()
        })
      })
    })
  }

  /**
   * 设置相机「看哪里」：
   * 三类缩略图都改为显式机位（见 capture 内的 CUE_POSE / TABLE_POSE /
   * SCENE_CAM），所以这里不再需要通用的「拟合包围盒」算法。
   * 保留这个工具只为取包围盒中心，供机位计算用。
   */
  function boxCenter(root) {
    var bb = new THREE.Box3().setFromObject(root)
    if (bb.isEmpty()) return new THREE.Vector3(0, 0, 0)
    return bb.getCenter(new THREE.Vector3())
  }

  /**
   * 把「游戏内的真实贴图」降采样成缩略图专用的小贴图。
   *
   * 【为什么必须这么做 —— 这是首图 55s 的第二大主因】
   *   实测（tools/render/_downscale.js，SwiftShader 软渲染）：
   *     原始尺寸（台呢 512²、桌框 1024×256）→ 每换一款**新皮肤**
   *       首帧就要 18~19 秒（不是编译一次就好了，是每张新贴图都要重来）；
   *     降到 256²/256×64 后 → **39 毫秒**，快约 500 倍。
   *   瓶颈是软渲染器上传/生成 mipmap 的 CPU 开销，与着色器编译无关。
   *
   * 【为什么不能直接改原贴图】
   *   这些 Texture 由 tableskinfactory 的模块级缓存持有、游戏主画面也在用，
   *   缩略图绝不能 mutate 它们（降采样、改 wrap、释放都会波及主画面）。
   *   所以这里**新建一张小 canvas**、把原图 drawImage 缩进去，再包成一张
   *   全新的 CanvasTexture —— 与原贴图完全独立，dispose 它也不伤缓存。
   *
   * @param src 原始 Texture（或其 image）
   * @param w   目标宽
   * @param h   目标高
   * @returns   新的小尺寸 CanvasTexture，失败时返回 null（调用方回退用原贴图）
   */
  function downscaleTexture(src, w, h) {
    try {
      var img = src && (src.image || src)
      if (!img || !img.width || !img.height) return null
      if (img.width <= w && img.height <= h) return src // 本来就够小，直接用
      var c = document.createElement("canvas")
      c.width = w
      c.height = h
      var g = c.getContext("2d")
      g.drawImage(img, 0, 0, w, h)
      var tex = new THREE.CanvasTexture(c)
      tex.colorSpace = THREE.SRGBColorSpace
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping
      // 标记「这是缩略图自建贴图」，捕捉结束后由 disposeThumbTextures 释放
      tex.__thumbTex = true
      tex.needsUpdate = true
      return tex
    } catch (e) {
      console.warn("[skinPreview3D] 贴图降采样失败，回退原图：" + (e && e.message))
      return null
    }
  }
  /** 缩略图用的小贴图尺寸：远大于 260×120 的实际像素，细节不会丢 */
  var CLOTH_TEX = { w: 256, h: 256 }
  var FRAME_TEX = { w: 256, h: 64 }

  // ---------- 灯光 ----------
  // 三类缩略图共用同一套灯：略冷的半球环境光 + 一盏主光 + 两盏补光。
  // 主光刻意偏"顶光"（+Z 分量大），因为台呢是一块**朝上的平面**，
  // 斜射光在近边缘视角下打不亮它，画面会退化成一片黑。
  function addLights(scene) {
    scene.add(new THREE.HemisphereLight(0xcfe0f5, 0x2a3444, 2.1))
    var key = new THREE.DirectionalLight(0xffffff, 2.6)
    key.position.set(0.6, 1.4, 2.4)
    scene.add(key)
    var fill = new THREE.DirectionalLight(0xffffff, 1.0)
    fill.position.set(-1.0, -0.8, 1.6)
    scene.add(fill)
    var rim = new THREE.DirectionalLight(0xffffff, 0.5)
    rim.position.set(0, 0, -2)
    scene.add(rim)
  }

  // ---------- 球杆缩略图 ----------
  /**
   * 与 cue-preview-3d.js 的 buildCue() 同源：都从 window.CueGameCue 取
   * CUE_GEOM（真实长度/半径）与 getCueTexture / getCueButtTexture（真实贴图）。
   *
   * 【为什么只取「杆尾一段」而不是整根杆】
   *   真实球杆长径比 ≈ 46.7:1，塞进 260×120（2.17:1）的扁色块里，杆身
   *   只剩 2~3 像素的一条细线，皮肤图案完全看不见（试拍实证：dragon 的
   *   金鳞纹在整杆视角下是一条模糊的暗线）。改为只渲染**从杆尾起 42%
   *   的一段**（装饰图案与品牌配色都集中在这里），横放后填满画幅，
   *   一眼能认出是哪款皮肤。
   */
  var CUE_SEG_FRAC = 0.42
  /** 杆尾段机位：近距俯视（实测 a 组观感最好） */
  var CUE_CAM = { fov: 30, xFrac: -0.33, yFrac: -0.16, zFrac: 0.1 }

  function buildCueThumb(themeId) {
    var g = cue()
    var geom = g.CUE_GEOM
    var R = geom.R
    var len = geom.length != null ? geom.length : R * 43
    var buttR = geom.buttRadius != null ? geom.buttRadius : R * 0.46
    var tipR = geom.tipRadius != null ? geom.tipRadius : R * 0.1

    var shaftTex = g.getCueTexture(themeId) || null
    var buttTex = g.getCueButtTexture ? g.getCueButtTexture(themeId) || null : null

    var root = new THREE.Group()
    // 杆尾（后 25%）与杆身（前 75%）两段圆柱，比例参照 cuemesh.ts 的分区
    var buttLen = len * 0.25
    var shaftLen = len * 0.75

    var buttGeo = new THREE.CylinderGeometry(buttR * 0.94, buttR, buttLen, 28, 1, true)
    var buttMat = new THREE.MeshStandardMaterial({
      map: buttTex || shaftTex || null,
      color: buttTex || shaftTex ? 0xffffff : 0x2a2a2a,
      roughness: geom.finish ? 0.34 : 0.4,
      metalness: 0.05,
      side: THREE.DoubleSide,
    })
    var buttMesh = new THREE.Mesh(buttGeo, buttMat)
    buttMesh.rotation.z = Math.PI / 2
    buttMesh.position.x = -(len / 2) + buttLen / 2
    root.add(buttMesh)

    // 只取杆身的前段（截到 CUE_SEG_FRAC 总长为止），锥度按截断比例线性收窄
    var takeShaft = Math.min(shaftLen, len * CUE_SEG_FRAC - buttLen)
    if (takeShaft > 0.001) {
      var rAtCut = buttR * 0.94 - (buttR * 0.94 - tipR) * (takeShaft / shaftLen)
      var shaftGeo = new THREE.CylinderGeometry(rAtCut, buttR * 0.94, takeShaft, 28, 1, true)
      var shaftMat = new THREE.MeshStandardMaterial({
        map: shaftTex || buttTex || null,
        color: shaftTex || buttTex ? 0xffffff : 0xd8c8a8,
        roughness: 0.3,
        metalness: 0.04,
        side: THREE.DoubleSide,
      })
      var shaftMesh = new THREE.Mesh(shaftGeo, shaftMat)
      shaftMesh.rotation.z = Math.PI / 2
      shaftMesh.position.x = -(len / 2) + buttLen + takeShaft / 2
      root.add(shaftMesh)
    }

    return { root: root, box: new THREE.Box3().setFromObject(root), direct: "cue" }
  }

  // ---------- 台球桌缩略图 ----------
  /**
   * 台呢 + 库边 + 桌框三件套，材质全部取自 tableskinfactory 的**真实贴图**。
   * 尺寸用 TableGeometry.tableX/tableY（R*43 / R*21），与游戏内球桌一致。
   * 「只渲染皮肤本身」——不带球、不带桌腿。
   */
  function buildTableThumb(skinId) {
    var S = skin()
    var def = S.getTableSkin(skinId) || {}
    var TX = S.TableGeometry.tableX
    var TY = S.TableGeometry.tableY

    var clothMap = downscaleTexture(S.getClothTexture(skinId), CLOTH_TEX.w, CLOTH_TEX.h) || S.getClothTexture(skinId) || null
    var frameMap = downscaleTexture(S.getFrameTexture(skinId), FRAME_TEX.w, FRAME_TEX.h) || S.getFrameTexture(skinId) || null
    /**
     * ⚠️ **不取** getFrameNormalTexture / getFrameRoughnessTexture。
     *
     * 实测（tools/render/_profileclt.js）：这两张 1024×256 贴图各自要在
     * CPU 上逐像素做 sobel/差分推导 —— 单张 **18~19 秒**，是首张球桌缩略图
     * 耗时 55s 的绝对主因（cloth 只要 70ms、frame 只要 11ms）。
     *
     * 而缩略图只有 260×120，法线/粗糙度这种"随视角变化的高光细节"在这
     * 个尺寸下**完全看不出来**（试拍对比确认：带与不带，肉眼无差别）。
     * 所以这里刻意省略，换来首图从 55s 降到 0.1s 量级。
     *
     * 游戏主画面用的是完整四张贴图（assets.ts），不受此影响。
     */

    var clothColor = new THREE.Color(def.clothColor != null ? def.clothColor : 0x2a7a3a)
    var frameColor = new THREE.Color(def.frameColor != null ? def.frameColor : 0x6a4a1a)
    var cushionColor = new THREE.Color(
      def.cushionColor != null ? def.cushionColor : def.clothColor != null ? def.clothColor : 0x2a7a3a
    )
    var glow = def.frameGlow != null && def.frameGlow > 0 ? new THREE.Color(def.frameGlow) : null
    var edge = def.edgeGlow != null && def.edgeGlow > 0 ? new THREE.Color(def.edgeGlow) : null

    var root = new THREE.Group()

    // 台呢（真实贴图 + 本色叠加；sheen 近似还原织物泛光，与 assets.ts 的升级逻辑同向）
    var clothMat = new THREE.MeshStandardMaterial({
      map: clothMap,
      color: clothColor,
      roughness: 0.93,
      metalness: 0.0,
    })
    if (THREE.MeshPhysicalMaterial) {
      clothMat = new THREE.MeshPhysicalMaterial({
        map: clothMap,
        color: clothColor,
        roughness: 0.93,
        metalness: 0.0,
        sheen: 0.5,
        sheenColor: new THREE.Color(0xffffff).lerp(clothColor, 0.4),
        sheenRoughness: 0.8,
      })
    }
    var cloth = new THREE.Mesh(new THREE.PlaneGeometry(2 * TX, 2 * TY), clothMat)
    root.add(cloth)

    // 库边（四条细长盒）—— 缩略图加粗，见 TABLE_CUSHION_BOOST 说明
    var cushMat = new THREE.MeshStandardMaterial({
      color: cushionColor,
      roughness: 0.86,
      metalness: 0.02,
    })
    var cushH = 0.016 * TABLE_CUSHION_BOOST
    var cushW = 0.015 * TABLE_CUSHION_BOOST
    var cushSpec = [
      [2 * TX, cushH, 0, TY - cushH / 2],
      [2 * TX, cushH, 0, -(TY - cushH / 2)],
      [cushW, 2 * TY, TX - cushW / 2, 0],
      [cushW, 2 * TY, -(TX - cushW / 2), 0],
    ]
    cushSpec.forEach(function (p) {
      var m = new THREE.Mesh(new THREE.BoxGeometry(p[0], p[1], 0.02), cushMat)
      m.position.set(p[2], p[3], 0.011)
      root.add(m)
    })

    // 桌框（外圈四条，真实贴图 + 发光；不加法线/粗糙度，见上方耗时说明）
    var frameMat = new THREE.MeshStandardMaterial({
      map: frameMap,
      color: frameMap ? 0xffffff : frameColor,
      roughness: frameMap ? 0.7 : 0.62,
      metalness: 0.18,
    })
    if (glow) {
      frameMat.emissive = glow
      frameMat.emissiveIntensity = 0.75
    }
    if (edge) frameMat.emissive = edge

    var fw = 0.032 * TABLE_FRAME_BOOST
    var frameSpec = [
      [2 * TX + fw * 2, fw, 0, TY + fw / 2],
      [2 * TX + fw * 2, fw, 0, -(TY + fw / 2)],
      [fw, 2 * TY + fw * 2, TX + fw / 2, 0],
      [fw, 2 * TY + fw * 2, -(TX + fw / 2), 0],
    ]
    frameSpec.forEach(function (p) {
      var m = new THREE.Mesh(new THREE.BoxGeometry(p[0], p[1], 0.028), frameMat)
      m.position.set(p[2], p[3], 0.014)
      root.add(m)
    })

    return { root: root, box: new THREE.Box3().setFromObject(root), glow: !!glow, direct: "table" }
  }

  // ---------- 场景缩略图 ----------
  /**
   * 只支持「无实拍照片」的三个场景（room / beach / ufc）；
   * snow / football / basketball 走菜单里的实拍照片路径，不进这里。
   * 直接调用游戏内真实的场景构建函数（它们不依赖任何单例）。
   *
   * 【为什么不用通用 frameBox() 取景 —— 三轮试拍的结论】
   *   通用取景是「朝向包围盒中心、退到刚好框住」。但地形类场景的地面
   *   半径 14~60m（beach）、26m 见方（ufc），包围盒中心在地面高度，
   *   相机被推到斜上方几十米 → 画面就是「俯视看一个大圆盘」，
   *   完全读不出是哪个场景。
   *
   * 【正解 —— 用游戏内同款近景机位】
   *   这些场景本来就是为「瞄准相机」设计的：相机高 1.10m、贴近球台
   *   （世界原点）、视线略抬（camera.ts 的 AIM_LOOK_LIFT = R*6），
   *   于是画面里是「近处地面 + 少量立面 + 一条地平线」。缩略图照搬这个
   *   视角，得到的就是玩家在游戏里真正看到的那个画面。
   *   下面为每个场景硬编码一组 {fov, p(相机位), t(注视点)}，全部由
   *   实测像素选出（见 tools/render/_sceneview*.js）。
   *
   * 【天空穹顶必须保留 —— 这是 beach 成败的关键】
   *   海面 r→60 时经 haze 淡到 BEACH_HORIZON_HEX，这个色值**等于天空
   *   穹顶下半球色**。删掉穹顶后海天交界处直接露黑底，沙滩缩略图会
   *   变成「黑幕上一条沙丘」。所以晴空/海洋类场景一律保留穹顶，
   *   靠相机贴近原点来保证它不出画（穹顶半径 110 远大于相机距离）。
   *
   * 「只渲染皮肤本身」在这里的落地 = 只框住**该场景的标志性近景**
   * （沙滩的地形与海、UFC 的八角笼、室内的墙与地板），不带球台。
   */
  var SCENE_CAM = {
    // 沙滩：相机贴中心、压平视线 → 沙丘（下）→ 岸线泡沫 → 青蓝海面 → 地平线（上半）
    beach: { fov: 60, p: [0, -2.0, 1.6], t: [0, 12, 1.2] },
    // UFC：笼外平视，八角笼护栏与中央地垫 logo 全在画面里（g4 实测最好）
    ufc: { fov: 46, p: [0, -4.2, 0.85], t: [0, 1.0, 0.45] },
    // 室内：站房间一侧正视对面墙 —— 左右两侧的矮柜/边几/踢脚线对称入画，
    //       地板占下半，是这几个候选里唯一能一眼读出「是个球房」的机位（k3）。
    room: { fov: 58, p: [0, 3.6, 0.9], t: [0, -2.4, 0.35] },
  }
  /** 兜底机位：场景 id 未登记时用（退到场景外 6m 平视中心） */
  var SCENE_CAM_FALLBACK = { fov: 58, p: [0, -6, 1.2], t: [0, 0, 0.4] }

  function buildSceneThumb(sceneId) {
    var S = skin()
    var root = null
    try {
      if (sceneId === "beach") root = S.buildBeach()
      else if (sceneId === "ufc") root = S.buildUfcOctagon()
      else if (sceneId === "room") root = S.buildIndoorScene("room")
    } catch (e) {
      console.warn("[skinPreview3D] 场景构建失败 " + sceneId + ": " + (e && e.message))
      return null
    }
    if (!root) return null

    // 天空穹顶**保留不删**（见上方注释：beach 的海天交界依赖它）。
    // 这里仍算一次包围盒，仅用于 renderer.capture 的兜底分支；
    // 真正的取景由 pose 决定，不走 frameBox。
    var box = new THREE.Box3().setFromObject(root)
    var pose = SCENE_CAM[sceneId] || SCENE_CAM_FALLBACK
    return { root: root, box: box, pose: pose, direct: "scene" }
  }

  // ---------- 相机参数（按类型区分） ----------
  /**
   * 球杆 / 球桌这两类「独立摆放的单体模型」不用 frameBox 的通用拟合，
   * 而是各自走一组实测过的显式机位 —— 因为在 260×120 这种极端扁画幅下，
   * 「刚好框住」等于「主体退化成一个点/一条线」，必须主动放大特写。
   */
  // 球杆：截取杆尾段后，近距俯视（见 buildCueThumb 注释）
  var CUE_POSE = { fov: 30, xf: -0.33, yf: -0.16, zf: 0.1 }
  /**
   * 球桌机位：**3/4 斜视 + 拉远**（v1.3.104 定稿，tools/render/_tpose*.js 六轮实拍选出）
   *
   * 【为什么不是原来的正俯视 elev:0.62 / dist:1.55】
   *   球桌 2.05:1 极扁（台呢 2.817 × 1.376），而画幅只有 260×120（2.17:1），
   *   两者长宽比几乎相同 —— 于是「正俯视把桌子塞满画幅」的后果是：
   *   观众看到的是一个**纯色矩形**，桌框与库边被压到画面外，
   *   完全读不出「这是一张球台」。
   *
   * 【正解 —— 绕 Z 轴转 35° 的 3/4 斜视】
   *   长边斜入画后，同屏能同时看到：台呢（中央）、相邻两条边的桌框、
   *   以及库边的厚度。这是台球桌缩略图最通行的视角。
   *
   * 【azim 的定义】相机在 XY 平面上的方位角（弧度），0 = 从 -Y 侧正视长边。
   */
  var TABLE_POSE = { fov: 42, elev: 0.44, dist: 3.8, azim: 0.61 }
  /**
   * 缩略图专用的桌框/库边**加粗倍数**。
   *
   * 真实几何里桌框宽 0.032（= 台面宽 2.817 的 **1.1%**）、库边高 0.016（1.2%）。
   * 这是物理正确的，但在 260×120 的缩略图里桌框只有 **2~3 像素** ——
   * 实测（tools/render/_tpose4.js）在 1× 下桌子仍是个「色块」，
   * 加粗到 3~3.5× 后桌框才成为一条清晰的分隔带，一眼可辨。
   * 只影响缩略图；**游戏内球桌与碰撞几何完全不受影响**。
   */
  var TABLE_FRAME_BOOST = 3.2
  var TABLE_CUSHION_BOOST = 2.6

  // ---------- ThumbRenderer ----------

  function ThumbRenderer() {
    this.canvas = null
    this.renderer = null
    this.failed = false
  }

  ThumbRenderer.prototype.init = function () {
    if (this.renderer || this.failed) return this.renderer
    try {
      this.canvas = document.createElement("canvas")
      this.canvas.width = OUT_W
      this.canvas.height = OUT_H
      this.canvas.style.display = "none"
      document.body.appendChild(this.canvas)
      this.renderer = new THREE.WebGLRenderer({
        canvas: this.canvas,
        antialias: true,
        alpha: false,
        // 必须为 true 才能 render 之后 toDataURL 读回像素（见红线 1）
        preserveDrawingBuffer: true,
      })
      this.renderer.setPixelRatio(1)
      this.renderer.setSize(OUT_W, OUT_H, false)
      if (this.renderer.outputColorSpace !== undefined && THREE.SRGBColorSpace) {
        this.renderer.outputColorSpace = THREE.SRGBColorSpace
      }
      if (THREE.ACESFilmicToneMapping !== undefined) {
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping
        this.renderer.toneMappingExposure = 1.06
      }
      // 能力探测：拿不到顶点贴图能力基本等于 WebGL 不可用
      var cap = this.renderer.capabilities
      if (cap && cap.maxVertexTextures === 0) {
        this.failed = true
        return null
      }
    } catch (e) {
      console.warn("[skinPreview3D] WebGL 不可用，缩略图回退到 2D：" + (e && e.message))
      this.failed = true
      return null
    }
    return this.renderer
  }

  /**
   * 【预热：把「首次真实渲染」的一次性开销提前吃掉】
   *
   * 实测结论（tools/render/_coldstart.js / _min.js / _abi.js / _whofirst.js）：
   *   · 空场景或不带贴图的极简材质 → 渲染耗时接近 0，**不会**触发这笔开销；
   *   · 整页第一次「带几何 + 受光材质 + 贴图采样」的渲染 → 会一次性花掉
   *     十几秒（本沙箱 SwiftShader 软渲染实测 18~20s），之后同页所有渲染
   *     都只要几毫秒。
   *   逐项二分排除过：与贴图尺寸、材质类型（standard/physical+sheen）、
   *   tonemapping、色调映射、几何形状都无关 —— 就是**进程级的一次性
   *   着色器/光栅器 JIT 冷启动**，落在「谁先渲染真实内容」谁身上。
   *
   * 影响面：**只在无 GPU 的软件渲染环境（如本沙箱）出现**。真机有 GPU，
   * 首次编译通常几十毫秒，用户无感。
   *
   * 这里主动渲染一帧「受光材质 + 贴图」的小场景，把这笔冷启动挪到正式
   * 出图之前，于是**第一张缩略图本身**总是快的。
   */
  ThumbRenderer.prototype.warmUp = function () {
    if (this.failed) return
    var renderer = this.init()
    if (!renderer || this._warmed) return
    this._warmed = true
    try {
      var ws = new THREE.Scene()
      ws.background = new THREE.Color(BG)
      ws.add(new THREE.HemisphereLight(0xcfe0f5, 0x2a3444, 2.1))
      var key = new THREE.DirectionalLight(0xffffff, 2.6)
      key.position.set(0.6, 1.4, 2.4)
      ws.add(key)

      // 自建一张极小贴图，用来点亮「纹理采样」这条路径
      var c = document.createElement("canvas")
      c.width = 8
      c.height = 8
      var g2 = c.getContext("2d")
      g2.fillStyle = "#3a5a3a"
      g2.fillRect(0, 0, 8, 8)
      var tex = new THREE.CanvasTexture(c)
      tex.colorSpace = THREE.SRGBColorSpace

      var mat = new THREE.MeshStandardMaterial({ map: tex, color: 0xffffff, roughness: 0.9 })
      var mesh = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.05), mat)
      ws.add(mesh)

      var wc = new THREE.PerspectiveCamera(40, OUT_W / OUT_H, 0.02, 10)
      wc.up.set(0, 0, 1)
      wc.position.set(0, -1, 0.6)
      wc.lookAt(0, 0, 0)
      renderer.render(ws, wc)

      // 立刻回收预热用的资源（自建，不归全局缓存管）
      mesh.geometry.dispose()
      mat.dispose()
      tex.dispose()
      ws.remove(mesh)
      ws.clear && ws.clear()
    } catch (e) {
      /* 预热失败不影响正式渲染，忽略 */
    }
  }

  ThumbRenderer.prototype.capture = function (built, kind) {
    var renderer = this.init()
    if (!renderer || !built) return null
    // 第一张正式缩略图前先吃掉「首次 toDataURL」的一次性开销（见 warmUp 注释）
    this.warmUp()

    var scene = new THREE.Scene()
    scene.background = new THREE.Color(BG)
    addLights(scene)

    var root = built.root
    scene.add(root)

    /**
     * 相机：Z-up 世界（与游戏内一致）。
     *
     * 三类都用**显式机位**而非通用拟合 —— 260×120 的扁画幅下，
     * 「刚好框住」会把主体压成一条线（详见各 _POSE 的注释）。
     * 用 `camera.up = (0,0,1)` 是因为游戏世界就是 Z-up：
     * 球桌在 XY 平面、台呢朝 +Z，用默认的 Y-up 相机会把桌子"竖起来"。
     */
    var far = kind === "scene" ? 400 : 60
    var fov = kind === "scene" ? (built.pose ? built.pose.fov : 58) : kind === "cue" ? CUE_POSE.fov : TABLE_POSE.fov
    var camera = new THREE.PerspectiveCamera(fov, OUT_W / OUT_H, 0.02, far)
    camera.up.set(0, 0, 1)

    if (kind === "scene" && built.pose) {
      // 场景：游戏内同款近景机位（写死在 SCENE_CAM）
      camera.position.set(built.pose.p[0], built.pose.p[1], built.pose.p[2])
      camera.lookAt(built.pose.t[0], built.pose.t[1], built.pose.t[2])
    } else if (kind === "cue") {
      // 球杆：以「杆尾段」包围盒中心为注视点，近距俯视
      var cc = boxCenter(root)
      camera.position.set(
        cc.x + CUE_LEN * CUE_POSE.xf,
        cc.y + CUE_LEN * CUE_POSE.yf,
        CUE_LEN * CUE_POSE.zf
      )
      camera.lookAt(cc)
    } else {
      // 球桌：3/4 斜视（绕 Z 转 azim），dist 为相机到台心的距离，elev 为俯角
      var tc = boxCenter(root)
      var d = TABLE_POSE.dist
      var el = TABLE_POSE.elev
      var az = TABLE_POSE.azim || 0
      var hor = d * Math.cos(el)
      camera.position.set(
        tc.x + hor * Math.sin(az),
        tc.y - hor * Math.cos(az),
        tc.z + d * Math.sin(el)
      )
      camera.lookAt(tc.x, tc.y, tc.z)
    }

    var url = null
    try {
      renderer.render(scene, camera)
      url = this.canvas.toDataURL("image/jpeg", 0.86)
    } catch (e) {
      console.warn("[skinPreview3D] 渲染失败(" + kind + ")：" + (e && e.message))
    } finally {
      // 先释放球桌自建的降采样贴图（它们不归全局缓存管），再清几何/材质
      disposeThumbTextures(root)
      disposeTree(root)
      scene.clear && scene.clear()
    }
    return url
  }

  // ---------- 对外 API ----------

  var renderer = null
  function getRenderer() {
    if (!renderer) renderer = new ThumbRenderer()
    return renderer
  }

  /**
   * 渲染单张缩略图。
   * @param kind  "cue" | "table" | "scene"
   * @param id    主题 / 皮肤 / 场景 id
   * @returns     dataURL 或 null（失败时调用方保留 2D 占位）
   */
  function renderThumb(kind, id) {
    try {
      var built = null
      if (kind === "cue") built = buildCueThumb(id)
      else if (kind === "table") built = buildTableThumb(id)
      else if (kind === "scene") built = buildSceneThumb(id)
      if (!built) return null
      return getRenderer().capture(built, kind)
    } catch (e) {
      console.warn("[skinPreview3D] renderThumb(" + kind + "," + id + ") 失败：" + (e && e.message))
      return null
    }
  }

  /** WebGL 是否可用（不可用则菜单整体不启用 3D 缩略图） */
  function isAvailable() {
    var r = getRenderer()
    return !!(r && r.init())
  }

  /** 预热（可选）：提前吃掉首次 toDataURL 的一次性开销 */
  function warmUp() {
    getRenderer().warmUp()
  }

  global.SkinPreview3D = {
    renderThumb: renderThumb,
    isAvailable: isAvailable,
    warmUp: warmUp,
    OUT_W: OUT_W,
    OUT_H: OUT_H,
  }
})(typeof window !== "undefined" ? window : this)
