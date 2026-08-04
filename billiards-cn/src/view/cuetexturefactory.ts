import {
  CanvasTexture,
  RepeatWrapping,
  SRGBColorSpace,
  Texture,
} from "three"
import { getCueTheme } from "../utils/settings"

/**
 * 球杆主题贴图工厂（item 2：增加球杆元素）。
 *
 * 全部为「程序化 Canvas 贴图」，不依赖任何外部图片资源：
 * - 离线可用、零额外包体、无版权/商标风险；
 * - 主题风格为原创的意象化图案（龙鳞、护目镜、爱心、火焰等），
 *   并非对具体角色形象的复制。
 *
 * 贴图沿球杆轴向（圆柱侧面 v 方向）平铺，画布高度代表杆长。
 */

const W = 256 // 周向分辨率
const H = 1024 // 轴向（杆长）分辨率

const cache = new Map<string, Texture>()

export function getCueTexture(themeId: string): Texture | null {
  if (themeId === "auto") return null
  if (cache.has(themeId)) return cache.get(themeId)!
  const tex = build(themeId)
  if (tex) {
    tex.wrapS = RepeatWrapping
    tex.wrapT = RepeatWrapping
    tex.colorSpace = SRGBColorSpace
    tex.anisotropy = 4
    tex.needsUpdate = true
    cache.set(themeId, tex)
  }
  return tex
}

function newCanvas(): { cv: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const cv = document.createElement("canvas")
  cv.width = W
  cv.height = H
  const ctx = cv.getContext("2d")!
  return { cv, ctx }
}

function toTexture(cv: HTMLCanvasElement): CanvasTexture {
  return new CanvasTexture(cv)
}

/** 在画布上平铺菱形鳞片 */
function drawScales(
  ctx: CanvasRenderingContext2D,
  rows: number,
  cols: number,
  fill: (r: number, c: number) => string,
  stroke?: string
) {
  const sw = W / cols
  const sh = H / rows
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = c * sw + (r % 2 ? sw / 2 : 0)
      const y = r * sh
      ctx.beginPath()
      ctx.moveTo(x + sw / 2, y)
      ctx.lineTo(x + sw, y + sh / 2)
      ctx.lineTo(x + sw / 2, y + sh)
      ctx.lineTo(x, y + sh / 2)
      ctx.closePath()
      ctx.fillStyle = fill(r, c)
      ctx.fill()
      if (stroke) {
        ctx.strokeStyle = stroke
        ctx.lineWidth = 1.5
        ctx.stroke()
      }
    }
  }
}

function build(themeId: string): Texture | null {
  const kind = getCueTheme(themeId).kind
  switch (kind) {
    case "dragon":
      return buildDragon()
    case "azure":
      return buildAzure()
    case "minions":
      return buildMinions()
    case "peppa":
      return buildPeppa()
    case "qilin":
      return buildQilin()
    default:
      return null
  }
}

/** 屠龙斩：暗红木底 + 金色龙鳞 + 剑光斜纹 */
function buildDragon(): Texture {
  const { cv, ctx } = newCanvas()
  const g = ctx.createLinearGradient(0, 0, 0, H)
  g.addColorStop(0, "#5a1414")
  g.addColorStop(0.5, "#3a0d0d")
  g.addColorStop(1, "#220707")
  ctx.fillStyle = g
  ctx.fillRect(0, 0, W, H)
  drawScales(
    ctx,
    26,
    8,
    (r, c) =>
      (r + c) % 2 ? "#caa23a" : "#9c7a1e",
    "rgba(40,20,0,0.5)"
  )
  // 剑光斜纹
  ctx.strokeStyle = "rgba(255,240,200,0.55)"
  ctx.lineWidth = 6
  for (let i = -1; i < 4; i++) {
    ctx.beginPath()
    ctx.moveTo(i * 90, 0)
    ctx.lineTo(i * 90 + H * 0.32, H)
    ctx.stroke()
  }
  // 尾部金属金箍
  ctx.fillStyle = "#e8c878"
  ctx.fillRect(0, H - 60, W, 60)
  return toTexture(cv)
}

