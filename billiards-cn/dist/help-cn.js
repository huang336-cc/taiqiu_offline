/**
 * 游戏内菜单覆盖层逻辑（操作说明 / 设置 / 规则）
 * 与主菜单共用同一份 localStorage 设置。
 */
;(function () {
  "use strict"

  var STORAGE_KEY = "billiards_cn_settings_v1"

  // ===== v1.3.19 多语言（i18n）=====
  var I18N = {
    zh: {
      quality: [
        "极速（像素风，最省电）",
        "流畅（低配手机推荐）",
        "标准",
        "高清（推荐）",
        "超清（开启抗锯齿）",
        "极致（高端手机）",
      ],
      qualityHint: [
        "以极低分辨率渲染，画面为像素风格，帧率最高、最省电。",
        "降低渲染分辨率与球体精度，适合入门机型与老旧设备。",
        "常规画质，多数中端手机可稳定运行。",
        "较高的渲染分辨率与球体精度，兼顾清晰度与流畅度。",
        "开启抗锯齿，边缘更平滑，建议中高端机型使用。",
        "最高渲染精度，仅建议旗舰机型开启，耗电较高。",
      ],
      tline: ["关闭", "短", "中", "最长"],
    },
    en: {
      quality: [
        "Ultra Lite (pixel art, most power-saving)",
        "Smooth (for low-end phones)",
        "Standard",
        "HD (recommended)",
        "Sharp (antialiasing on)",
        "Ultra (high-end phones)",
      ],
      qualityHint: [
        "Renders at very low resolution with a pixel-art look; highest frame rate and lowest power use.",
        "Lowers render resolution and ball detail; good for entry-level and older devices.",
        "Standard quality; runs stably on most mid-range phones.",
        "Higher render resolution and ball detail, balancing clarity and smoothness.",
        "Enables antialiasing for smoother edges; recommended for mid-to-high-end devices.",
        "Highest render quality; only recommended for flagship devices, higher power draw.",
      ],
      tline: ["Off", "Short", "Medium", "Longest"],
    },
  }

  // 中文 -> 英文 文本映射（覆盖 help.html 的文本节点与属性）
  var TX = {
    "操作说明": "How to Play",
    "设置": "Settings",
    "触屏操作": "Touch controls",
    "左右拖动：旋转瞄准方向": "Drag left/right: rotate aim direction",
    "上下拖动：调整视角俯仰": "Drag up/down: adjust view pitch",
    "双指捏合：缩放画面": "Pinch: zoom",
    "击球按钮：右下角圆形按钮，点击出杆":
      "Shoot button: round button at bottom-right; tap to strike",
    "力度与杆法": "Power & Stroke",
    "力度条：拖动调整，百分比实时显示":
      "Power bar: drag to adjust; percentage shows live",
    "母球图示：点选击球点，上=高杆，下=低杆，左右=加塞":
      "Cue ball diagram: tap contact point — top=follow, bottom=draw, left/right=side spin",
    "「+」按钮：调整球杆抬起角度": "+ button: raise cue angle",
    "复位按钮（圆盘左上角 ⟲）：一键把击球点恢复到正中心；双击母球图示也可复位":
      "Reset button (top-left of disc ⟲): recentre contact point; double-tap the cue diagram also resets",
    "细微瞄准条：底部悬浮滑动条，左右拖动极精细修正瞄准角；滑块居中=本杆初始方向，松手自动归中，可一直拖动持续微调瞄准":
      "Fine aim bar: floating slider at bottom; drag left/right for precise aim adjustment; centred = shot initial direction, auto-recentres on release",
    "视角": "Camera",
    "点击 循环切换：跟随 → 俯视 → 母球视角":
      "Tap to cycle: Follow → Top-down → Cue-ball view",
    "俯视视角适合观察全局与规划走位":
      "Top-down helps read the whole table and plan position",
    "画面": "Graphics",
    "画质档位": "Quality",
    "画质调整后，返回主菜单重新开局即可完全生效。":
      "Quality changes take full effect after returning to the menu and starting a new game.",
    "声音": "Sound",
    "音效": "Sound",
    "音量": "Volume",
    "操作": "Controls",
    "球杆延长线": "Cue extension line",
    "进球预测线": "Pot prediction line",
    "瞄准时在台面上画两段线：实线 = 母球球心 → 目标球碰撞接触点，虚线 = 碰撞点 → 球袋中心。遇到其它球或台边自动截断，出杆瞬间立刻隐藏。":
      "Two lines are drawn on the table while aiming: a solid line = cue centre to object-ball contact point, and a dashed line = contact point to pocket centre. They auto-clip at other balls or rails and hide the instant you strike.",
    "辅助线长度": "Aim line length",
    "没有正对袋口时线条的延伸长度。拖到最左同样可关闭辅助线。":
      "How far the line extends when no pocket is directly aimed at. Drag fully left to also turn it off.",
    "保留三个视角": "Keep three views",
    "关闭后，": "When off, ",
    "仅在「跟随 / 俯视」两视角间切换，不再拉远到母球视角。":
      "only the Follow / Top-down views are kept; it no longer zooms out to the cue-ball view.",
    "语言": "Language",
    "界面语言": "Interface language",
    "中文": "Chinese",
      "游戏菜单": "Game Menu",
      "（圆盘左上角 ⟲）：一键把击球点恢复到正中心；双击母球图示也可复位": "(Top-left of the disc ⟲): one tap resets the cue contact point to center; double-tap the cue-ball icon also resets it.",
      "瞄准时在台面上画两段线：实线 = 母球球心 →\n          目标球碰撞接触点，虚线 = 碰撞点 →\n          球袋中心。遇到其它球或台边自动截断，出杆瞬间立刻隐藏。": "When aiming, two lines are drawn on the table: the solid line = cue-ball center → object-ball contact point, the dashed line = contact point → pocket center. They are auto-clipped at other balls or rails and hidden the instant you shoot.",
      "最长": "Longest",
      "左右拖动": "Drag left/right",
      "：旋转瞄准方向": ": rotate the aim direction",
      "上下拖动": "Drag up/down",
      "：调整视角俯仰": ": tilt the view pitch",
      "双指捏合": "Pinch",
      "：缩放画面": ": zoom in/out",
      "击球按钮": "Shoot button",
      "：右下角圆形按钮，点击出杆": ": the round button at bottom-right; tap to shoot",
      "力度条": "Power bar",
      "：拖动调整，百分比实时显示": ": drag to adjust; the percentage shows in real time",
      "母球图示": "Cue-ball icon",
      "：点选击球点，上=高杆，下=低杆，左右=加塞": ": tap to set the contact point — top = follow, bottom = draw, left/right = side spin",
      "「+」按钮": "“+” button",
      "：调整球杆抬起角度": ": raise the cue angle",
      "复位按钮": "Reset button",
      "细微瞄准条": "Fine aim bar",
      "：底部悬浮滑动条，左右拖动极精细修正瞄准角；滑块居中=本杆初始方向，松手自动归中，可一直拖动持续微调瞄准": ": a floating bar at the bottom; drag left/right for very fine aim correction. The slider centers on the current shot’s initial direction, auto-recenters on release, and you can keep dragging to fine-tune continuously.",
      "点击": "Tap",
      "循环切换：跟随 → 俯视 → 母球视角": "to cycle: Follow → Top-down → Cue-ball view",
  }

  function curLang() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY)
      if (raw) {
        var s = JSON.parse(raw)
        if (s && (s.language === "en" || s.language === "zh")) return s.language
      }
    } catch (e) {}
    return "zh"
  }

  function localePkg() {
    var l = curLang()
    return I18N[l] || I18N.zh
  }

  function QL(i) {
    var a = localePkg().quality
    return a[i] != null ? a[i] : I18N.zh.quality[i]
  }
  function QH(i) {
    var a = localePkg().qualityHint
    return a[i] != null ? a[i] : I18N.zh.qualityHint[i]
  }
  function TL(i) {
    var a = localePkg().tline
    return a[i] != null ? a[i] : I18N.zh.tline[i]
  }

  function setLang(l) {
    if (l !== "en" && l !== "zh") l = "zh"
    var s = {}
    try {
      var raw = localStorage.getItem(STORAGE_KEY)
      if (raw) s = JSON.parse(raw) || {}
    } catch (e) {
      s = {}
    }
    s.language = l
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(s))
    } catch (e) {}
  }

  function localize(root, toLang) {
    root = root || document
    try {
      document.documentElement.lang = toLang === "en" ? "en" : "zh-CN"
    } catch (e) {}
    if (!root.querySelectorAll) return
    var walker
    try {
      walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null)
    } catch (e) {
      return
    }
    var texts = []
    var n
    while ((n = walker.nextNode())) texts.push(n)
    for (var i = 0; i < texts.length; i++) {
      var node = texts[i]
      if (node.nodeValue == null) continue
      if (toLang === "en") {
        var key = node.nodeValue.trim()
        if (TX[key] != null) {
          node.__zh = key
          node.nodeValue = TX[key]
        }
      } else if (node.__zh != null) {
        node.nodeValue = node.__zh
      }
    }
    var attrs = ["title", "aria-label", "placeholder", "alt"]
    var els = root.querySelectorAll("*")
    for (var j = 0; j < els.length; j++) {
      var el = els[j]
      for (var k = 0; k < attrs.length; k++) {
        var an = attrs[k]
        var v = el.getAttribute(an)
        if (v == null) continue
        if (toLang === "en") {
          if (TX[v] != null) {
            if (el["__zh_" + an] == null) el["__zh_" + an] = v
            el.setAttribute(an, TX[v])
          }
        } else if (el["__zh_" + an] != null) {
          el.setAttribute(an, el["__zh_" + an])
        }
      }
    }
  }

  // 兼容旧引用
  var LABELS = I18N.zh.quality
  var HINTS = I18N.zh.qualityHint
  var TLINE_LABELS = I18N.zh.tline

  var DEFAULTS = {
    lod: 3,
    sound: true,
    volume: 0.8,
    aimAssist: true,
    seenGuide: false,
    lastRule: "nineball",
    vsBot: false,
    fpsCap: 0,
    targetLineLength: 2,
    aimLine: true,
    aimSlider: true,
    keepAllViews: true,
  }

  function load() {
    var s = {}
    try {
      var raw = localStorage.getItem(STORAGE_KEY)
      if (raw) s = JSON.parse(raw) || {}
    } catch (e) {
      s = {}
    }
    var m = {}
    for (var k in DEFAULTS) m[k] = DEFAULTS[k]
    for (var k2 in s) m[k2] = s[k2]
    return m
  }

  function save(s) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(s))
    } catch (e) {
      /* 忽略 */
    }
    // 通知游戏主页面设置已变更
    try {
      if (window.parent && window.parent !== window) {
        window.parent.postMessage({ type: "billiards-settings", data: s }, "*")
      }
    } catch (e) {
      /* 跨域时忽略 */
    }
  }

  var st = load()

  function $(id) {
    return document.getElementById(id)
  }

  // 标签页切换
  var tabs = document.querySelectorAll(".tab")
  Array.prototype.forEach.call(tabs, function (t) {
    t.addEventListener("click", function () {
      Array.prototype.forEach.call(tabs, function (x) {
        x.classList.remove("active")
      })
      t.classList.add("active")
      var panes = document.querySelectorAll(".pane")
      Array.prototype.forEach.call(panes, function (p) {
        p.classList.remove("active")
      })
      var target = $("pane-" + t.getAttribute("data-tab"))
      if (target) target.classList.add("active")
    })
  })

  // v1.3.60：「画质档位」select 已从 settings pane DOM 中删除。
  // 这里的 renderQualityOptions / q / qh 全套跟着删除，避免保留死代码。
  // 玩家调画质仍可走电脑端首页「设置」面板（Home Settings）-> 画质档位。

  function sync() {
    $("snd").checked = !!st.sound
    $("vol").value = String(Math.round(st.volume * 100))
    $("volv").textContent = Math.round(st.volume * 100) + "%"
    $("aim").checked = !!st.aimAssist
    $("aimline").checked = st.aimLine !== false
    // v1.2.11 #F10：删除 aimslider 同步（设置项已移除，控件默认存在）
    $("tline").value = String(st.targetLineLength || 3)
    $("tlinev").textContent = TL(st.targetLineLength || 3)
    $("keepviews").checked = st.keepAllViews !== false
  }
  sync()

  $("snd").addEventListener("change", function (e) {
    st.sound = e.target.checked
    save(st)
  })
  $("vol").addEventListener("input", function (e) {
    st.volume = parseInt(e.target.value, 10) / 100
    $("volv").textContent = e.target.value + "%"
    save(st)
  })
  $("aim").addEventListener("change", function (e) {
    st.aimAssist = e.target.checked
    save(st)
  })
  $("aimline").addEventListener("change", function (e) {
    st.aimLine = e.target.checked
    save(st)
  })
  // v1.2.11 #F10：删除 aimslider change 监听（设置项已移除）
  $("tline").addEventListener("input", function (e) {
    st.targetLineLength = parseInt(e.target.value, 10)
    $("tlinev").textContent = TL(st.targetLineLength) || "中"
    save(st)
  })
  $("keepviews").addEventListener("change", function (e) {
    st.keepAllViews = e.target.checked
    save(st)
  })

  // v1.3.19：语言切换
  function applyLang(l) {
    setLang(l)
    // v1.3.60：语言下拉段已从 settings pane DOM 移除，无 renderQualityOptions
    // 调用，也没有 langSeg 按钮可切换。这里保留 setLang + localize + postMessage，
    // 因为语言切换仍由电脑端首页「设置」面板触发，事件经由 window.parent.postMessage
    // 同步（与 v1.3.19 起一致）。
    localize(document, l)
    // 通知父页面（游戏）语言已变更
    try {
      if (window.parent && window.parent !== window) {
        window.parent.postMessage({ type: "billiards-language", language: l }, "*")
      }
    } catch (e) {}
  }

  localize(document, curLang())
  // v1.3.60：游戏内设置覆盖层不再有语言分段按钮，不再绑定 langSeg click。
  // 电脑端首页的「设置」面板仍保留 [中文]/[English] 切换入口，那里同步
  // localStorage 后经由 storage 事件 + postMessage 把语言推到所有 iframe。
})()
