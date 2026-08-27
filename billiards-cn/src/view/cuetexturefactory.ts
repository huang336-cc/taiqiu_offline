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
    case "moyunlongque":
      return buildMoyunlongque()
    case "qingzhutingfeng":
      return buildQingzhutingfeng()
    case "fengyuliujin":
      return buildFengyuliujin()
    case "qianliyanshan":
      return buildQianliyanshan()
    case "xinghedanmang":
      return buildXinghedanmang()
    case "nihongsuguang":
      return buildNihongsuguang()
    case "xukonglilie":
      return buildXukonglilie()
    case "youciyeying":
      return buildYouciyeying()
    case "jinhuofengfeng":
      return buildJinhuofengfeng()
    case "yuntianghuanmeng":
      return buildYuntianghuanmeng()
    case "bingjingxuepo":
      return buildBingjingxuepo()
    case "wanxiangquanzhang":
      return buildWanxiangquanzhang()
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

/** 墨云龙阙：乌墨黑杆身，暗金龙鳞云纹，击球微光流转 */
function buildMoyunlongque(): Texture {
  const { cv, ctx } = newCanvas()
  const g = ctx.createLinearGradient(0, 0, 0, H)
  g.addColorStop(0, "#211d14")
  g.addColorStop(0.5, "#100d08")
  g.addColorStop(1, "#080603")
  ctx.fillStyle = g
  ctx.fillRect(0, 0, W, H)
  // 暗金龙鳞
  drawScales(ctx, 26, 8, (r, c) => (r + c) % 2 ? "#5a4a1e" : "#3a2f12", "rgba(20,16,4,0.6)")
  // 云纹曲线
  ctx.strokeStyle = "rgba(201,162,74,0.30)"
  ctx.lineWidth = 3
  ctx.beginPath()
  ctx.moveTo(0, H * 0.28)
  ctx.bezierCurveTo(W * 0.4, H * 0.22, W * 0.6, H * 0.38, W, H * 0.3)
  ctx.moveTo(0, H * 0.7)
  ctx.bezierCurveTo(W * 0.5, H * 0.6, W * 0.7, H * 0.8, W, H * 0.7)
  ctx.stroke()
  // 击球微光流转（暗金斜流光）
  ctx.strokeStyle = "rgba(230,200,120,0.45)"
  ctx.lineWidth = 5
  ctx.shadowColor = "#e6c878"
  ctx.shadowBlur = 10
  for (let i = -1; i < 4; i++) {
    ctx.beginPath()
    ctx.moveTo(i * 90, 0)
    ctx.lineTo(i * 90 + H * 0.3, H)
    ctx.stroke()
  }
  ctx.shadowBlur = 0
  ctx.fillStyle = "#2a2410"
  ctx.fillRect(0, H - 60, W, 60)
  return toTexture(cv)
}

/** 青竹听风：青竹节纹理，淡银线条，素雅国风 */
function buildQingzhutingfeng(): Texture {
  const { cv, ctx } = newCanvas()
  const g = ctx.createLinearGradient(0, 0, 0, H)
  g.addColorStop(0, "#bfe3a0")
  g.addColorStop(0.5, "#6fb04a")
  g.addColorStop(1, "#3f7d2f")
  ctx.fillStyle = g
  ctx.fillRect(0, 0, W, H)
  // 竹节环纹
  ctx.strokeStyle = "rgba(30,70,20,0.75)"
  ctx.lineWidth = 11
  for (let y = 0; y < H; y += 120) {
    ctx.beginPath()
    ctx.moveTo(0, y)
    ctx.lineTo(W, y)
    ctx.stroke()
  }
  // 淡银竖线条
  ctx.strokeStyle = "rgba(225,245,220,0.5)"
  ctx.lineWidth = 1.5
  for (let i = 10; i < W; i += 22) {
    ctx.beginPath()
    ctx.moveTo(i, 0)
    ctx.lineTo(i, H)
    ctx.stroke()
  }
  ctx.fillStyle = "#356b27"
  ctx.fillRect(0, H - 60, W, 60)
  return toTexture(cv)
}

