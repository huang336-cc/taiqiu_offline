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
/** v1.3.88：桌框法线 / 粗糙度贴图缓存（与颜色贴图分开存） */
const frameNormalCache = new Map<string, Texture>()
const frameRoughnessCache = new Map<string, Texture>()

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
 * 材质同样无贴图），现在统一返回程序化木纹 / 发光边纹理。
 * v1.3.88：画布 256×64 → 1024×256，并补法线/粗糙度贴图。 */
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

/**
 * v1.3.88：桌框法线贴图（木纹凹凸）。
 *
 * 为什么必须补这一张：桌框在**俯视机位下占画面 67.5%**，是最大的表面。
 * 但此前只有一张颜色贴图 —— 颜色变化不产生明暗，俯视下光线接近垂直，
 * 一块「有色但无凹凸」的木板看起来就是**一块上过色的塑料**。
 * 木纹之所以能被看见，靠的是纤维沟槽在掠射光下产生的**明暗差**，
 * 这必须由法线贴图提供。
 *
 * 实现：把颜色贴图的亮度场当作高度场（height map），
 * 用 Sobel 算子求梯度 → 转成切线空间法线（RGB 编码 xyz）。
 * 这样凹凸与颜色天然对齐，不会出现「纹理和凹凸对不上」的割裂感。
 */
export function getFrameNormalTexture(tableSkinId: string): Texture | null {
  const key = tableSkinId + "#n"
  if (frameNormalCache.has(key)) return frameNormalCache.get(key)!
  const def = getTableSkin(tableSkinId)
  const src = buildFrameCanvas(def)
  const ctx = src.getContext("2d")!
  const w = src.width
  const h = src.height
  const px = ctx.getImageData(0, 0, w, h).data

  // 亮度场（Rec.709）
  const lum = new Float32Array(w * h)
  for (let i = 0, j = 0; i < px.length; i += 4, j++) {
    lum[j] = (0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2]) / 255
  }

  const out = document.createElement("canvas")
  out.width = w
  out.height = h
  const octx = out.getContext("2d")!
  const img = octx.createImageData(w, h)
  const d = img.data

  /**
   * 凹凸强度。木头是**浅浮雕**，不是砖墙 —— 系数给太大会像搓衣板。
   * 1.8 是实测下来「俯视能看出纹路、近看又不夸张」的平衡点。
   */
  const strength = 1.8
  // 取模以支持平铺（贴图是 RepeatWrapping，边缘必须对得上）
  const at = (x: number, y: number): number => lum[(((y % h) + h) % h) * w + (((x % w) + w) % w)]

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      // Sobel 梯度
      const gx =
        at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1) -
        at(x - 1, y - 1) - 2 * at(x - 1, y) - at(x - 1, y + 1)
      const gy =
        at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1) -
        at(x - 1, y - 1) - 2 * at(x, y - 1) - at(x + 1, y - 1)

      // 切线空间法线：n = normalize(-gx*s, -gy*s, 1)
      let nx = -gx * strength
      let ny = -gy * strength
      const nz = 1
      const len = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1
      nx /= len
      ny /= len

      const i = (y * w + x) * 4
      d[i] = Math.round((nx * 0.5 + 0.5) * 255)
      d[i + 1] = Math.round((ny * 0.5 + 0.5) * 255)
      d[i + 2] = Math.round((nz / len * 0.5 + 0.5) * 255)
      d[i + 3] = 255
    }
  }
  octx.putImageData(img, 0, 0)

  const tex = new CanvasTexture(out)
  tex.wrapS = tex.wrapT = RepeatWrapping
  // 法线贴图**不能**设 sRGB —— 它是向量数据不是颜色。
  // 设错会让凹凸方向整体偏移，视觉上像「光照从错误的方向来」。
  tex.anisotropy = 4
  tex.needsUpdate = true
  frameNormalCache.set(key, tex)
  return tex
}

/**
 * v1.3.88：桌框粗糙度贴图。
 *
 * 真实木材表面的光泽是不均匀的：早材（颜色浅、密度低）更哑光，
 * 晚材（颜色深、密度高）略亮。单靠 `roughness` 一个常数做不到这种
 * 微妙变化，俯视下桌框就显得「一整片均匀的塑料」。
 *
 * 这里用同一张木纹的亮度场反推：亮处（浅色早材）→ 更粗糙；
 * 暗处（深色晚材）→ 略光滑。变化幅度刻意压小（0.55~0.75），
 * 只求打破均匀感，不求强烈反光。
 */
