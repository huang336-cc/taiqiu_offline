import { CanvasTexture, RepeatWrapping, SRGBColorSpace, Texture } from "three"
import { makeSeededRng } from "../utils/noise"

/**
 * 室内场景程序化贴图工厂（v1.3.84l）。
 *
 * 与 `beachtexturefactory.ts` 同一套路：程序化 Canvas 绘制、零外部图片
 * 资源、模块级 cache 长期持有。
 *
 * ══════════════════════════════════════════════════════════════════════
 * ⚠️ 与沙滩完全相同的铁律：贴图必须是「接近白」的细节层
 * ══════════════════════════════════════════════════════════════════════
 *
 * 室内环境同样用 `envMaterial()`
 * （`MeshBasicMaterial({ vertexColors: true, toneMapped: false, fog: false })`）。
 * three 着色器里顶点色与贴图是**相乘**关系，而且**两者都先解码到线性空间**：
 *
 *     linearOut = srgbToLinear(vertexColor) × srgbToLinear(texture)
 *     finalColor = linearToSrgb(linearOut)
 *
 * 而室内地面/墙面的顶点色**已经是烘焙好的最终显示色** —— 环境光（AMB）、
 * 太阳（SUN·N·L）、灯光池衰减（lamps）、地面反弹光（bounce）、大气透视
 * （haze）全部提前算进去了。所以贴图在这里只能当**细节层**：提供纤维感、
 * 木纹、水泥颗粒，而**不是**提供颜色。
 *
 * ──────────────────────────────────────────────────────────────────────
 * v1.3.84l 修正：下限要按**线性空间**算，不能按显示空间算
 * ──────────────────────────────────────────────────────────────────────
 *
 * 最初把铁律写成「明度 ≥ 0.80（显示空间）」，验证脚本里按 `min ≥ 0.78`
 * 卡。结果实测发现三张地面都暗了 13~22%：
 *
 *     场景        最暗保留   平均保留
 *     room        77.8%      86.9%
 *
 * 根因就是**空间搞错了**：0.78 在显示空间解码到线性只有 0.57 —— 相当于
 * 每个片元被乘 0.57，画面当然暗。sRGB 传递函数在暗部斜率大，显示空间看
 * 起来「只差 22%」，线性空间实际差 43%。
 *
 *     显示值 → 线性乘数：0.90→0.787  0.93→0.845  0.95→0.890  0.96→0.914
 *
 * 所以铁律改为按**线性乘数**定：任何像素解码后 ≥ 0.85（≈ 显示 0.93），
 * 这样即使是最暗的绒面/木节，地面亮度衰减也在 15% 以内。
 *
 * 颜色全部由 `IndoorPalette` 的 `floor` 回调负责，这里只画明暗纹理。
 * `__texStats()` 导出像素统计（含线性均值）供离线断言。
 *
 * ══════════════════════════════════════════════════════════════════════
 * ⚠️ 生命周期：必须模块级 cache 长期持有（同沙滩）
 * ══════════════════════════════════════════════════════════════════════
 *
 * `assets.ts:disposeEnvGroup()` 只 dispose 几何体与材质；three 的
 * `Material.dispose()` **不会** dispose `material.map`。环境 LRU 上限 3，
 * 切换场景会淘汰并 dispose。于是贴图必须走本模块的 cache：
 *   · 放进 cache → 长期持有，淘汰环境不泄漏、不重建 ✅
 *   · 每次 `new` → 环境淘汰后无人释放，持续泄漏 ❌
 *   · `material.map.clone()` → clone 对象无人持有，泄漏 ❌
 *
 * 不同 repeat 的贴图要**各自预建一张**，全部走 cache，**绝不 clone**。
 */

/**
 * 贴图种类。
 *
 *  - `wood`     —— 浅色木地板（room 主地面，细密直纹）
 *  - `carpet`   —— 方块地毯（平铺软地面）
 *  - `stone`    —— 哑光石材质感地砖
 *  - `concrete` —— 水泥/环氧（走道、过道这类次级地面）
 */
export type InteriorTexKind = "carpet" | "wood" | "stone" | "concrete"

const cache = new Map<InteriorTexKind, Texture>()

/**
 * 取室内贴图。首次调用时绘制并缓存。
 *
 * 注意：本函数在**运行时**调用（需要 `document`），模块加载时不执行任何
 * 绘制 —— 所以 node 里可以安全 `require` 本模块做几何构建验证。
 */
