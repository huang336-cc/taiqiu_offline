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

  var DEFAULTS = {
    lod: 3,
    sound: true,
    volume: 0.8,
    aimAssist: true,
    vibrate: true,
    seenGuide: false,
    practiceGuide: false,
    turnTimer: 0,
    lastRule: "nineball",
    lastOpponent: "solo",
    vsBot: false,
    fpsCap: 0,
    targetLineLength: 3,
    skin: "classic",
    cueTheme: "auto",
    scene: "room",
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
    return merged
  }

  function saveSettings(s) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(s))
    } catch (e) {
      /* 忽略存储异常 */
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
    try {
      var c = document.createElement("canvas")
      var gl = c.getContext("webgl") || c.getContext("experimental-webgl")
      if (!gl) return ""
      var dbg = gl.getExtension("WEBGL_debug_renderer_info")
      if (!dbg) return ""
      return String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) || "")
    } catch (e) {
      return ""
    }
  }

  var settings = loadSettings()

  /* ---------------- 界面状态 ---------------- */

  var selectedRule = settings.lastRule || "nineball"
  var selectedOpponent = settings.lastOpponent || "solo"

  var OPPONENT_HINTS = {
    solo: "自由练习模式，不计胜负，适合熟悉手感与走位。",
    ClawBreak: "电脑风格稳健，优先选择成功率高的球，适合新手对局。",
    TheFarJaw: "电脑风格激进，偏爱难度更高的进攻路线，挑战性更强。",
  }

  function $(id) {
    return document.getElementById(id)
  }

  /* ---------------- 玩法选择 ---------------- */

  function initModes() {
    var cards = document.querySelectorAll(".mode-card")
    Array.prototype.forEach.call(cards, function (card) {
      if (card.getAttribute("data-rule") === selectedRule) {
        card.classList.add("selected")
      }
      card.addEventListener("click", function () {
        Array.prototype.forEach.call(cards, function (c) {
          c.classList.remove("selected")
        })
        card.classList.add("selected")
        selectedRule = card.getAttribute("data-rule")
        settings.lastRule = selectedRule
        saveSettings(settings)
        updateOpponentAvailability()
        buzz(10)
      })
    })
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
    $("opponentHint").textContent = OPPONENT_HINTS[op] || ""
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

    $("setVibrate").addEventListener("change", function (e) {
      settings.vibrate = e.target.checked
      saveSettings(settings)
      if (e.target.checked) buzz(20)
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

    $("setPracticeGuide").addEventListener("change", function (e) {
      settings.practiceGuide = e.target.checked
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
    $("setVibrate").checked = !!settings.vibrate
    $("setSkin").value = settings.skin || "classic"
    $("setCueTheme").value = settings.cueTheme || "auto"
    $("setScene").value = settings.scene || "room"
    $("setPracticeGuide").checked = settings.practiceGuide !== false
    $("setTurnTimer").value = String(settings.turnTimer || 0)
  }

  function buzz(ms) {
    try {
      if (settings.vibrate && navigator.vibrate) navigator.vibrate(ms)
    } catch (e) {
      /* 部分设备不支持震动 */
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

    // 分步实操新手引导（item 6）：
    // 仅首次安装（!seenGuide）自动显示；若开启了「练习时显示引导」，练习模式强制显示。
    // 不再在这里写 seenGuide（由游戏内引导完成后写入）。
    var forceTutorial =
      !settings.seenGuide ||
      (selectedOpponent === "solo" && settings.practiceGuide === true)
    if (forceTutorial) {
      params.push("tutorial=1")
    }
    location.href = "index.html?" + params.join("&")
  }

  /** 从设置页「重新打开新手引导」：直接进入一次练习并强制显示引导 */
  function replayTutorial() {
    var params = [
      "ruletype=" + encodeURIComponent(selectedRule),
      "practice=true",
      "tutorial=1",
    ]
    location.href = "index.html?" + params.join("&")
  }

  /* ---------------- 初始化 ---------------- */

  function init() {
    initModes()
    initOpponents()
    initSettingsPanel()
    initSkins()
    initCueThemes()
    initScenes()

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
  }

  /* ---------------- 皮肤卡片（item 1） ---------------- */

  function initSkins() {
    var cards = document.querySelectorAll("#skinCards .skin-card")
    if (!cards.length) return
    function syncActive() {
      Array.prototype.forEach.call(cards, function (c) {
        c.classList.toggle("active", c.getAttribute("data-skin") === settings.skin)
      })
      var sel = $("setSkin")
      if (sel) sel.value = settings.skin || "classic"
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
          c.getAttribute("data-scene") === (settings.scene || "room")
        )
      })
      var sel = $("setScene")
      if (sel) sel.value = settings.scene || "room"
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

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init)
  } else {
    init()
  }
})()