/** 凤羽鎏金：黑檀底色，幻彩贝母凤凰羽翼，鎏金环饰 */
function buildFengyuliujin(): Texture {
  const { cv, ctx } = newCanvas()
  const g = ctx.createLinearGradient(0, 0, 0, H)
  g.addColorStop(0, "#1a1410")
  g.addColorStop(0.5, "#0e0a07")
  g.addColorStop(1, "#060403")
  ctx.fillStyle = g
  ctx.fillRect(0, 0, W, H)
  // 幻彩贝母羽翼（青蓝紫渐变羽片）
  for (let r = 0; r < 10; r++) {
    for (let c = 0; c < 4; c++) {
      const x = 30 + c * 60 + (r % 2 ? 30 : 0)
      const y = 50 + r * 100
      const grd = ctx.createRadialGradient(x, y, 2, x, y, 34)
      const hue = (r * 36 + c * 60) % 360
      grd.addColorStop(0, `hsla(${hue},70%,75%,0.85)`)
      grd.addColorStop(1, `hsla(${hue},70%,55%,0)`)
      ctx.fillStyle = grd
      ctx.beginPath()
      ctx.ellipse(x, y, 22, 34, Math.PI / 5, 0, Math.PI * 2)
      ctx.fill()
    }
  }
  // 鎏金环饰
  ctx.fillStyle = "#caa24a"
  ctx.fillRect(0, H * 0.18, W, H * 0.04)
  ctx.fillRect(0, H * 0.6, W, H * 0.04)
  ctx.fillStyle = "#2a2010"
  ctx.fillRect(0, H - 60, W, 60)
  return toTexture(cv)
}

/** 千里砚山：青灰石砚质感，山水暗纹，水墨国风 */
function buildQianliyanshan(): Texture {
  const { cv, ctx } = newCanvas()
  const g = ctx.createLinearGradient(0, 0, 0, H)
  g.addColorStop(0, "#8a99a0")
  g.addColorStop(0.5, "#5d6b72")
  g.addColorStop(1, "#39474d")
  ctx.fillStyle = g
  ctx.fillRect(0, 0, W, H)
  // 山水墨纹（远山轮廓）
  ctx.strokeStyle = "rgba(30,40,45,0.55)"
  ctx.lineWidth = 6
  ctx.beginPath()
  ctx.moveTo(0, H * 0.55)
  ctx.lineTo(W * 0.25, H * 0.4)
  ctx.lineTo(W * 0.5, H * 0.55)
  ctx.lineTo(W * 0.75, H * 0.35)
  ctx.lineTo(W, H * 0.52)
  ctx.stroke()
  ctx.strokeStyle = "rgba(20,28,32,0.4)"
  ctx.beginPath()
  ctx.moveTo(0, H * 0.75)
  ctx.lineTo(W * 0.3, H * 0.62)
  ctx.lineTo(W * 0.6, H * 0.76)
  ctx.lineTo(W, H * 0.64)
  ctx.stroke()
  // 石砚磨砂颗粒
  for (let i = 0; i < 300; i++) {
    ctx.fillStyle = `rgba(255,255,255,${Math.random() * 0.05})`
    ctx.fillRect(Math.random() * W, Math.random() * H, 1.5, 1.5)
  }
  ctx.fillStyle = "#2f3a40"
  ctx.fillRect(0, H - 60, W, 60)
  return toTexture(cv)
}