export function getInteriorTexture(kind: InteriorTexKind): Texture {
  const hit = cache.get(kind)
  if (hit) return hit
  const tex = build(kind)
  finalize(tex)
  cache.set(kind, tex)
  return tex
}

function finalize(tex: Texture): void {
  tex.wrapS = RepeatWrapping
  tex.wrapT = RepeatWrapping
  tex.colorSpace = SRGBColorSpace
  tex.anisotropy = 4
  tex.needsUpdate = true
}

// ───────────────────────── 确定性随机（同 beach 工厂）─────────────────────────

/** 确定性随机（seed → [0,1)）—— 木节位置用 */
let _seed = 1
function srand(s: number): void {
  _seed = (s | 0) || 1
}
function rnd(): number {
  _seed = (_seed * 1103515245 + 12345) & 0x7fffffff
  return _seed / 0x7fffffff
}

// ───────────────────────── 绘制 ─────────────────────────

const SIZE = 256

function build(kind: InteriorTexKind): CanvasTexture {
  switch (kind) {
    case "carpet":
      return buildCarpet()
    case "wood":
      return buildWood()
    case "stone":
      return buildStone()
    case "concrete":
      return buildConcrete()
  }
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
 * 逐像素画一张灰度细节层。
 *
 * ══════════════════════════════════════════════════════════════════════
 * 为什么必须逐像素写，而不是「底色 + 稀疏点阵」
 * ══════════════════════════════════════════════════════════════════════
 *
 * 稀疏点阵的问题在**覆盖率**：256×256 上撒 18000 个 1px 点，最多覆盖
 * 27% 的像素，其余 73% 全是**同一个底色**。这会让直方图在底色处堆成一根
 * 尖峰 —— 标准差自然上不去（实测 carpet std 只有 0.004，而判据要 0.008）。
 *
 * 更糟的是这种情况**没法通过调亮度解决**：把点画得更暗只会拉低 `linMin`
 * 而 std 几乎不动（因为大部分像素根本没被碰到）。
 *
 * 逐像素写则让**每个像素都参与**，明暗分布是连续的，std 直接由噪声幅度
 * 决定 —— 想调对比就调幅度，不会伤到 `linMin`（只要均值守在安全线上）。
 *
 * @param shade 输入 (u, v) ∈ [0,1)，输出**明度 0~1**。
 *              调用方负责把结果钳在铁律允许的 [0.871, 1.0] 内（见文件头）。
 */
function paintPixels(
  ctx: CanvasRenderingContext2D,
  N: number,
  shade: (u: number, v: number) => number
): void {
  const img = ctx.getImageData(0, 0, N, N)
  const d = img.data
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      // 明度 → 0~255，钳到 [240, 255]：下限 240 对应线性 0.871，
      // 是铁律（linMin ≥ 0.85）之上留了余量的安全线
      const l = Math.min(1, Math.max(0, shade(x / N, y / N)))
      const v = Math.round(Math.min(255, Math.max(240, l * 255)))
      const i = (y * N + x) * 4
      d[i] = v
      d[i + 1] = v
      d[i + 2] = v
      d[i + 3] = 255
    }
  }
  ctx.putImageData(img, 0, 0)
}

/**
 * 二维值噪声（确定性、可平铺）。
 *
 * 用两个不同频率的正弦叠加代替真随机 —— 好处是**天然无缝**（正弦在
 * [0,1) 上周期闭合），不会在贴图接缝处出现断线。室内地面 repeat 高达
 * 20 次，一道接缝就是 20 条可见的直线。
 */
function tileNoise(u: number, v: number, fu: number, fv: number, ph: number): number {
  return (
    Math.sin(u * fu * Math.PI * 2 + ph) * Math.cos(v * fv * Math.PI * 2 - ph) +
    Math.sin(u * fu * 2.7 * Math.PI * 2 - ph * 1.7) *
      Math.cos(v * fv * 2.3 * Math.PI * 2 + ph * 0.6)
  )
}

/**
 * 方块地毯：短绒纤维 + 极缓的明暗块。
 *
 * 地毯的视觉特征是**方向性极弱的短绒** —— 不像木纹有明显线条。这里用
 * 高频细噪声（绒感）+ 低频缓噪声（踩压/倒伏）两层叠加。
 *
 * ⚠️ 明度钳在 [240, 255]（线性 ≥0.871），见文件头铁律。
 */
