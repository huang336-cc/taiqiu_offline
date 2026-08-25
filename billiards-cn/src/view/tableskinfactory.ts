import {
  CanvasTexture,
  RepeatWrapping,
  SRGBColorSpace,
  Texture,
} from "three"
import { getTableSkin } from "../utils/settings"

/**
 * 台球桌皮肤贴图工厂（item 5：增加台球桌皮肤）。
 *
 * 全部为「程序化 Canvas 贴图」，不依赖任何外部图片资源：
 * - 离线可用、零额外包体、无版权风险；
 * - 风格为原创意象化图案（玻璃反光、熔岩裂纹、霓虹灯带、鎏金云纹、
 *   全息薄膜、果冻质感等），并非对具体品牌/角色的复制。
 *
 * 台呢贴图沿平面平铺（wrapS/wrapT = RepeatWrapping），画布代表桌面的
 * 一小块纹理单元，循环铺满整张台呢；桌框贴图同理（沿杆向/周向平铺）。
 */

const W = 512 // 纹理单元宽
const H = 512 // 纹理单元高

const clothCache = new Map<string, Texture>()
const frameCache = new Map<string, Texture>()

/** 取台呢贴图（按 tableSkin id 缓存） */
export function getClothTexture(tableSkinId: string): Texture | null {
  if (clothCache.has(tableSkinId)) return clothCache.get(tableSkinId)!
  const def = getTableSkin(tableSkinId)
  if (def.clothTexture === "none") return null
  const tex = buildCloth(def)
  tex.wrapS = tex.wrapT = RepeatWrapping
  tex.colorSpace = SRGBColorSpace
  tex.anisotropy = 4
  tex.repeat.set(2, 2)
  tex.needsUpdate = true
  clothCache.set(tableSkinId, tex)
  return tex
}