/** 星核暗芒：深空黑，星尘颗粒 + 青蓝电路纹，击球星芒粒子 */
function buildXinghedanmang(): Texture {
  const { cv, ctx } = newCanvas()
  const g = ctx.createLinearGradient(0, 0, 0, H)
  g.addColorStop(0, "#1b2a4a")
  g.addColorStop(0.5, "#0a1124")
  g.addColorStop(1, "#05060a")
  ctx.fillStyle = g
  ctx.fillRect(0, 0, W, H)
  // 星尘颗粒
  for (let i = 0; i < 220; i++) {
    const a = Math.random() * 0.8 + 0.2
    ctx.fillStyle = `rgba(180,210,255,${a})`
    const s = Math.random() * 2 + 0.5
    ctx.fillRect(Math.random() * W, Math.random() * H, s, s)
  }
  // 青蓝电路纹
  ctx.strokeStyle = "rgba(57,198,255,0.6)"
  ctx.lineWidth = 2
  ctx.shadowColor = "#39c6ff"
  ctx.shadowBlur = 6
  for (let i = 0; i < 8; i++) {
    let x = Math.random() * W
    let y = Math.random() * H
    ctx.beginPath()
    ctx.moveTo(x, y)
    for (let j = 0; j < 4; j++) {
      x += (Math.random() > 0.5 ? 1 : -1) * (20 + Math.random() * 30)
      y += (Math.random() > 0.5 ? 1 : -1) * (20 + Math.random() * 30)
      ctx.lineTo(x, y)
    }
    ctx.stroke()
  }
  ctx.shadowBlur = 0
  ctx.fillStyle = "#0a1226"
  ctx.fillRect(0, H - 60, W, 60)
  return toTexture(cv)
}

/** 霓虹溯光：深紫杆身，粉蓝螺旋霓虹光带（替代原霓虹脉冲） */
function buildNihongsuguang(): Texture {
  const { cv, ctx } = newCanvas()
  const g = ctx.createLinearGradient(0, 0, 0, H)
  g.addColorStop(0, "#3a1d6e")
  g.addColorStop(0.5, "#241046")
  g.addColorStop(1, "#160a2e")
  ctx.fillStyle = g
  ctx.fillRect(0, 0, W, H)
  // 粉蓝螺旋光带
  ctx.shadowColor = "#ff5fd0"
  ctx.shadowBlur = 12
  for (let i = 0; i < 5; i++) {
    const yBase = (i + 0.5) * (H / 5)
    ctx.strokeStyle = i % 2 ? "rgba(255,123,224,0.9)" : "rgba(90,200,255,0.9)"
    ctx.lineWidth = 5
    ctx.beginPath()
    for (let t = 0; t <= 1; t += 0.02) {
      const x = W / 2 + Math.sin(t * Math.PI * 3 + i) * (W * 0.4)
      const y = yBase + (t - 0.5) * 40
      t === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)
    }
    ctx.stroke()
  }
  ctx.shadowBlur = 0
  ctx.fillStyle = "#1a0d33"
  ctx.fillRect(0, H - 60, W, 60)
  return toTexture(cv)
}

/** 虚空裂隙：纯黑哑光，幽紫发光裂隙纹路 */
function buildXukonglilie(): Texture {
  const { cv, ctx } = newCanvas()
  ctx.fillStyle = "#050507"
  ctx.fillRect(0, 0, W, H)
  // 幽紫发光裂隙（锯齿发光纹）
  ctx.strokeStyle = "rgba(155,92,255,0.85)"
  ctx.lineWidth = 3
  ctx.shadowColor = "#9b5cff"
  ctx.shadowBlur = 12
  for (let i = 0; i < 5; i++) {
    let x = Math.random() * W * 0.3
    let y = Math.random() * H
    ctx.beginPath()
    ctx.moveTo(x, y)
    for (let j = 0; j < 12; j++) {
      x += 18 + Math.random() * 14
      y += (Math.random() - 0.5) * 60
      ctx.lineTo(x, y)
    }
    ctx.stroke()
  }
  ctx.shadowBlur = 0
  ctx.fillStyle = "#0a0810"
  ctx.fillRect(0, H - 60, W, 60)
  return toTexture(cv)
}