function buildCarpet(): CanvasTexture {
  const { cv, ctx } = newCanvas(SIZE, SIZE)
  const N = SIZE
  const ph = makeSeededRng(3101)() * Math.PI * 2

  paintPixels(ctx, N, (u, v) => {
    // 高频绒感：绒毛倒伏方向极随机 → 用两个交叉高频噪声
    const fuzz = tileNoise(u, v, 97, 91, ph) * 0.5 + tileNoise(u, v, 151, 143, ph * 2.3) * 0.5
    // 低频缓块：踩压/磨损造成的大尺度不匀
    const low = tileNoise(u, v, 3.1, 2.7, ph * 0.7)
    // 中心明度 0.9628（≈246/255），上下各留一点余量
    //   绒感 ±0.030 → 246±7.6 → [238.4, 253.6]
    //   缓块 ±0.018 → 再 ±4.6
    // 钳位后落在 [240, 255]，线性 ≥0.871 ✅
    return 0.9628 + fuzz * 0.030 + low * 0.018
  })

  return new CanvasTexture(cv)
}

/**
 * 橡木地板：纵向直纹 + 稀疏木节。
 *
 * 木板纹理在室内是**强方向性**的（沿房间长边铺），但顶点色已经用
 * `roomFloor` 画了板缝与条纹 —— 这里只补**板面内部的细木纹**，
 * 密度要高、对比要低，否则会和顶点色的板缝打架。
 *
 * v1.3.84l：明度区间由 228~254 上抬到 246~255（线性 ≥0.92），木节同步提亮。
 */
function buildWood(): CanvasTexture {
  const { cv, ctx } = newCanvas(SIZE, SIZE)
  const N = SIZE

  // 逐像素写：木纹 = 沿 v 的高频正弦 × 沿 u 的低频扰动。
  // 这里不用 paintPixels，因为橡木需要**轻微暖偏**（R 略高于 B）。
  const wob = makeSeededRng(4409)
  const ph = wob() * Math.PI * 2
  const img = ctx.getImageData(0, 0, N, N)
  const d = img.data
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      // 纹理沿 y 方向走（与 roomFloor 的板缝方向一致）
      const u = x / N
      const v = y / N
      // 主纹：高频细线；用 u 做相位扰动 → 纹路不是死板直线
      const warp = Math.sin(u * 6.2 + ph) * 0.8 + Math.sin(u * 15.7 - ph) * 0.35
      const line = Math.sin((v + warp * 0.06) * 78 + ph * 3)
      // 次级纹：更低频、更宽的木纤维束
      const fiber = Math.sin((v + warp * 0.09) * 19 - ph * 2)
      // 明度锁 240~255：木纹要看得见，但整体必须接近白（线性 ≥0.871）
      const base = 246 + line * 7 + fiber * 4
      const c = Math.round(Math.min(255, Math.max(240, base)))
      const i = (y * N + x) * 4
      // 极轻微暖偏（橡木偏黄）—— 但 B 通道也守 240 下限，否则 linMin 被它拽破
      d[i] = Math.min(255, c + 3)
      d[i + 1] = c
      d[i + 2] = Math.max(240, c - 3)
      d[i + 3] = 255
    }
  }
  ctx.putImageData(img, 0, 0)

  // 木节：稀疏的几个深色小斑（明度 241，对比明显但线性仍 ≥0.875）
  srand(4513)
  for (let i = 0; i < 14; i++) {
    const x = rnd() * N
    const y = rnd() * N
    const rx = 1.2 + rnd() * 2.0
    const ry = rx * (1.6 + rnd() * 1.4)
    const c = 241 + Math.floor(rnd() * 8)
    ctx.fillStyle = `rgba(${c},${c - 2},${c - 4},0.7)`
    ctx.beginPath()
    ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2)
    ctx.fill()
  }

  return new CanvasTexture(cv)
}

/**
 * 深色地砖：哑光微颗粒。
 *
 * 地砖本身颜色由顶点色负责，贴图只补**细微颗粒感**，
 * 让掠射下的大片地面不至于是一块死板渐变。
 *
 * ⚠️ 明度钳在 [240, 255]（线性 ≥0.871），见文件头铁律。
 */
