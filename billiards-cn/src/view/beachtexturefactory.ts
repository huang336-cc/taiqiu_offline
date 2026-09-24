import {
  CanvasTexture,
  RepeatWrapping,
  SRGBColorSpace,
  Texture,
} from "three"
import { fbm2D, makeSeededRng, makeValueNoise2D } from "../utils/noise"

/**
 * 沙滩场景程序化贴图工厂（v1.3.84j）。
 *
 * 全部为「程序化 Canvas 贴图」，零外部图片资源 —— 与 project 里
 * `cuetexturefactory.ts` 同一套路：
 * 离线可用、不增加 APK 体积、不存在加载失败。
 *
 * ══════════════════════════════════════════════════════════════════════
 * ⚠️ 最关键的一条约束：这些贴图必须「接近白」
 * ══════════════════════════════════════════════════════════════════════
 *
 * 沙滩环境用的是 `envMaterial()`，即
 * `MeshBasicMaterial({ vertexColors: true, toneMapped: false, fog: false })`。
 * three 的着色器里顶点色与贴图是**相乘**关系：
 *
 *     finalColor = vertexColor × textureColor      （map_fragment × color_fragment）
 *
 * 而沙滩的顶点色**已经是「烘焙好的最终显示色」** —— 光照（AMB + SUN·N·L）、
 * 大气透视（haze）全部提前算进了顶点色里。所以贴图在这里只能当**细节层**：
 * 提供颗粒感、斑驳感，而**不是**提供颜色。
 *
 * 一旦贴图明度低于 0.8，就会把已经算好的顶点色**整体压暗** —— 表现为画面
 * 发灰、发闷、像蒙了一层脏东西。因此本工厂有一条铁律：
 *
 *     所有贴图像素的明度 ≥ 0.8（≈ 204/255），平均明度 ≈ 0.88~0.95。
 *
 * 颜色（沙的暖金、岩石的灰褐）全部由 sceneenvironment.ts 的顶点色负责，
 * 这里只画「明暗纹理」。`__texStats()` 导出了像素统计，供离线断言这条铁律。
 *
 * ══════════════════════════════════════════════════════════════════════
 * ⚠️ 生命周期：必须模块级 cache 长期持有
 * ══════════════════════════════════════════════════════════════════════
 *
 * `assets.ts` 的 `disposeEnvGroup()` 只 dispose 几何体与材质；three 的
 * `Material.dispose()` **不会** dispose `material.map`。而环境有 LRU 缓存
 * （上限 3），切换场景时会被淘汰并 dispose。于是：
 *
 *   · 贴图若放进这个模块级 cache → 长期持有，淘汰环境不泄漏、不重建 ✅
 *   · 贴图若每 `new` 一次 → 环境淘汰后无人释放，持续泄漏 ❌
 *   · 贴图若用 `material.map.clone()` → clone 出的对象无人持有，泄漏 ❌
 *
 * 所以：**不同 repeat 的贴图要各自预建一张**（如 sand / sandFar），
 * 全部走 cache，**绝不 clone**。
 */

/** 贴图种类 */
export type BeachTexKind = "sand" | "sandFar" | "rock" | "foliage"

const cache = new Map<BeachTexKind, Texture>()

/**
 * 取沙滩贴图。首次调用时绘制并缓存。
 *
 * 注意：本函数在**运行时**调用（需要 `document`），模块加载时不执行任何
 * 绘制 —— 所以 node 里可以安全 `require` 本模块做几何构建验证。
 */