/** 幽刺夜影：炭黑尖刺纹理，贝母幻彩珠光，虎纹握把 */
function buildYouciyeying(): Texture {
  const { cv, ctx } = newCanvas()
  const g = ctx.createLinearGradient(0, 0, 0, H)
  g.addColorStop(0, "#3a3a42")
  g.addColorStop(0.5, "#1c1c22")
  g.addColorStop(1, "#0d0d10")
  ctx.fillStyle = g
  ctx.fillRect(0, 0, W, H)
  // 贝母幻彩珠光（暗紫蓝渐变斑点）
  for (let i = 0; i < 14; i++) {
    const x = (i * 61) % W
    const y = (i * 131) % H
    const grd = ctx.createRadialGradient(x, y, 2, x, y, 26)
    grd.addColorStop(0, "rgba(184,160,216,0.5)")
    grd.addColorStop(1, "rgba(184,160,216,0)")
    ctx.fillStyle = grd
    ctx.beginPath()
    ctx.arc(x, y, 26, 0, Math.PI * 2)
    ctx.fill()
  }
  // 炭黑尖刺（向上三角）
  ctx.fillStyle = "rgba(10,10,14,0.85)"
  for (let y = 20; y < H - 70; y += 70) {
    for (let x = 0; x < W; x += 28) {
      ctx.beginPath()
      ctx.moveTo(x, y + 18)
      ctx.lineTo(x + 14, y)
      ctx.lineTo(x + 28, y + 18)
      ctx.closePath()
      ctx.fill()
    }
  }
  ctx.fillStyle = "#14141a"
  ctx.fillRect(0, H - 60, W, 60)
  return toTexture(cv)
}

