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
      // v1.3.93：MSAA 改为**始终开启**，不再随画质档开关。
      //
      // 原先是 `antialias: lod >= 1`，即画质档 0 完全关闭多重采样。用户反馈
      // 「锯齿太多，整体的画质差」，而 MSAA 恰恰是治边缘走样最直接、最便宜
      // 的手段：它由 GPU 的 MSAA 硬件路径完成，对 4x 采样而言显存与带宽开销
      // 在现代移动 GPU 上完全可接受（相比关掉后满屏爬行的边缘锯齿，
      // 这点开销换来的观感提升是压倒性的）。
      //
      // 真正的低端护栏应该是**分辨率**（见 computeCappedDPR，档 0 的 cap 仍是
      // 1x）和**几何细分度**（见 BallMesh.ballGeometryDetail），而不是砍掉抗锯齿。
      antialias: true,
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

  // v1.3.93：中高画质档的 cap 各上调一档。
  //
  // 背景：DPR cap 是「渲染分辨率」的直接闸门 —— cap=2 意味着 DPR=3 的手机
  // 只按 2x 渲染，相当于把渲染分辨率砍掉 (2/3)² ≈ 56%，画面上就是整体发糊 +
  // 边缘锯齿。用户反馈「整体的画质差」，cap 偏低是仅次于几何细分度的第二大
  // 因素（在 MSAA 已改为始终开启之后）。
  //
  // 调整：档 2 从 1.5 → 2，档 3 从 2 → 2.5，档 4 从 2.5 → 3。档 0/1 保持
  // 1 / 1.25 不动 —— 那是低端机护栏，动了会真掉帧。MSAA 现在始终开启，
  // 加上球几何在低档也提到 detail 2，低档的观感已经比改前明显好，
  // 不需要再靠抬 DPR 补偿。
  let cap: number
  switch (lod) {
    case 0:
      cap = 1
      break
    case 1:
      cap = 1.25
      break
    case 2:
      cap = 2
      break
    case 3:
      cap = 2.5
      break
    case 4:
      cap = 3
      break
    // 修复：原 switch 只到 case 4，QualityLevel 最高为 5（"最高画质"），
    // lod=5 会掉进 default=2，导致「调到最高档反而比 4 档更糊、锯齿更重」。
    // 现显式给出 3x 超采样，用更高渲染分辨率压制锯齿。
    case 5:
      cap = 3
      break
    default:
      cap = 2
      break
  }
  return Math.min(device, cap)
}

/**
 * v1.3.93：按当前画质档与设备像素比刷新渲染器的像素比。
 *
 * 修的问题：`setPixelRatio(computeCappedDPR())` 原先**只在创建渲染器时调一次**
 * （见 createRenderer 末尾），而 resize 路径（view.ts 的 updateSize 分支）只调
 * setSize / setViewport / setScissor，**从不刷新 DPR**。后果有两类：
 *
 *  1. 旋转屏幕 / 折叠屏展开后，`devicePixelRatio` 可能变化（横竖屏的 DPR 常不同），
 *     渲染分辨率却仍按旧 DPR 算，画质要么糊要么白白多渲染；
 *  2. 用户在设置里改了画质档，本函数是让它**当场生效**的钩子（否则要退出重进）。
 *
 * 返回是否真的发生了变化，便于调用方决定要不要顺带 updateProjectionMatrix。
 */
export function refreshPixelRatio(glRenderer: WebGLRenderer): boolean {
  const next = computeCappedDPR()
  if (glRenderer.getPixelRatio() === next) return false
  glRenderer.setPixelRatio(next)
  return true
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