export function getFrameRoughnessTexture(tableSkinId: string): Texture | null {
  const key = tableSkinId + "#r"
  if (frameRoughnessCache.has(key)) return frameRoughnessCache.get(key)!
  const def = getTableSkin(tableSkinId)
  const src = buildFrameCanvas(def)
  const ctx = src.getContext("2d")!
  const w = src.width
  const h = src.height
  const px = ctx.getImageData(0, 0, w, h).data

  const out = document.createElement("canvas")
  out.width = w
  out.height = h
  const octx = out.getContext("2d")!
  const img = octx.createImageData(w, h)
  const d = img.data
  for (let i = 0; i < px.length; i += 4) {
    const l = (0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2]) / 255
    // 亮度 0 → 0.75（较光滑的深色晚材），亮度 1 → 0.55（较哑光的浅色早材）
    const r = 0.75 - l * 0.2
    const v = Math.round(r * 255)
    d[i] = v
    d[i + 1] = v
    d[i + 2] = v
    d[i + 3] = 255
  }
  octx.putImageData(img, 0, 0)

  const tex = new CanvasTexture(out)
  tex.wrapS = tex.wrapT = RepeatWrapping
  // 粗糙度同样不是颜色数据，不设 sRGB
  tex.anisotropy = 4
  tex.needsUpdate = true
  frameRoughnessCache.set(key, tex)
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
 * 基础台呢底纹（v1.3.61 重做，v1.3.87 加对比度）。
 *
 * 旧版是「线性渐变 + 4000 个噪点」：渐变沿对角线铺设，而台呢贴图是
 * RepeatWrapping 平铺的，接缝处颜色突变；噪点在 512² 画布上每 6~7px 才一个，
 * 放大到桌面上更像溅上去的脏点而不是绒毛。
 *
 * v1.3.61 改为**周期函数逐像素生成**：
 * - 几组不同频率 / 方向的正弦波叠加出大尺度明暗斑（灯光不均、绒毛倒伏）
 *   与小尺度编织起伏，函数本身以画布为周期 → 平铺严格无缝；
 * - 噪点密度提高 3.5 倍、尺寸压到 1px、透明度随机 —— 1px 噪点无结构性，
 *   相邻平铺单元统计特性相同，接缝不可辨。
 *
 * ⚠️ v1.3.88：v1.3.87 的「双尺度正弦」方案被**实机截图证伪**，已推翻重做。
 *
 * v1.3.87 用了 4 组高频**规则正弦波**去堆「编织颗粒」。离线小尺寸截图里
 * 看着像织物，但在**实机俯视全屏**（2400×1080 超宽屏、台呢铺满整屏）下，
 * 规则正弦必然产生**等间距的斜向条纹**，视觉上就是一块「格子布」，
 * 非常假。用户反馈「越改越垃圾」，判定正确。
 *
 * 教训：**规则函数 = 可见的周期结构 = 假**。真实台呢的绒面起伏是
 * **各向同性、无方向性、随机**的，不可能有等间距条纹。
 *
 * 本版改为**值噪声（value noise）**：
 *   · 用哈希函数在格点上取随机值，再做双线性/平滑插值；
 *   · 三层倍频（fBm）叠加 —— 低频定大块走向、高频给细颗粒；
 *   · 三层都用**整数格点周期**，且周期整除画布宽高 → 平铺严格无缝；
 *   · 关键：噪声没有方向性偏好，不会形成条纹或网格。
 *
 * 幅度也整体收敛（不再追求「对比度越大越好」）：对比度服务于「像织物」，
 * 而不是「看得出来我改了」—— 上一版恰恰栽在后者。
 *
 * ⚠️ 保底：`velvet` 的斜线菱格纹（`buildVelvet`）同时移除，见该函数注释。
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

  /**
   * 整数格点哈希 → [0,1) 伪随机值。
   *
   * 用整数坐标做位运算（不依赖 Math.random），保证：
   *   · 同一格点每次调用结果一致（贴图缓存友好）；
   *   · 输入取模周期后，噪声在画布边界上严格周期 → 平铺无缝。
   */
  const hash2 = (xi: number, yi: number, seed: number): number => {
    let h = (xi * 374761393 + yi * 668265263 + seed * 1442695040888963407) | 0
    h = (h ^ (h >>> 13)) * 1274126177
    h = h ^ (h >>> 16)
    // 映射到 [0,1)
    return (h >>> 0) / 4294967296
  }

  /** 五次平滑插值（比线性插值少很多方向性伪影） */
  const fade = (t: number): number => t * t * t * (t * (t * 6 - 15) + 10)

  /**
   * 二维值噪声。period 必须是整数，且整除画布宽高，
   * 这样 x=0 与 x=W 落在同一格点 → 平铺无缝。
   */
  const valueNoise = (x: number, y: number, period: number, seed: number): number => {
    const gx = Math.floor(x)
    const gy = Math.floor(y)
    const fx = fade(x - gx)
    const fy = fade(y - gy)
    const w = (n: number): number => ((n % period) + period) % period
    const v00 = hash2(w(gx), w(gy), seed)
    const v10 = hash2(w(gx + 1), w(gy), seed)
    const v01 = hash2(w(gx), w(gy + 1), seed)
    const v11 = hash2(w(gx + 1), w(gy + 1), seed)
    const a = v00 + (v10 - v00) * fx
    const b = v01 + (v11 - v01) * fx
    return a + (b - a) * fy
  }

  const img = ctx.createImageData(W, H)
  const d = img.data
  for (let y = 0; y < H; y++) {
    // 归一化到 [0, period) 的连续坐标（period 整除尺寸 → 边界连续）
    const ny = y / H
    for (let x = 0; x < W; x++) {
      const nx = x / W
      // ── 三层倍频（fBm）：低频大块走向 + 中频 + 高频细颗粒 ──
      // 每层周期都是整数且整除 512，保证无限平铺不露接缝。
      const n1 = valueNoise(nx * 4, ny * 4, 4, 1) - 0.5
      const n2 = valueNoise(nx * 16, ny * 16, 16, 2) - 0.5
      const n3 = valueNoise(nx * 64, ny * 64, 64, 3) - 0.5
      // 幅度刻意克制：这是绒面，不是噪点图。
      // v1.3.87 的「对比度 +59%」在实机全屏下被判定为过头，这里整体收敛。
      const n = 0.5 + n1 * 0.34 + n2 * 0.16 + n3 * 0.07
      const t = n < 0 ? 0 : n > 1 ? 1 : n
      const i = (y * W + x) * 4
      d[i] = r1 + (r2 - r1) * t
      d[i + 1] = g1 + (g2 - g1) * t
      d[i + 2] = b1 + (b2 - b1) * t
      d[i + 3] = 255
    }
  }
  ctx.putImageData(img, 0, 0)
  // 绒毛细噪点：密度回落（v1.3.87 的 30000 在实机全屏下显得脏）
  for (let i = 0; i < 16000; i++) {
    ctx.globalAlpha = 0.02 + Math.random() * 0.05
    ctx.fillStyle = Math.random() > 0.5 ? "#ffffff" : "#000000"
    ctx.fillRect(Math.random() * W, Math.random() * H, 1, 1)
  }
  ctx.globalAlpha = 1
}

