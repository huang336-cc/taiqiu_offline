import { WebGLRenderer, SRGBColorSpace, NoToneMapping, PCFShadowMap } from "three"
import { Session } from "../network/client/session"

/**
 * 惰性创建/重建 WebGLRenderer。
 *
 * v1.1.10 关键改动：不再因为容器尺寸为 0 直接 return undefined。
 * 折叠屏在折叠/展开瞬间，容器 offsetWidth/Height 会短暂为 0，旧逻辑一旦在这一帧
 * 调用 renderer() 就会永久放弃创建（View.renderer 是 readonly 时尤甚），导致黑屏。
 * 现在返回 undefined 但记录待重试的 element，由 View 在下一帧/resize 时主动重试。
 *
 * v1.1.28：移除 v1.1.21 引入的诊断浮层（ensureDiagOverlay / diagState / setDiagStage /
 *          reportWebGLEError）。游戏已在真机稳定运行（1142+ 帧连续渲染、零异常），
 *          不再需要常驻状态显示；真正的 WebGL 创建/上下文错误改为 console.error/warn。
 */
let pendingElement: HTMLElement | null = null
let retryCount = 0
const MAX_RETRY = 60 // 约 1 秒（60fps）

export function renderer(element: HTMLElement) {
  if (typeof process !== "undefined") {
    return undefined
  }

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

  return createRenderer(element, width, height)
}

/** 惰性重建入口：View 在 ResizeObserver/resize 检测到尺寸从 0 恢复时调用。 */
export function ensureWebRenderer(element: HTMLElement): WebGLRenderer | undefined {
  const width = element.offsetWidth
  const height = element.offsetHeight
  if (width === 0 || height === 0) {
    return undefined
  }
  // 尺寸有效，尝试创建
  retryCount = 0
  pendingElement = null
  return createRenderer(element, width, height)
}

function scheduleRetry() {
  if (retryCount >= MAX_RETRY) {
    console.error(
      "[WebGL] 渲染容器持续为 0 超过 " + MAX_RETRY + " 帧，已放弃。可能是 WebView 异常。"
    )
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
    console.error(
      "[WebGL] 创建 WebGLRenderer 失败：" +
        (e instanceof Error ? e.message : String(e))
    )
    return undefined
  }

  // 兜底：如果上下文拿不到，three.js 在某些 WebView 上不会抛异常，而是留下一个无上下文的 canvas
  const gl = glRenderer.getContext()
  if (!gl) {
    console.error(
      "[WebGL] getContext() 返回空。请确认系统 WebView 已更新，并尝试开启硬件加速。"
    )
    glRenderer.dispose()
    return undefined
  }

  // 监听上下文丢失/恢复
  glRenderer.domElement.addEventListener("webglcontextlost", (e) => {
    e.preventDefault()
    console.warn("[WebGL] 上下文丢失 (context lost)，正在尝试恢复…")
  })
  glRenderer.domElement.addEventListener("webglcontextrestored", () => {
    // 上下文已恢复，无需 UI 操作
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

  return glRenderer
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
 * 全局未捕获异常兜底：仅打印到 console（v1.1.28 已移除诊断浮层）。
 *
 * 此前会汇聚到诊断浮层便于远程定位黑屏；现在没有浮层，错误只在 console
 * 可见。如真机再现"无声黑屏"，可通过 USB 调试 `adb logcat | grep Billiards`
 * 抓取本文件的 console 输出定位根因。
 */
if (
  typeof globalThis !== "undefined" &&
  typeof (globalThis as any).addEventListener === "function"
) {
  ;(globalThis as any).addEventListener("error", (e: any) => {
    const msg = e?.message ?? (e?.error ? String(e.error) : "未知错误")
    console.error("[Billiards] 运行时异常:", msg)
  })
  ;(globalThis as any).addEventListener("unhandledrejection", (e: any) => {
    const msg =
      e?.reason?.message ?? String(e?.reason ?? "未处理的 Promise 拒绝")
    console.error("[Billiards] 异步异常:", msg)
  })
}