/**
 * 系统返回键二次确认（仅安卓 WebView 生效）
 *
 * 当用户按系统返回键时，Java 端 MainActivity.onBackPressed() 会调用
 * window.__onAndroidBack()。这里弹出一个二次确认菜单：
 *   - 继续游戏   → 关闭弹窗，什么都不做
 *   - 返回主菜单 → 立刻 location.href 跳回 menu.html（会丢失本局进度）
 *
 * 该脚本由 dist/index.html 通过 <script> 引入（webpack 不处理 dist/，
 * 所以下次 build 不会被覆盖）。
 *
 * 注：纯 JS 实现，不依赖任何第三方库；同时监听 popstate 以防某些
 * WebView 版本直接走 history.go(-1)。
 */
;(function () {
  "use strict"
  if (window.__backConfirmInited) return
  window.__backConfirmInited = true

  var STYLE_ID = "back-confirm-cn-style"
  var BACKDROP_ID = "back-confirm-cn-backdrop"
  var state = null // null 表示无弹窗，{timer:...} 表示正在显示

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return
    var s = document.createElement("style")
    s.id = STYLE_ID
    s.textContent = [
      "#" + BACKDROP_ID + "{",
      "  position:fixed;inset:0;background:rgba(0,0,0,0.55);",
      "  display:flex;align-items:center;justify-content:center;",
      "  z-index:99999;backdrop-filter:blur(2px);",
      "  -webkit-tap-highlight-color:transparent;",
      "}",
      "#" + BACKDROP_ID + " .panel{",
      "  background:#1f2a26;color:#f5f5f5;min-width:280px;max-width:84vw;",
      "  border-radius:14px;padding:20px 22px 18px;",
      "  box-shadow:0 10px 30px rgba(0,0,0,0.45);",
      "  font-family:system-ui,-apple-system,Segoe UI,sans-serif;",
      "  text-align:center;",
      "}",
      "#" + BACKDROP_ID + " h3{margin:0 0 8px;font-size:18px;color:#ffe082;}",
      "#" + BACKDROP_ID + " p{margin:0 0 18px;font-size:14px;line-height:1.5;color:#ccc;}",
      "#" + BACKDROP_ID + " .actions{display:flex;gap:10px;justify-content:center;}",
      "#" + BACKDROP_ID + " button{",
      "  border:none;border-radius:10px;padding:10px 18px;",
      "  font-size:15px;font-weight:500;cursor:pointer;min-width:96px;",
      "}",
      "#" + BACKDROP_ID + " .secondary{background:#37474f;color:#fff;}",
      "#" + BACKDROP_ID + " .danger{background:#d84315;color:#fff;}",
      "#" + BACKDROP_ID + " button:active{opacity:0.8;}",
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
    btnStay.textContent = "继续游戏"
    var btnExit = document.createElement("button")
    btnExit.className = "danger"
    btnExit.textContent = "返回主菜单"
    btnStay.addEventListener("click", removeDialog)
    btnExit.addEventListener("click", function () {
      // 标记已确认，避免被 popstate 拦截再次弹窗
      window.__exitConfirmed = true
      removeDialog()
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
    panel.appendChild(actions)
    bd.appendChild(panel)
    document.body.appendChild(bd)
    state = { dialog: bd }
    // 自动聚焦到"继续游戏"，按 Enter 直接继续
    setTimeout(function () {
      try { btnStay.focus() } catch (e) {}
    }, 50)
  }

  /** 供 Java 端 evaluateJavascript 调用的入口 */
  window.__onAndroidBack = function () {
    showDialog()
    return true // 表示"我已处理，请勿退出"
  }

  // 兜底：如果某些 WebView 版本直接走 history.go(-1) 而不经过 Java，
  // 监听 popstate 同样弹窗；用户点"返回主菜单"时通过 __exitConfirmed
  // 标记绕过二次拦截。
  window.addEventListener("popstate", function () {
    if (window.__exitConfirmed) return
    // 立即 pushState 回去，阻止真正离开
    try { window.history.pushState(null, "", window.location.href) } catch (e) {}
    showDialog()
  })

  // 进入页面时先压入一个 history 条目，触发后续 back 时能进入 popstate 兜底
  try { window.history.pushState(null, "", window.location.href) } catch (e) {}
})()