/** 青龙：青蓝渐变 + 龙鳞 + 青色高光 */
function buildAzure(): Texture {
  const { cv, ctx } = newCanvas()
  const g = ctx.createLinearGradient(0, 0, 0, H)
  g.addColorStop(0, "#1f6f9c")
  g.addColorStop(0.5, "#0e4a6e")
  g.addColorStop(1, "#093b54")
  ctx.fillStyle = g
  ctx.fillRect(0, 0, W, H)
  drawScales(
    ctx,
    28,
    8,
    (r, c) =>
      (r + c) % 2 ? "#5fd0e0" : "#2f9fc0",
    "rgba(5,30,45,0.55)"
  )
  // 青色流光
  ctx.strokeStyle = "rgba(180,255,255,0.4)"
  ctx.lineWidth = 4
  ctx.beginPath()
  ctx.moveTo(W / 2, 0)
  ctx.bezierCurveTo(W * 0.9, H * 0.3, W * 0.1, H * 0.7, W / 2, H)
  ctx.stroke()
  ctx.fillStyle = "#3fe0c0"
  ctx.fillRect(0, H - 60, W, 60)
  return toTexture(cv)
}

/** 小黄人：亮黄底 + 蓝色护目镜环 */
function buildMinions(): Texture {
  const { cv, ctx } = newCanvas()
  ctx.fillStyle = "#f4d000"
  ctx.fillRect(0, 0, W, H)
  // 护目镜带
  ctx.fillStyle = "#1a1a1a"
  ctx.fillRect(0, H * 0.32, W, H * 0.16)
  ctx.fillRect(0, H * 0.66, W, H * 0.16)
  // 护目镜环
  const drawGoggle = (cy: number) => {
    ctx.fillStyle = "#1f6fb2"
    ctx.beginPath()
    ctx.arc(W / 2, cy, 70, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = "#bfe3ff"
    ctx.beginPath()
    ctx.arc(W / 2, cy, 46, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = "#0a1a2a"
    ctx.beginPath()
    ctx.arc(W / 2, cy, 22, 0, Math.PI * 2)
    ctx.fill()
  }
  drawGoggle(H * 0.4)
  drawGoggle(H * 0.74)
  return toTexture(cv)
}

/** 小猪佩奇：粉色底 + 白色爱心 */
function buildPeppa(): Texture {
  const { cv, ctx } = newCanvas()
  ctx.fillStyle = "#ff9ec4"
  ctx.fillRect(0, 0, W, H)
  const heart = (x: number, y: number, s: number) => {
    ctx.save()
    ctx.translate(x, y)
    ctx.scale(s, s)
    ctx.fillStyle = "#ffffff"
    ctx.beginPath()
    ctx.moveTo(0, 8)
    ctx.bezierCurveTo(-12, -6, -22, 8, 0, 24)
    ctx.bezierCurveTo(22, 8, 12, -6, 0, 8)
    ctx.closePath()
    ctx.fill()
    ctx.restore()
  }
  for (let r = 0; r < 9; r++) {
    for (let c = 0; c < 3; c++) {
      const x = 50 + c * 80 + (r % 2 ? 40 : 0)
      const y = 60 + r * 110
      heart(x, y, 1.1)
    }
  }
  ctx.fillStyle = "#ff6fa8"
  ctx.fillRect(0, H - 60, W, 60)
  return toTexture(cv)
}

/** 火麒麟：橙红火焰渐变 + 金色火舌 */
function buildQilin(): Texture {
  const { cv, ctx } = newCanvas()
  const g = ctx.createLinearGradient(0, 0, 0, H)
  g.addColorStop(0, "#ff7a1f")
  g.addColorStop(0.5, "#d8320a")
  g.addColorStop(1, "#7a1404")
  ctx.fillStyle = g
  ctx.fillRect(0, 0, W, H)
  // 火舌
  ctx.fillStyle = "rgba(255,220,120,0.85)"
  for (let i = 0; i < 18; i++) {
    const x = (i * 53) % W
    const y = (i * 137) % H
    ctx.beginPath()
    ctx.moveTo(x, y + 40)
    ctx.quadraticCurveTo(x + 22, y - 10, x + 40, y + 30)
    ctx.quadraticCurveTo(x + 18, y + 20, x, y + 40)
    ctx.closePath()
    ctx.fill()
  }
  ctx.fillStyle = "#ffd24a"
  ctx.fillRect(0, H - 60, W, 60)
  return toTexture(cv)
}