export function getBeachTexture(kind: BeachTexKind): Texture {
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

// ══════════════════════════════════════════════════════════════════════
//                        确定性随机
// ══════════════════════════════════════════════════════════════════════

/**
 * 确定性线性同余随机。刻意**不**用 `Math.random()`：
 * 贴图每次构建都必须完全一致，否则同一场景多次进出会出现纹理「闪烁」。
 */
let _seed = 1
function srand(s: number): void {
  _seed = (s | 0) || 1
}
function rnd(): number {
  _seed = (_seed * 1103515245 + 12345) & 0x7fffffff
  return _seed / 0x7fffffff
}
function rr(a: number, b: number): number {
  return a + rnd() * (b - a)
}

/** 明度（0~255）→ 中性灰的 CSS 颜色字符串 */
function gray(v: number): string {
  const c = Math.round(Math.min(255, Math.max(0, v)))
  return `rgb(${c},${c},${c})`
}

/** 带极轻微暖偏的灰（沙用）—— 仍保持高明度，只加一丝暖意 */
function warmGray(v: number): string {
  const c = Math.round(Math.min(255, Math.max(0, v)))
  const r = Math.min(255, c + 3)
  const b = Math.max(0, c - 4)
  return `rgb(${r},${c},${b})`
}

// ══════════════════════════════════════════════════════════════════════
//                        四种贴图的绘制
// ══════════════════════════════════════════════════════════════════════

const SAND_SIZE = 256
const FOLIAGE_SIZE = 128

function build(kind: BeachTexKind): CanvasTexture {
  switch (kind) {
    case "sand":
      return buildSand()
    case "sandFar":
      return buildSandFar()
    case "rock":
      return buildRock()
    case "foliage":
      return buildFoliage()
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
 * 近景沙：细密颗粒 + 低频疏密斑。
 *
 * 目标是「凑近看有沙粒感，远看仍是一片均匀的暖沙」。所以：
 *   · 高频层 —— ~4000 个 1~2px 亮点/暗点，模拟沙粒
 *   · 低频层 —— 几团大半径径向渐变，制造「有的地方沙更细、有的更糙」
 */
function buildSand(): CanvasTexture {
  const { cv, ctx } = newCanvas(SAND_SIZE, SAND_SIZE)
  const N = SAND_SIZE

  // 底色：暖白（明度 240）
  ctx.fillStyle = warmGray(240)
  ctx.fillRect(0, 0, N, N)

  // 低频疏密斑：3~5 团大范围柔和明暗
  srand(7001)
  const blobCount = 4
  for (let i = 0; i < blobCount; i++) {
    const cx = rnd() * N
    const cy = rnd() * N
    const r = 34 + rnd() * 46
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r)
    const dark = rnd() > 0.5
    // alpha 刻意压得很低（0.10~0.16）：既要疏密不均，又不能破坏「接近白」
    const a = 0.1 + rnd() * 0.06
    g.addColorStop(0, dark ? `rgba(196,194,186,${a})` : `rgba(255,255,252,${a})`)
    g.addColorStop(1, "rgba(0,0,0,0)")
    ctx.fillStyle = g
    ctx.beginPath()
    ctx.arc(cx, cy, r, 0, Math.PI * 2)
    ctx.fill()
  }

  // 高频沙粒：4000 个小点
  srand(7331)
  for (let i = 0; i < 4000; i++) {
    const x = rnd() * N
    const y = rnd() * N
    const s = 1 + Math.floor(rnd() * 2) // 1~2px
    // 明度 210~255：最暗也远高于 204 的铁律下限
    const v = 210 + Math.floor(rnd() * 46)
    ctx.fillStyle = rnd() > 0.5 ? gray(v) : `rgba(205,203,196,0.85)`
    ctx.fillRect(x, y, s, s)
  }

  // 极少量小石子/贝壳碎屑：稍大、稍暗，但仍 ≥205
  srand(7919)
  for (let i = 0; i < 90; i++) {
    const x = rnd() * N
    const y = rnd() * N
    const s = 2 + rnd() * 2.5
    ctx.fillStyle = `rgba(206,204,198,0.8)`
    ctx.beginPath()
    ctx.ellipse(x, y, s, s * 0.7, rnd() * Math.PI, 0, Math.PI * 2)
    ctx.fill()
  }

  return new CanvasTexture(cv)
}

/**
 * 远景沙：风纹为主，整体更平更亮。
 *
 * 远处的沙地细节在掠射视角下看不见，画颗粒纯属浪费 —— 改为「横向风纹」，
 * 这是真实沙滩在远景里唯一能读出来的纹理（风吹出来的平行沙脊）。
 */
function buildSandFar(): CanvasTexture {
  const { cv, ctx } = newCanvas(SAND_SIZE, SAND_SIZE)
  const N = SAND_SIZE

  ctx.fillStyle = warmGray(244)
  ctx.fillRect(0, 0, N, N)

  // 风纹：逐行明暗正弦，相位上加噪声让波纹不呆板
  const phaseNoise = makeSeededRng(5107)
  const phase = phaseNoise() * Math.PI * 2
  const img = ctx.getImageData(0, 0, N, N)
  const d = img.data
  for (let y = 0; y < N; y++) {
    // 两条不同频率的正弦叠加 → 更自然的沙脊间距
    const w =
      Math.sin(y * 0.35 + phase) * 9 +
      Math.sin(y * 0.13 + phase * 1.7) * 5
    const v = 236 + w
    for (let x = 0; x < N; x++) {
      // 沿水平方向再加一点极缓的起伏，避免整行完全一致
      const wx = Math.sin(x * 0.06 + phase) * 2.5
      const c = Math.round(Math.min(255, Math.max(205, v + wx)))
      const i = (y * N + x) * 4
      d[i] = Math.min(255, c + 3)
      d[i + 1] = c
      d[i + 2] = Math.max(0, c - 4)
      d[i + 3] = 255
    }
  }
  ctx.putImageData(img, 0, 0)

  // 稀疏砂砾，压一点呆板感（数量远少于近景）
  srand(5209)
  for (let i = 0; i < 500; i++) {
    const x = rnd() * N
    const y = rnd() * N
    ctx.fillStyle = `rgba(214,212,205,0.7)`
    ctx.fillRect(x, y, 1 + rnd() * 1.5, 1)
  }

  return new CanvasTexture(cv)
}

/**
 * 岩石：fbm 斑驳 + 深色斑点。
 *
 * 岩石的「灰褐色」由顶点色给，这里只画**凹凸斑驳感**。所以要特别小心：
 * fbm 的振幅必须收窄（明度锁在 224~255），否则会在岩石表面糊出大片深色
 * 云斑，看起来像发霉。
 */
function buildRock(): CanvasTexture {
  const { cv, ctx } = newCanvas(SAND_SIZE, SAND_SIZE)
  const N = SAND_SIZE

  ctx.fillStyle = gray(240)
  ctx.fillRect(0, 0, N, N)

  // fbm 斑驳：3 个八度，铺满整张
  const nA = makeValueNoise2D(9137)
  const nB = makeValueNoise2D(4211)
  const img = ctx.getImageData(0, 0, N, N)
  const d = img.data
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const u = x / N
      const v = y / N
      const f = fbm2D(nA, u * 4.5, v * 4.5, 3)
      const det = fbm2D(nB, u * 13, v * 13, 2)
      // 明度锁 226~254：斑驳要有，但整体必须接近白
      const base = 238 + (f - 0.5) * 22 + (det - 0.5) * 10
      const c = Math.round(Math.min(254, Math.max(226, base)))
      const i = (y * N + x) * 4
      // 极轻微冷偏（石头比沙冷一点），但亮度仍高
      d[i] = c
      d[i + 1] = c
      d[i + 2] = Math.min(255, c + 4)
      d[i + 3] = 255
    }
  }
  ctx.putImageData(img, 0, 0)

  // 深色矿点：150 个小斑，明度 226（对比明显但不发黑）
  srand(6151)
  for (let i = 0; i < 150; i++) {
    const x = rnd() * N
    const y = rnd() * N
    const r = 1.4 + rnd() * 2.4
    const c = 226 + Math.floor(rnd() * 8)
    ctx.fillStyle = `rgba(${c},${c},${Math.min(255, c + 3)},0.75)`
    ctx.beginPath()
    ctx.arc(x, y, r, 0, Math.PI * 2)
    ctx.fill()
  }

  // 裂纹：几道细线，让石头有「面」（低多边形石头最缺的就是面与面的分界）
  srand(6277)
  ctx.strokeStyle = "rgba(210,208,204,0.55)"
  for (let i = 0; i < 9; i++) {
    ctx.lineWidth = 1 + rnd() * 1.6
    ctx.beginPath()
    let x = rnd() * N
    let y = rnd() * N
    ctx.moveTo(x, y)
    const segs = 3 + Math.floor(rnd() * 4)
    for (let k = 0; k < segs; k++) {
      x += rr(-40, 40)
      y += rr(-40, 40)
      ctx.lineTo(x, y)
    }
    ctx.stroke()
  }

  return new CanvasTexture(cv)
}

