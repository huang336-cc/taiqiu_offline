import { CanvasTexture, RepeatWrapping, SRGBColorSpace, Texture } from "three"
import { makeSeededRng } from "../utils/noise"

/**
 * 球类场馆地面程序化贴图工厂（v1.3.90 demo）。
 *
 * 与 `interiortexturefactory.ts` 同一套路：程序化 Canvas 绘制、零外部图片
 * 资源、模块级 cache 长期持有（`disposeEnvGroup` 不会 dispose map，LRU 淘汰
 * 环境后贴图必须由本模块持有，防泄漏）。
 *
 * ══════════════════════════════════════════════════════════════════════
 * 乘数层语义：final = linear(顶点色反照率) × linear(贴图)
 * ══════════════════════════════════════════════════════════════════════
 *
 * 与室内三间不同（铁律「贴图接近白 ≥240」），场馆地面贴图**允许真正的暗
 * 结构线** —— 木地板板缝、草皮磨损斑是**物理事实**（缝里是阴影+积尘，反照
 * 率本来就是暗的），不是「压暗画面的噪声」。室内铁律成立的前提是顶点色已
 * 画了全部明暗结构、贴图只补细节；场馆地面则相反：**结构从顶点色搬到贴
 * 图** —— 0.22m 板缝在 108×63 顶点网格里只有约 1 个顶点宽，插值成糊边；
 * 贴图像素级缝线（≈3px）才是真实球馆的锐利质感。
 *
 * 所以本工厂的明度范围放宽为：
 *   - 基底接近白（乘数 ≈1.0，不改变顶点色反照率的整体色调）
 *   - 结构线（缝/磨损）有意压暗到 0.60~0.85
 *   - 由 `__courtTexStats()` 输出统计供离线断言（转正时随 verify-entry 加阈值）
 *
 * 可平铺性：所有周期量取整数周期（正弦天然闭合）；错缝相位按 5 行闭合
 * 设计（5 × 0.52 = 2.6 = 2 × 板长 1.3，tile 边缘端缝精确回卷）。
 */

const cache = new Map<string, Texture>()

/** 硬木 tile 物理尺寸（米）：板长 1.3 × 7 行窄板（行宽 0.0571 → 0.4） */
export const HARDWOOD_TILE = { x: 1.3, y: 0.4 }
/** 草皮 tile 物理尺寸（米）：含 2 条 1.6m 割草条带 */
export const GRASS_TILE = { x: 3.2, y: 3.2 }

export type CourtTexKind = "hardwood" | "grass"

/**
 * 取场馆地面贴图。
 *
 * ⚠️ repeat **不在本工厂设置** —— 它 = 地面尺寸 ÷ tile 尺寸，由使用方
 * （sceneenvironment 的 `courtBakedMaterial`）按各自场地尺寸计算。工厂只
 * 保证 tile 物理尺寸常量与绘制内容一致（板宽 0.22m / 板长 1.3m / 条带
 * 1.6m），repeat 错了板条会被拉伸/压缩成假比例（v1.3.90 demo 第一版就
 * 踩过：repeat 误设 tile 尺寸，板条拉大 4.7 倍）。
 */
export function getCourtTexture(kind: CourtTexKind): Texture {
  const hit = cache.get(kind)
  if (hit) return hit
  const tex = kind === "hardwood" ? buildHardwood() : buildGrass()
  finalize(tex, kind)
  cache.set(kind, tex)
  return tex
}

function finalize(tex: Texture, kind: CourtTexKind): void {
  tex.wrapS = RepeatWrapping
  tex.wrapT = RepeatWrapping
  tex.colorSpace = SRGBColorSpace
  tex.anisotropy = 8
  tex.needsUpdate = true
}

// ───────────────────────── 确定性随机 ─────────────────────────

function hash2(i: number, j: number): number {
  const s = Math.sin(i * 127.1 + j * 311.7) * 43758.5453
  return s - Math.floor(s)
}

/** 可平铺二维噪声（正弦叠加天然无缝，同室内工厂 tileNoise） */
function tileNoise(u: number, v: number, fu: number, fv: number, ph: number): number {
  return (
    Math.sin(u * fu * Math.PI * 2 + ph) * Math.cos(v * fv * Math.PI * 2 - ph) +
    Math.sin(u * fu * 2.7 * Math.PI * 2 - ph * 1.7) *
      Math.cos(v * fv * 2.3 * Math.PI * 2 + ph * 0.6)
  )
}

