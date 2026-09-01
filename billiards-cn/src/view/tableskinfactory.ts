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

/** 取桌框贴图（木纹或发光边纹理）。
 * v1.3.61：原先无发光主题直接返回 null（桌框就是一块纯色，GLTF 的 wood
 * 材质同样无贴图），现在统一返回程序化木纹 / 发光边纹理。 */
export function getFrameTexture(tableSkinId: string): Texture | null {
  if (frameCache.has(tableSkinId)) return frameCache.get(tableSkinId)!
  const def = getTableSkin(tableSkinId)
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

/**
 * 基础台呢底纹（v1.3.61 重做）。
 *
 * 旧版是「线性渐变 + 4000 个噪点」：渐变沿对角线铺设，而台呢贴图是
 * RepeatWrapping 平铺的，接缝处颜色突变；噪点在 512² 画布上每 6~7px 才一个，
 * 放大到桌面上更像溅上去的脏点而不是绒毛。
 *
 * 新版改为**周期函数逐像素生成**：
 * - 几组不同频率 / 方向的正弦波叠加出大尺度明暗斑（灯光不均、绒毛倒伏）
 *   与小尺度编织起伏，函数本身以画布为周期 → 平铺严格无缝；
 * - 噪点密度提高 3.5 倍、尺寸压到 1px、透明度随机 —— 1px 噪点无结构性，
 *   相邻平铺单元统计特性相同，接缝不可辨。
 */
function baseClothGradient(
  ctx: CanvasRenderingContext2D,
  c1: number,
  c2: number
): void {
  const r1 = (c1 >> 16) & 255
  const g1 = (c1 >> 8) & 255
  const b1 = c1 & 255
  const r2 = (c2 >> 16) & 255
  const g2 = (c2 >> 8) & 255
  const b2 = c2 & 255
  const TAU = Math.PI * 2
  const img = ctx.createImageData(W, H)
  const d = img.data
  for (let y = 0; y < H; y++) {
    const v = y / H
    for (let x = 0; x < W; x++) {
      const u = x / W
      const n =
        0.5 +
        0.13 * Math.sin(TAU * (u + v * 2) + 0.7) +
        0.1 * Math.sin(TAU * (u * 2 - v) + 2.1) +
        0.05 * Math.sin(TAU * (u * 9 + v * 7)) +
        0.04 * Math.sin(TAU * (u * 6 - v * 11) + 1.3)
      const t = n < 0 ? 0 : n > 1 ? 1 : n
      const i = (y * W + x) * 4
      d[i] = r1 + (r2 - r1) * t
      d[i + 1] = g1 + (g2 - g1) * t
      d[i + 2] = b1 + (b2 - b1) * t
      d[i + 3] = 255
    }
  }
  ctx.putImageData(img, 0, 0)
  // 绒毛细噪点
  for (let i = 0; i < 14000; i++) {
    ctx.globalAlpha = 0.02 + Math.random() * 0.05
    ctx.fillStyle = Math.random() > 0.5 ? "#ffffff" : "#000000"
    ctx.fillRect(Math.random() * W, Math.random() * H, 1, 1)
  }
  ctx.globalAlpha = 1
}

/**
 * v1.3.61：菱格压花暗纹（velvet，经典 5 款用）。
 *
 * 经典主题原先 clothTexture 为 "none"：p8 / snooker 模型的台呢材质本身
 * 没有任何贴图，只剩一块纯色 —— 这就是「台球桌太素」的主因。
 * velvet 在绒面底纹上叠加两组正交斜线构成的菱格暗纹（透明度 0.05），
 * 远看仍是一块干净的呢面，近看有织物压花的细节。
 * 斜线族 x±y = k·step 的周期 step 整除画布宽高 → 平铺无缝。
 */
function buildVelvet(
  cv: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
  def: ReturnType<typeof getTableSkin>
): Texture {
  baseClothGradient(ctx, def.clothColor, def.clothColor2)
  ctx.save()
  ctx.globalAlpha = 0.05
  ctx.strokeStyle = "#ffffff"
  ctx.lineWidth = 2
  const step = 64
  for (let i = -H; i < W + H; i += step) {
    ctx.beginPath()
    ctx.moveTo(i, 0)
    ctx.lineTo(i + H, H)
    ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(i, 0)
    ctx.lineTo(i - H, H)
    ctx.stroke()
  }
  ctx.restore()
  return toTexture(cv)
}

/**
 * v1.3.61：金色菱格网纹（gild，翡翠鎏金用）。
 * 与 velvet 同构的斜线族，但线更亮、交点处点缀金铆钉，华丽度拉满。
 */
function buildGild(
  cv: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
  def: ReturnType<typeof getTableSkin>
): Texture {
  baseClothGradient(ctx, def.clothColor, def.clothColor2)
  ctx.save()
  ctx.strokeStyle = "rgba(217,162,58,0.5)"
  ctx.lineWidth = 2.5
  const step = 96
  for (let i = -H; i < W + H; i += step) {
    ctx.beginPath()
    ctx.moveTo(i, 0)
    ctx.lineTo(i + H, H)
    ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(i, 0)
    ctx.lineTo(i - H, H)
    ctx.stroke()
  }
  ctx.restore()
  ctx.fillStyle = "rgba(240,200,96,0.75)"
  for (let gy = 0; gy < H; gy += step) {
    for (let gx = 0; gx < W; gx += step) {
      ctx.beginPath()
      ctx.arc(gx, gy, 3, 0, Math.PI * 2)
      ctx.fill()
    }
  }
  return toTexture(cv)
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
    case "velvet":
      return buildVelvet(cv, ctx, def)
    case "gild":
      return buildGild(cv, ctx, def)
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
  // v1.3.61：木纹拉丝（无发光主题）。GLTF 的 wood 材质没有贴图，纯色框
  // 看起来像一块塑料。横向拉丝：每条纹理线是「正弦扰动 + 深/浅交替」，
  // 正弦取整数周期 → 水平方向平铺无缝；线不越过画布上下边界 → 垂直方向
  // 在 UV 0..1 采样内也完整。发光主题跳过木纹（发光框是金属/烤漆质感）。
  if (!def.frameGlow) {
    const TAU = Math.PI * 2
    for (let i = 0; i < 46; i++) {
      const y0 = 5 + Math.random() * (cv.height - 10)
      const amp = 0.8 + Math.random() * 2.2
      const freq = 1 + (i % 3)
      const phase = Math.random() * TAU
      const alpha = 0.05 + Math.random() * 0.09
      ctx.strokeStyle =
        i % 2
          ? `rgba(0,0,0,${alpha.toFixed(3)})`
          : `rgba(255,255,255,${(alpha * 0.7).toFixed(3)})`
      ctx.lineWidth = 0.8 + Math.random() * 1.4
      ctx.beginPath()
      for (let x = 0; x <= cv.width; x += 8) {
        const y = y0 + Math.sin((x / cv.width) * TAU * freq + phase) * amp
        if (x === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      }
      ctx.stroke()
    }
    // 节疤：2 个柔和的径向暗斑（年轮密集处）
    for (let i = 0; i < 2; i++) {
      const kx = 30 + Math.random() * (cv.width - 60)
      const ky = 12 + Math.random() * (cv.height - 24)
      const kr = 8 + Math.random() * 10
      const knot = ctx.createRadialGradient(kx, ky, 1, kx, ky, kr)
      knot.addColorStop(0, "rgba(0,0,0,0.22)")
      knot.addColorStop(0.7, "rgba(0,0,0,0.08)")
      knot.addColorStop(1, "rgba(0,0,0,0)")
      ctx.fillStyle = knot
      ctx.beginPath()
      ctx.arc(kx, ky, kr, 0, Math.PI * 2)
      ctx.fill()
    }
  }
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