/** 烬火焚风：黑红熔岩裂纹，橙红光效，大力击球火光迸发 */
function buildJinhuofengfeng(): Texture {
  const { cv, ctx } = newCanvas()
  const g = ctx.createLinearGradient(0, 0, 0, H)
  g.addColorStop(0, "#1a0805")
  g.addColorStop(0.5, "#3a0f06")
  g.addColorStop(1, "#100402")
  ctx.fillStyle = g
  ctx.fillRect(0, 0, W, H)
  // 熔岩裂纹（橙红发光）
  ctx.strokeStyle = "rgba(255,122,31,0.9)"
  ctx.lineWidth = 3
  ctx.shadowColor = "#ff7a1f"
  ctx.shadowBlur = 10
  for (let i = 0; i < 7; i++) {
    let x = Math.random() * W * 0.3
    let y = Math.random() * H
    ctx.beginPath()
    ctx.moveTo(x, y)
    for (let j = 0; j < 10; j++) {
      x += 20 + Math.random() * 16
      y += (Math.random() - 0.5) * 70
      ctx.lineTo(x, y)
    }
    ctx.stroke()
  }
  // 火光迸发点
  for (let i = 0; i < 16; i++) {
    const x = Math.random() * W
    const y = Math.random() * H
    const grd = ctx.createRadialGradient(x, y, 1, x, y, 16)
    grd.addColorStop(0, "rgba(255,220,120,0.9)")
    grd.addColorStop(1, "rgba(255,90,42,0)")
    ctx.fillStyle = grd
    ctx.beginPath()
    ctx.arc(x, y, 16, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.shadowBlur = 0
  ctx.fillStyle = "#1a0805"
  ctx.fillRect(0, H - 60, W, 60)
  return toTexture(cv)
}

/** 云糖幻梦：粉白果冻质感，云朵暗纹，柔和治愈 */
function buildYuntianghuanmeng(): Texture {
  const { cv, ctx } = newCanvas()
  const g = ctx.createLinearGradient(0, 0, 0, H)
  g.addColorStop(0, "#ffe3ef")
  g.addColorStop(0.5, "#ffd0e2")
  g.addColorStop(1, "#e9d6ff")
  ctx.fillStyle = g
  ctx.fillRect(0, 0, W, H)
  // 云朵暗纹
  ctx.fillStyle = "rgba(255,255,255,0.55)"
  for (let r = 0; r < 9; r++) {
    for (let c = 0; c < 3; c++) {
      const x = 50 + c * 80 + (r % 2 ? 40 : 0)
      const y = 60 + r * 110
      ctx.beginPath()
      ctx.arc(x - 16, y, 22, 0, Math.PI * 2)
      ctx.arc(x + 16, y, 22, 0, Math.PI * 2)
      ctx.arc(x, y - 14, 26, 0, Math.PI * 2)
      ctx.fill()
    }
  }
  // 柔和珠光
  for (let i = 0; i < 12; i++) {
    const x = (i * 71) % W
    const y = (i * 151) % H
    const grd = ctx.createRadialGradient(x, y, 1, x, y, 20)
    grd.addColorStop(0, "rgba(255,255,255,0.6)")
    grd.addColorStop(1, "rgba(255,255,255,0)")
    ctx.fillStyle = grd
    ctx.beginPath()
    ctx.arc(x, y, 20, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.fillStyle = "#f3c9de"
  ctx.fillRect(0, H - 60, W, 60)
  return toTexture(cv)
}

/** 冰晶雪魄：透白冰晶，冰棱纹路，冷光边缘 */
function buildBingjingxuepo(): Texture {
  const { cv, ctx } = newCanvas()
  const g = ctx.createLinearGradient(0, 0, 0, H)
  g.addColorStop(0, "#eaf6ff")
  g.addColorStop(0.5, "#cfe8f7")
  g.addColorStop(1, "#9fc6e0")
  ctx.fillStyle = g
  ctx.fillRect(0, 0, W, H)
  // 冰棱六角纹
  ctx.strokeStyle = "rgba(120,180,220,0.7)"
  ctx.lineWidth = 2
  const hex = (cx: number, cy: number, r: number) => {
    ctx.beginPath()
    for (let k = 0; k < 6; k++) {
      const a = (Math.PI / 3) * k
      const x = cx + r * Math.cos(a)
      const y = cy + r * Math.sin(a)
      k === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)
    }
    ctx.closePath()
    ctx.stroke()
  }
  for (let r = 0; r < H; r += 130) {
    hex(W * 0.3, r + 40, 30)
    hex(W * 0.7, r + 100, 30)
  }
  // 冷光边缘
  ctx.strokeStyle = "rgba(207,234,255,0.9)"
  ctx.lineWidth = 4
  ctx.strokeRect(3, 3, W - 6, H - 6)
  ctx.fillStyle = "#b8d8ee"
  ctx.fillRect(0, H - 60, W, 60)
  return toTexture(cv)
}

/** 万象权杖：黑金欧式雕花，鎏金浮雕，击球金色拖尾特效 */
function buildWanxiangquanzhang(): Texture {
  const { cv, ctx } = newCanvas()
  const g = ctx.createLinearGradient(0, 0, 0, H)
  g.addColorStop(0, "#1a160d")
  g.addColorStop(0.5, "#0e0b06")
  g.addColorStop(1, "#060403")
  ctx.fillStyle = g
  ctx.fillRect(0, 0, W, H)
  // 欧式卷草雕花（鎏金）
  ctx.strokeStyle = "rgba(232,200,120,0.85)"
  ctx.lineWidth = 3
  ctx.shadowColor = "#e8c878"
  ctx.shadowBlur = 6
  for (let r = 0; r < 10; r++) {
    const y = 40 + r * 100
    ctx.beginPath()
    ctx.moveTo(10, y)
    ctx.bezierCurveTo(W * 0.3, y - 40, W * 0.5, y + 40, W * 0.7, y - 20)
    ctx.bezierCurveTo(W * 0.85, y - 40, W - 10, y + 10, W - 10, y)
    ctx.stroke()
  }
  // 鎏金浮雕环 + 金色拖尾
  ctx.fillStyle = "#caa24a"
  ctx.fillRect(0, H * 0.3, W, H * 0.035)
  ctx.fillRect(0, H * 0.66, W, H * 0.035)
  ctx.strokeStyle = "rgba(255,225,150,0.6)"
  ctx.lineWidth = 4
  for (let i = -1; i < 3; i++) {
    ctx.beginPath()
    ctx.moveTo(i * 100, 0)
    ctx.lineTo(i * 100 + H * 0.25, H)
    ctx.stroke()
  }
  ctx.shadowBlur = 0
  ctx.fillStyle = "#2a2010"
  ctx.fillRect(0, H - 60, W, 60)
  return toTexture(cv)
}
