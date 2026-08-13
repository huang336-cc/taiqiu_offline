/**
 * 主菜单逻辑（纯离线，无任何网络请求）
 *
 * 设置数据与游戏内共用同一份 localStorage，键名保持一致。
 */
;(function () {
  "use strict"

  var STORAGE_KEY = "billiards_cn_settings_v1"

  var QUALITY_LABELS = [
    "极速（像素风，最省电）",
    "流畅（低配手机推荐）",
    "标准",
    "高清（推荐）",
    "超清（开启抗锯齿）",
    "极致（高端手机）",
  ]

  var QUALITY_HINTS = [
    "以极低分辨率渲染，画面为像素风格，帧率最高、最省电。",
    "降低渲染分辨率与球体精度，适合入门机型与老旧设备。",
    "常规画质，多数中端手机可稳定运行。",
    "较高的渲染分辨率与球体精度，兼顾清晰度与流畅度。",
    "开启抗锯齿，边缘更平滑，建议中高端机型使用。",
    "最高渲染精度，仅建议旗舰机型开启，耗电较高。",
  ]

  // 辅助线长度滑动条档位文案（0=关，1=短，2=中，3=最长），与游戏内保持一致
  var TLINE_LABELS = ["关闭", "短", "中", "最长"]

  var DEFAULTS = {
    lod: 3,
    sound: true,
    // v1.2.28：音量默认最大（1.0）。与 settings.ts 对齐。
    volume: 1,
    aimAssist: true,
    seenGuide: false,
    turnTimer: 0,
    lastRule: "nineball",
    lastOpponent: "solo",
    vsBot: false,
    fpsCap: 0,
    // v1.2.28：辅助线长度默认最长（3）。此前此处写 2（中）与 settings.ts 的 3 不一致，
    // 且菜单这份 DEFAULTS 会被持久化，导致首次进入游戏辅助线默认不是最长。统一为 3。
    targetLineLength: 3,
    aimLine: true,
    aimSlider: true,
    keepAllViews: true,
    skin: "classic",
    cueTheme: "auto",
    // v1.1.6：默认且仅启用「雪山」场景
    scene: "snow",
  }

  /* ---------------- 设置存取 ---------------- */

  function loadSettings() {
    var s = {}
    try {
      var raw = localStorage.getItem(STORAGE_KEY)
      if (raw) s = JSON.parse(raw) || {}
    } catch (e) {
      s = {}
    }
    var isFirst = !s || Object.keys(s).length === 0
    var merged = {}
    for (var k in DEFAULTS) merged[k] = DEFAULTS[k]
    for (var k2 in s) merged[k2] = s[k2]
    if (isFirst) merged.lod = detectLod()
    merged.lod = Math.min(5, Math.max(0, Math.round(merged.lod)))
    // v1.1.6：仅启用「雪山」场景，其余 UI 已禁用；若旧存档选了别的场景，
    // 强制回落到雪山，避免进入游戏后黑屏。
    if (merged.scene !== "snow") merged.scene = "snow"
    // v1.1.10：seenGuide 独立 key 兜底。主 key 写入失败时，独立 key 仍可读到。
    if (!merged.seenGuide) {
      try {
        if (localStorage.getItem("billiards_cn_seenGuide_v1") === "1") {
          merged.seenGuide = true
        }
      } catch (e) { /* 忽略 */ }
    }
    return merged
  }

  function saveSettings(s) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(s))
    } catch (e) {
      // v1.1.10：不再静默吞错，至少把 seenGuide 写到独立 key 兜底
      console.warn("[menu] localStorage 写入失败", e)
      try {
        if (s && s.seenGuide) {
          localStorage.setItem("billiards_cn_seenGuide_v1", "1")
        }
      } catch (e2) { /* 彻底不可用时无能为力 */ }
    }
  }

  /** 依据设备内存/核心数/GPU 推荐画质 */
  function detectLod() {
    try {
      var mem = navigator.deviceMemory || 4
      var cores = navigator.hardwareConcurrency || 4
      var dpr = window.devicePixelRatio || 1
      var score = 0
      if (mem >= 8) score += 3
      else if (mem >= 6) score += 2
      else if (mem >= 4) score += 1
      if (cores >= 8) score += 3
      else if (cores >= 6) score += 2
      else if (cores >= 4) score += 1
      if (dpr >= 2) score += 1

      var gpu = detectGpu().toLowerCase()
      var lowEnd = ["mali-4", "mali-t", "adreno 3", "adreno 4", "powervr sgx"]
      for (var i = 0; i < lowEnd.length; i++) {
        if (gpu.indexOf(lowEnd[i]) >= 0) {
          score -= 3
          break
        }
      }
      if (score >= 6) return 4
      if (score >= 4) return 3
      if (score >= 2) return 2
      return 1
    } catch (e) {
      return 2
    }
  }

  function detectGpu() {
    // 关键修复：菜单启动阶段【不再】创建 WebGL 上下文。
    // 原实现用裸 canvas.getContext("webgl") 读取 GPU 型号，但部分机型 GPU 驱动
    // 在创建这个上下文时会直接令渲染进程崩溃（表现即"点图标即闪退，进不了首页"）。
    // 画质自动分级改为仅依据 deviceMemory / 核数 / DPR，已知低端 GPU 的额外扣分在此跳过；
    // 用户仍可在设置中手动调低画质。游戏页（index.html）真正的 WebGL 由 three.js 负责，
    // 那里有 onRenderProcessGone 兜底，与菜单解耦。
    return ""
  }

  var settings = loadSettings()

  /* ---------------- 界面状态 ---------------- */

  var selectedRule = settings.lastRule || "nineball"
  var selectedOpponent = settings.lastOpponent || "solo"

  function $(id) {
    return document.getElementById(id)
  }

  /* ---------------- 玩法选择 ---------------- */

  // 每个玩法的色板：与 CSS .mode-card 的 data-tint 对应，
  // 同时驱动「模式预览」画布的背景主题，让卡片整体色彩协调。
  var MODE_META = {
    nineball:     { tint: "#ffb648", icon: "assets/nineball.png",     name: "九球" },
    eightball:    { tint: "#3aa3ff", icon: "assets/eightball.png",    name: "八球" },
    snooker:      { tint: "#e85a5a", icon: "assets/snooker.png",      name: "斯诺克" },
    threecushion: { tint: "#7e5ad6", icon: "assets/threecushion.png", name: "三库开伦" },
  }

  function getModeMeta(rule) {
    return MODE_META[rule] || MODE_META.eightball
  }

  function initModes() {
    var cards = document.querySelectorAll(".mode-card")
    Array.prototype.forEach.call(cards, function (card) {
      var rule = card.getAttribute("data-rule")
      var meta = getModeMeta(rule)
      // 把 data-tint 转成 CSS 变量，让色彩主题在卡片各处生效
      card.style.setProperty("--tint", meta.tint)
      if (rule === selectedRule) {
        card.classList.add("selected")
      }
      // v1.2.11 #F4：外层改为 div，补 keydown 触发模式选择（可访问性）
      card.addEventListener("click", function (e) {
        // 若点击来自规则按钮，不触发模式选择
        if (e.target && e.target.classList && e.target.classList.contains("mode-rule")) return
        Array.prototype.forEach.call(cards, function (c) {
          c.classList.remove("selected")
        })
        card.classList.add("selected")
        selectedRule = rule
        settings.lastRule = selectedRule
        saveSettings(settings)
        updateOpponentAvailability()
        buzz(10)
      })
      card.addEventListener("keydown", function (e) {
        if (e.key === "Enter" || e.key === " " || e.key === "Spacebar") {
          e.preventDefault()
          card.click()
        }
      })
    })

    // v1.2.11 #F4：绑定「规则」按钮点击 → 弹出对应玩法规则
    var ruleBtns = document.querySelectorAll(".mode-rule")
    Array.prototype.forEach.call(ruleBtns, function (btn) {
      btn.addEventListener("click", function (e) {
        e.stopPropagation()
        e.preventDefault()
        var rule = btn.getAttribute("data-rule")
        showModeRules(rule)
        buzz(10)
      })
    })
  }

  /** v1.2.11 #F4：各玩法规则文本（含犯规规则），填充到 #screen-rules */
  var MODE_RULES = {
    nineball: {
      title: "九球规则",
      body:
        '<div class="guide-block"><h3>九球</h3><p>台面上有 1~9 号球。每次击球必须先碰到台面上号码最小的球，任何球落袋都算得分并可继续击球。谁先合法打进 9 号球即获胜。</p></div>' +
        '<div class="guide-block"><h3>犯规</h3><ul class="guide-list"><li>母球落袋</li><li>空杆（未击中任何球）</li><li>首个击中的球不是台面号码最小的球</li><li>击球后无任何球碰库且无球落袋</li></ul><p class="about-text dim">犯规后对手获得自由球，可任意摆放母球。</p></div>',
    },
    eightball: {
      title: "八球规则",
      body:
        '<div class="guide-block"><h3>八球</h3><p>开球后由第一颗合法落袋的球确定己方球组（全色 1~7 或花色 9~15）。清完己方球组后，最后打进黑 8 者获胜。黑 8 提前落袋判负。</p></div>' +
        '<div class="guide-block"><h3>犯规</h3><ul class="guide-list"><li>母球落袋</li><li>空杆（未击中任何球）</li><li>开局先碰黑八，犯规</li><li>先碰到了对方的球</li><li>本方球已清台，必须先碰黑八（否则犯规）</li><li>击球后无任何球碰库且无球落袋</li></ul><p class="about-text dim">犯规后对手获得自由球，可任意摆放母球。</p></div>',
    },
    snooker: {
      title: "斯诺克规则",
      body:
        '<div class="guide-block"><h3>斯诺克</h3><p>先打红球（1 分），进袋后再打一颗彩球，交替进行。彩球分值：黄 2、绿 3、棕 4、蓝 5、粉 6、黑 7。红球阶段彩球进袋后需重新摆回原位；红球清完后，按分值从低到高依次清彩球，总分高者获胜。</p></div>' +
        '<div class="guide-block"><h3>犯规</h3><ul class="guide-list"><li>母球落袋</li><li>空杆（未击中任何球）</li><li>首个击中的球不符合当前阶段（红球阶段碰彩球，或彩球阶段碰红球）</li><li>击球后无任何球碰库且无球落袋</li></ul><p class="about-text dim">犯规后对手获得自由球，可任意摆放母球。</p></div>',
    },
    threecushion: {
      title: "三库开伦规则",
      body:
        '<div class="guide-block"><h3>三库开伦</h3><p>无袋球台。母球需先碰到库边至少三次，再撞到另外两颗球，即得 1 分。得分后可继续击球，未得分则换手。</p></div>' +
        '<div class="guide-block"><h3>犯规</h3><ul class="guide-list"><li>未先碰库边三次即撞到第二颗球</li><li>空杆（未击中任何球）</li></ul><p class="about-text dim">犯规后换手，由对手击球。</p></div>',
    },
  }

  function showModeRules(rule) {
    var info = MODE_RULES[rule]
    if (!info) return
    var titleEl = $("rulesTitle")
    var bodyEl = $("rulesBody")
    if (titleEl) titleEl.textContent = info.title
    if (bodyEl) bodyEl.innerHTML = info.body
    showScreen("rules")
  }

  /**
   * 三库开伦没有袋口，电脑策略仅针对落袋类玩法，
   * 因此该玩法下只提供自己练习。
   */
  function updateOpponentAvailability() {
    var isCarom = selectedRule === "threecushion"
    var btns = document.querySelectorAll("#opponentSeg .seg-btn")
    Array.prototype.forEach.call(btns, function (b) {
      var op = b.getAttribute("data-opponent")
      if (op !== "solo" && isCarom) {
        b.style.display = "none"
      } else {
        b.style.display = ""
      }
    })
    if (isCarom && selectedOpponent !== "solo") {
      selectOpponent("solo")
    }
  }

  function selectOpponent(op) {
    selectedOpponent = op
    var btns = document.querySelectorAll("#opponentSeg .seg-btn")
    Array.prototype.forEach.call(btns, function (b) {
      b.classList.toggle("active", b.getAttribute("data-opponent") === op)
    })
    settings.vsBot = op !== "solo"
    settings.lastOpponent = op
    saveSettings(settings)
  }

  function initOpponents() {
    var btns = document.querySelectorAll("#opponentSeg .seg-btn")
    Array.prototype.forEach.call(btns, function (b) {
      b.addEventListener("click", function () {
        selectOpponent(b.getAttribute("data-opponent"))
        buzz(10)
      })
    })
    selectOpponent(selectedOpponent)
    updateOpponentAvailability()
  }

  /* ---------------- 屏幕切换 ---------------- */

  function showScreen(name) {
    var screens = document.querySelectorAll(".screen")
    Array.prototype.forEach.call(screens, function (s) {
      s.classList.remove("active")
    })
    var target = $("screen-" + name)
    if (target) target.classList.add("active")
  }

  /* ---------------- 设置面板 ---------------- */

  function initSettingsPanel() {
    var sel = $("setQuality")
    for (var i = 0; i < QUALITY_LABELS.length; i++) {
      var opt = document.createElement("option")
      opt.value = String(i)
      opt.textContent = QUALITY_LABELS[i]
      sel.appendChild(opt)
    }

    syncSettingsUI()

    sel.addEventListener("change", function () {
      settings.lod = parseInt(sel.value, 10)
      saveSettings(settings)
      $("qualityHint").textContent = QUALITY_HINTS[settings.lod]
    })

    $("btnAutoQuality").addEventListener("click", function () {
      settings.lod = detectLod()
      saveSettings(settings)
      syncSettingsUI()
      buzz(15)
    })

    $("setSound").addEventListener("change", function (e) {
      settings.sound = e.target.checked
      saveSettings(settings)
    })

    $("setVolume").addEventListener("input", function (e) {
      settings.volume = parseInt(e.target.value, 10) / 100
      $("volumeVal").textContent = e.target.value + "%"
      saveSettings(settings)
    })

    $("setAim").addEventListener("change", function (e) {
      settings.aimAssist = e.target.checked
      saveSettings(settings)
    })

    $("setAimLine").addEventListener("change", function (e) {
      settings.aimLine = e.target.checked
      saveSettings(settings)
    })

    $("setTLine").addEventListener("input", function (e) {
      settings.targetLineLength = parseInt(e.target.value, 10)
      $("setTLineVal").textContent = TLINE_LABELS[settings.targetLineLength] || "中"
      saveSettings(settings)
    })

    $("setKeepViews").addEventListener("change", function (e) {
      settings.keepAllViews = e.target.checked
      saveSettings(settings)
    })

    $("setSkin").addEventListener("change", function (e) {
      settings.skin = e.target.value
      saveSettings(settings)
    })

    $("setCueTheme").addEventListener("change", function (e) {
      settings.cueTheme = e.target.value
      saveSettings(settings)
    })

    $("setScene").addEventListener("change", function (e) {
      settings.scene = e.target.value
      saveSettings(settings)
    })

    $("setTurnTimer").addEventListener("change", function (e) {
      settings.turnTimer = parseInt(e.target.value, 10) || 0
      saveSettings(settings)
    })

    $("btnReset").addEventListener("click", function () {
      var d = {}
      for (var k in DEFAULTS) d[k] = DEFAULTS[k]
      d.lod = detectLod()
      settings = d
      saveSettings(settings)
      syncSettingsUI()
      buzz(20)
    })
  }

  function syncSettingsUI() {
    $("setQuality").value = String(settings.lod)
    $("qualityHint").textContent = QUALITY_HINTS[settings.lod]
    $("setSound").checked = !!settings.sound
    $("setVolume").value = String(Math.round(settings.volume * 100))
    $("volumeVal").textContent = Math.round(settings.volume * 100) + "%"
    $("setAim").checked = !!settings.aimAssist
    $("setAimLine").checked = settings.aimLine !== false
    $("setTLine").value = String(settings.targetLineLength || 3)
    $("setTLineVal").textContent = TLINE_LABELS[settings.targetLineLength || 3] || "中"
    $("setKeepViews").checked = settings.keepAllViews !== false
    $("setSkin").value = settings.skin || "classic"
    $("setCueTheme").value = settings.cueTheme || "auto"
    $("setScene").value = settings.scene || "snow"
    $("setTurnTimer").value = String(settings.turnTimer || 0)
  }

  function buzz(ms) {
    try {
      if (navigator.vibrate) navigator.vibrate(ms)
    } catch (e) {
      /* 部分设备不支持震动 */
    }
  }

  /* ---------------- 选项框特写预览（item 5） ----------------
   * 用 Canvas 程序化生成「主题细节特写」，替代原来的纯色色块：
   *  - 场景：房间内景（墙面渐变 + 地面透视 + 各场景图案）
   *  - 球杆：斜放球杆特写（杆身渐变 + 铜箍皮头 + 主题纹样）
   *  - 台球桌颜色：台呢 + 木框 + 一颗球 的特写
   * 全部离线生成，结果以 dataURL 写入 .skin-swatch 的 background-image。
   */

  function shadeColor(hex, amt) {
    var c = String(hex).replace("#", "")
    if (c.length === 3)
      c = c[0] + c[0] + c[1] + c[1] + c[2] + c[2]
    var r = parseInt(c.substr(0, 2), 16)
    var g = parseInt(c.substr(2, 2), 16)
    var b = parseInt(c.substr(4, 2), 16)
    var f = function (v) {
      return Math.max(0, Math.min(255, Math.round(v + 255 * amt)))
    }
    return "rgb(" + f(r) + "," + f(g) + "," + f(b) + ")"
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath()
    ctx.moveTo(x + r, y)
    ctx.arcTo(x + w, y, x + w, y + h, r)
    ctx.arcTo(x + w, y + h, x, y + h, r)
    ctx.arcTo(x, y + h, x, y, r)
    ctx.arcTo(x, y, x + w, y, r)
    ctx.closePath()
  }

  function makeCanvas(w, h) {
    var cv = document.createElement("canvas")
    cv.width = w
    cv.height = h
    return cv
  }

  function drawScenePreview(cv, kind, c1, c2) {
    var ctx = cv.getContext("2d")
    var W = cv.width,
      H = cv.height
    var g = ctx.createLinearGradient(0, 0, 0, H)
    g.addColorStop(0, c1)
    g.addColorStop(1, c2)
    ctx.fillStyle = g
    ctx.fillRect(0, 0, W, H)
    var fh = H * 0.36
    ctx.fillStyle = shadeColor(c2, -0.16)
    ctx.fillRect(0, H - fh, W, fh)
    var vpx = W / 2,
      vpy = H - fh
    ctx.strokeStyle = "rgba(255,255,255,0.16)"
    ctx.lineWidth = 1
    for (var i = 0; i <= 6; i++) {
      var x = (i / 6) * W
      ctx.beginPath()
      ctx.moveTo(x, H)
      ctx.lineTo(vpx + (x - vpx) * 0.28, vpy)
      ctx.stroke()
    }
    for (var j = 1; j < 3; j++) {
      var y = vpy + (H - vpy) * (j / 3)
      ctx.beginPath()
      ctx.moveTo(0, y)
      ctx.lineTo(W, y)
      ctx.stroke()
    }
    drawScenePattern(ctx, W, H, kind, c1, c2, vpy)
  }

  /**
   * 实景照片 cover 绘制（Request D）：把照片按 object-fit:cover 裁切填满画布，
   * 并叠加轻微暗角提升文字可读性。用于「雪山/足球场/篮球场」等照片场景缩略图。
   */
  function drawPhotoCover(cv, img) {
    var ctx = cv.getContext("2d")
    var W = cv.width,
      H = cv.height
    var iw = img.width || 1,
      ih = img.height || 1
    var ir = iw / ih,
      cr = W / H
    var sx, sy, sw, sh
    if (ir > cr) {
      sh = ih
      sw = sh * cr
      sx = (iw - sw) / 2
      sy = 0
    } else {
      sw = iw
      sh = sw / cr
      sx = 0
      sy = (ih - sh) / 2
    }
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, W, H)
    var vg = ctx.createRadialGradient(W / 2, H / 2, H * 0.2, W / 2, H / 2, W * 0.72)
    vg.addColorStop(0, "rgba(0,0,0,0)")
    vg.addColorStop(1, "rgba(0,0,0,0.2)")
    ctx.fillStyle = vg
    ctx.fillRect(0, 0, W, H)
  }

  function drawScenePattern(ctx, W, H, kind, c1, c2, horizonY) {
    switch (kind) {
      case "beach":
        ctx.globalAlpha = 0.12
        ctx.fillStyle = "#000"
        for (var y = 0; y < horizonY; y += 22)
          ctx.fillRect(0, y + ((y / 22) % 2 ? 5 : 0), W, 5)
        ctx.globalAlpha = 1
        break
      case "forest":
        ctx.globalAlpha = 0.2
        ctx.fillStyle = "#0c1a0c"
        for (var x = 24; x < W; x += 58) ctx.fillRect(x, 0, 22, horizonY)
        ctx.globalAlpha = 1
        break
      case "snow":
        ctx.fillStyle = "rgba(255,255,255,0.55)"
        for (var s = 0; s < 140; s++) {
          ctx.beginPath()
          ctx.arc(
            Math.random() * W,
            Math.random() * horizonY,
            Math.random() * 2 + 0.5,
            0,
            6.283
          )
          ctx.fill()
        }
        break
      case "office":
        ctx.globalAlpha = 0.12
        ctx.strokeStyle = "#1a2430"
        ctx.lineWidth = 3
        for (var x2 = 0; x2 <= W; x2 += 96) {
          ctx.beginPath()
          ctx.moveTo(x2, 0)
          ctx.lineTo(x2, horizonY)
          ctx.stroke()
        }
        for (var y2 = 0; y2 <= horizonY; y2 += 96) {
          ctx.beginPath()
          ctx.moveTo(0, y2)
          ctx.lineTo(W, y2)
          ctx.stroke()
        }
        ctx.globalAlpha = 1
        break
      case "cybercafe":
        ctx.globalAlpha = 0.5
        ctx.strokeStyle = "#36e0ff"
        ctx.lineWidth = 2
        for (var x3 = 0; x3 <= W; x3 += 44) {
          ctx.beginPath()
          ctx.moveTo(x3, 0)
          ctx.lineTo(x3, horizonY)
          ctx.stroke()
        }
        for (var y3 = 0; y3 <= horizonY; y3 += 44) {
          ctx.beginPath()
          ctx.moveTo(0, y3)
          ctx.lineTo(W, y3)
          ctx.stroke()
        }
        ctx.globalAlpha = 0.3
        ctx.strokeStyle = "#ff3ca0"
        ctx.lineWidth = 4
        ctx.strokeRect(6, 6, W - 12, horizonY - 12)
        ctx.globalAlpha = 1
        break
      case "football":
        ctx.fillStyle = "rgba(0,0,0,0.10)"
        for (var y4 = 0; y4 < horizonY; y4 += 26) ctx.fillRect(0, y4, W, 13)
        ctx.globalAlpha = 0.92
        ctx.strokeStyle = "#fff"
        ctx.lineWidth = 5
        ctx.strokeRect(16, 16, W - 32, horizonY - 32)
        ctx.beginPath()
        ctx.moveTo(16, horizonY / 2)
        ctx.lineTo(W - 16, horizonY / 2)
        ctx.stroke()
        ctx.beginPath()
        ctx.arc(W / 2, horizonY / 2, 52, 0, 6.283)
        ctx.stroke()
        ctx.fillStyle = "#fff"
        ctx.beginPath()
        ctx.arc(W / 2, horizonY / 2, 6, 0, 6.283)
        ctx.fill()
        ctx.globalAlpha = 1
        break
      case "basketball":
        ctx.globalAlpha = 0.06
        ctx.strokeStyle = "#3a230c"
        ctx.lineWidth = 2
        for (var x4 = 18; x4 < W; x4 += 34) {
          ctx.beginPath()
          ctx.moveTo(x4, 0)
          ctx.lineTo(x4, horizonY)
          ctx.stroke()
        }
        ctx.globalAlpha = 0.95
        ctx.strokeStyle = "#fff4e0"
        ctx.lineWidth = 5
        ctx.strokeRect(16, 16, W - 32, horizonY - 32)
        ctx.strokeRect(W / 2 - 46, 16, 92, 96)
        ctx.fillStyle = "#fff4e0"
        ctx.beginPath()
        ctx.arc(W / 2, 112, 6, 0, 6.283)
        ctx.fill()
        ctx.beginPath()
        ctx.arc(W / 2, 112, 98, 0.2 * Math.PI, 0.8 * Math.PI)
        ctx.stroke()
        ctx.globalAlpha = 1
        break
      case "room":
      default:
        ctx.globalAlpha = 0.06
        ctx.fillStyle = "#000"
        for (var y5 = 0; y5 < horizonY; y5 += 54) ctx.fillRect(0, y5, W, 2)
        ctx.globalAlpha = 1
        break
    }
  }

  function drawCueMotif(ctx, kind, halfLen, halfTh) {
    var x0 = -halfLen * 0.5,
      x1 = halfLen * 0.5
    ctx.save()
    if (kind === "auto") {
      ctx.globalAlpha = 0.25
      ctx.strokeStyle = "rgba(255,255,255,0.5)"
      ctx.lineWidth = 1.5
      for (var i = -halfTh + 3; i < halfTh; i += 4) {
        ctx.beginPath()
        ctx.moveTo(x0, i + 1)
        ctx.lineTo(x1, i + 1 + (i % 8 ? 1 : -1))
        ctx.stroke()
      }
      ctx.globalAlpha = 1
    } else if (kind === "dragon") {
      ctx.strokeStyle = "#ffd76a"
      ctx.lineWidth = 2
      ctx.globalAlpha = 0.9
      for (var d = 0; d < 5; d++) {
        var cx = x0 + 10 + d * ((x1 - x0) / 5)
        ctx.beginPath()
        ctx.arc(cx, 0, halfTh * 0.9, Math.PI * 0.15, Math.PI * 0.85)
        ctx.stroke()
      }
      ctx.globalAlpha = 1
    } else if (kind === "azure") {
      ctx.strokeStyle = "#9af0ff"
      ctx.lineWidth = 2
      ctx.globalAlpha = 0.85
      for (var w = 0; w < 4; w++) {
        var yy = -halfTh + w * (halfTh * 0.6)
        ctx.beginPath()
        ctx.moveTo(x0, yy)
        ctx.quadraticCurveTo((x0 + x1) / 2, yy - 6, x1, yy)
        ctx.stroke()
      }
      ctx.globalAlpha = 1
    } else if (kind === "minions") {
      ctx.fillStyle = "#1f6fb2"
      roundRect(ctx, x0, -halfTh * 0.7, x1 - x0, halfTh * 1.4, halfTh * 0.7)
      ctx.fill()
      ctx.fillStyle = "#0d3b5a"
      ctx.beginPath()
      ctx.arc((x0 + x1) / 2, 0, halfTh * 0.5, 0, 6.283)
      ctx.fill()
      ctx.fillStyle = "#9af0ff"
      ctx.beginPath()
      ctx.arc((x0 + x1) / 2 - 2, -2, halfTh * 0.22, 0, 6.283)
      ctx.fill()
    } else if (kind === "peppa") {
      ctx.fillStyle = "#ff5e9a"
      ctx.beginPath()
      ctx.arc((x0 + x1) / 2, 0, halfTh * 0.7, 0, 6.283)
      ctx.fill()
      ctx.fillStyle = "#ffd0e2"
      ctx.beginPath()
      ctx.arc((x0 + x1) / 2 - 6, -3, halfTh * 0.22, 0, 6.283)
      ctx.fill()
      ctx.beginPath()
      ctx.arc((x0 + x1) / 2 + 6, -3, halfTh * 0.22, 0, 6.283)
      ctx.fill()
    } else if (kind === "qilin") {
      ctx.strokeStyle = "#ffb347"
      ctx.lineWidth = 2.5
      ctx.globalAlpha = 0.95
      for (var f = 0; f < 5; f++) {
        var fx = x0 + 8 + f * ((x1 - x0) / 5)
        ctx.beginPath()
        ctx.moveTo(fx, halfTh)
        ctx.quadraticCurveTo(fx + 6, 0, fx, -halfTh)
        ctx.stroke()
      }
      ctx.globalAlpha = 1
    }
    ctx.restore()
  }

  function drawCuePreview(cv, kind, c1, c2) {
    var ctx = cv.getContext("2d")
    var W = cv.width,
      H = cv.height
    var bg = ctx.createLinearGradient(0, 0, 0, H)
    bg.addColorStop(0, shadeColor(c2, -0.05))
    bg.addColorStop(1, shadeColor(c2, -0.18))
    ctx.fillStyle = bg
    ctx.fillRect(0, 0, W, H)
    ctx.save()
    ctx.translate(W / 2, H / 2)
    ctx.rotate(-Math.PI / 4)
    var halfLen = W * 0.5,
      halfTh = H * 0.15
    var g = ctx.createLinearGradient(-halfLen, 0, halfLen, 0)
    g.addColorStop(0, c2)
    g.addColorStop(0.55, c1)
    g.addColorStop(0.85, "#efe0bf")
    g.addColorStop(1, "#f4ead0")
    ctx.fillStyle = g
    roundRect(ctx, -halfLen * 0.92, -halfTh, halfLen * 1.84, halfTh * 2, halfTh)
    ctx.fill()
    ctx.fillStyle = "#caa15a"
    roundRect(ctx, halfLen * 0.62, -halfTh, halfLen * 0.16, halfTh * 2, 3)
    ctx.fill()
    ctx.fillStyle = "#3a6ea5"
    roundRect(ctx, halfLen * 0.78, -halfTh * 0.62, halfLen * 0.12, halfTh * 1.24, 3)
    ctx.fill()
    drawCueMotif(ctx, kind, halfLen, halfTh)
    ctx.restore()
  }

  function drawTablePreview(cv, felt) {
    var ctx = cv.getContext("2d")
    var W = cv.width,
      H = cv.height
    ctx.fillStyle = "#5a3d18"
    ctx.fillRect(0, 0, W, H)
    var m = 10
    var g = ctx.createLinearGradient(0, m, 0, H - m)
    g.addColorStop(0, shadeColor(felt, 0.12))
    g.addColorStop(1, shadeColor(felt, -0.12))
    ctx.fillStyle = g
    roundRect(ctx, m, m, W - 2 * m, H - 2 * m, 8)
    ctx.fill()
    ctx.strokeStyle = shadeColor(felt, 0.18)
    ctx.lineWidth = 2
    roundRect(ctx, m + 2, m + 2, W - 2 * m - 4, H - 2 * m - 4, 6)
    ctx.stroke()
    var r = Math.min(W, H) * 0.18
    var bx = W * 0.62,
      by = H * 0.42
    var bg2 = ctx.createRadialGradient(bx - r * 0.3, by - r * 0.3, r * 0.1, bx, by, r)
    bg2.addColorStop(0, shadeColor(felt, 0.5))
    bg2.addColorStop(1, "#f4f1ea")
    ctx.fillStyle = bg2
    ctx.beginPath()
    ctx.arc(bx, by, r, 0, 6.283)
    ctx.fill()
    ctx.fillStyle = "rgba(255,255,255,0.5)"
    ctx.beginPath()
    ctx.arc(bx - r * 0.3, by - r * 0.3, r * 0.28, 0, 6.283)
    ctx.fill()
  }

  function applyCardPreviews() {
    Array.prototype.forEach.call(
      document.querySelectorAll("#sceneCards .skin-card"),
      function (card) {
        var sw = card.querySelector(".skin-swatch")
        if (sw && !sw.dataset.pv) {
          var photo = card.getAttribute("data-photo")
          if (photo) {
            // Request D：照片场景用实景照片作缩略图
            var pimg = new Image()
            pimg.onload = function () {
              var cv = makeCanvas(150, 150)
              drawPhotoCover(cv, pimg)
              sw.style.backgroundImage = "url(" + cv.toDataURL() + ")"
            }
            pimg.src = photo
          } else {
            var cv = makeCanvas(150, 150)
            drawScenePreview(cv, card.dataset.pattern, card.dataset.c1, card.dataset.c2)
            sw.style.backgroundImage = "url(" + cv.toDataURL() + ")"
          }
          sw.dataset.pv = "1"
        }
      }
    )
    Array.prototype.forEach.call(
      document.querySelectorAll("#cueThemeCards .skin-card"),
      function (card) {
        var sw = card.querySelector(".skin-swatch")
        if (sw && !sw.dataset.pv) {
          var cv = makeCanvas(150, 150)
          drawCuePreview(cv, card.dataset.pattern, card.dataset.c1, card.dataset.c2)
          sw.style.backgroundImage = "url(" + cv.toDataURL() + ")"
          sw.dataset.pv = "1"
        }
      }
    )
    Array.prototype.forEach.call(
      document.querySelectorAll("#skinCards .skin-card"),
      function (card) {
        var sw = card.querySelector(".skin-swatch")
        if (sw && !sw.dataset.pv) {
          var cv = makeCanvas(150, 150)
          drawTablePreview(cv, card.dataset.felt)
          sw.style.backgroundImage = "url(" + cv.toDataURL() + ")"
          sw.dataset.pv = "1"
        }
      }
    )
  }

  var NAME_OF = {
    scene: function (id) {
      var c = document.querySelector('#sceneCards .skin-card[data-scene="' + id + '"]')
      return c ? c.querySelector(".skin-name").textContent : "室内"
    },
    cuetheme: function (id) {
      var c = document.querySelector('#cueThemeCards .skin-card[data-cuetheme="' + id + '"]')
      return c ? c.querySelector(".skin-name").textContent : "随台面"
    },
    skin: function (id) {
      var c = document.querySelector('#skinCards .skin-card[data-skin="' + id + '"]')
      return c ? c.querySelector(".skin-name").textContent : "经典原木"
    },
  }

  /** 刷新首页「外观定制」三行的缩略图与当前值（item 4） */
  function refreshCustomRows() {
    var ts = $("thumbScene")
    if (ts) {
      $("valScene").textContent = NAME_OF.scene(settings.scene)
      var sc = document.querySelector('#sceneCards .skin-card[data-scene="' + settings.scene + '"]')
      if (sc) {
        var photo = sc.getAttribute("data-photo")
        if (photo) {
          // Request D：照片场景用实景照片作首页缩略图
          var pimg = new Image()
          pimg.onload = function () {
            var cv = makeCanvas(92, 92)
            drawPhotoCover(cv, pimg)
            ts.style.backgroundImage = "url(" + cv.toDataURL() + ")"
          }
          pimg.src = photo
        } else {
          var cv = makeCanvas(92, 92)
          drawScenePreview(cv, sc.dataset.pattern, sc.dataset.c1, sc.dataset.c2)
          ts.style.backgroundImage = "url(" + cv.toDataURL() + ")"
        }
      }
    }
    var tc = $("thumbCue")
    if (tc) {
      $("valCue").textContent = NAME_OF.cuetheme(settings.cueTheme)
      var cc = document.querySelector('#cueThemeCards .skin-card[data-cuetheme="' + settings.cueTheme + '"]')
      if (cc) {
        var cv2 = makeCanvas(92, 92)
        drawCuePreview(cv2, cc.dataset.pattern, cc.dataset.c1, cc.dataset.c2)
        tc.style.backgroundImage = "url(" + cv2.toDataURL() + ")"
      }
    }
    var tk = $("thumbSkin")
    if (tk) {
      $("valSkin").textContent = NAME_OF.skin(settings.skin)
      var kc = document.querySelector('#skinCards .skin-card[data-skin="' + settings.skin + '"]')
      if (kc) {
        var cv3 = makeCanvas(92, 92)
        drawTablePreview(cv3, kc.dataset.felt)
        tk.style.backgroundImage = "url(" + cv3.toDataURL() + ")"
      }
    }
  }

  /* ---------------- 启动游戏 ---------------- */

  function startGame() {
    var params = []
    params.push("ruletype=" + encodeURIComponent(selectedRule))
    if (selectedOpponent !== "solo") {
      params.push("bot=" + encodeURIComponent(selectedOpponent))
      if (settings.turnTimer && settings.turnTimer > 0) {
        params.push("timer=" + settings.turnTimer)
      }
    } else {
      // 落袋类玩法在无对手时进入自由练习
      params.push("practice=true")
    }

    // 分步实操新手引导：仅首次安装或手动「重新打开新手引导」后自动显示一次。
    // 由游戏内引导完成时写入 seenGuide，之后进入任何对局都不再自动弹出。
    if (!settings.seenGuide) {
      params.push("tutorial=1")
    }
    location.href = "index.html?" + params.join("&")
  }

  /** 轻量 toast 提示（不依赖外部库） */
  function showToast(msg) {
    try {
      var el = document.createElement("div")
      el.textContent = msg
      el.style.cssText =
        "position:fixed;left:50%;bottom:18%;transform:translateX(-50%);" +
        "max-width:80vw;padding:10px 16px;background:rgba(20,28,40,.92);" +
        "color:#f3d79a;font-size:14px;font-weight:700;line-height:1.4;" +
        "border:1.5px solid #c89534;border-radius:10px;box-shadow:0 4px 16px rgba(0,0,0,.4);" +
        "z-index:99999;text-align:center;pointer-events:none;" +
        "transition:opacity .25s ease;opacity:1;"
      document.body.appendChild(el)
      setTimeout(function () {
        el.style.opacity = "0"
        setTimeout(function () {
          if (el.parentNode) el.parentNode.removeChild(el)
        }, 280)
      }, 1800)
    } catch (e) {}
  }

  /** 从设置页「重新打开新手引导」：v1.2.9 #F4 / v1.2.11 #F6
   *  不再直接进入游戏——只把「已看过新手引导」复位，
   *  下次用户自行进入对局（任意玩法）时即会显示引导；由用户自行操作，不自动开局。
   *  v1.2.11 #F6：原实现只改 localStorage + globalThis，未更新内存 settings.seenGuide，
   *  导致 startGame() 里 !settings.seenGuide 判定仍为 false（不传 tutorial=1）→ 引导永不显示。
   *  现在同步复位内存 settings.seenGuide，确保下次进对局 forceTutorial=true。 */
  function replayTutorial() {
    settings.seenGuide = false
    saveSettings(settings)
    try {
      localStorage.removeItem("billiards_cn_seenGuide_v1")
    } catch (e) {}
    try {
      globalThis.__billiardsSeenGuide = false
    } catch (e) {}
    showToast("已开启新手引导，进入对局即可看到")
  }

  /* ---------------- 初始化 ---------------- */

  function init() {
    initModes()
    initOpponents()
    initSettingsPanel()
    initSkins()
    initCueThemes()
    initScenes()

    // v1.2.12：恢复首页「查看回放」按钮绑定（v1.2.11 #3 误删 initMyReplays 时一并丢失）
    initReplays()

    // 首页「外观定制」二级菜单入口（item 4）
    Array.prototype.forEach.call(
      document.querySelectorAll("#customRows .menu-row"),
      function (row) {
        row.addEventListener("click", function () {
          buzz(10)
          showScreen(row.getAttribute("data-target"))
        })
      }
    )

    applyCardPreviews()
    refreshCustomRows()

    $("btnStart").addEventListener("click", function () {
      buzz(15)
      startGame()
    })
    $("btnGuide").addEventListener("click", function () {
      showScreen("guide")
    })
    $("btnSettings").addEventListener("click", function () {
      syncSettingsUI()
      showScreen("settings")
    })

    var licenseBtn = $("btnLicense")
    if (licenseBtn) {
      licenseBtn.addEventListener("click", function () {
        showScreen("license")
      })
    }

    // v1.1.12：关于页 → 变更履历（独立屏）
    var changelogBtn = $("btnChangelog")
    if (changelogBtn) {
      changelogBtn.addEventListener("click", function () {
        buzz(15)
        showScreen("changelog")
      })
    }

    // ---------- 关于页：GitHub 项目链接 ----------
    // WebView 内不加载外链（应用保持纯离线），点击后交给系统浏览器打开；
    // 若设备没有可用浏览器，则退化为复制链接到剪贴板。
    var GITHUB_URL = "https://github.com/huang336-cc/taiqiu_offline"

    function copyText(text) {
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text)
          return true
        }
      } catch (e) {
        /* 继续走兜底方案 */
      }
      try {
        var ta = document.createElement("textarea")
        ta.value = text
        ta.style.position = "fixed"
        ta.style.opacity = "0"
        document.body.appendChild(ta)
        ta.select()
        var ok = document.execCommand("copy")
        document.body.removeChild(ta)
        return ok
      } catch (e) {
        return false
      }
    }

    function flashLabel(btn, text) {
      if (!btn || btn.dataset.flashing === "1") return
      var old = btn.textContent
      btn.dataset.flashing = "1"
      btn.textContent = text
      setTimeout(function () {
        btn.textContent = old
        btn.dataset.flashing = "0"
      }, 1400)
    }

    var githubBtn = $("btnGithub")
    if (githubBtn) {
      githubBtn.addEventListener("click", function () {
        buzz(15)
        var url = githubBtn.getAttribute("data-url") || GITHUB_URL
        try {
          window.open(url, "_blank")
        } catch (e) {
          copyText(url)
        }
      })
    }

    // 「查看 GitHub Release 更新」：同样交给系统浏览器打开 Release 页
    var releasesBtn = $("btnReleases")
    if (releasesBtn) {
      releasesBtn.addEventListener("click", function () {
        buzz(15)
        var url =
          releasesBtn.getAttribute("data-url") ||
          GITHUB_URL + "/releases"
        try {
          window.open(url, "_blank")
        } catch (e) {
          copyText(url)
        }
      })
    }

    // v1.2.11 #F5：删除「复制链接」按钮的绑定（按钮已从 HTML 移除）。

    // 关于 / 许可页里的 <a> 外链，统一走系统浏览器
    var extLinks = document.querySelectorAll("a.ext-link")
    Array.prototype.forEach.call(extLinks, function (a) {
      a.addEventListener("click", function (ev) {
        ev.preventDefault()
        buzz(10)
        try {
          window.open(a.getAttribute("href"), "_blank")
        } catch (e) {
          copyText(a.getAttribute("href"))
        }
      })
    })

    var replayBtn = $("btnReplayTutorial")
    if (replayBtn) {
      replayBtn.addEventListener("click", function () {
        buzz(15)
        replayTutorial()
      })
    }

    // data-back 可指定返回目标，缺省回主页
    var backs = document.querySelectorAll("[data-back]")
    Array.prototype.forEach.call(backs, function (b) {
      b.addEventListener("click", function () {
        showScreen(b.getAttribute("data-back") || "home")
      })
    })

    var v = $("versionText")
    if (v) v.style.display = "none"

    // 用构建时注入的 __BILLIARDS_VERSION__ 同步刷新「关于」页的版本单元格，
    // 避免 HTML 里的硬编码版本号随着打包逐渐过期。
    var versionCell = $("versionCell")
    if (versionCell && typeof window.__BILLIARDS_VERSION__ === "string") {
      var raw = window.__BILLIARDS_VERSION__
      // "1.1.0-26080504" → 显示主版本号；如需详细可改成 raw
      var main = raw.split("-")[0]
      if (main) versionCell.textContent = main
      versionCell.title = raw
    }
  }

  /* ---------------- 台球桌颜色卡片（item 1） ---------------- */

  function initSkins() {
    var cards = document.querySelectorAll("#skinCards .skin-card")
    if (!cards.length) return
    function syncActive() {
      Array.prototype.forEach.call(cards, function (c) {
        c.classList.toggle("active", c.getAttribute("data-skin") === settings.skin)
      })
      var sel = $("setSkin")
      if (sel) sel.value = settings.skin || "classic"
      refreshCustomRows()
    }
    Array.prototype.forEach.call(cards, function (c) {
      c.addEventListener("click", function () {
        settings.skin = c.getAttribute("data-skin")
        saveSettings(settings)
        syncActive()
        buzz(10)
      })
    })
    syncActive()
  }

  /* ---------------- 球杆主题卡片（item 2） ---------------- */

  function initCueThemes() {
    var cards = document.querySelectorAll("#cueThemeCards .skin-card")
    if (!cards.length) return
    function syncActive() {
      Array.prototype.forEach.call(cards, function (c) {
        c.classList.toggle(
          "active",
          c.getAttribute("data-cuetheme") === (settings.cueTheme || "auto")
        )
      })
      var sel = $("setCueTheme")
      if (sel) sel.value = settings.cueTheme || "auto"
      refreshCustomRows()
    }
    Array.prototype.forEach.call(cards, function (c) {
      c.addEventListener("click", function () {
        settings.cueTheme = c.getAttribute("data-cuetheme")
        saveSettings(settings)
        syncActive()
        buzz(10)
      })
    })
    syncActive()
  }

  /* ---------------- 环境场景卡片（item 4） ---------------- */

  function initScenes() {
    var cards = document.querySelectorAll("#sceneCards .skin-card")
    if (!cards.length) return
    function syncActive() {
      Array.prototype.forEach.call(cards, function (c) {
        c.classList.toggle(
          "active",
          c.getAttribute("data-scene") === (settings.scene || "snow")
        )
      })
      var sel = $("setScene")
      if (sel) sel.value = settings.scene || "snow"
      refreshCustomRows()
    }
    Array.prototype.forEach.call(cards, function (c) {
      c.addEventListener("click", function () {
        settings.scene = c.getAttribute("data-scene")
        saveSettings(settings)
        syncActive()
        buzz(10)
      })
    })
    syncActive()
  }

  /* ---------------- v1.2.4：我的回放（离线本地保存列表） ----------------
     与游戏内 src/utils/replay-store.ts 共用同一 IndexedDB（库名 / 表名 / keyPath），
     因此「游戏内保存」与「主菜单我的回放」共享同一数据源。 */
  var REPLAY_DB = "billiards_replays"
  var REPLAY_STORE = "replays"

  function replayOpenDB() {
    return new Promise(function (resolve, reject) {
      if (!window.indexedDB) {
        reject(new Error("no idb"))
        return
      }
      var req = window.indexedDB.open(REPLAY_DB, 1)
      req.onupgradeneeded = function () {
        var db = req.result
        if (!db.objectStoreNames.contains(REPLAY_STORE)) {
          db.createObjectStore(REPLAY_STORE, { keyPath: "id" })
        }
      }
      req.onsuccess = function () {
        resolve(req.result)
      }
      req.onerror = function () {
        reject(req.error)
      }
    })
  }

  function replayList() {
    return replayOpenDB().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(REPLAY_STORE, "readonly")
        var req = tx.objectStore(REPLAY_STORE).getAll()
        req.onsuccess = function () {
          db.close()
          var arr = req.result || []
          arr.sort(function (a, b) {
            return b.createdAt - a.createdAt
          })
          resolve(arr)
        }
        req.onerror = function () {
          db.close()
          reject(req.error)
        }
      })
    })
  }

  function replayDelete(id) {
    return replayOpenDB().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(REPLAY_STORE, "readwrite")
        tx.objectStore(REPLAY_STORE).delete(id)
        tx.oncomplete = function () {
          db.close()
          resolve()
        }
        tx.onerror = function () {
          db.close()
          reject(tx.error)
        }
      })
    })
  }

  function replayEscape(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return {
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      }[c]
    })
  }

  function replayFmtDate(ts) {
    var d = new Date(ts)
    function p(n) {
      return (n < 10 ? "0" : "") + n
    }
    return (
      d.getFullYear() +
      "-" +
      p(d.getMonth() + 1) +
      "-" +
      p(d.getDate()) +
      " " +
      p(d.getHours()) +
      ":" +
      p(d.getMinutes())
    )
  }

  // v1.2.5：经 sessionStorage 传递完整回放数据，再跳转回放页。
  // 规避 Android WebView 对 URL 长度的限制（之前 ?state= 超长被截断，
  // 只回放出前几个球）。与游戏内 src/utils/replay-nav.ts 同方案。
  function navigateToReplay(compressed, rule) {
    var id = "bcr_" + Date.now() + "_" + Math.floor(Math.random() * 1e9)
    try {
      sessionStorage.setItem("bcr:" + id, compressed)
    } catch (e) {
      console.error("replay sessionStorage 写入失败", e)
    }
    location.href =
      "index.html?replayId=" +
      encodeURIComponent(id) +
      "&ruletype=" +
      encodeURIComponent(rule || "nineball")
  }

  // v1.2.12：恢复首页「查看回放」按钮（v1.2.11 #3 删除「我的回放」时误删了本按钮的绑定）。
  // 仅绑定首页 btnReplays + 回放列表 overlay；「我的回放」（关于页）按需求已删除，不再接线。
  function initReplays() {
    var homeBtn = $("btnReplays")
    var overlay = $("replayListOverlay")
    if (!overlay) return
    var listEl = $("replayList")
    var emptyEl = $("replayEmpty")

    Array.prototype.forEach.call(
      overlay.querySelectorAll("[data-close-replay]"),
      function (el) {
        el.addEventListener("click", function () {
          overlay.hidden = true
        })
      }
    )

    function renderList() {
      listEl.innerHTML = ""
      replayList()
        .then(function (items) {
          if (!items.length) {
            emptyEl.hidden = false
            return
          }
          emptyEl.hidden = true
          items.forEach(function (r) {
            var row = document.createElement("div")
            row.className = "replay-item"

            var info = document.createElement("button")
            info.type = "button"
            info.className = "replay-info"
            info.innerHTML =
              '<span class="replay-label">' +
              replayEscape(r.label || r.rule) +
              "</span>" +
              '<span class="replay-date">' +
              replayFmtDate(r.createdAt) +
              "</span>"
            info.addEventListener("click", function () {
              overlay.hidden = true
              navigateToReplay(r.compressed, r.rule)
            })

            var del = document.createElement("button")
            del.type = "button"
            del.className = "replay-del"
            del.textContent = "删除"
            del.addEventListener("click", function (e) {
              e.stopPropagation()
              replayDelete(r.id)
                .then(function () {
                  renderList()
                })
                .catch(function (err) {
                  console.error("delete replay failed", err)
                })
            })

            row.appendChild(info)
            row.appendChild(del)
            listEl.appendChild(row)
          })
        })
        .catch(function () {
          emptyEl.hidden = false
          emptyEl.textContent = "读取回放失败（当前环境可能不支持本地存储）。"
        })
    }

    if (homeBtn) {
      homeBtn.addEventListener("click", function () {
        overlay.hidden = false
        renderList()
      })
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init)
  } else {
    init()
  }
})()
