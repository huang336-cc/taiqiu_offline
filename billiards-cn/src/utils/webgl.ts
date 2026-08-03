import { WebGLRenderer, SRGBColorSpace, NoToneMapping } from "three"
import { Session } from "../network/client/session"

export function renderer(element: HTMLElement) {
  if (typeof process !== "undefined") {
    return undefined
  }

  // 创建诊断浮层，用于在真机上显示 WebGL 错误
  const diag = ensureDiagOverlay(element)

  const width = element.offsetWidth
  const height = element.offsetHeight
  if (width === 0 || height === 0) {
    diag.textContent = "[WebGL] 渲染容器尺寸为 0，无法创建画布"
    return undefined
  }

  const lod = Session.getLod()

  let glRenderer: WebGLRenderer | undefined
  try {
    glRenderer = new WebGLRenderer({
      antialias: lod >= 4,
      depth: true,
      powerPreference: lod <= 1 ? "low-power" : "high-performance",
      stencil: false,
      alpha: false,
    })
  } catch (e) {
    diag.textContent =
      "[WebGL] 创建 WebGLRenderer 失败：" +
      (e instanceof Error ? e.message : String(e))
    return undefined
  }

  // 兜底：如果上下文拿不到，three.js 在某些 WebView 上不会抛异常，而是留下一个无上下文的 canvas
  const gl = glRenderer.getContext()
  if (!gl) {
    diag.textContent =
      "[WebGL] getContext() 返回空。请确认系统 WebView 已更新，并尝试开启硬件加速。"
    glRenderer.dispose()
    return undefined
  }

  // 监听上下文丢失/恢复
  glRenderer.domElement.addEventListener("webglcontextlost", (e) => {
    diag.textContent = "[WebGL] 上下文丢失 (context lost)"
    e.preventDefault()
  })
  glRenderer.domElement.addEventListener("webglcontextrestored", () => {
    diag.textContent = "[WebGL] 上下文已恢复"
  })

  glRenderer.shadowMap.enabled = false
  glRenderer.autoClear = false
  glRenderer.outputColorSpace = SRGBColorSpace
  glRenderer.toneMapping = NoToneMapping
  glRenderer.sortObjects = false
  glRenderer.setSize(width, height)
  glRenderer.setPixelRatio(computeCappedDPR())
  glRenderer.domElement.draggable = false
  glRenderer.domElement.style.userSelect = "none"
  glRenderer.domElement.addEventListener("dragstart", (e) => e.preventDefault())
  element.appendChild(glRenderer.domElement)

  // 创建成功后再等一帧，确认没有触发上下文丢失
  requestAnimationFrame(() => {
    if (glRenderer) {
      diag.style.opacity = "0"
    }
  })

  return glRenderer
}

function ensureDiagOverlay(parent: HTMLElement): HTMLDivElement {
  const existing = parent.querySelector(".webgl-diag") as HTMLDivElement | null
  if (existing) {
    existing.style.opacity = "1"
    return existing
  }
  const el = document.createElement("div")
  el.className = "webgl-diag"
  el.style.cssText =
    "position:absolute;top:8px;left:8px;right:8px;z-index:10000;" +
    "background:rgba(0,0,0,0.75);color:#ff6b6b;font-size:12px;" +
    "padding:10px;border-radius:6px;pointer-events:none;" +
    "font-family:monospace;white-space:pre-wrap;word-break:break-all;"
  parent.appendChild(el)
  return el
}

/**
 * 计算渲染像素比。
 *
 * 手机屏幕像素比常达 3~4，若按原生分辨率渲染，
 * 中低端 GPU 的填充率会成为瓶颈。这里按画质档位设上限，
 * 在保证清晰度的同时避免过度绘制。
 */
function computeCappedDPR() {
  const lod = Session.getLod()
  const device = globalThis.devicePixelRatio ?? 1

  let cap: number
  switch (lod) {
    case 0:
      cap = 0.5
      break
    case 1:
      cap = 0.75
      break
    case 2:
      cap = 1
      break
    case 3:
      cap = 1.5
      break
    case 4:
      cap = 2
      break
    default:
      cap = 3
      break
  }
  return Math.min(device, cap)
}
