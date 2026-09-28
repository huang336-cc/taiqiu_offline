/**
 * 系统返回键 / 「返回主菜单」按钮的二次确认（仅安卓 WebView 生效）
 *
 * 当用户按系统返回键时，Java 端 MainActivity.onBackPressed() 会调用
 * window.__onAndroidBack()。这里弹出一个二次确认菜单：
 *   - 继续游戏   → 关闭弹窗，什么都不做
 *   - 返回主菜单 → 清零系列赛比分并 location.href 跳回 menu.html
 *
 * 该脚本由 dist/play.html 通过 <script> 引入（webpack 不处理 dist/，
 * 所以下次 build 不会被覆盖）。
 *
 * 注：纯 JS 实现，不依赖任何第三方库；同时监听 popstate 以防某些
 * WebView 版本直接走 history.go(-1)。
 *
 * v1.3.75：主题统一为「金棕木纹」+ 三段式层级 + 系列赛清零提示。
 *
 * v1.3.76：把 inset/min()/gap 换成老 WebView 兼容写法（方向没找对）。
 *
 * v1.3.77：真正的根因找到了 —— **类名撞车**。此前面板用
 * className="panel"，而游戏自身 css（index.css / bottombar-v2.css /
 * ingame-cn.css）里 .panel 是「底部操作栏」的样式：display:flex;
 * flex-direction:row; height:70px; align-items:flex-end; position:relative。
 * 我们的规则从没声明过这些属性，于是它们全部漏进弹窗：
 * 面板被横排 + 压扁成 70px 高 —— 标题逐字竖排、正文/提示/按钮挤成
 * 一条横带（用户三次反馈的「排版错误」全是它，任何内核都会乱）。
 * 桌面 chromium 上已 100% 复现并验证。
 * 修复（三重防御）：
 *   1) 弹窗内所有元素改用 bc 前缀专属类名（.bcpanel/.bctitle/...），
 *      不再使用 panel/h3/p 等会被全局规则命中的类名与裸元素样式；
 *   2) 每条规则显式写全 display/position/float/height/width 等关键属性
 *      （height:auto;float:none;position:static...），把可能的污染维度堵死；
 *   3) 遮罩与面板的尺寸/位置由 JS 用 innerWidth/innerHeight 以像素内联，
 *      不再依赖 vw/%/flex 的居中与铺屏（保留 fixed + 居中作为无 JS 时的兜底）。
 *
 * v1.4.6 修复「点弹窗『返回主菜单』无反应」（真机 100% 复现路径）：
 *   旧版遮罩监听 click、点空白处等同「继续游戏」直接关弹窗。真机上手指
 *   触点比视觉目标大得多 —— 弹窗出现后手指任何一次落点偏差/连点节奏里的
 *   多余触摸落在按钮之外，弹窗就被静默关闭；用户再点「返回主菜单」原位置
 *   时弹窗已不在，点到的只是底下的游戏层 —— 表现即「点了没反应」，且越急
 *   越点不动（每次误触都把弹窗关掉，重新走 齿轮→返回主菜单 又会再被关）。
 *   已用真实触摸事件流（CDP touchstart/touchend）100% 复现：弹窗显示期间
 *   一次 (5,5) 触摸即令弹窗消失。修复：
 *   1) 遮罩空白触摸/点击**不再关闭弹窗** —— 改为面板轻微抖动提示
 *      （用户知道点到了、但必须明确二选一），弹窗仅剩「继续游戏 /
 *      返回主菜单」两个明确出口，任何误触都不再让它静默消失；
 *   2) 按钮最小高度提到 44px（iOS HIG 触控目标下限），降低误触概率。
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
      /* 遮罩：显式四边（不用 inset），宽高由 JS 再按像素补一道保险 */
      "#" + BACKDROP_ID + "{",
      "  position:fixed;top:0;right:0;bottom:0;left:0;",
      "  width:100%;height:100%;",
      "  background:rgba(0,0,0,0.6);",
      "  z-index:99999;",
      "  -webkit-tap-highlight-color:transparent;",
      "  padding:16px;box-sizing:border-box;",
      "  -webkit-text-size-adjust:100%;text-size-adjust:100%;",
      /* v1.3.77：不再用 flex 居中。JS 直接像素定位面板，这里只留背景与层级 */
      "}",
      /* 面板：专属类名，避开游戏自身 .panel（底部操作栏）的全部样式。
         关键属性显式写全：块级流、高度自适应、不浮动、不伸缩 —— 任何全局
         规则都改不动它的布局骨架。装饰（金棕木纹/金边）沿用同款主题。 */
      "#" + BACKDROP_ID + " .bcpanel{",
      "  display:block;position:relative;float:none;",
      "  box-sizing:border-box;",
      "  width:86vw;max-width:520px;min-width:0;",
      "  height:auto;min-height:0;max-height:none;",
      "  margin:0 auto;", /* 块级 + 定宽 + auto 边距 = 水平居中（无 flex 依赖） */
      "  top:0;right:0;bottom:0;left:0;",
      "  background:#5a3c1b;",
      "  background:-webkit-linear-gradient(top,#6b4a22 0%,#4a3014 100%);",
      "  background:linear-gradient(180deg,#6b4a22 0%,#4a3014 100%);",
      "  border:1.5px solid #c89534;border-radius:14px;",
      "  box-shadow:0 12px 32px rgba(0,0,0,0.55),inset 0 1px 0 rgba(255,225,160,0.18);",
      "  color:#f3d79a;padding:18px 20px 16px;text-align:center;",
      "  font-family:system-ui,-apple-system,'Segoe UI','PingFang SC','Microsoft YaHei',sans-serif;",
      "  -webkit-text-size-adjust:100%;text-size-adjust:100%;",
      "}",
      /* 标题 / 正文 / 系列赛提示：全部专属类名 + 块级流 + 宽度自适应，
         不用 h3/p 裸元素选择器，防止被任何针对裸元素的全局规则波及 */
      "#" + BACKDROP_ID + " .bctitle{",
      "  display:block;margin:0 0 10px;padding:0;",
      "  font-size:18px;line-height:1.35;font-weight:700;",
      "  color:#e7b14b;letter-spacing:0.5px;",
      "  text-shadow:0 1px 2px rgba(0,0,0,0.6);",
      "  white-space:normal;word-break:break-word;",
      "}",
      "#" + BACKDROP_ID + " .bctext{",
      "  display:block;margin:0 0 6px;padding:0;",
      "  font-size:14px;line-height:1.6;color:#f3d79a;",
      "  white-space:normal;word-break:break-word;",
      "}",
      "#" + BACKDROP_ID + " .bcseries{",
      "  display:block;margin:0 0 16px;padding:0;",
      "  font-size:13px;line-height:1.5;",
      "  color:rgba(243,215,154,0.78);",
      "  white-space:normal;word-break:break-word;",
      "}",
      "#" + BACKDROP_ID + " .bcseries b{color:#e7b14b;font-weight:700;}",
      /* 按钮行：text-align 居中 + inline-block 按钮（CSS2.1，全内核兼容）。
         font-size:0 消除 inline-block 之间的空隙，按钮内再单独设字号 */
      "#" + BACKDROP_ID + " .bcactions{",
      "  display:block;position:static;float:none;",
      "  margin:0;padding:0;text-align:center;",
      "  font-size:0;line-height:0;height:auto;width:auto;",
      "  white-space:nowrap;",
      "}",
      "#" + BACKDROP_ID + " button.bcbtn{",
      "  display:inline-block;vertical-align:middle;",
      "  position:static;float:none;clear:none;",
      "  box-sizing:border-box;",
      /* v1.4.6：min-height 44px（iOS HIG 触控目标下限），真机手指偏差不再点空 */
      "  width:200px;max-width:44%;min-width:0;height:auto;min-height:44px;",
      "  margin:0 5px;padding:11px 8px;",
      "  font-family:inherit;font-size:15px;line-height:1.2;font-weight:600;",
      "  letter-spacing:normal;text-indent:0;",
      "  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;",
      "  cursor:pointer;text-align:center;text-decoration:none;",
      "  border:1px solid #c89534;border-radius:10px;",
      "  -webkit-text-size-adjust:100%;text-size-adjust:100%;",
      "}",
      "#" + BACKDROP_ID + " .bcbtn.secondary{",
      "  background:#7a5730;",
      "  background:-webkit-linear-gradient(top,#7a5730 0%,#54371a 100%);",
      "  background:linear-gradient(180deg,#7a5730 0%,#54371a 100%);",
      "  color:#f7e6bb;",
      "}",
      "#" + BACKDROP_ID + " .bcbtn.danger{",
      "  background:#8e2f22;",
      "  background:-webkit-linear-gradient(top,#8e2f22 0%,#5f1d14 100%);",
      "  background:linear-gradient(180deg,#8e2f22 0%,#5f1d14 100%);",
      "  color:#ffd9c2;border-color:#e0a06a;",
      "}",
      "#" + BACKDROP_ID + " button.bcbtn:active{opacity:0.82;}",
      /* v1.4.6：点空白（误触）时面板抖动提示 —— 明确反馈「点到了但没点中按钮」，
         而不是旧版的静默关弹窗（真机上那是「点了没反应」的直接来源） */
      "@-webkit-keyframes bcshake{",
      "  0%{-webkit-transform:translateX(0);}20%{-webkit-transform:translateX(-8px);}",
      "  40%{-webkit-transform:translateX(8px);}60%{-webkit-transform:translateX(-5px);}",
      "  80%{-webkit-transform:translateX(5px);}100%{-webkit-transform:translateX(0);}",
      "}",
      "@keyframes bcshake{",
      "  0%{transform:translateX(0);}20%{transform:translateX(-8px);}40%{transform:translateX(8px);}",
      "  60%{transform:translateX(-5px);}80%{transform:translateX(5px);}100%{transform:translateX(0);}",
      "}",
      "#" + BACKDROP_ID + " .bcpanel.bcshake{",
      "  -webkit-animation:bcshake 0.3s ease;animation:bcshake 0.3s ease;",
      "}",
      /* 横屏矮屏：收紧纵向留白与字号，避免弹窗高度溢出 */
      "@media (max-height:480px){",
      "  #" + BACKDROP_ID + " .bcpanel{padding:12px 14px 10px;}",
      "  #" + BACKDROP_ID + " .bctitle{font-size:16px;margin-bottom:6px;}",
      "  #" + BACKDROP_ID + " .bctext{font-size:13px;margin-bottom:4px;}",
      "  #" + BACKDROP_ID + " .bcseries{margin-bottom:10px;font-size:12px;}",
      "  #" + BACKDROP_ID + " button.bcbtn{padding:8px 8px;font-size:14px;}",
      "}",
    ].join("")
    document.head.appendChild(s)
  }

  function removeDialog() {
    var bd = document.getElementById(BACKDROP_ID)
    if (bd && bd.parentNode) bd.parentNode.removeChild(bd)
    window.removeEventListener("resize", onViewportChange, false)
    state = null
    try { if (typeof shakeTimerRef === "number" && shakeTimerRef) clearTimeout(shakeTimerRef) } catch (e) {}
  }
  var shakeTimerRef = null

  /** v1.3.77：视口变化（转屏/出键盘）时重新按像素摆放弹窗 */
  function onViewportChange() {
    var bd = document.getElementById(BACKDROP_ID)
    if (!bd) return
    var panel = bd.firstChild
    placePanel(bd, panel)
  }

  /**
   * v1.3.77：按视口像素摆放弹窗 —— 不再依赖 flex/vw/% 做居中与铺屏。
   * 遮罩宽高 = 视口像素；面板定宽（520 与视口取小）、水平居中（auto 边距），
   * 垂直位置在渲染后量高再定（视口中心）。
   */
  function placePanel(bd, panel) {
    var vw = window.innerWidth || document.documentElement.clientWidth || 360
    var vh = window.innerHeight || document.documentElement.clientHeight || 640
    // 遮罩铺满视口（像素兜底，防 % 失效）
    bd.style.width = vw + "px"
    bd.style.height = vh + "px"
    // 面板定宽
    var W = Math.max(240, Math.min(520, vw - 32))
    panel.style.width = W + "px"
    // 高度要等内容排完 —— 下一帧量高再垂直居中
    setTimeout(function () {
      var h = panel.offsetHeight || 0
      var top = Math.max(12, Math.round((vh - h) / 2))
      // 矮横屏时略偏上一点，视觉更稳
      if (vh < 480) top = Math.max(8, Math.round((vh - h) / 2) - 10)
      panel.style.marginTop = top + "px"
    }, 0)
  }

  function el(tag, cls, text) {
    var n = document.createElement(tag)
    if (cls) n.className = cls
    if (text != null) n.textContent = text
    return n
  }

  function showDialog() {
    if (state) return // 已经在弹窗
    ensureStyle()
    if (document.getElementById(BACKDROP_ID)) return

    var bd = el("div")
    bd.id = BACKDROP_ID
    bd.setAttribute("role", "dialog")
    // v1.4.6：遮罩空白触摸/点击**不再关闭弹窗**（旧版「点空白=继续游戏」在
    // 真机上会被手指偏差/连点节奏误触发，弹窗静默消失后用户再点按钮即「无
    // 反应」—— 已用真实触摸事件流 100% 复现）。改为面板抖动提示，弹窗仅剩
    // 「继续游戏 / 返回主菜单」两个明确出口。
    var shakeTimer = null
    function shakeHint() {
      var bdNow = document.getElementById(BACKDROP_ID)
      if (!bdNow) return
      var pn = bdNow.firstChild
      if (!pn) return
      pn.classList.remove("bcshake")
      // 强制重启动画
      void pn.offsetWidth
      pn.classList.add("bcshake")
      if (shakeTimer) clearTimeout(shakeTimer)
      shakeTimer = setTimeout(function () {
        try { pn.classList.remove("bcshake") } catch (e) {}
      }, 350)
      shakeTimerRef = shakeTimer
    }
    bd.addEventListener("click", function (e) {
      if (e.target === bd) shakeHint()
    })
    bd.addEventListener("touchend", function (e) {
      if (e.target === bd) {
        // 触屏上合成 click 可能被防抖吞掉，这里直接给反馈
        shakeHint()
      }
    }, { passive: true })
    var panel = el("div", "bcpanel")
    var title = el("div", "bctitle", "返回主菜单？")
    var text = el("div", "bctext", "本局进度将不会保存，确认要返回主菜单吗？")

    var actions = el("div", "bcactions")
    var btnStay = el("button", "bcbtn secondary", "继续游戏")
    btnStay.type = "button"
    var btnExit = el("button", "bcbtn danger", "返回主菜单")
    btnExit.type = "button"
    btnStay.addEventListener("click", removeDialog)
    btnExit.addEventListener("click", function () {
      // 标记已确认，避免被 popstate 拦截再次弹窗
      window.__exitConfirmed = true
      removeDialog()
      // v1.5.0：退出立即反馈（必须先于任何可能让主线程忙碌的操作）。
      // location.replace 提交后、menu.html 首帧渲染完成前，浏览器会一直显示旧文档
      // —— 真机实测（录屏逐帧 + CPU 6x 降速）这段长达 3.5 秒且画面完全静止，
      // 玩家感知为「点了没反应、卡死几秒」。这里立即铺一层全屏「加载中…」遮罩，
      // 把无反馈的静默期变成明确的加载状态（与进入游戏时的加载页同款观感）。
      try {
        var ld = document.createElement("div")
        ld.setAttribute("id", "bc-exit-loading")
        ld.style.cssText = "position:fixed;inset:0;z-index:2147483000;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;background:#0a2a3d;"
        var sp = document.createElement("div")
        sp.style.cssText = "width:42px;height:42px;border:4px solid rgba(255,255,255,0.18);border-top-color:#e8c37a;border-radius:50%;animation:bcExitSpin 0.8s linear infinite;"
        var tx = document.createElement("div")
        tx.style.cssText = "font-size:14px;color:rgba(255,255,255,0.75);letter-spacing:1px;"
        tx.textContent = "加载中…"
        var st = document.createElement("style")
        st.textContent = "@keyframes bcExitSpin{to{transform:rotate(360deg)}}"
        ld.appendChild(sp)
        ld.appendChild(tx)
        document.body.appendChild(st)
        document.body.appendChild(ld)
      } catch (e) {}
      // 返回主菜单即结束本轮系列赛：清掉「你 X : Y 电脑」的累计，
      // 不清的话下次进同一玩法会接着上次的比分算，语义不对。
      try {
        window.localStorage && window.localStorage.removeItem(SERIES_KEY)
      } catch (e) {}
      // v1.4.6：跳转前主动释放游戏内的 WebGL / Audio 资源（见 index.ts 暴露的
      // window.__onExitToMenu）。部分 WebView 不触发 pagehide/beforeunload，仅靠
      // 浏览器回收会因 bfcache 保留旧页面 context 而累积到上限，反复「开始游戏 →
      // 退出主菜单」几次后新 context 创建失败、游戏卡在 Loading（用户反馈的卡死）。
      // 这里在整页导航之前显式释放，与 browsercontainer 的 shutdown 形成双保险。
      try {
        if (typeof window.__onExitToMenu === "function") window.__onExitToMenu()
      } catch (e) {}
      // 直接跳回主菜单；不依赖 history 栈（避免某些 WebView 不一致）
      try {
        window.location.replace("menu.html")
      } catch (e) {
        window.history.go(-(window.history.length))
      }
    })
    actions.appendChild(btnStay)
    actions.appendChild(btnExit)
    panel.appendChild(title)
    panel.appendChild(text)
    var line = seriesLine()
    if (line) {
      var sp = el("div", "bcseries")
      sp.appendChild(document.createTextNode("返回后系列赛比分将清零："))
      sp.appendChild(el("b", null, line))
      panel.appendChild(sp)
    }
    panel.appendChild(actions)
    bd.appendChild(panel)
    document.body.appendChild(bd)
    // v1.3.77：像素级摆放（遮罩铺屏 + 面板居中），并跟踪转屏
    placePanel(bd, panel)
    window.addEventListener("resize", onViewportChange, false)
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
