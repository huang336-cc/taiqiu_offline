import { BrowserContainer } from "./container/browsercontainer"
import { AngleInput } from "./view/dom/angleinput"
import { getCanvas } from "./utils/dom"
import { VERSION } from "./utils/version"
import { Settings } from "./utils/settings"
import { PocketGeometry } from "./view/pocketgeometry"

customElements.define("angle-input", AngleInput)

initialise()

function initialise() {
  console.log("奥特曼的台球 离线版", VERSION)

  // 预读设置，确保渲染器创建前画质档位已就绪
  const settings = Settings.get()
  applyQualityClass(settings.lod)

  const canvas3d = getCanvas("viewP1")!
  const params = new URLSearchParams(location.search)
  const browserContainer = new BrowserContainer(canvas3d, params)
  browserContainer.start()
  // 调试句柄：仅在显式打开 ?debug=1 时挂载，发布版不带，
  // 既能给自动化测试用，也不污染正式包
  if (params.get("debug") === "1") {
    ;(globalThis as any).__bc = browserContainer
    ;(globalThis as any).__bc.PocketGeometry = PocketGeometry
  }

  setupMobileBehaviour()
  setupOverlayControls(browserContainer)
  setupResizeListeners(browserContainer)
  setupViewportFit()
}

/**
 * v1.1.10：折叠屏折叠/展开 + 旋转感知。
 *
 * 鸿蒙折叠机在折叠/展开瞬间，WebView 容器尺寸会经历 0 → 目标尺寸的跳变。
 * 不加监听时，View 只能靠 ResizeObserver 被动缓存尺寸，不会主动触发重建渲染，
 * 导致折叠后黑屏几百毫秒甚至永久黑屏（若 renderer 在 0 尺寸帧被放弃创建）。
 *
 * 这里在 resize/orientationchange 时去抖 50ms 后主动调一次 ensureRendererAndRender，
 * 确保尺寸恢复后立刻重建渲染器并渲染一帧。
 */
function setupResizeListeners(browserContainer: BrowserContainer) {
  let debounceTimer: number | undefined
  const debouncedRender = () => {
    if (debounceTimer !== undefined) {
      clearTimeout(debounceTimer)
    }
    debounceTimer = window.setTimeout(() => {
      try {
        browserContainer.container?.view?.ensureRendererAndRender()
      } catch {
        /* 尚未初始化时忽略 */
      }
    }, 50)
  }

  window.addEventListener("resize", debouncedRender)
  window.addEventListener("orientationchange", debouncedRender)

  // v1.2.30：iOS Safari 的地址栏展开/收起不会触发 window.resize，
  // 但会触发 visualViewport.resize。监听它才能及时更新 canvas/body 尺寸，
  // 避免黑边或球桌比例畸变。
  const visualViewport = (window as any).visualViewport
  if (visualViewport && typeof visualViewport.addEventListener === "function") {
    visualViewport.addEventListener("resize", debouncedRender)
  }

  // screen.orientation change（容错：部分 WebView 不支持）
  const orientation = (screen as any)?.orientation
  if (orientation && typeof orientation.addEventListener === "function") {
    orientation.addEventListener("change", debouncedRender)
  }
}

/**
 * v1.2.32：iOS Safari / 微信等 WebView 的底部工具栏/操作栏会以 overlay 形式
 * 盖在页面内容之上，导致游戏底部操作栏被压住。通过 visualViewport 计算
 * layout viewport 与 visual viewport 的高度差，得到底部被遮挡的高度，写入
 * --vv-bottom CSS 变量；CSS 再用它把 .panel / 回放进度条整体上移，确保
 * 击球/力度/视角等控件始终位于工具栏上方。
 */
function setupViewportFit() {
  const update = () => {
    const vv = (window as any).visualViewport
    let bottom = 0
    if (vv) {
      bottom = Math.max(0, Math.round(window.innerHeight - vv.height))
    }
    document.documentElement.style.setProperty("--vv-bottom", `${bottom}px`)
  }
  update()

  const vv = (window as any).visualViewport
  if (vv && typeof vv.addEventListener === "function") {
    vv.addEventListener("resize", update)
    vv.addEventListener("scroll", update)
  }
  window.addEventListener("resize", update)
  window.addEventListener("orientationchange", update)
}

/** 低画质档位下给 body 加类，关闭一些昂贵的 CSS 效果 */
function applyQualityClass(lod: number) {
  document.body?.classList.toggle("lod-low", lod <= 1)
}

/**
 * 帮助/设置浮层与主菜单之间的联动。
 * 设置面板保存后会 postMessage 过来，这里即时生效，无需重开游戏。
 */
