import { WebGLRenderer, SRGBColorSpace, NoToneMapping, PCFShadowMap } from "three"
import { Session } from "../network/client/session"

/**
 * 诊断浮层：在真机上把 WebGL/运行时错误显示出来，避免「静默黑屏」无法排查。
 */

let diagHadError = false
let diagParent: HTMLElement | null = null

/** 把 WebGL 相关错误显示到诊断浮层（同时打印到 console）。 */
export function reportWebGLError(msg: string) {
  diagHadError = true
  if (diagParent) {
    const el = ensureDiagOverlay(diagParent)
    el.textContent = "[WebGL] " + msg
    el.style.opacity = "1"
  }
  console.error("[WebGL] " + msg)
}

/**
 * 惰性创建/重建 WebGLRenderer。
 *
 * v1.1.10 关键改动：不再因为容器尺寸为 0 直接 return undefined。
 * 折叠屏在折叠/展开瞬间，容器 offsetWidth/Height 会短暂为 0，旧逻辑一旦在这一帧
 * 调用 renderer() 就会永久放弃创建（View.renderer 是 readonly 时尤甚），导致黑屏。
 * 现在返回 undefined 但记录待重试的 element，由 View 在下一帧/resize 时主动重试。
 */
let pendingElement: HTMLElement | null = null
let retryCount = 0
const MAX_RETRY = 60 // 约 1 秒（60fps）

export function renderer(element: HTMLElement) {
  if (typeof process !== "undefined") {
    return undefined
  }

  diagParent = element
  const diag = ensureDiagOverlay(element)

  const width = element.offsetWidth
  const height = element.offsetHeight
  if (width === 0 || height === 0) {
    // 不再直接报错放弃。记录待重试元素，调度下一帧重试。
    pendingElement = element
    if (retryCount === 0) {
      scheduleRetry()
    }
    return undefined
  }

  // 尺寸恢复，重置重试计数
  retryCount = 0
  pendingElement = null
  diagHadError = false

  return createRenderer(element, diag, width, height)
}

/** 惰性重建入口：View 在 ResizeObserver/resize 检测到尺寸从 0 恢复时调用。 */
export function ensureWebRenderer(element: HTMLElement): WebGLRenderer | undefined {
  const width = element.offsetWidth
  const height = element.offsetHeight
  if (width === 0 || height === 0) {
    return undefined
  }
  // 尺寸有效，尝试创建
  diagParent = element
  const diag = ensureDiagOverlay(element)
  retryCount = 0
  pendingElement = null
  diagHadError = false
  return createRenderer(element, diag, width, height)
}

function scheduleRetry() {
  if (retryCount >= MAX_RETRY) {
    reportWebGLError("渲染容器持续为 0 超过 " + MAX_RETRY + " 帧，已放弃。可能是 WebView 异常。")
    pendingElement = null
    retryCount = 0
    return
  }
  retryCount++
  requestAnimationFrame(() => {
    if (!pendingElement) return
    const el = pendingElement
    const w = el.offsetWidth
    const h = el.offsetHeight
    if (w > 0 && h > 0) {
      // 尺寸恢复，触发一次重建（通过 globalThis 钩子让 View 主动拉）
      const hook = (globalThis as any).__rendererReady
      if (typeof hook === "function") {
        hook(el)
      }
      pendingElement = null
      retryCount = 0
    } else {
      scheduleRetry()
    }
  })
}