function newCanvas(w: number, h: number): {
  cv: HTMLCanvasElement
  ctx: CanvasRenderingContext2D
} {
  const cv = document.createElement("canvas")
  cv.width = w
  cv.height = h
  const ctx = cv.getContext("2d")!
  return { cv, ctx }
}

/**
 * 逐像素画乘数层。
 *
 * @param shade (u, v) ∈ [0,1) → 乘数 0~1（1.0 = 不改变顶点色）
 */
function paintMul(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  shade: (u: number, v: number) => number
): void {
  const img = ctx.getImageData(0, 0, W, H)
  const d = img.data
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const m = Math.min(1, Math.max(0, shade(x / W, y / H)))
      const b = Math.round(m * 255)
      const i = (y * W + x) * 4
      // 极轻微暖偏（硬木偏暖 / 草皮偏中性），与室内 wood 同手法
      d[i] = Math.min(255, b + 2)
      d[i + 1] = b
      d[i + 2] = Math.max(0, b - 2)
      d[i + 3] = 255
    }
  }
  ctx.putImageData(img, 0, 0)
}

// ═══════════════════════ 硬木地板 ═══════════════════════

const HW_W = 512
const HW_H = 432
const HW_PW = 0.4 / 7 // 板宽 57mm —— 真实球馆硬木板条宽度（NBA 标准 ≈2.25"）
const HW_PL = 1.3 // 板长（= tile 宽）
const HW_ROWS = 7 // tile 内行数（7 × (3/7)×1.3 错缝 = 3 × 1.3 → 端缝闭合）

/**
 * 球馆硬木地板：板条结构 + 细木纹 + 漆面光泽 + 磨损。
 *
 * 结构参数：板宽 57mm / 板长 1.3m / 隔行错缝 3/7×PL（7 行后相位精确闭合，
 * tile 无缝平铺）。全部落到像素级：缝线 ≈2px 锐利、每行板 hash 色差、板内
 * 木纹沿板长走向带随机弯曲、低频亮带模拟漆面反光的「光泽变化」——
 * 掠射视角下这是真实球馆照片感的第一来源。
 */
function buildHardwood(): CanvasTexture {
  const { cv, ctx } = newCanvas(HW_W, HW_H)
  const pxmx = HW_W / HARDWOOD_TILE.x
  const pxmy = HW_H / HARDWOOD_TILE.y
  const ph = makeSeededRng(7703)() * Math.PI * 2

  paintMul(ctx, HW_W, HW_H, (uu, vv) => {
    const wx = uu * HARDWOOD_TILE.x
    const wy = vv * HARDWOOD_TILE.y
    const row = Math.min(HW_ROWS - 1, Math.floor(wy / HW_PW))
    const yLocal = wy - row * HW_PW

    // 错缝：第 r 行端缝 offset = (r × 3/7 × 1.3) % 1.3
    const off = ((row * 3) / 7 * HW_PL) % HW_PL
    const seamX = (wx - off + HW_PL) % HW_PL

    // 行间色差：每行板一个乘数（0.96~1.02）
    let mul = 0.965 + hash2(row, 7) * 0.055
    // 板段间色差：每行 1 道端缝 → 2 段
    mul += (hash2(row, seamX > HW_PL / 2 ? 11 : 23) - 0.5) * 0.03

    // 细木纹：沿板长走向（x 方向），带低频弯曲 warp
    const warp = Math.sin(wx * 4.2 + row * 2.1 + ph) * 0.9 + Math.sin(wx * 11.3 - row - ph) * 0.35
    const line = Math.sin((yLocal + warp * 0.02) * 260 + row * 5 + ph * 3)
    mul += (line - 0.5) * 0.048

    // 次级木纤维束（更低频更宽）
    const fiber = Math.sin((yLocal + warp * 0.035) * 62 - row * 3 + ph)
    mul += (fiber - 0.5) * 0.028

    // 漆面光泽：沿板长的低频亮带（掠射反光不均 —— 照片感核心）
    const sheen = Math.sin(wx * 2.4 + row * 1.7 + ph * 0.7)
    mul += Math.max(0, sheen) * 0.055

    // 磨损：低频明暗（人走区域抛光发亮）
    mul += tileNoise(uu, vv, 2.1, 1.7, ph * 0.4) * 0.018

    // 细颗粒
    mul += (hash2(Math.floor(uu * HW_W), Math.floor(vv * HW_H)) - 0.5) * 0.03

    // 板缝：纵缝（行间）与端缝，≈2.5px 暗线
    const dRow = Math.min(yLocal, HW_PW - yLocal) * pxmy
    const dEnd = Math.min(seamX, HW_PL - seamX) * pxmx
    const seam = Math.min(dRow, dEnd)
    if (seam < 2.5) {
      mul *= 0.62 + (seam / 2.5) * 0.2
    }

    return mul
  })

  return new CanvasTexture(cv)
}