function setupOverlayControls(browserContainer: BrowserContainer) {
  const backToMenu = document.getElementById("backToMenu")
  if (backToMenu) {
    backToMenu.onclick = () => {
      globalThis.location.href = "menu.html"
    }
  }

  // 设置浮层「再来一局」：先关闭浮层，再弹二次确认，确认后才原地重开本局
  const restartGame = document.getElementById("restartGame")
  if (restartGame) {
    restartGame.onclick = () => {
      document.getElementById("helpOverlay")?.setAttribute("hidden", "true")
      const c = browserContainer.container
      if (c?.notification) {
        c.notification.show(
          {
            type: "Info",
            title: "确认重新开始本局？",
            subtext: "将重新摆球并开始新一局",
            extra:
              '<button class="notification-btn" data-notification-action="confirm-restart">重新开始</button>' +
              '<button class="notification-btn" data-notification-action="cancel-restart">取消</button>',
            duration: 0,
          },
          0,
          {
            "confirm-restart": () => globalThis.location.reload(),
            "cancel-restart": () => c.notification.clear(),
          }
        )
      } else {
        globalThis.location.reload()
      }
    }
  }

  globalThis.addEventListener("message", (e: MessageEvent) => {
    if (!e.data) return
    // 对局内实时换肤（item 1）：立即刷新球杆与球台外观，无需重开
    if (e.data.type === "billiards-apply-skin") {
      try {
        // 先按浮层刚写入的 localStorage 刷新缓存，再落定皮肤，
        // 避免用本页的旧快照覆盖掉浮层同时改动的其它设置
        Settings.reload()
        Settings.set("skin", e.data.skin)
        browserContainer.container?.view?.applySkin(e.data.skin)
      } catch {
        /* 尚未初始化时忽略 */
      }
      return
    }
    if (e.data.type === "billiards-apply-cuetheme") {
      try {
        Settings.reload()
        Settings.set("cueTheme", e.data.cueTheme)
        browserContainer.container?.view?.applyCueTheme(e.data.cueTheme)
      } catch {
        /* 尚未初始化时忽略 */
      }
      return
    }
    // 对局内实时切换台球桌皮肤（item 5）：刷新台呢/桌框/装饰边，不影响球杆与物理
    if (e.data.type === "billiards-apply-tableskin") {
      try {
        Settings.reload()
        Settings.set("tableSkin", e.data.tableSkin)
        browserContainer.container?.view?.applyTableSkin(e.data.tableSkin)
      } catch {
        /* 尚未初始化时忽略 */
      }
      return
    }
    // 对局内实时切换环境场景（item 4）：刷新背景贴图与氛围光
    if (e.data.type === "billiards-apply-scene") {
      try {
        Settings.reload()
        Settings.set("scene", e.data.scene)
        browserContainer.container?.view?.applyScene(e.data.scene)
      } catch {
        /* 尚未初始化时忽略 */
      }
      return
    }
    if (e.data.type !== "billiards-settings") return
    // 让本页缓存失效后重新读取
    Settings.reload()
    const settings = Settings.get()
    applyQualityClass(settings.lod)
    try {
      browserContainer.container?.table?.cue?.showHelper(settings.aimAssist)
      // 进球辅助线开关：关掉时立刻收线，开启则下一帧自然重绘
      if (!settings.aimLine) {
        browserContainer.container?.table?.cue?.hideTargetLine()
      }
      // 横向瞄准滑动条开关
      browserContainer.container?.table?.cue?.aimInputs?.applyAimSliderVisibility()
      // 浮层可能改了球杆主题，重新套用
      browserContainer.container?.table?.cue?.applyCueTheme(
        settings.cueTheme
      )
      // 浮层可能改了环境场景，重新套用
      browserContainer.container?.view?.applyScene(settings.scene)
      // 浮层可能改了台球桌皮肤，重新套用
      browserContainer.container?.view?.applyTableSkin(settings.tableSkin)
    } catch {
      /* 尚未初始化时忽略 */
    }
  })
}

/**
 * 手机端体验优化：
 * - 阻止双指缩放与双击放大，避免误触打断瞄准
 * - 阻止长按弹出系统菜单
 */
function setupMobileBehaviour() {
  document.addEventListener(
    "gesturestart",
    (e) => {
      e.preventDefault()
    },
    { passive: false }
  )

  let lastTouch = 0
  document.addEventListener(
    "touchend",
    (e) => {
      const now = Date.now()
      if (now - lastTouch < 300) {
        e.preventDefault()
      }
      lastTouch = now
    },
    { passive: false }
  )

  document.addEventListener("contextmenu", (e) => e.preventDefault())
}
