/**
 * 系统返回键 / 「返回主菜单」按钮的二次确认（仅安卓 WebView 生效）
 *
 * 当用户按系统返回键时，Java 端 MainActivity.onBackPressed() 会调用
 * window.__onAndroidBack()。这里弹出一个二次确认菜单：
 *   - 继续游戏   → 关闭弹窗，什么都不做
 *   - 返回主菜单 → 清零系列赛比分并 location.href 跳回 menu.html
 *
 * 该脚本由 dist/index.html 通过 <script> 引入（webpack 不处理 dist/，
 * 所以下次 build 不会被覆盖）。
 *
 * 注：纯 JS 实现，不依赖任何第三方库；同时监听 popstate 以防某些
 * WebView 版本直接走 history.go(-1)。
 *
 * v1.3.75：
 *  1) 主题统一 —— 此前弹窗是深绿灰 #1f2a26 + 橙色 #d84315，与游戏内主菜单 /
 *     比分栏 / 底部栏的金棕木纹完全不是一个体系。现改为同一套「金棕木纹」：
 *     木纹渐变底 (#6b4a22 → #4a3014) + 金边 (#c89534) + 奶油金字 (#f3d79a)，
 *     与 dist/css/scoreboard-v2.css 的 --sc-wood-1 / --sc-wood-2 / --sc-gold 一致。
 *  2) 排版修复 —— 旧版 panel 用 min-width:280px + max-width:84vw 且按钮固定
 *     min-width:96px、靠 justify-content:center 排布，横屏长文案下按钮会挤到
 *     右侧甚至被裁掉半个字。现改为：面板定宽 min(520px, 86vw)、三段式层级
 *     （标题 / 正文 / 按钮行），按钮行两个等宽按钮 flex:1 1 0 + min-width:0，
 *     文字 nowrap 不截断、两端留白不贴边。
 *  3) 系列赛提示 —— 返回主菜单会清零「系列赛 你 X : Y 电脑」的累计，
 *     弹窗里显式读出当前比分并提示，确认时才真正清 localStorage。
 */