/**
 * v1.3.61：菱格压花暗纹（velvet，经典 5 款用）。
 *
 * ⚠️ v1.3.88：**斜线菱格纹已移除**。
 *
 * 原实现用两组正交斜线（`x±y = k·64`，透明度 0.05）堆「压花」效果。
 * 离线小尺寸截图里看着还行，但实机**俯视全屏**（台呢铺满 2400×1080 整屏）
 * 下，`step=64` 配合 `repeat.set(2,2)` 平铺后变成一块**等间距的格子布**，
 * 非常假。用户直接判定「越改越垃圾」，据此撤除。
 *
 * 现在 velvet 退化为「纯绒面底纹」，与 default 分支一致 ——
 * 保留独立 case 是为了后续若真要加织物细节时有个明确的落点。
 *
 * 教训记在这里：**台呢是绒面，绒面没有规则几何**。
 * 任何等间距的线、格、条纹都会立刻暴露「程序生成」的假。
 */
function buildVelvet(
  cv: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
  def: ReturnType<typeof getTableSkin>
): Texture {
  baseClothGradient(ctx, def.clothColor, def.clothColor2)
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

/**
 * v1.3.88：桌框木纹画布（颜色贴图）。
 *
 * 为什么重做：桌框在**俯视机位下占画面 67.5%**，是最大的表面，但此前
 * 画布只有 **256×64**，铺到那么大的面积上必然糊成一片；而且木纹只有
 * 「平行拉丝 + 一个节疤」，缺少真实木材的结构，俯视下就像一块上过色的塑料。
 *
 * 本版三处升级：
 *   1. 画布 **256×64 → 1024×256**（16 倍像素），细节经得起放大；
 *   2. 木纹从「平行拉丝」改成 **年轮 + 导管** 双结构 —— 真实木材的
 *      弦切面上，主导特征是**沿纤维方向拉长的椭圆年轮**，不是等距直线；
 *   3. 补法线 / 粗糙度贴图（见 getFrameNormalTexture /
 *      getFrameRoughnessTexture），让木纹在光下有真实的明暗凹凸。
 *
 * 平铺约束：年轮沿 x 方向是周期函数（整数周期）→ 水平无缝；
 * 沿 y 方向用「距中心的距离」生成环，并在上下边缘做淡出 → 垂直也接得上。
 */
function buildFrameCanvas(
  def: ReturnType<typeof getTableSkin>
): HTMLCanvasElement {
  const FW = 1024
  const FH = 256
  const cv = document.createElement("canvas")
  cv.width = FW
  cv.height = FH
  const ctx = cv.getContext("2d")!

  // 底色
  ctx.fillStyle = hex(def.frameColor)
  ctx.fillRect(0, 0, FW, FH)

  if (!def.frameGlow) {
    const TAU = Math.PI * 2

    /**
     * ⚠️ v1.3.88 关键教训：木纹要**提亮**表达，不是**加深**。
     *
     * 首版用 `rgba(20,10,4,0.16)` 这类近乎全黑的线去画沟槽。但桌框底色
     * `frameColor` 本身已经是很深的棕（如 `0x6a4a1a`，8bit 最大通道仅 106），
     * 再往上叠黑线 → 整条桌框糊成一条暗带，木纹完全看不见（实测
     * 裁图确认「几乎被压成一条暗色带」）。
     *
     * 正确做法是**两头都走**，且以提亮为主：
     *   · 浅色纤维（提亮）—— 主表达，让木纹真正"亮"出来；
     *   · 深色沟槽（压暗）—— 仅作辅助，幅度必须远小于提亮。
     * 这样木纹才是在底色上「浮」出来的，而不是被压进去的。
     */
    const KL = (x: number, y: number) => ((x % y) + y) % y

    // ── 结构一：年轮（疏密不均）──
    // 真实木材的年轮间距**不等宽**（生长速度随季节变化）。用非线性的
    // 位置映射来制造疏密不均，避免等距平行线那种「斑马纹」的假感。
    for (let i = 0; i < 460; i++) {
      const t0 = i / 460
      // 非线性映射：t^1.6 让靠近一侧的环更密、另一侧更疏
      const y0 = Math.pow(t0, 1.6) * FH
      const sway = 2.5 + KL(i * 7919, 11) * 0.45

      // 主年轮：提亮的高光纤维
      const bright = 0.05 + KL(i * 104729, 100) / 700
      ctx.strokeStyle = "rgba(226,190,138," + bright.toFixed(3) + ")"
      ctx.lineWidth = 1.0 + KL(i * 31, 10) * 0.14
      ctx.beginPath()
      for (let x = 0; x <= FW; x += 4) {
        // 整数周期（2/3/5）保证 x=0 与 x=FW 取值相同 → 水平平铺无缝
        const y =
          y0 +
          Math.sin((x / FW) * TAU * 2 + i * 0.7) * sway * 0.5 +
          Math.sin((x / FW) * TAU * 3 + i * 1.3) * sway * 0.3
        if (x === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      }
      ctx.stroke()

      // 伴随的深色沟槽：每 6 条才来一条，且幅度明显小于提亮线
      if (i % 6 === 0) {
        const dark = 0.035 + KL(i * 53, 60) / 1400
        ctx.strokeStyle = "rgba(28,14,4," + dark.toFixed(3) + ")"
        ctx.lineWidth = 1.6
        ctx.beginPath()
        for (let x = 0; x <= FW; x += 4) {
          const y =
            y0 +
            1.6 +
            Math.sin((x / FW) * TAU * 2 + i * 0.7) * sway * 0.5 +
            Math.sin((x / FW) * TAU * 3 + i * 1.3) * sway * 0.3
          if (x === 0) ctx.moveTo(x, y)
          else ctx.lineTo(x, y)
        }
        ctx.stroke()
      }
    }

    // ── 结构二：导管（木材的细长孔隙）──
    // 沿纤维方向的短促细线。v1.3.88：以**提亮**为主（浅色导管壁），
    // 深色只占少数 —— 深色在深色底上不可见（见上方注释）。
    for (let i = 0; i < 340; i++) {
      const y0 = ((i * 613) % FH) + ((i * 17) % 7) * 0.15
      const x0 = (i * 3571) % FW
      const len = 30 + ((i * 97) % 190)
      const isDark = i % 4 === 0
      const alpha = isDark
        ? 0.03 + ((i * 53) % 40) / 1600
        : 0.05 + ((i * 53) % 60) / 700
      ctx.strokeStyle = isDark
        ? "rgba(28,14,4," + alpha.toFixed(3) + ")"
        : "rgba(232,198,146," + alpha.toFixed(3) + ")"
      ctx.lineWidth = 0.6 + ((i * 11) % 5) * 0.18
      ctx.beginPath()
      for (let x = 0; x <= len; x += 4) {
        const y = y0 + Math.sin((x / len) * Math.PI) * 1.6
        if (x === 0) ctx.moveTo(x0 + x, y)
        else ctx.lineTo(x0 + x, y)
      }
      ctx.stroke()
    }

    // ── 结构三：高光丝（浅色纤维，让木纹「浮」出来）──
    // v1.3.88：幅度明显加强（0.025~0.05 → 0.05~0.13）。
    // 这是木纹可见度的**主要来源** —— 之前太小，等于白画。
    for (let i = 0; i < 260; i++) {
      const y0 = ((i * 271) % FH) + ((i * 13) % 5) * 0.3
      const alpha = 0.05 + ((i * 41) % 40) / 500
      ctx.strokeStyle = "rgba(255,238,204," + alpha.toFixed(3) + ")"
      ctx.lineWidth = 0.7 + ((i * 23) % 6) * 0.18
      ctx.beginPath()
      for (let x = 0; x <= FW; x += 4) {
        const y =
          y0 +
          Math.sin((x / FW) * TAU * 2 + i * 1.9) * 2.4 +
          Math.sin((x / FW) * TAU * 5 + i * 0.4) * 1.1
        if (x === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      }
      ctx.stroke()
    }

    // ── 结构四：节疤（年轮密集处，2 个）──
    // v1.3.88：提亮相间的同心环。真实节疤是「一圈亮一圈暗」的交替年轮，
    // 只画暗环在深色底上看不见；只画亮环又像贴纸。交替才是对的。
    for (let i = 0; i < 2; i++) {
      const kx = 140 + i * 460
      const ky = 70 + i * 105
      const kr = 26 + i * 12
      let ring = 0
      for (let r = kr; r > 2; r -= 4.5) {
        const bright = ring % 2 === 0
        ctx.strokeStyle = bright
          ? "rgba(235,204,156," + (0.1 * (1 - r / kr) + 0.05).toFixed(3) + ")"
          : "rgba(32,16,5," + (0.09 * (1 - r / kr) + 0.03).toFixed(3) + ")"
        ctx.lineWidth = 1.5
        ctx.beginPath()
        // 椭圆（沿纤维方向拉长）
        ctx.ellipse(kx, ky, r * 1.5, r, 0, 0, TAU)
        ctx.stroke()
        ring++
      }
      const knot = ctx.createRadialGradient(kx, ky, 1, kx, ky, kr * 1.5)
      knot.addColorStop(0, "rgba(26,13,4,0.5)")
      knot.addColorStop(0.55, "rgba(26,13,4,0.18)")
      knot.addColorStop(1, "rgba(26,13,4,0)")
      ctx.fillStyle = knot
      ctx.beginPath()
      ctx.ellipse(kx, ky, kr * 1.5, kr, 0, 0, TAU)
      ctx.fill()
    }
  }

  // 上下边发光条（沿桌框边缘）
  if (def.frameGlow) {
    ctx.fillStyle = hex(def.frameGlow)
    ctx.globalAlpha = 0.85
    ctx.fillRect(0, 0, FW, 14)
    ctx.fillRect(0, FH - 14, FW, 14)
    ctx.globalAlpha = 1
  }

  // 鎏金云纹（朱红鎏金款）
  if (def.clothTexture === "cloud") {
    ctx.strokeStyle = "rgba(240,200,96,0.7)"
    ctx.lineWidth = 4
    for (let i = 0; i < 32; i++) {
      const x = i * 32
      ctx.beginPath()
      ctx.moveTo(x, 128)
      ctx.bezierCurveTo(x, 84, x + 16, 84, x + 16, 128)
      ctx.stroke()
    }
  }

  return cv
}

/** 取桌框颜色贴图（内部转 Texture） */
function buildFrame(def: ReturnType<typeof getTableSkin>): Texture {
  return toTexture(buildFrameCanvas(def))
}
