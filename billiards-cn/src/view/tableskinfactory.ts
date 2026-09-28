import {
  CanvasTexture,
  LinearFilter,
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

/**
 * 【v1.4.5 P5】库边贴图（绒面橡胶颗粒）。
 *
 * 为什么要单独一张：库边（CushionBlue）此前只有纯色 + 粗糙度/金属度分级
 * （v1.4.4），光影上正确，但表面是「一块均匀的色块」—— 真实库边橡胶上有
 * 细密的绒毛颗粒，掠射光下会呈现细微的明暗闪烁。而且 GLTF 的库边 mesh
 * 连 TEXCOORD_0 都没有（见 assets.fixCushionUVs），此前挂任何贴图都恒采样
 * (0,0)，从未真正显示过。
 *
 * 设计约束：
 *  · **中性明度**（灰白底 + 明暗颗粒），色相全部交给 mat.color(cushionColor)
 *    —— 贴图若自带主题色再与 color 相乘会「色彩平方」，越乘越脏；
 *  · **上下均匀、无分带**：UV 是三平面米制投影（u 周期 0.75m、v 周期
 *    0.05m），顶面窄条与侧面全程采样的是贴图的不同小条 —— 只有上下
 *    均匀，两个面才不会出现明暗断层；
 *  · 颗粒沿 u 拉长（绒毛顺长度方向），用整数格点哈希做伪随机 ——
 *    v1.3.87 的教训：任何「规则函数」都会变成可见的周期 = 假。
 */
const CW = 1024
const CH = 64
const cushionCache = new Map<string, Texture>()

/** 库边贴图专用的 wrap-safe 绘制（画布是 1024×64，与台呢的 W/H=512 不同） */
function wrapCushion(
  ctx: CanvasRenderingContext2D,
  draw: () => void
): void {
  for (const ox of [-CW, 0, CW]) {
    for (const oy of [-CH, 0, CH]) {
      ctx.save()
      ctx.translate(ox, oy)
      draw()
      ctx.restore()
    }
  }
}

export function getCushionTexture(tableSkinId: string): Texture | null {
  if (cushionCache.has(tableSkinId)) return cushionCache.get(tableSkinId)!
  const def = getTableSkin(tableSkinId)
  // 发光主题的库边更「光洁」（亮颗粒更明显、暗颗粒收敛），呼应整体质感分级
  const glow = def.frameGlow || def.edgeGlow

  const cv = document.createElement("canvas")
  cv.width = CW
  cv.height = CH
  const ctx = cv.getContext("2d")!

  // 底色：接近白的浅灰（明度纹理，色相交给材质色相乘）
  ctx.fillStyle = "#f2f2f2"
  ctx.fillRect(0, 0, CW, CH)

  // 绒毛颗粒：沿 u 拉长的细颗粒（约 1~2px 高 × 3~7px 长），明暗成对 ——
  // 只画暗点在浅底上是「脏点」，明暗相间才是绒面纤维的反光。
  const N = 2600
  for (let i = 0; i < N; i++) {
    const x = hash2d(i, 1, 71) * CW
    const y = hash2d(i, 2, 73) * CH
    const len = 2.5 + hash2d(i, 3, 79) * 5
    const hgt = 0.8 + hash2d(i, 4, 83) * 1.4
    const bright = hash2d(i, 5, 89) > 0.5
    const a0 = 0.03 + hash2d(i, 6, 97) * 0.06
    const a = bright ? a0 * (glow ? 1.4 : 1) : a0 * (glow ? 0.5 : 0.8)
    ctx.fillStyle = bright
      ? "rgba(255,255,255," + a.toFixed(3) + ")"
      : "rgba(60,60,64," + a.toFixed(3) + ")"
    wrapCushion(ctx, () => {
      ctx.fillRect(x, y, len, hgt)
    })
  }

  // 大颗粒暗斑：少量、更淡的柔边暗斑，打破「均匀噪点」的塑料感
  for (let i = 0; i < 90; i++) {
    const x = hash2d(i, 11, 101) * CW
    const y = hash2d(i, 12, 103) * CH
    const r = 1.5 + hash2d(i, 13, 107) * 3.5
    const a = (0.02 + hash2d(i, 14, 109) * 0.03) * (glow ? 0.6 : 1)
    const g = ctx.createRadialGradient(x, y, 0, x, y, r)
    g.addColorStop(0, "rgba(70,70,76," + a.toFixed(3) + ")")
    g.addColorStop(1, "rgba(70,70,76,0)")
    ctx.fillStyle = g
    wrapCushion(ctx, () => {
      ctx.fillRect(x - r, y - r, r * 2, r * 2)
    })
  }

  const tex = new CanvasTexture(cv)
  tex.wrapS = tex.wrapT = RepeatWrapping
  tex.colorSpace = SRGBColorSpace
  tex.anisotropy = 4
  tex.needsUpdate = true
  cushionCache.set(tableSkinId, tex)
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

// ============ 【v1.4.4】台面标志覆盖层 ============

/** 整台标志贴图尺寸（repeat 1,1 铺满台面；≈7px/m，够画开球线与置球点） */
const MARK_W = 2048
const MARK_H = 1024
const markCache = new Map<string, Texture>()

/**
 * 台面标志元素贴图：开球线（head string）、置球点（foot spot）、
 * 头部点（head spot）、中点（center spot）。
 *
 * **为什么必须是独立覆盖层，而不是画进台呢贴图**：
 * 台呢贴图 `getClothTexture` 是 `repeat(2,2)` 平铺的（一个纹理单元代表
 * 桌面的一小块），任何「整台唯一」的元素画进去都会被重复 4 次 ——
 * 开球线会变成 4 条、置球点变成 4 个。所以这里另起一张 repeat(1,1) 的
 * 整台贴图，由 assets.applyClothMarks 以独立半透明 mesh 铺在台呢之上。
 *
 * **为什么画布是 2048×1024**：台面玩区 2.816×1.376m（比例 2.047），
 * 2048×1024 比例 2.0，误差 2.3% —— 圆点的椭圆度肉眼不可辨，换来的是
 * 2 的幂尺寸（兼容性好）。像素密度约 727×744 px/m，线宽 5px ≈ 7mm、
 * 点半径 10px ≈ 14mm，在俯视机位下清晰可见且不过分抢眼。
 *
 * **元素定位按真实美式台球规则**（u 沿长边、v 沿短边）：
 * - 开球线在长边 1/4 处，横跨整个短边；
 * - 置球点在长边 3/4 处（与开球线对称）、短边中线；
 * - 头部点在开球线与短边中线的交点；
 * - 中点在台面正中。
 */
export function getClothMarksTexture(tableSkinId: string): Texture | null {
  if (markCache.has(tableSkinId)) return markCache.get(tableSkinId)!
  const def = getTableSkin(tableSkinId)
  const ms = def.markStyle
  if (!ms) return null

  const cv = document.createElement("canvas")
  cv.width = MARK_W
  cv.height = MARK_H
  const ctx = cv.getContext("2d")!
  const r0 = (ms.color >> 16) & 255
  const g0 = (ms.color >> 8) & 255
  const b0 = ms.color & 255
  /** 主题色 + 指定透明度 */
  const col = (a: number): string => `rgba(${r0},${g0},${b0},${a})`

  ctx.save()
  ctx.lineCap = "round"
  // 特效款：整层外发光（覆盖层没有桌框那种 Sobel 法线顾虑，可放心用 shadowBlur）
  if (ms.glow > 0) {
    ctx.shadowColor = col(0.9)
    ctx.shadowBlur = 8 + ms.glow * 26
  }

  /**
   * ⚠️ v1.4.4 实测教训：**元素不能太小**。
   *
   * 首版点半径只有 10px（2048 宽贴图），线宽 5~7px。游戏里台面在 1280×720
   * 画面上只有约 960px 宽 —— 贴图被压缩到 0.47 倍后再走 mipmap，点的 alpha
   * 被各级 mip 平均成接近 0，实测三个置球点**一个都看不见**，只剩那条
   * 纵贯线（连续线不会被 mip 稀释）。
   * 现在点位放大到直径 40px 上下、线宽统一 ×1.6，屏幕上看是 19~24px 的
   * 圆点和 3.3~5px 的线 —— 与真实球桌（点 ~6mm、线 ~2mm）相比是夸张的，
   * 但这是「看得见」的底线，再小就会被 mipmap 吃掉。
   */
  // ── 开球线：长边 1/4 处，纵贯短边（两端各留 3% 不与库边相接）──
  ctx.strokeStyle = col(ms.alpha)
  ctx.lineWidth = ms.width * 2.2
  if (ms.dotted) ctx.setLineDash([26, 18])
  ctx.beginPath()
  ctx.moveTo(MARK_W * 0.25, MARK_H * 0.03)
  ctx.lineTo(MARK_W * 0.25, MARK_H * 0.97)
  ctx.stroke()
  ctx.setLineDash([])

  // ── 三个点：置球点 / 头部点 / 中点 ──
  // 分级：特效款（glow>0）点位张扬，经典款收一档 —— 与「经典克制/特效张扬」
  // 的视觉调性一致（用户选定的方向）。
  const r = 40 * (ms.glow > 0 ? 1 : 0.85)
  drawSpot(ctx, MARK_W * 0.75, MARK_H * 0.5, r, ms.spot, col) // foot spot
  drawSpot(ctx, MARK_W * 0.25, MARK_H * 0.5, r * 0.85, ms.spot, col) // head spot
  drawSpot(ctx, MARK_W * 0.5, MARK_H * 0.5, r * 0.72, ms.spot, col) // center

  ctx.restore()
  const tex = toTexture(cv)
  tex.colorSpace = SRGBColorSpace
  /**
   * ⚠️ 必须关掉 mipmap（v1.4.4 实测）。
   *
   * 覆盖层是**单张不平铺**的整台贴图：2048px 宽在游戏俯视画面上只占约
   * 512px，采样率 0.25。开 mipmap 时采样落在 mip2（512×256）上，孤立的
   * 小圆点（实心核只有几个像素）被逐级平均，alpha 被稀释到接近 0 —— 三个
   * 置球点**一个都看不见**；而纵贯的开球线因为沿一个方向连续，平均不掉，
   * 所以只有线可见。这正是「同一个贴图里画的东西，有的看得见有的看不见」
   * 的全部原因。关掉 mipmap + 各向异性拉到 8，点就回来了。
   */
  tex.generateMipmaps = false
  tex.minFilter = LinearFilter
  tex.magFilter = LinearFilter
  tex.anisotropy = 8
  tex.needsUpdate = true
  markCache.set(tableSkinId, tex)
  return tex
}

/**
 * 置球点样式（7 种）。
 *
 * 全部为径向渐变/环带这类**中心对称**画法：置球点在真实球桌上就是一枚
 * 嵌进台呢的小圆片（象牙、珍珠贝或金属），不适合用任何方向性图案。
 */
function drawSpot(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  kind: string,
  col: (a: number) => string
): void {
  /**
   * 实心底盘（v1.4.4）。
   *
   * 没有它，pearl / frost 这类**径向渐变**样式的中心虽然 alpha 高，但真正
   * 不透明的区域只有几个像素；贴图缩到屏幕尺寸后走 mipmap 逐级平均，核心
   * alpha 被稀释到接近 0 —— 实测经典款置球点在 1280×720 画面上**完全
   * 看不见**（差异 0），而同一张贴画的连续开球线却清晰可见。
   * 真实球桌的置球点本来就是一枚嵌进台呢的实心圆片，所以先铺一层不透明
   * 底再叠样式，既修了可见性，也更写实。
   */
  ctx.fillStyle = col(0.85)
  ctx.beginPath()
  ctx.arc(x, y, r * 0.55, 0, Math.PI * 2)
  ctx.fill()

  switch (kind) {
    case "pearl": {
      // 珍珠贝：中心亮、边缘收，带一圈极淡的晕
      const g = ctx.createRadialGradient(x - r * 0.3, y - r * 0.3, r * 0.1, x, y, r)
      g.addColorStop(0, "rgba(255,255,255,0.95)")
      g.addColorStop(0.55, col(0.72))
      g.addColorStop(1, col(0.28))
      ctx.fillStyle = g
      ctx.beginPath()
      ctx.arc(x, y, r, 0, Math.PI * 2)
      ctx.fill()
      ctx.strokeStyle = col(0.35)
      ctx.lineWidth = r * 0.15
      ctx.stroke()
      break
    }
    case "gem": {
      // 宝石：主题色实体 + 亮心 + 深色内环
      ctx.fillStyle = col(0.8)
      ctx.beginPath()
      ctx.arc(x, y, r, 0, Math.PI * 2)
      ctx.fill()
      ctx.strokeStyle = "rgba(0,0,0,0.35)"
      ctx.lineWidth = r * 0.2
      ctx.stroke()
      const g = ctx.createRadialGradient(x - r * 0.35, y - r * 0.35, 0, x, y, r * 0.6)
      g.addColorStop(0, "rgba(255,255,255,0.85)")
      g.addColorStop(1, "rgba(255,255,255,0)")
      ctx.fillStyle = g
      ctx.beginPath()
      ctx.arc(x, y, r, 0, Math.PI * 2)
      ctx.fill()
      break
    }
    case "gold": {
      // 鎏金：金属环 + 中心亮点（环比实体更有「镶嵌」感）
      ctx.strokeStyle = col(0.9)
      ctx.lineWidth = r * 0.3
      ctx.beginPath()
      ctx.arc(x, y, r, 0, Math.PI * 2)
      ctx.stroke()
      ctx.fillStyle = col(0.35)
      ctx.beginPath()
      ctx.arc(x, y, r * 0.72, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = "rgba(255,250,225,0.9)"
      ctx.beginPath()
      ctx.arc(x - r * 0.25, y - r * 0.25, r * 0.22, 0, Math.PI * 2)
      ctx.fill()
      break
    }
    case "frost": {
      // 霜白：冷白径向 + 虚线外环（呼应蓝宝石的冰裂主题）
      const g = ctx.createRadialGradient(x, y, 0, x, y, r)
      g.addColorStop(0, "rgba(255,255,255,0.9)")
      g.addColorStop(1, col(0.25))
      ctx.fillStyle = g
      ctx.beginPath()
      ctx.arc(x, y, r * 0.8, 0, Math.PI * 2)
      ctx.fill()
      ctx.strokeStyle = col(0.5)
      ctx.lineWidth = r * 0.15
      ctx.setLineDash([4, 4])
      ctx.beginPath()
      ctx.arc(x, y, r * 1.25, 0, Math.PI * 2)
      ctx.stroke()
      ctx.setLineDash([])
      break
    }
    case "obsidian": {
      // 黑曜石：暗色实体 + 一道弧形高光（黑玻璃的辨识特征）
      ctx.fillStyle = "rgba(18,20,24,0.85)"
      ctx.beginPath()
      ctx.arc(x, y, r, 0, Math.PI * 2)
      ctx.fill()
      ctx.strokeStyle = col(0.6)
      ctx.lineWidth = r * 0.2
      ctx.stroke()
      ctx.strokeStyle = "rgba(255,255,255,0.55)"
      ctx.lineWidth = r * 0.2
      ctx.beginPath()
      ctx.arc(x, y, r * 0.62, Math.PI * 1.05, Math.PI * 1.6)
      ctx.stroke()
      break
    }
    case "glow": {
      // 发光：强径向渐变（外圈透明）+ 过曝亮心
      const g = ctx.createRadialGradient(x, y, 0, x, y, r * 1.6)
      g.addColorStop(0, "rgba(255,255,255,0.98)")
      g.addColorStop(0.35, col(0.95))
      g.addColorStop(1, col(0))
      ctx.fillStyle = g
      ctx.beginPath()
      ctx.arc(x, y, r * 1.6, 0, Math.PI * 2)
      ctx.fill()
      break
    }
    case "candy": {
      // 糖果：粉白圆片 + 亮边环 + 高光点
      ctx.fillStyle = "rgba(255,255,255,0.92)"
      ctx.beginPath()
      ctx.arc(x, y, r, 0, Math.PI * 2)
      ctx.fill()
      ctx.strokeStyle = col(0.85)
      ctx.lineWidth = r * 0.25
      ctx.stroke()
      ctx.fillStyle = "rgba(255,255,255,1)"
      ctx.beginPath()
      ctx.arc(x - r * 0.3, y - r * 0.32, r * 0.24, 0, Math.PI * 2)
      ctx.fill()
      break
    }
    default: {
      ctx.fillStyle = col(0.7)
      ctx.beginPath()
      ctx.arc(x, y, r, 0, Math.PI * 2)
      ctx.fill()
    }
  }
}

// ============ 【v1.4.4】经典 5 款独有底纹 ============

/**
 * 设计硬约束（承接 v1.3.87 / v1.3.88 两次翻车的教训）：
 *
 * v1.3.87 用高频**规则正弦**堆「编织颗粒」、v1.3.88 用等间距**斜线菱格**
 * 堆「压花」，两者在离线小图里都像织物，但在实机俯视全屏（台呢铺满整屏）
 * 下必然暴露**等间距周期结构**，视觉上就是一块格子布，被判定为假。
 *
 * 结论：**规则函数 = 可见的周期 = 假**。真实台呢是绒面，起伏各向同性、
 * 无方向性、无等间距。因此这 5 款一律走：
 *   · 基础层：baseClothGradient（值噪声 + 三层 fBm，整数周期 → 平铺无缝）；
 *   · 特征层：各向异性噪声 / 域扭曲噪声 / 随机分叉线 —— 有机、无周期；
 *   · 跨边界的线：wrap-safe（在 x-W / x / x+W 三处各画一遍）；
 *   · 幅度克制：经典款对比度 ±6% 上下，宁可「看不出我改了」也不要「假」。
 */

/** 整数格点哈希 → [0,1)（与 baseClothGradient 内部同构） */
function hash2d(xi: number, yi: number, seed: number): number {
  let h = (xi * 374761393 + yi * 668265263 + seed * 1442695041) | 0
  h = (h ^ (h >>> 13)) * 1274126177
  h = h ^ (h >>> 16)
  return (h >>> 0) / 4294967296
}

/**
 * 模块级值噪声（供特征层使用；baseClothGradient 内部那份是闭包拿不到）。
 *
 * px / py 分别指定 x / y 方向的格点周期 —— 两者**独立**是刻意的：
 * 各向异性纹理（如顺毛）需要两个方向频率不同，若共用一个周期会算错。
 * 只要 px 整除 x 方向的坐标跨度、py 整除 y 方向跨度，平铺即无缝。
 */
function vn(
  x: number,
  y: number,
  px: number,
  py: number,
  seed: number
): number {
  const gx = Math.floor(x)
  const gy = Math.floor(y)
  const fx = x - gx
  const fy = y - gy
  const sx = fx * fx * fx * (fx * (fx * 6 - 15) + 10)
  const sy = fy * fy * fy * (fy * (fy * 6 - 15) + 10)
  const wx = (n: number): number => ((n % px) + px) % px
  const wy = (n: number): number => ((n % py) + py) % py
  const v00 = hash2d(wx(gx), wy(gy), seed)
  const v10 = hash2d(wx(gx + 1), wy(gy), seed)
  const v01 = hash2d(wx(gx), wy(gy + 1), seed)
  const v11 = hash2d(wx(gx + 1), wy(gy + 1), seed)
  const a = v00 + (v10 - v00) * sx
  const b = v01 + (v11 - v01) * sx
  return a + (b - a) * sy
}

/** 8bit 通道限幅 */
function cl(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : v
}

/**
 * wrap-safe 绘制：把同一组图元在 3×3 宫格（x-W/x/x+W × y-H/y/y+H）各画一遍。
 * 超出画布的部分被裁掉，跨界的那一段自然由相邻那份补上 → 平铺不断线。
 *
 * ⚠️ 为什么必须双向而不只是横向：台呢贴图 repeat(2,2)，**两个方向都会
 * 跨接缝**。只做 x 方向平移时，金箔斑与裂纹在 y 方向仍在边界处断裂
 * （实测 golden 的 seamY 达 3.23，即上下边界差是内部行差的 3 倍多）。
 */
function wrapDraw(ctx: CanvasRenderingContext2D, draw: () => void): void {
  for (const ox of [-W, 0, W]) {
    for (const oy of [-H, 0, H]) {
      ctx.save()
      ctx.translate(ox, oy)
      draw()
      ctx.restore()
    }
  }
}

/** 经典原木：精纺顺毛（各向异性噪声，纹理沿长边拉长） */
function buildWorsted(
  cv: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
  def: ReturnType<typeof getTableSkin>
): Texture {
  baseClothGradient(ctx, def.clothColor, def.clothColor2)
  const img = ctx.getImageData(0, 0, W, H)
  const d = img.data
  for (let y = 0; y < H; y++) {
    const ny = y / H
    for (let x = 0; x < W; x++) {
      const nx = x / W
      // y 方向频率是 x 的 6 倍 → 纹理沿 x 拉长 = 顺毛走向（各向异性）
      const n =
        vn(nx * 8, ny * 48, 8, 48, 31) * 0.62 +
        vn(nx * 24, ny * 144, 24, 144, 37) * 0.38
      const k = (n - 0.5) * 0.12 * 255 // ±6%
      const i = (y * W + x) * 4
      d[i] = cl(d[i] + k)
      d[i + 1] = cl(d[i + 1] + k)
      d[i + 2] = cl(d[i + 2] + k)
    }
  }
  ctx.putImageData(img, 0, 0)
  return toTexture(cv)
}

/** 翡翠绿：叶脉（域扭曲噪声 + ridged 脊线 → 有机流线） */
function buildLeafVein(
  cv: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
  def: ReturnType<typeof getTableSkin>
): Texture {
  baseClothGradient(ctx, def.clothColor, def.clothColor2)
  const img = ctx.getImageData(0, 0, W, H)
  const d = img.data
  for (let y = 0; y < H; y++) {
    const ny = y / H
    for (let x = 0; x < W; x++) {
      const nx = x / W
      // 域扭曲：先用低频噪声偏移采样坐标，直线族被掰成蜿蜒的有机流线。
      // 扭曲量自身周期（4）整除跨度 → x=0 与 x=W 处扭曲量相同，平铺无缝。
      const qx = vn(nx * 4, ny * 4, 4, 4, 51) - 0.5
      const qy = vn(nx * 4 + 11, ny * 4 + 7, 4, 4, 52) - 0.5
      const n = vn(nx * 6 + qx * 0.9, ny * 6 + qy * 0.9, 6, 6, 53)
      // ridged：把噪声翻成脊线（|中值| 处最亮）→ 叶脉那样的细亮线
      const ridge = 1 - Math.abs(n * 2 - 1)
      const k = Math.pow(ridge, 7) * 0.13 * 255
      const i = (y * W + x) * 4
      d[i] = cl(d[i] + k)
      d[i + 1] = cl(d[i + 1] + k * 0.92)
      d[i + 2] = cl(d[i + 2] + k * 0.7)
    }
  }
  ctx.putImageData(img, 0, 0)
  return toTexture(cv)
}

/**
 * 赤焰红：火焰暗纹。
 *
 * 火舌的「上扬感」**不用**线性渐变（1-ny 是非周期的，v 方向平铺时
 * 会在贴图上下边界处突变出一条横向接缝），改用低频噪声（周期 2）做
 * 上下的明暗调制 —— 既无缝，又不是规则正弦那种可察觉的规律渐变。
 */
function buildFlame(
  cv: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
  def: ReturnType<typeof getTableSkin>
): Texture {
  baseClothGradient(ctx, def.clothColor, def.clothColor2)
  const img = ctx.getImageData(0, 0, W, H)
  const d = img.data
  for (let y = 0; y < H; y++) {
    const ny = y / H
    for (let x = 0; x < W; x++) {
      const nx = x / W
      const qx = vn(nx * 4, ny * 2, 4, 2, 61) - 0.5
      // y 方向频率低（2）→ 纹理竖直拉长，像火舌
      const n = vn(nx * 5 + qx * 1.15, ny * 2, 5, 2, 62)
      const ridge = 1 - Math.abs(n * 2 - 1)
      // 低频噪声调制：整幅上下的火势强弱（周期 2 → 无缝）
      const draft = 0.55 + 0.45 * vn(nx * 1.5, ny * 2, 2, 2, 63)
      const k = Math.pow(ridge, 5) * draft * 0.2 * 255
      const i = (y * W + x) * 4
      d[i] = cl(d[i] + k)
      d[i + 1] = cl(d[i + 1] + k * 0.45)
      d[i + 2] = cl(d[i + 2] + k * 0.12)
    }
  }
  ctx.putImageData(img, 0, 0)
  return toTexture(cv)
}

/**
 * 随机分叉裂纹（冰裂 / 金箔龟裂共用）。
 *
 * 用随机游走而非等间距线：步长带随机扰动、随机触发分叉，
 * 生成的是**有机**裂纹网，不会形成周期结构。
 */
function crackPoints(
  x0: number,
  y0: number,
  angle: number,
  steps: number,
  stepLen: number,
  jitter: number
): Array<[number, number]> {
  const pts: Array<[number, number]> = [[x0, y0]]
  let x = x0
  let y = y0
  let a = angle
  for (let s = 0; s < steps; s++) {
    a += (Math.random() - 0.5) * jitter
    x += Math.cos(a) * stepLen
    y += Math.sin(a) * stepLen
    pts.push([x, y])
  }
  return pts
}

function strokePts(
  ctx: CanvasRenderingContext2D,
  pts: Array<[number, number]>
): void {
  ctx.beginPath()
  ctx.moveTo(pts[0][0], pts[0][1])
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1])
  ctx.stroke()
}

/** 蓝宝石：冰裂（冷白细裂纹，随机分叉 + wrap-safe） */
function buildIceCrack(
  cv: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
  def: ReturnType<typeof getTableSkin>
): Texture {
  baseClothGradient(ctx, def.clothColor, def.clothColor2)
  ctx.save()
  ctx.lineCap = "round"
  for (let i = 0; i < 26; i++) {
    const x0 = Math.random() * W
    const y0 = Math.random() * H
    const a0 = Math.random() * Math.PI * 2
    const pts = crackPoints(x0, y0, a0, 16, 7, 0.5)
    // 主裂纹
    ctx.strokeStyle = "rgba(206,232,255,0.30)"
    ctx.lineWidth = 1.4
    wrapDraw(ctx, () => strokePts(ctx, pts))
    // 分叉：从主裂纹中段随机抽出 1~2 条短支
    const forks = 1 + Math.floor(Math.random() * 2)
    for (let f = 0; f < forks; f++) {
      const p = pts[Math.floor(Math.random() * pts.length)]
      const fp = crackPoints(p[0], p[1], Math.random() * Math.PI * 2, 6, 5, 0.7)
      ctx.strokeStyle = "rgba(206,232,255,0.16)"
      ctx.lineWidth = 1
      wrapDraw(ctx, () => strokePts(ctx, fp))
    }
  }
  ctx.restore()
  return toTexture(cv)
}

/** 金辉：金箔龟裂（碎裂网 + 金箔斑，wrap-safe） */
function buildGoldLeaf(
  cv: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
  def: ReturnType<typeof getTableSkin>
): Texture {
  baseClothGradient(ctx, def.clothColor, def.clothColor2)
  // 金箔斑：先铺一层不规则的金箔块（椭圆，随机旋转，wrap-safe）
  ctx.save()
  for (let i = 0; i < 40; i++) {
    const x = Math.random() * W
    const y = Math.random() * H
    const rx = 8 + Math.random() * 26
    const ry = rx * (0.35 + Math.random() * 0.5)
    const rot = Math.random() * Math.PI
    ctx.fillStyle = `rgba(246,214,128,${0.05 + Math.random() * 0.07})`
    wrapDraw(ctx, () => {
      ctx.beginPath()
      ctx.ellipse(x, y, rx, ry, rot, 0, Math.PI * 2)
      ctx.fill()
    })
  }
  // 龟裂网：比冰裂更碎更密
  ctx.lineCap = "round"
  for (let i = 0; i < 44; i++) {
    const x0 = Math.random() * W
    const y0 = Math.random() * H
    const pts = crackPoints(x0, y0, Math.random() * Math.PI * 2, 7, 4.5, 0.85)
    ctx.strokeStyle = "rgba(236,198,104,0.34)"
    ctx.lineWidth = 1.1
    wrapDraw(ctx, () => strokePts(ctx, pts))
  }
  ctx.restore()
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
    // 【v1.4.4】经典 5 款独有底纹（此前 5 款共用 velvet，只换色不换图案）
    case "worsted":
      return buildWorsted(cv, ctx, def)
    case "leafvein":
      return buildLeafVein(cv, ctx, def)
    case "flame":
      return buildFlame(cv, ctx, def)
    case "icecrack":
      return buildIceCrack(cv, ctx, def)
    case "goldleaf":
      return buildGoldLeaf(cv, ctx, def)
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

  /**
   * 【v1.4.4】桌框装饰（内镶线 / 中轴暗槽 / 四角包角）。
   *
   * 前提：桌框走三平面 UV（fixFrameUVs），顶面 u=(x-minX)/scale、
   * v=(y-minY)/scale，侧面被挪到 v∈[0.62,0.677] 的独立带（见 assets.ts）。
   * 实测 wood mesh 世界尺寸 3.2917×1.8503×0.1887，scale=3.2917，于是：
   *   · 顶面占据贴图 u∈[0,1]、v∈[0,0.5621] —— flipY 下即 canvas
   *     y∈[(1-0.5621)*256, 256] = [112, 256]；
   *   · 桌框是**环**，内边界是库边外沿（±1.5006 / ±0.7799）→ u∈[0.0441,
   *     0.9559]、v∈[0.0441,0.5177] → canvas 内矩形 (45,123)-(979,245)。
   * 所以能画的只有这条环带，而且 x 方向 311px/m、y 方向 78px/m —— **严重
   * 各向异性**，任何"圆"都会被拉成横椭圆。装饰必须全用直线段。
   *
   * 另外：法线贴图由颜色贴图的亮度场 Sobel 生成，所以这些线画下去会
   * 自动获得对应的凹凸，不需要另画一套法线。
   */
  drawFrameTrim(ctx, def)

  /**
   * 桌框发光边（沿外沿一圈）。
   *
   * ⚠️ v1.4.4 修正：旧版把发光条画在 canvas y=0..14 与 y=242..256。但顶面
   * 只占 v∈[0,0.5621]（flipY 后即 y∈[112,256]）—— **上面那条 v≈0.95~1 的
   * 条子从来没被采样过，等于白画**，只有下面那条看得见，所以发光框一直是
   * 「只有一条边亮」。现在改成沿外沿描一圈，四条边都亮。
   */
  if (def.frameGlow) {
    ctx.strokeStyle = hex(def.frameGlow)
    ctx.globalAlpha = 0.85
    ctx.lineWidth = 9
    ctx.strokeRect(
      TRIM.ox0 + 5,
      TRIM.oyTop + 5,
      TRIM.ox1 - TRIM.ox0 - 10,
      TRIM.oyBot - TRIM.oyTop - 10
    )
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

/**
 * 桌框顶面在画布上的可用区域（常量来自实测，见 buildFrameCanvas 注释）。
 * 这些数字**只对这个 GLTF 桌模型成立** —— 换模型必须重测（probe-frameuv.js）。
 */
const TRIM = {
  /** 桌框外沿矩形（顶面可见区的边界） */
  ox0: 0,
  ox1: 1024,
  oyTop: 112, // v=0.5621
  oyBot: 256, // v=0
  /** 桌框内沿矩形（贴着库边外沿） */
  ix0: 45,
  ix1: 979,
  iyTop: 123, // v=0.5177
  iyBot: 245, // v=0.0441
}

/**
 * 桌框装饰：内镶线 + 中轴暗槽 + 四角包角。
 *
 * 三条原则（都是踩过的坑）：
 *  · 只画**直线段**：贴图 x/y 是 311/78 px per m，画圆会变成横椭圆；
 *  · 线宽 ≤3px：环带在 y 方向只有 11px 高，画粗了会溢出到台面/侧面；
 *  · **提亮为主**：桌框底色是很深的木色（如 0x6a4a1a，最大通道仅 106），
 *    往上叠暗线会糊成一片，只有提亮的线才浮得出来（v1.3.88 教训）。
 */
function drawFrameTrim(
  ctx: CanvasRenderingContext2D,
  def: ReturnType<typeof getTableSkin>
): void {
  const { ox0, ox1, oyTop, oyBot, ix0, ix1, iyTop, iyBot } = TRIM
  /**
   * 分级（用户选定的「经典克制 / 特效张扬」）：
   * 发光款用主题色 + 更高不透明度，经典款用木色系 + 低不透明度。
   */
  const glow = !!def.frameGlow
  const trimA = glow ? 0.62 : 0.34
  const grooveA = glow ? 0.34 : 0.2
  const cornerA = glow ? 0.72 : 0.4

  const line = (
    x0: number, y0: number, x1: number, y1: number, w: number, style: string
  ) => {
    ctx.strokeStyle = style
    ctx.lineWidth = w
    ctx.beginPath()
    ctx.moveTo(x0, y0)
    ctx.lineTo(x1, y1)
    ctx.stroke()
  }
  const colorWithAlpha = (h: number, a: number): string => {
    const r = (h >> 16) & 255
    const g = (h >> 8) & 255
    const b = h & 255
    return `rgba(${r},${g},${b},${a})`
  }

  ctx.save()
  ctx.lineCap = "butt"

  // ── 1. 内镶线：沿内沿一圈的亮线 + 外侧 3px 的一条暗线（双线镶边）──
  const inner = glow
    ? colorWithAlpha(def.frameGlow || 0xf0d8a0, trimA)
    : `rgba(238,212,164,${trimA})`
  ctx.strokeStyle = inner
  ctx.lineWidth = glow ? 2.4 : 1.8
  ctx.strokeRect(ix0, iyTop, ix1 - ix0, iyBot - iyTop)

  // 外侧暗线：让亮线"浮"出来（真实球桌镶线两侧有阴影槽）
  ctx.strokeStyle = `rgba(26,13,4,${grooveA})`
  ctx.lineWidth = 1.2
  ctx.strokeRect(ix0 - 3, iyTop - 3, ix1 - ix0 + 6, iyBot - iyTop + 6)

  // ── 2. 中轴暗槽：沿环带中线一圈（左右带宽 45px、上下带高 11px）──
  const mx0 = (ox0 + ix0) / 2
  const mx1 = (ox1 + ix1) / 2
  const myTop = (oyTop + iyTop) / 2
  const myBot = (oyBot + iyBot) / 2
  ctx.strokeStyle = `rgba(22,11,3,${grooveA * 0.9})`
  ctx.lineWidth = glow ? 2.6 : 2.0
  ctx.strokeRect(mx0, myTop, mx1 - mx0, myBot - myTop)

  // 暗槽旁再补一条极淡的高光丝，避免暗槽看起来像"一条脏线"
  ctx.strokeStyle = glow
    ? colorWithAlpha(def.frameGlow || 0xf0d8a0, 0.22)
    : `rgba(246,226,190,0.14)`
  ctx.lineWidth = 0.9
  ctx.strokeRect(mx0, myTop - 2.5, mx1 - mx0, myBot - myTop + 5)

  // ── 3. 四角包角：角部加粗的 L 形亮线 ──
  // 长度换算：x 311px/m、y 78px/m，取视觉长度 0.30m → 水平 93px、垂直 23px
  const LEN_X = 93
  const LEN_Y = 23
  const cornerCol = glow
    ? colorWithAlpha(def.frameGlow || 0xf0d8a0, cornerA)
    : `rgba(244,220,178,${cornerA})`
  ctx.strokeStyle = cornerCol
  ctx.lineWidth = glow ? 4.5 : 3.2
  const corners: Array<[number, number, number, number]> = [
    // [内沿角点 x, 内沿角点 y, 水平延伸方向, 垂直延伸方向]
    [ix0, iyTop, 1, 1],
    [ix1, iyTop, -1, 1],
    [ix0, iyBot, 1, -1],
    [ix1, iyBot, -1, -1],
  ]
  for (const [cx, cy, sx, sy] of corners) {
    line(cx, cy, cx + LEN_X * sx, cy, ctx.lineWidth, cornerCol)
    line(cx, cy, cx, cy + LEN_Y * sy, ctx.lineWidth, cornerCol)
  }

  ctx.restore()
}