// ═══════════════════════ 草皮 ═══════════════════════

const GR_N = 512

/**
 * 草皮细节层：细草纹 + 磨损白斑 + 中频色块。
 *
 * ⚠️ 刻意**不画割草条带** —— 条带明暗由顶点色负责（1.6m 交替，与贴图
 * tile 相位无关），贴图若再画条带，两者相位一旦错开半条带就会互相抵消
 * 成均匀色。本层全部用相位无关的噪声：怎么平铺都不会与顶点色打架。
 *
 * 相比旧顶点色 hash 噪声（±0.025 HSL，约 8cm 大颗粒）：像素级草纹在
 * 掠射视角下呈现连续的「草坪绒面」，磨损斑给出真实球场的使用痕迹。
 */
function buildGrass(): CanvasTexture {
  const { cv, ctx } = newCanvas(GR_N, GR_N)
  const ph = makeSeededRng(8909)() * Math.PI * 2

  paintMul(ctx, GR_N, GR_N, (u, v) => {
    // 细草纹：两交叉高频噪声（草叶感，各向异性轻微——横向略拉长）
    const blade =
      tileNoise(u, v, 113, 97, ph) * 0.5 + tileNoise(u, v, 173, 149, ph * 1.9) * 0.5
    // 中频色块：修剪痕/草簇不匀
    const clump = tileNoise(u, v, 17, 13, ph * 1.3)
    // 大尺度磨损：中路/禁区白化发黄
    const wear = tileNoise(u, v, 3.1, 2.3, ph * 0.5)
    // 细颗粒
    const grit = (hash2(Math.floor(u * GR_N), Math.floor(v * GR_N)) - 0.5) * 0.03
    return 1.0 + blade * 0.058 + clump * 0.036 + wear * 0.04 + grit
  })

  // 磨损白斑：稀疏浅色椭圆（发黄的踩秃区），面积小、对比温和
  const rng = makeSeededRng(9311)
  for (let i = 0; i < 10; i++) {
    const x = rng() * GR_N
    const y = rng() * GR_N
    const r = 6 + rng() * 14
    const a = 0.1 + rng() * 0.08
    ctx.fillStyle = `rgba(255,255,240,${a})`
    ctx.beginPath()
    ctx.ellipse(x, y, r, r * (0.5 + rng() * 0.5), rng() * Math.PI, 0, Math.PI * 2)
    ctx.fill()
  }

  return new CanvasTexture(cv)
}

// ═══════════════════════ 离线断言支持 ═══════════════════════

/**
 * 贴图像素统计（显示空间 + 线性空间），归一化 0~1。
 *
 * 场馆地面允许暗结构线（见文件头），断言口径与室内铁律不同：
 * 重点看 mean（整体不能明显压暗顶点色）与 linMin（结构线下限）。
 * 需要 `document`；无 canvas 环境抛错，调用方 try/catch 跳过。
 */
export function __courtTexStats(kind: CourtTexKind): {
  mean: number
  std: number
  min: number
  linMean: number
  linMin: number
} {
  const tex = getCourtTexture(kind)
  const cv = tex.image as HTMLCanvasElement
  const ctx = cv.getContext("2d")!
  const { data } = ctx.getImageData(0, 0, cv.width, cv.height)
  let sum = 0
  let sumSq = 0
  let min = 1
  let linSum = 0
  let linMin = 1
  let n = 0
  for (let i = 0; i < data.length; i += 4) {
    const l = (data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114) / 255
    sum += l
    sumSq += l * l
    if (l < min) min = l
    const lin =
      srgbToLinear(data[i] / 255) * 0.299 +
      srgbToLinear(data[i + 1] / 255) * 0.587 +
      srgbToLinear(data[i + 2] / 255) * 0.114
    linSum += lin
    if (lin < linMin) linMin = lin
    n++
  }
  const mean = sum / n
  const std = Math.sqrt(Math.max(0, sumSq / n - mean * mean))
  return { mean, std, min, linMean: linSum / n, linMin }
}

function srgbToLinear(c: number): number {
  const v = Math.min(1, Math.max(0, c))
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
}