function buildStone(): CanvasTexture {
  const { cv, ctx } = newCanvas(SIZE, SIZE)
  const N = SIZE
  const ph = makeSeededRng(5209)() * Math.PI * 2

  paintPixels(ctx, N, (u, v) => {
    // 细颗粒：两个高频噪声交叉 → 砂粒感（各向同性）
    const grit = tileNoise(u, v, 131, 127, ph) * 0.5 + tileNoise(u, v, 197, 191, ph * 1.9) * 0.5
    // 大尺度水渍/磨损：低频，很缓
    const wear = tileNoise(u, v, 2.3, 3.7, ph * 0.5)
    // 颗粒对比比地毯略小（哑光石材），但比原来大 —— 要能通过 std 判据
    return 0.9608 + grit * 0.028 + wear * 0.016
  })

  return new CanvasTexture(cv)
}

/**
 * 水泥/环氧：大尺度斑驳 + 细骨料。
 *
 * 用在「走道」这类次级地面。它要在视觉上比主地面**更粗糙** ——
 * 低频斑驳最明显，这是几张里对比最大的一张。
 *
 * ⚠️ 明度钳在 [240, 255]（线性 ≥0.871），见文件头铁律。
 */
function buildConcrete(): CanvasTexture {
  const { cv, ctx } = newCanvas(SIZE, SIZE)
  const N = SIZE
  const ph = makeSeededRng(6113)() * Math.PI * 2

  paintPixels(ctx, N, (u, v) => {
    // 细骨料：高频颗粒
    const grit = tileNoise(u, v, 109, 103, ph * 1.3) * 0.5 + tileNoise(u, v, 163, 157, ph) * 0.5
    // 中尺度：浇筑接痕/抹平纹路
    const trowel = tileNoise(u, v, 5.3, 4.1, ph * 0.8)
    // 大尺度斑驳：水泥固有的大块色差（对比最大的那层）
    const blotch = tileNoise(u, v, 1.7, 2.1, ph * 0.35)
    return 0.9608 + grit * 0.020 + trowel * 0.022 + blotch * 0.030
  })

  return new CanvasTexture(cv)
}

// ══════════════════════════════════════════════════════════════════════
//                      离线断言支持（沙箱无 GPU）
// ══════════════════════════════════════════════════════════════════════

/**
 * 返回贴图的像素统计，归一化到 0~1。
 *
 * 用途：沙箱里没有 GPU、看不到渲染结果，但可以通过这个函数断言
 * **「贴图不会把画面压暗」** 这条铁律是否成立。
 *
 * ⚠️ v1.3.84l：判据必须在**线性空间**，不能只看显示空间。
 *
 * 显示空间（`mean` / `min` / `std`）看的是「画得像不像白纸」，方便人读；
 * 但 three 实际是 `linear(顶点色) × linear(贴图)`，压暗效果由**线性乘数**
 * 决定。sRGB 在暗部斜率大 —— 显示 0.90 解码后只剩 0.787，显示 0.78 只剩
 * 0.571。所以真正该卡的下限是 `linMin`：
 *
 *     linMin ≥ 0.85  ≈ 显示 0.93  → 最坏情况下地面衰减 ≤ 15%
 *
 * 需要 `document`（运行时）。若环境无 canvas 能力，本函数会抛错，
 * 调用方应 try/catch 后跳过。
 */
export function __texStats(kind: InteriorTexKind): {
  mean: number
  std: number
  min: number
  linMean: number
  linMin: number
} {
  const tex = getInteriorTexture(kind)
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
    // 感知明度：绿通道权重最高
    const l = (data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114) / 255
    sum += l
    sumSq += l * l
    if (l < min) min = l
    // 线性空间：三通道分别解码后取均值（与着色器逐通道相乘一致）
    const lin =
      (srgbToLinear(data[i] / 255) * 0.299 +
        srgbToLinear(data[i + 1] / 255) * 0.587 +
        srgbToLinear(data[i + 2] / 255) * 0.114)
    linSum += lin
    if (lin < linMin) linMin = lin
    n++
  }
  const mean = sum / n
  const std = Math.sqrt(Math.max(0, sumSq / n - mean * mean))
  return { mean, std, min, linMean: linSum / n, linMin }
}

/** sRGB 传递函数的反变换（显示空间 → 线性），与 three 内部一致 */
function srgbToLinear(c: number): number {
  const v = Math.min(1, Math.max(0, c))
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
}

/** 供离线验证：返回已缓存的贴图种类（确认 cache 没有被 clone 破坏） */
export function __cachedKinds(): InteriorTexKind[] {
  return Array.from(cache.keys())
}
