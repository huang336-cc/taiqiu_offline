/**
 * 游戏内菜单覆盖层逻辑（操作说明 / 设置 / 规则）
 * 与主菜单共用同一份 localStorage 设置。
 */
;(function () {
  "use strict"

  var STORAGE_KEY = "billiards_cn_settings_v1"

  var LABELS = [
    "极速（像素风，最省电）",
    "流畅（低配手机推荐）",
    "标准",
    "高清（推荐）",
    "超清（开启抗锯齿）",
    "极致（高端手机）",
  ]

  var HINTS = [
    "以极低分辨率渲染，画面为像素风格，帧率最高、最省电。",
    "降低渲染分辨率与球体精度，适合入门机型与老旧设备。",
    "常规画质，多数中端手机可稳定运行。",
    "较高的渲染分辨率与球体精度，兼顾清晰度与流畅度。",
    "开启抗锯齿，边缘更平滑，建议中高端机型使用。",
    "最高渲染精度，仅建议旗舰机型开启，耗电较高。",
  ]

  // 被击打球瞄准线滑动条档位文案（0=关，1~5=短到长）
  var TLINE_LABELS = ["关闭", "短", "中短", "中", "中长", "长"]

  var DEFAULTS = {
    lod: 3,
    sound: true,
    volume: 0.8,
    aimAssist: true,
    vibrate: true,
    seenGuide: false,
    lastRule: "nineball",
    vsBot: false,
    fpsCap: 0,
    targetLineLength: 3,
    skin: "classic",
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

  // 画质下拉
  var q = $("q")
  for (var i = 0; i < LABELS.length; i++) {
    var o = document.createElement("option")
    o.value = String(i)
    o.textContent = LABELS[i]
    q.appendChild(o)
  }

  function sync() {
    q.value = String(st.lod)
    $("qh").textContent = HINTS[st.lod] || ""
    $("snd").checked = !!st.sound
    $("vol").value = String(Math.round(st.volume * 100))
    $("volv").textContent = Math.round(st.volume * 100) + "%"
    $("aim").checked = !!st.aimAssist
    $("tline").value = String(st.targetLineLength || 3)
    $("tlinev").textContent = TLINE_LABELS[st.targetLineLength || 3]
    $("skin").value = st.skin || "classic"
    $("vib").checked = !!st.vibrate
  }
  sync()

  q.addEventListener("change", function () {
    st.lod = parseInt(q.value, 10)
    $("qh").textContent = HINTS[st.lod] || ""
    save(st)
  })
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
  $("tline").addEventListener("input", function (e) {
    st.targetLineLength = parseInt(e.target.value, 10)
    $("tlinev").textContent = TLINE_LABELS[st.targetLineLength] || "中"
    save(st)
  })
  $("skin").addEventListener("change", function (e) {
    st.skin = e.target.value
    save(st)
    // 对局内实时换肤：通知父页面立即刷新球杆与球台外观
    try {
      if (window.parent && window.parent !== window) {
        window.parent.postMessage({ type: "billiards-apply-skin", skin: st.skin }, "*")
      }
    } catch (err) {
      /* 跨域时忽略 */
    }
  })
  $("vib").addEventListener("change", function (e) {
    st.vibrate = e.target.checked
    save(st)
  })
})()
