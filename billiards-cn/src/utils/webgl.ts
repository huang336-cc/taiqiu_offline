import { WebGLRenderer, SRGBColorSpace, NoToneMapping } from "three"
import { Session } from "../network/client/session"

export function renderer(element: HTMLElement) {
  if (typeof process !== "undefined") {
    return undefined
  }

  const lod = Session.getLod()

  const renderer = new WebGLRenderer({
    antialias: lod >= 4,
    depth: true,
    powerPreference: lod <= 1 ? "low-power" : "high-performance",
    stencil: false,
    alpha: false,
  })

  renderer.shadowMap.enabled = false
  renderer.autoClear = false
  renderer.outputColorSpace = SRGBColorSpace
  renderer.toneMapping = NoToneMapping
  renderer.sortObjects = false
  renderer.setSize(element.offsetWidth, element.offsetHeight)
  renderer.setPixelRatio(computeCappedDPR())
  renderer.domElement.draggable = false
  renderer.domElement.style.userSelect = "none"
  renderer.domElement.addEventListener("dragstart", (e) => e.preventDefault())
  element.appendChild(renderer.domElement)
  return renderer
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