function createRenderer(
  element: HTMLElement,
  diag: HTMLDivElement,
  width: number,
  height: number
): WebGLRenderer | undefined {
  const lod = Session.getLod()

  let glRenderer: WebGLRenderer | undefined
  try {
    glRenderer = new WebGLRenderer({
      antialias: lod >= 1,
      depth: true,
      powerPreference: lod <= 1 ? "low-power" : "high-performance",
      stencil: false,
      alpha: false,
    })
  } catch (e) {
    reportWebGLError(
      "创建 WebGLRenderer 失败：" + (e instanceof Error ? e.message : String(e))
    )
    return undefined
  }

  // 兜底：如果上下文拿不到，three.js 在某些 WebView 上不会抛异常，而是留下一个无上下文的 canvas
  const gl = glRenderer.getContext()
  if (!gl) {
    reportWebGLError(
      "getContext() 返回空。请确认系统 WebView 已更新，并尝试开启硬件加速。"
    )
    glRenderer.dispose()
    return undefined
  }

  // 监听上下文丢失/恢复
  glRenderer.domElement.addEventListener("webglcontextlost", (e) => {
    e.preventDefault()
    reportWebGLError("上下文丢失 (context lost)，正在尝试恢复…")
  })
  glRenderer.domElement.addEventListener("webglcontextrestored", () => {
    diagHadError = false
    const el = ensureDiagOverlay(element)
    el.style.opacity = "0"
  })

  glRenderer.shadowMap.enabled = true
  glRenderer.shadowMap.type = PCFShadowMap
  glRenderer.autoClear = true
  glRenderer.setClearColor(0x142a1f, 1)
  glRenderer.outputColorSpace = SRGBColorSpace
  glRenderer.toneMapping = NoToneMapping
  glRenderer.sortObjects = false
  glRenderer.setSize(width, height)
  glRenderer.setPixelRatio(computeCappedDPR())
  glRenderer.domElement.draggable = false
  glRenderer.domElement.style.userSelect = "none"
  glRenderer.domElement.addEventListener("dragstart", (e) => e.preventDefault())
  element.appendChild(glRenderer.domElement)

  requestAnimationFrame(() => {
    if (glRenderer && !diagHadError) {
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
 * v1.1.12：把 lod 0~4 的 cap 各上调一档，lod=1 默认档从 0.75x → 1.25x，
 *          解决「球移动时锯齿严重」的反馈——之前 DPR cap 太低，DPR=3
 *          的设备实际只渲染到 0.75 倍逻辑像素（画布分辨率砍到 1/4），
 *          再叠加 antialias 仅在 lod≥4 才开，欠采样 + 无 MSAA 直接出锯齿。
 *
 *          v1.1.10 引入 LOD 是为了避免折叠屏中低端 GPU 触发 WebGL
 *          上下文丢失（黑屏）。本版同步把 antialias 阈值从 lod≥4
 *          放宽到 lod≥1，cap 上调后仍保留原有的性能护栏（最高 2.5x）。
 */
function computeCappedDPR() {
  const lod = Session.getLod()
  const device = globalThis.devicePixelRatio ?? 1

  let cap: number
  switch (lod) {
    case 0:
      cap = 1
      break
    case 1:
      cap = 1.25
      break
    case 2:
      cap = 1.5
      break
    case 3:
      cap = 2
      break
    case 4:
      cap = 2.5
      break
    default:
      cap = 2
      break
  }
  return Math.min(device, cap)
}

/**
 * 全局未捕获异常兜底。
 *
 * 此前渲染循环/资源加载中的异常会「静默杀掉」动画循环或只打印到 console，
 * 在真机上表现为无信息的黑屏。这里把 window error / unhandledrejection
 * 都汇聚到诊断浮层，便于定位根因。
 */
if (typeof globalThis !== "undefined" && typeof (globalThis as any).addEventListener === "function") {
  ;(globalThis as any).addEventListener("error", (e: any) => {
    const msg = e?.message ?? (e?.error ? String(e.error) : "未知错误")
    reportWebGLError("运行时异常: " + msg)
  })
  ;(globalThis as any).addEventListener("unhandledrejection", (e: any) => {
    const msg =
      e?.reason?.message ?? String(e?.reason ?? "未处理的 Promise 拒绝")
    reportWebGLError("异步异常: " + msg)
  })
  // 暴露给 container.ts 的帧循环 catch 使用
  ;(globalThis as any).reportWebGLError = reportWebGLError
}
