import { BrowserContainer } from "./container/browsercontainer"
import { AngleInput } from "./view/dom/angleinput"
import { getCanvas } from "./utils/dom"
import { VERSION } from "./utils/version"
import { Settings } from "./utils/settings"

customElements.define("angle-input", AngleInput)

initialise()

function initialise() {
  console.log("台球大师 离线版", VERSION)

  // 预读设置，确保渲染器创建前画质档位已就绪
  const settings = Settings.get()
  applyQualityClass(settings.lod)

  const canvas3d = getCanvas("viewP1")!
  const params = new URLSearchParams(location.search)
  const browserContainer = new BrowserContainer(canvas3d, params)
  browserContainer.start()

  setupMobileBehaviour()
  setupOverlayControls(browserContainer)
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

  globalThis.addEventListener("message", (e: MessageEvent) => {
    if (!e.data) return
    // 对局内实时换肤（item 1）：立即刷新球杆与球台外观，无需重开
    if (e.data.type === "billiards-apply-skin") {
      try {
        browserContainer.container?.view?.applySkin(e.data.skin)
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