;(function () {
  "use strict"
  if (window.__backConfirmInited) return
  window.__backConfirmInited = true

  var STYLE_ID = "back-confirm-cn-style"
  var BACKDROP_ID = "back-confirm-cn-backdrop"
  var SERIES_KEY = "billiards_cn_series_v1"
  var state = null // null 表示无弹窗，{dialog:...} 表示正在显示

  /** 读出当前系列赛比分文案（读不到 / 全 0 时返回 null，弹窗里就不提这茬） */
  function seriesLine() {
    try {
      var raw = window.localStorage && window.localStorage.getItem(SERIES_KEY)
      if (!raw) return null
      var s = JSON.parse(raw)
      if (!s || typeof s.you !== "number" || typeof s.cpu !== "number") {
        return null
      }
      if (s.you === 0 && s.cpu === 0) return null
      return "系列赛　你 " + s.you + " : " + s.cpu + " 电脑"
    } catch (e) {
      return null
    }
  }

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return
    var s = document.createElement("style")
    s.id = STYLE_ID
    s.textContent = [
      "#" + BACKDROP_ID + "{",
      "  position:fixed;inset:0;background:rgba(0,0,0,0.6);",
      "  display:flex;align-items:center;justify-content:center;",
      "  z-index:99999;backdrop-filter:blur(3px);",
      "  -webkit-backdrop-filter:blur(3px);",
      "  -webkit-tap-highlight-color:transparent;",
      "  padding:16px;box-sizing:border-box;",
      "}",
      /* 面板：金棕木纹，与比分栏 / 主菜单卡片同款 */
      "#" + BACKDROP_ID + " .panel{",
      "  box-sizing:border-box;",
      "  width:min(520px,86vw);max-width:86vw;",
      "  background:linear-gradient(180deg,#6b4a22 0%,#4a3014 100%);",
      "  border:1.5px solid #c89534;border-radius:14px;",
      "  box-shadow:0 12px 32px rgba(0,0,0,0.55),inset 0 1px 0 rgba(255,225,160,0.18);",
      "  color:#f3d79a;padding:18px 20px 16px;text-align:center;",
      "  font-family:system-ui,-apple-system,'Segoe UI',sans-serif;",
      "}",
      /* 标题：金色，层级最高 */
      "#" + BACKDROP_ID + " h3{",
      "  margin:0 0 10px;font-size:18px;line-height:1.35;font-weight:700;",
      "  color:#e7b14b;letter-spacing:0.5px;",
      "  text-shadow:0 1px 2px rgba(0,0,0,0.6);",
      "}",
      /* 正文：两行，主提示 + 系列赛弱提示 */
      "#" + BACKDROP_ID + " p{margin:0 0 6px;font-size:14px;line-height:1.6;color:#f3d79a;}",
      "#" + BACKDROP_ID + " .series{",
      "  margin:0 0 16px;font-size:13px;line-height:1.5;",
      "  color:rgba(243,215,154,0.78);",
      "}",
      "#" + BACKDROP_ID + " .series b{color:#e7b14b;font-weight:700;}",
      /* 按钮行：两个等宽按钮，不贴边、不截断 */
      "#" + BACKDROP_ID + " .actions{",
      "  display:flex;gap:12px;justify-content:center;align-items:stretch;",
      "}",
      "#" + BACKDROP_ID + " button{",
      "  flex:1 1 0;min-width:0;max-width:200px;",
      "  border-radius:10px;padding:11px 8px;",
      "  font-size:15px;font-weight:600;line-height:1.2;",
      "  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;",
      "  cursor:pointer;font-family:inherit;",
      "  border:1px solid #c89534;",
      "}",
      "#" + BACKDROP_ID + " .secondary{",
      "  background:linear-gradient(180deg,#7a5730 0%,#54371a 100%);",
      "  color:#f7e6bb;",
      "}",
      "#" + BACKDROP_ID + " .danger{",
      "  background:linear-gradient(180deg,#8e2f22 0%,#5f1d14 100%);",
      "  color:#ffd9c2;border-color:#e0a06a;",
      "}",
      "#" + BACKDROP_ID + " button:active{opacity:0.82;transform:translateY(1px);}",
      /* 横屏矮屏：收紧纵向留白，避免弹窗高度溢出 */
      "@media (max-height:480px){",
      "  #" + BACKDROP_ID + " .panel{padding:14px 16px 12px;}",
      "  #" + BACKDROP_ID + " h3{font-size:16px;margin-bottom:8px;}",
      "  #" + BACKDROP_ID + " p{font-size:13px;margin-bottom:4px;}",
      "  #" + BACKDROP_ID + " .series{margin-bottom:12px;font-size:12px;}",
      "  #" + BACKDROP_ID + " button{padding:9px 8px;font-size:14px;}",
      "}",
    ].join("")
    document.head.appendChild(s)
  }

  function removeDialog() {
    var bd = document.getElementById(BACKDROP_ID)
    if (bd && bd.parentNode) bd.parentNode.removeChild(bd)
    state = null
  }

  function showDialog() {
    if (state) return // 已经在弹窗
    ensureStyle()
    if (document.getElementById(BACKDROP_ID)) return

    var bd = document.createElement("div")
    bd.id = BACKDROP_ID
    bd.setAttribute("role", "dialog")
    bd.addEventListener("click", function (e) {
      // 点空白处等同"继续游戏"
      if (e.target === bd) removeDialog()
    })
    var panel = document.createElement("div")
    panel.className = "panel"
    var h = document.createElement("h3")
    h.textContent = "返回主菜单？"
    var p = document.createElement("p")
    p.textContent = "本局进度将不会保存，确认要返回主菜单吗？"

    var actions = document.createElement("div")
    actions.className = "actions"
    var btnStay = document.createElement("button")
    btnStay.className = "secondary"
    btnStay.type = "button"
    btnStay.textContent = "继续游戏"
    var btnExit = document.createElement("button")
    btnExit.className = "danger"
    btnExit.type = "button"
    btnExit.textContent = "返回主菜单"
    btnStay.addEventListener("click", removeDialog)
    btnExit.addEventListener("click", function () {
      // 标记已确认，避免被 popstate 拦截再次弹窗
      window.__exitConfirmed = true
      removeDialog()
      // 返回主菜单即结束本轮系列赛：清掉「你 X : Y 电脑」的累计，
      // 不清的话下次进同一玩法会接着上次的比分算，语义不对。
      try {
        window.localStorage && window.localStorage.removeItem(SERIES_KEY)
      } catch (e) {}
      // 直接跳回主菜单；不依赖 history 栈（避免某些 WebView 不一致）
      try {
        window.location.href = "menu.html"
      } catch (e) {
        window.history.go(-(window.history.length))
      }
    })
    actions.appendChild(btnStay)
    actions.appendChild(btnExit)
    panel.appendChild(h)
    panel.appendChild(p)
    var line = seriesLine()
    if (line) {
      var sp = document.createElement("p")
      sp.className = "series"
      sp.appendChild(document.createTextNode("返回后系列赛比分将清零："))
      var b = document.createElement("b")
      b.textContent = line
      sp.appendChild(b)
      panel.appendChild(sp)
    }
    panel.appendChild(actions)
    bd.appendChild(panel)
    document.body.appendChild(bd)
    state = { dialog: bd }
    // 自动聚焦到"继续游戏"，按 Enter 直接继续
    setTimeout(function () {
      try {
        btnStay.focus()
      } catch (e) {}
    }, 50)
  }

  /** 供 Java 端 evaluateJavascript 调用的入口 */
  window.__onAndroidBack = function () {
    showDialog()
    return true // 表示"我已处理，请勿退出"
  }

  /**
   * v1.3.75：暴露给游戏内「返回主菜单」按钮（设置浮层）与结算面板按钮复用，
   * 保证所有退出路径都走同一套主题弹窗 + 同一套系列赛清零语义。
   */
  window.__showExitConfirm = showDialog

  // 兜底：如果某些 WebView 版本直接走 history.go(-1) 而不经过 Java，
  // 监听 popstate 同样弹窗；用户点"返回主菜单"时通过 __exitConfirmed
  // 标记绕过二次拦截。
  window.addEventListener("popstate", function () {
    if (window.__exitConfirmed) return
    // 立即 pushState 回去，阻止真正离开
    try {
      window.history.pushState(null, "", window.location.href)
    } catch (e) {}
    showDialog()
  })

  // 进入页面时先压入一个 history 条目，触发后续 back 时能进入 popstate 兜底
  try {
    window.history.pushState(null, "", window.location.href)
  } catch (e) {}
})()