/**
 * 植被：镂空叶片剪影。
 *
 * 只画「叶簇的明暗」—— 叶色由顶点色给。做成一团团重叠的椭圆，
 * 模拟叶片在枝上散开的样子；明度 232~255，保持接近白。
 */
function buildFoliage(): CanvasTexture {
  const { cv, ctx } = newCanvas(FOLIAGE_SIZE, FOLIAGE_SIZE)
  const N = FOLIAGE_SIZE

  ctx.fillStyle = gray(238)
  ctx.fillRect(0, 0, N, N)

  srand(8761)
  // 60 片叶：随机位置、随机朝向的椭圆
  for (let i = 0; i < 60; i++) {
    const x = rnd() * N
    const y = rnd() * N
    const rx = 7 + rnd() * 13
    const ry = rx * (0.32 + rnd() * 0.28) // 细长叶形
    const rot = rnd() * Math.PI
    const v = 234 + Math.floor(rnd() * 21) // 234~254
    ctx.fillStyle = `rgba(${v},${Math.min(255, v + 2)},${v},0.9)`
    ctx.beginPath()
    ctx.ellipse(x, y, rx, ry, rot, 0, Math.PI * 2)
    ctx.fill()
  }

  // 叶脉：每片叶加一道更亮的细线，增加「叶」的可读性
  srand(8823)
  ctx.lineWidth = 1
  for (let i = 0; i < 26; i++) {
    const x = rnd() * N
    const y = rnd() * N
    const len = 12 + rnd() * 22
    const rot = rnd() * Math.PI
    ctx.strokeStyle = `rgba(252,254,252,0.5)`
    ctx.beginPath()
    ctx.moveTo(x, y)
    ctx.lineTo(x + Math.cos(rot) * len, y + Math.sin(rot) * len)
    ctx.stroke()
  }

  return new CanvasTexture(cv)
}