/** 取桌框贴图（含发光边纹理），无发光时返回 null（直接上色即可） */
export function getFrameTexture(tableSkinId: string): Texture | null {
  if (frameCache.has(tableSkinId)) return frameCache.get(tableSkinId)!
  const def = getTableSkin(tableSkinId)
  if (def.frameGlow === 0 && def.edgeGlow === 0) return null
  const tex = buildFrame(def)
  tex.wrapS = tex.wrapT = RepeatWrapping
  tex.colorSpace = SRGBColorSpace
  tex.anisotropy = 4
  tex.needsUpdate = true
  frameCache.set(tableSkinId, tex)
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

function hex(n: number): string {
  return "#" + (n >>> 0).toString(16).padStart(6, "0").slice(-6)
}

/** 基础台呢渐变（含细微噪点，避免纯色死板） */
function baseClothGradient(
  ctx: CanvasRenderingContext2D,
  c1: number,
  c2: number
): void {
  const g = ctx.createLinearGradient(0, 0, W, H)
  g.addColorStop(0, hex(c1))
  g.addColorStop(1, hex(c2))
  ctx.fillStyle = g
  ctx.fillRect(0, 0, W, H)
  // 细微噪点（台呢绒面质感）
  ctx.globalAlpha = 0.05
  for (let i = 0; i < 4000; i++) {
    const x = Math.random() * W
    const y = Math.random() * H
    ctx.fillStyle = Math.random() > 0.5 ? "#ffffff" : "#000000"
    ctx.fillRect(x, y, 1.2, 1.2)
  }
  ctx.globalAlpha = 1
}

// ============ 台呢纹理 ============

function buildCloth(
  def: ReturnType<typeof getTableSkin>
): Texture {
  const { cv, ctx } = newCanvas()
  switch (def.clothTexture) {
    case "glass":
      return buildGlass(cv, ctx, def)
    case "lava":
      return buildLava(cv, ctx, def)
    case "neonstrip":
      return buildNeonStrip(cv, ctx, def)
    case "cloud":
      return buildCloud(cv, ctx, def)
    case "holo":
      return buildHolo(cv, ctx, def)
    case "candy":
      return buildCandy(cv, ctx, def)
    default:
      baseClothGradient(ctx, def.clothColor, def.clothColor2)
      return toTexture(cv)
  }
}

/** 黑曜石：黑底 + 细微玻璃斜向反光高光 */
function buildGlass(
  cv: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
  def: ReturnType<typeof getTableSkin>
): Texture {
  baseClothGradient(ctx, def.clothColor, def.clothColor2)
  // 玻璃斜向反光带
  ctx.save()
  ctx.globalAlpha = 0.18
  ctx.strokeStyle = "#cfd6e0"
  ctx.lineWidth = 26
  for (let i = -1; i < 4; i++) {
    ctx.beginPath()
    ctx.moveTo(i * 160, 0)
    ctx.lineTo(i * 160 + H * 0.5, H)
    ctx.stroke()
  }
  ctx.restore()
  // 暗角，强化冷酷神秘
  const vg = ctx.createRadialGradient(W / 2, H / 2, W * 0.2, W / 2, H / 2, W * 0.75)
  vg.addColorStop(0, "rgba(0,0,0,0)")
  vg.addColorStop(1, "rgba(0,0,0,0.55)")
  ctx.fillStyle = vg
  ctx.fillRect(0, 0, W, H)
  return toTexture(cv)
}

/** 熔岩：黑红渐变 + 橙红发光裂纹网络 */
function buildLava(
  cv: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
  def: ReturnType<typeof getTableSkin>
): Texture {
  baseClothGradient(ctx, def.clothColor, def.clothColor2)
  // 裂纹：随机分叉折线 + 发光描边
  ctx.lineCap = "round"
  const drawCrack = (x: number, y: number, len: number, ang: number, w: number) => {
    if (len < 6 || w < 0.4) return
    const nx = x + Math.cos(ang) * len
    const ny = y + Math.sin(ang) * len
    // 外发光
    ctx.strokeStyle = "rgba(255,90,20,0.55)"
    ctx.lineWidth = w * 3
    ctx.beginPath()
    ctx.moveTo(x, y)
    ctx.lineTo(nx, ny)
    ctx.stroke()
    // 亮芯
    ctx.strokeStyle = "rgba(255,220,140,0.95)"
    ctx.lineWidth = w
    ctx.beginPath()
    ctx.moveTo(x, y)
    ctx.lineTo(nx, ny)
    ctx.stroke()
    const branches = 2 + Math.floor(Math.random() * 2)
    for (let b = 0; b < branches; b++) {
      drawCrack(
        nx,
        ny,
        len * (0.5 + Math.random() * 0.4),
        ang + (Math.random() - 0.5) * 1.6,
        w * 0.7
      )
    }
  }
  for (let i = 0; i < 9; i++) {
    drawCrack(
      Math.random() * W,
      Math.random() * H,
      40 + Math.random() * 50,
      Math.random() * Math.PI * 2,
      4 + Math.random() * 3
    )
  }
  return toTexture(cv)
}

/** 霓虹：蓝紫底 + 青/品红发光横向灯带 */
function buildNeonStrip(
  cv: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
  def: ReturnType<typeof getTableSkin>
): Texture {
  baseClothGradient(ctx, def.clothColor, def.clothColor2)
  ctx.shadowBlur = 18
  const bands = ["#6a3cff", "#13e6ff", "#b45cff", "#13e6ff", "#6a3cff"]
  for (let i = 0; i < bands.length; i++) {
    const y = ((i + 0.5) / bands.length) * H
    ctx.shadowColor = bands[i]
    ctx.strokeStyle = bands[i]
    ctx.lineWidth = 8
    ctx.beginPath()
    ctx.moveTo(0, y)
    ctx.lineTo(W, y + (i % 2 ? 24 : -24))
    ctx.stroke()
  }
  ctx.shadowBlur = 0
  // 散点辉光
  for (let i = 0; i < 40; i++) {
    const x = Math.random() * W
    const y = Math.random() * H
    const r = 2 + Math.random() * 4
    const g = ctx.createRadialGradient(x, y, 0, x, y, r * 3)
    g.addColorStop(0, "rgba(120,200,255,0.8)")
    g.addColorStop(1, "rgba(120,200,255,0)")
    ctx.fillStyle = g
    ctx.beginPath()
    ctx.arc(x, y, r * 3, 0, Math.PI * 2)
    ctx.fill()
  }
  return toTexture(cv)
}

/** 朱红鎏金：红黑台呢 + 金色云纹 */
function buildCloud(
  cv: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
  def: ReturnType<typeof getTableSkin>
): Texture {
  baseClothGradient(ctx, def.clothColor, def.clothColor2)
  // 鎏金云纹（祥云卷曲）
  ctx.strokeStyle = "rgba(217,162,58,0.8)"
  ctx.lineWidth = 5
  ctx.shadowColor = "rgba(240,200,96,0.6)"
  ctx.shadowBlur = 10
  for (let i = 0; i < 6; i++) {
    const cx = (i * 97) % W
    const cy = (i * 173) % H
    ctx.beginPath()
    ctx.moveTo(cx - 40, cy)
    ctx.bezierCurveTo(cx - 40, cy - 28, cx + 10, cy - 28, cx + 10, cy)
    ctx.bezierCurveTo(cx + 10, cy + 22, cx + 46, cy + 22, cx + 46, cy)
    ctx.stroke()
  }
  ctx.shadowBlur = 0
  // 细金点
  for (let i = 0; i < 60; i++) {
    ctx.fillStyle = "rgba(240,200,96,0.5)"
    ctx.beginPath()
    ctx.arc(Math.random() * W, Math.random() * H, 1.5, 0, Math.PI * 2)
    ctx.fill()
  }
  return toTexture(cv)
}

/** 全息银：银灰底 + 彩虹薄膜干涉条纹 */
function buildHolo(
  cv: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
  def: ReturnType<typeof getTableSkin>
): Texture {
  baseClothGradient(ctx, def.clothColor, def.clothColor2)
  // 彩虹薄膜：随角度变化的色相条带
  const bands = 24
  for (let i = 0; i < bands; i++) {
    const t = i / bands
    const hue = (t * 360 + 200) % 360
    ctx.globalAlpha = 0.22
    ctx.fillStyle = `hsl(${hue}, 80%, 65%)`
    ctx.fillRect(0, (i / bands) * H, W, H / bands + 1)
  }
  ctx.globalAlpha = 1
  // 斜向高光增强金属感
  ctx.save()
  ctx.globalAlpha = 0.15
  ctx.strokeStyle = "#ffffff"
  ctx.lineWidth = 20
  for (let i = -1; i < 5; i++) {
    ctx.beginPath()
    ctx.moveTo(i * 130, 0)
    ctx.lineTo(i * 130 + H * 0.4, H)
    ctx.stroke()
  }
  ctx.restore()
  return toTexture(cv)
}

/** 粉色糖果：粉白渐变 + 果冻高光泡泡 */
function buildCandy(
  cv: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
  def: ReturnType<typeof getTableSkin>
): Texture {
  baseClothGradient(ctx, def.clothColor, def.clothColor2)
  // 果冻质感：柔和圆形高光
  for (let i = 0; i < 26; i++) {
    const x = Math.random() * W
    const y = Math.random() * H
    const r = 14 + Math.random() * 36
    const g = ctx.createRadialGradient(x - r * 0.3, y - r * 0.3, 1, x, y, r)
    g.addColorStop(0, "rgba(255,255,255,0.6)")
    g.addColorStop(0.6, "rgba(255,200,225,0.12)")
    g.addColorStop(1, "rgba(255,200,225,0)")
    ctx.fillStyle = g
    ctx.beginPath()
    ctx.arc(x, y, r, 0, Math.PI * 2)
    ctx.fill()
  }
  return toTexture(cv)
}

// ============ 桌框贴图（含发光边） ============

function buildFrame(
  def: ReturnType<typeof getTableSkin>
): Texture {
  const cv = document.createElement("canvas")
  cv.width = 256
  cv.height = 64
  const ctx = cv.getContext("2d")!
  // 底色
  ctx.fillStyle = hex(def.frameColor)
  ctx.fillRect(0, 0, cv.width, cv.height)
  // 上下边发光条（沿桌框边缘）
  if (def.frameGlow) {
    ctx.fillStyle = hex(def.frameGlow)
    ctx.globalAlpha = 0.85
    ctx.fillRect(0, 0, cv.width, 6)
    ctx.fillRect(0, cv.height - 6, cv.width, 6)
    ctx.globalAlpha = 1
  }
  // 鎏金云纹（朱红鎏金款）
  if (def.clothTexture === "cloud") {
    ctx.strokeStyle = "rgba(240,200,96,0.7)"
    ctx.lineWidth = 3
    for (let i = 0; i < 8; i++) {
      const x = i * 32
      ctx.beginPath()
      ctx.moveTo(x, 32)
      ctx.bezierCurveTo(x, 20, x + 16, 20, x + 16, 32)
      ctx.stroke()
    }
  }
  return toTexture(cv)
}
