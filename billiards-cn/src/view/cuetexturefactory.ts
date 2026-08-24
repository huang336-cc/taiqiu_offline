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
    case "ultraman":
      return buildUltraman()
    case "neon":
      return buildNeon()
    case "bamboo":
      return buildBamboo()
    case "jade":
      return buildJade()
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

/** 奥特曼：银色金属底 + 红色能量条纹 + 六边形护甲块（原创意象，红银配色致敬） */
function buildUltraman(): Texture {
  const { cv, ctx } = newCanvas()
  const g = ctx.createLinearGradient(0, 0, 0, H)
  g.addColorStop(0, "#e8eef2")
  g.addColorStop(0.5, "#b9c4cc")
  g.addColorStop(1, "#8c98a2")
  ctx.fillStyle = g
  ctx.fillRect(0, 0, W, H)
  // 金属高光竖纹
  ctx.strokeStyle = "rgba(255,255,255,0.45)"
  ctx.lineWidth = 3
  for (let i = 0; i < W; i += 24) {
    ctx.beginPath()
    ctx.moveTo(i, 0)
    ctx.lineTo(i + 8, H)
    ctx.stroke()
  }
  // 红色能量环带
  ctx.fillStyle = "#c81f1f"
  ctx.fillRect(0, H * 0.22, W, H * 0.05)
  ctx.fillRect(0, H * 0.62, W, H * 0.05)
  // 六边形护甲块
  const hex = (cx: number, cy: number, r: number) => {
    ctx.beginPath()
    for (let k = 0; k < 6; k++) {
      const a = (Math.PI / 3) * k - Math.PI / 6
      const x = cx + r * Math.cos(a)
      const y = cy + r * Math.sin(a)
      k === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)
    }
    ctx.closePath()
    ctx.fillStyle = "#d7dde2"
    ctx.fill()
    ctx.strokeStyle = "#9aa6ae"
    ctx.lineWidth = 2
    ctx.stroke()
  }
  for (let r = 0; r < H; r += 150) {
    hex(W * 0.3, r + 40, 26)
    hex(W * 0.7, r + 110, 26)
  }
  // 尾部红银金箍
  ctx.fillStyle = "#c81f1f"
  ctx.fillRect(0, H - 60, W, 60)
  return toTexture(cv)
}

/** 霓虹脉冲：深黑底 + 品红/青色发光脉冲波（赛博朋克） */
function buildNeon(): Texture {
  const { cv, ctx } = newCanvas()
  ctx.fillStyle = "#05060a"
  ctx.fillRect(0, 0, W, H)
  // 脉冲波（品红 → 青 渐变描边）
  for (let i = 0; i < 14; i++) {
    const cx = (i * 97) % W
    const cy = (i * 173) % H
    const rad = 30 + (i % 4) * 18
    const grd = ctx.createRadialGradient(cx, cy, 2, cx, cy, rad)
    grd.addColorStop(0, "rgba(255,43,214,0.9)")
    grd.addColorStop(0.6, "rgba(19,230,255,0.5)")
    grd.addColorStop(1, "rgba(19,230,255,0)")
    ctx.fillStyle = grd
    ctx.beginPath()
    ctx.arc(cx, cy, rad, 0, Math.PI * 2)
    ctx.fill()
  }
  // 横向霓虹流光线
  ctx.strokeStyle = "rgba(255,43,214,0.85)"
  ctx.lineWidth = 5
  ctx.shadowColor = "#ff2bd6"
  ctx.shadowBlur = 14
  for (let i = 0; i < 5; i++) {
    const y = (i + 0.5) * (H / 5)
    ctx.beginPath()
    ctx.moveTo(0, y)
    ctx.lineTo(W, y + (i % 2 ? 30 : -30))
    ctx.stroke()
  }
  ctx.shadowBlur = 0
  ctx.fillStyle = "#0a0f16"
  ctx.fillRect(0, H - 60, W, 60)
  return toTexture(cv)
}

/** 青竹：竹青渐变 + 竹节环纹 + 竖纤维 */
function buildBamboo(): Texture {
  const { cv, ctx } = newCanvas()
  const g = ctx.createLinearGradient(0, 0, 0, H)
  g.addColorStop(0, "#9fd67a")
  g.addColorStop(0.5, "#5fa83f")
  g.addColorStop(1, "#3f7d2f")
  ctx.fillStyle = g
  ctx.fillRect(0, 0, W, H)
  // 竹节环纹
  ctx.strokeStyle = "rgba(30,70,20,0.7)"
  ctx.lineWidth = 10
  for (let y = 0; y < H; y += 110) {
    ctx.beginPath()
    ctx.moveTo(0, y)
    ctx.lineTo(W, y)
    ctx.stroke()
  }
  // 竖纤维高光
  ctx.strokeStyle = "rgba(220,255,200,0.4)"
  ctx.lineWidth = 2
  for (let i = 8; i < W; i += 16) {
    ctx.beginPath()
    ctx.moveTo(i, 0)
    ctx.lineTo(i, H)
    ctx.stroke()
  }
  ctx.fillStyle = "#356b27"
  ctx.fillRect(0, H - 60, W, 60)
  return toTexture(cv)
}

/** 墨玉：墨黑/墨绿底 + 玉色光泽 + 暗云纹 */
function buildJade(): Texture {
  const { cv, ctx } = newCanvas()
  const g = ctx.createLinearGradient(0, 0, 0, H)
  g.addColorStop(0, "#1c2b22")
  g.addColorStop(0.5, "#101a14")
  g.addColorStop(1, "#0a0f0c")
  ctx.fillStyle = g
  ctx.fillRect(0, 0, W, H)
  // 玉色流动光斑
  for (let i = 0; i < 16; i++) {
    const cx = (i * 71) % W
    const cy = (i * 151) % H
    const rad = 24 + (i % 3) * 14
    const grd = ctx.createRadialGradient(cx, cy, 2, cx, cy, rad)
    grd.addColorStop(0, "rgba(80,180,140,0.55)")
    grd.addColorStop(1, "rgba(80,180,140,0)")
    ctx.fillStyle = grd
    ctx.beginPath()
    ctx.arc(cx, cy, rad, 0, Math.PI * 2)
    ctx.fill()
  }
  // 暗云纹
  ctx.strokeStyle = "rgba(120,200,160,0.18)"
  ctx.lineWidth = 3
  ctx.beginPath()
  ctx.moveTo(0, H * 0.3)
  ctx.bezierCurveTo(W * 0.4, H * 0.25, W * 0.6, H * 0.4, W, H * 0.32)
  ctx.moveTo(0, H * 0.7)
  ctx.bezierCurveTo(W * 0.5, H * 0.62, W * 0.7, H * 0.78, W, H * 0.7)
  ctx.stroke()
  ctx.fillStyle = "#0d1a14"
  ctx.fillRect(0, H - 60, W, 60)
  return toTexture(cv)
}