// ══════════════════════════════════════════════════════════════════════
//                      离线断言支持（沙箱无 GPU）
// ══════════════════════════════════════════════════════════════════════

/**
 * 返回贴图的像素统计（明度均值 / 标准差 / 最小值），归一化到 0~1。
 *
 * 用途：沙箱里没有 GPU、看不到渲染结果，但可以通过这个函数断言
 * **「贴图不会把画面压暗」** 这条铁律是否成立：
 *   · mean ≥ 0.80 —— 平均明度够高
 *   · min  ≥ 0.78 —— 没有大片暗区
 *   · std  ≥ 0.01 —— 不是一张纯色（真的画了纹理）
 *
 * 需要 `document`（运行时）。若环境无 canvas 能力，本函数会抛错，
 * 调用方应 try/catch 后跳过。
 */
export function __texStats(kind: BeachTexKind): {
  mean: number
  std: number
  min: number
} {
  const tex = getBeachTexture(kind)
  const cv = tex.image as HTMLCanvasElement
  const ctx = cv.getContext("2d")!
  const { data } = ctx.getImageData(0, 0, cv.width, cv.height)
  let sum = 0
  let sumSq = 0
  let min = 1
  let n = 0
  for (let i = 0; i < data.length; i += 4) {
    // 感知明度：绿通道权重最高
    const l = (data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114) / 255
    sum += l
    sumSq += l * l
    if (l < min) min = l
    n++
  }
  const mean = sum / n
  const variance = Math.max(0, sumSq / n - mean * mean)
  return { mean, std: Math.sqrt(variance), min }
}
