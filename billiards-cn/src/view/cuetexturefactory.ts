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
 * 【v1.3.51 分区重构】
 * 球杆几何由 cueShaft（前 71%）与 cueButt（后 28%）两段独立圆柱组成，
 * 原先两段共用同一张整根贴图，导致"握把 / 杆尾"分区无法对应设计描述。
 * 现拆成两张贴图：
 *   - 杆身贴图（getCueTexture）     ：画布上=杆头方向，画布下=接缝方向
 *   - 杆尾贴图（getCueButtTexture）：画布上=接缝方向，画布下=杆尾端
 *     分区：0 → GRIP_END 握把；GRIP_END → DECOR_END 杆尾装饰带；DECOR_END → 1 端盖
 *
 * 【v1.4.3 统一的定向光照层（实现见文件末段的 enhance）】
 * 此前所有主题的贴图都只是「平涂图案 + 颗粒」，展开图沿周向没有任何明暗分布，
 * 贴到圆柱后各角度亮度几乎一致 —— 看上去是一根没有体积的色管。
 * 实测 dist/previews/cue-*.jpg（260×120）后发现更严重的问题：12 款深色主题的
 * 有效像素仅占整图 1.2%~3.7%，最亮像素只有 79~190/255（亮色主题为 8.5%~9.1%、
 * 240），即"设计描述华丽、渲染结果却近于黑棍"。
 * 故在 19 款之上统一烘焙一层圆柱光照：背光暗面 + 受光亮面 + 镜面高光带 +
 * 边缘轮廓反光，强度随底图明度自适应（越暗越强，避免形体信息量为 0）。
 */

const W = 256 // 周向分辨率
const H = 1024 // 轴向（杆长）分辨率

/** 杆尾（butt）贴图的分区比例 */
const GRIP_END = Math.floor(H * 0.58) // 握把结束
const DECOR_END = Math.floor(H * 0.84) // 装饰带结束（之后为端盖）

/**
 * 【v1.4.3】接缝金属接环宽度（单位：贴图像素）。
 * 由 cuemesh 的几何换算而来：cueShaft 段映射 0.71L → 1024px，
 * cueButt 段映射 0.28L → 1024px。于是
 *   18px ÷ (0.71L/1024) = 0.0125L    46px ÷ (0.28L/1024) = 0.0126L
 * 二者几乎相等 —— shaft 贴图画布底端的半枚 + butt 贴图画布顶端的半枚，
 * 拼起来正好是一整枚宽度一致的接环，不会在两段 mesh 上出现粗细跳变。
 */
const JOINT_SHAFT = 18
const JOINT_BUTT = 46

const cache = new Map<string, Texture>()

// ==================== 确定性随机（保证每次构建贴图一致，避免闪烁）====================
let _seed = 1
function srand(s: number) {
  _seed = (s | 0) || 1
}
function rnd() {
  _seed = (_seed * 1103515245 + 12345) & 0x7fffffff
  return _seed / 0x7fffffff
}
function rr(a: number, b: number) {
  return a + rnd() * (b - a)
}

// ==================== 对外接口 ====================

/** 杆身贴图（cueShaft） */
export function getCueTexture(themeId: string): Texture | null {
  if (themeId === "auto") return null
  if (cache.has(themeId)) return cache.get(themeId)!
  const raw = build(themeId)
  if (!raw) return null
  // v1.4.3：接缝接环 + 轴向形体 + 周向定向光照
  const tex = enhance(raw, themeId, "shaft")
  finalize(tex)
  cache.set(themeId, tex)
  return tex
}

/** 杆尾贴图（cueButt）：握把 + 杆尾装饰 + 端盖 */
export function getCueButtTexture(themeId: string): Texture | null {
  if (themeId === "auto") return null
  const key = "butt:" + themeId
  if (cache.has(key)) return cache.get(key)!
  const raw = buildButt(themeId)
  if (!raw) {
    // 未单独绘制杆尾的主题沿用整根统一贴图，行为不变
    return getCueTexture(themeId)
  }
  const tex = enhance(raw, themeId, "butt")
  finalize(tex)
  cache.set(key, tex)
  return tex
}

function finalize(tex: Texture) {
  tex.wrapS = RepeatWrapping
  tex.wrapT = RepeatWrapping
  tex.colorSpace = SRGBColorSpace
  tex.anisotropy = 4
  tex.needsUpdate = true
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

// ==================== 通用绘制工具 ====================

type Stop = [number, string]

/** 在 [y0,y1) 画竖向渐变色带（铺满整周） */
function vBand(
  ctx: CanvasRenderingContext2D,
  y0: number,
  y1: number,
  stops: Stop[]
) {
  const g = ctx.createLinearGradient(0, y0, 0, y1)
  for (const [p, c] of stops) g.addColorStop(p, c)
  ctx.fillStyle = g
  ctx.fillRect(0, y0, W, y1 - y0)
}

/** 纯色带（铺满整周） */
function band(ctx: CanvasRenderingContext2D, y0: number, y1: number, fill: string) {
  ctx.fillStyle = fill
  ctx.fillRect(0, y0, W, y1 - y0)
}

/** 细密颗粒（磨砂 / 石砚 / 金属磨砂质感） */
function speckle(
  ctx: CanvasRenderingContext2D,
  y0: number,
  y1: number,
  count: number,
  color: string,
  maxSize = 1.6,
  alpha = 1
) {
  ctx.save()
  ctx.globalAlpha = alpha
  ctx.fillStyle = color
  for (let i = 0; i < count; i++) {
    const s = rr(0.5, maxSize)
    ctx.fillRect(rr(0, W), rr(y0, y1), s, s)
  }
  ctx.restore()
}

/**
 * 木质/竹质竖纹（天然木纹、竹丝）：沿杆长方向的细微纵向纹理。
 * 用于乌木杆身、黑檀握把、竹丝等。
 */
function woodGrain(
  ctx: CanvasRenderingContext2D,
  y0: number,
  y1: number,
  opts: { dark: string; light: string; lines?: number; wave?: number; width?: number }
) {
  const lines = opts.lines ?? 90
  const wave = opts.wave ?? 5
  const h = y1 - y0
  ctx.save()
  ctx.lineWidth = opts.width ?? 1
  for (let i = 0; i < lines; i++) {
    const x0 = rr(-10, W + 10)
    ctx.strokeStyle = rnd() > 0.5 ? opts.dark : opts.light
    ctx.globalAlpha = rr(0.12, 0.42)
    ctx.beginPath()
    ctx.moveTo(x0, y0)
    // 轻微起伏，模拟天然木纹走向
    ctx.bezierCurveTo(x0 + rr(-wave, wave), y0 + h * 0.35, x0 + rr(-wave, wave), y0 + h * 0.7, x0 + rr(-wave * 0.6, wave * 0.6), y1)
    ctx.stroke()
  }
  ctx.restore()
}

/** 环绕整周的环带（金属环 / 鎏金环 / 色环） */
function ring(
  ctx: CanvasRenderingContext2D,
  y: number,
  h: number,
  fill: string,
  opts?: { edge?: string; inner?: string }
) {
  band(ctx, y, y + h, fill)
  if (opts?.edge) {
    ctx.fillStyle = opts.edge
    ctx.fillRect(0, y, W, 1.5)
    ctx.fillRect(0, y + h - 1.5, W, 1.5)
  }
}

/** 在画布上平铺菱形鳞片（v1.4.3：跨接缝的鳞片自动补画，保证左右缝合连续） */
function drawScales(
  ctx: CanvasRenderingContext2D,
  rows: number,
  cols: number,
  fill: (r: number, c: number) => string,
  stroke?: string,
  y0 = 0,
  y1 = H
) {
  const sw = W / cols
  const sh = (y1 - y0) / rows
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = c * sw + (r % 2 ? sw / 2 : 0)
      const y = y0 + r * sh
      const one = (px: number) => {
        ctx.beginPath()
        ctx.moveTo(px + sw / 2, y)
        ctx.lineTo(px + sw, y + sh / 2)
        ctx.lineTo(px + sw / 2, y + sh)
        ctx.lineTo(px, y + sh / 2)
        ctx.closePath()
        ctx.fillStyle = fill(r, c)
        ctx.fill()
        if (stroke) {
          ctx.strokeStyle = stroke
          ctx.lineWidth = 1.5
          ctx.stroke()
        }
      }
      one(x)
      // 交错行最后一枚鳞片的右半会越过 x=W 接缝：在左侧补画一份
      if (x + sw > W) one(x - W)
    }
  }
}

/**
 * 【v1.4.3】wrap 安全绘制：把 draw 以 x 平移 -W / 0 / +W 各执行一遍，
 * 越界部分被画布自动裁剪。任何可能跨越 x=0/W 接缝的图案都必须经过它，
 * 否则圆柱 UV 缝合处会出现一道可见的断纹（贴图左右边缘亮度不一致）。
 */
function drawWrapped(
  ctx: CanvasRenderingContext2D,
  draw: () => void
) {
  for (const dx of [-W, 0, W]) {
    ctx.save()
    ctx.translate(dx, 0)
    draw()
    ctx.restore()
  }
}

/** 连绵云纹：沿杆身环绕分布（横向波浪线 = 环绕一周）。
 *  v1.4.3：终点 y 与起点 y 相同（周期化），保证接缝处云纹连续 */
function cloudRibbon(
  ctx: CanvasRenderingContext2D,
  y: number,
  amp: number,
  color: string,
  lineWidth: number,
  phase = 0
) {
  const y0 = y + Math.sin(phase) * amp * 0.3
  ctx.strokeStyle = color
  ctx.lineWidth = lineWidth
  ctx.beginPath()
  ctx.moveTo(0, y0)
  ctx.bezierCurveTo(W * 0.3, y - amp, W * 0.62, y + amp, W, y0)
  ctx.stroke()
}

// ==================== 握把材质（grip）====================

/** 哑光黑檀 / 木质握把：细密天然木纹 */
function gripWood(
  ctx: CanvasRenderingContext2D,
  y0: number,
  y1: number,
  base: string,
  dark: string,
  light: string
) {
  vBand(ctx, y0, y1, [
    [0, base],
    [0.5, dark],
    [1, base],
  ])
  woodGrain(ctx, y0, y1, { dark: "#000000", light, lines: 130, wave: 3, width: 1 })
  speckle(ctx, y0, y1, 260, "rgba(255,255,255,0.05)", 1.2)
  // 哑光：整体压一层暗，避免高光
  band(ctx, y0, y1, "rgba(0,0,0,0.18)")
}

/** 竹根粗糙肌理握把 */
function gripBambooRoot(
  ctx: CanvasRenderingContext2D,
  y0: number,
  y1: number
) {
  vBand(ctx, y0, y1, [
    [0, "#8fae55"],
    [0.5, "#6d8f3c"],
    [1, "#55702e"],
  ])
  // 粗糙：不规则短纤维 + 结节
  ctx.save()
  for (let i = 0; i < 200; i++) {
    ctx.strokeStyle = rnd() > 0.5 ? "rgba(40,60,20,0.5)" : "rgba(200,225,170,0.35)"
    ctx.lineWidth = rr(0.6, 1.8)
    const x = rr(0, W)
    const y = rr(y0, y1)
    ctx.beginPath()
    ctx.moveTo(x, y)
    ctx.lineTo(x + rr(-6, 6), y + rr(6, 22))
    ctx.stroke()
  }
  // 竹根疙瘩
  for (let i = 0; i < 26; i++) {
    const x = rr(0, W)
    const y = rr(y0 + 10, y1 - 10)
    const r = rr(4, 11)
    const g = ctx.createRadialGradient(x, y, 1, x, y, r)
    g.addColorStop(0, "rgba(60,84,32,0.55)")
    g.addColorStop(1, "rgba(60,84,32,0)")
    ctx.fillStyle = g
    ctx.beginPath()
    ctx.arc(x, y, r, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.restore()
  speckle(ctx, y0, y1, 180, "rgba(255,255,255,0.06)", 1.3)
}

/** 编织缠线握把（深色） */
function gripWovenCord(
  ctx: CanvasRenderingContext2D,
  y0: number,
  y1: number,
  base = "#2a2018",
  hi = "rgba(190,150,90,0.55)"
) {
  vBand(ctx, y0, y1, [
    [0, base],
    [0.5, "#191309"],
    [1, base],
  ])
  // 双向斜交编织
  const step = 16
  ctx.save()
  ctx.lineWidth = 4
  for (let d = -H; d < W + H; d += step) {
    ctx.strokeStyle = hi
    ctx.globalAlpha = 0.5
    ctx.beginPath()
    ctx.moveTo(d, y0)
    ctx.lineTo(d + (y1 - y0), y1)
    ctx.stroke()
    ctx.strokeStyle = "rgba(0,0,0,0.55)"
    ctx.globalAlpha = 0.6
    ctx.beginPath()
    ctx.moveTo(d, y1)
    ctx.lineTo(d + (y1 - y0), y0)
    ctx.stroke()
  }
  ctx.restore()
  speckle(ctx, y0, y1, 200, "rgba(255,255,255,0.05)", 1.2)
}

/** 仿粗陶磨砂握把 */
function gripCeramic(
  ctx: CanvasRenderingContext2D,
  y0: number,
  y1: number
) {
  vBand(ctx, y0, y1, [
    [0, "#7d888c"],
    [0.5, "#5f6a6e"],
    [1, "#4c565a"],
  ])
  speckle(ctx, y0, y1, 1400, "rgba(255,255,255,0.16)", 2.0)
  speckle(ctx, y0, y1, 900, "rgba(0,0,0,0.22)", 2.0)
  // 粗陶颗粒团簇
  ctx.save()
  for (let i = 0; i < 60; i++) {
    const x = rr(0, W)
    const y = rr(y0, y1)
    const r = rr(3, 9)
    ctx.fillStyle = `rgba(${rnd() > 0.5 ? "255,255,255" : "0,0,0"},0.06)`
    ctx.beginPath()
    ctx.arc(x, y, r, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.restore()
}

/** 防滑橡胶细密点阵（v1.4.3：底色可参数化，奥特曼银灰款复用） */
function gripRubberDots(
  ctx: CanvasRenderingContext2D,
  y0: number,
  y1: number,
  base: [string, string, string] = ["#23262e", "#15171d", "#0e1014"]
) {
  vBand(ctx, y0, y1, [
    [0, base[0]],
    [0.5, base[1]],
    [1, base[2]],
  ])
  const step = 9
  for (let y = y0 + 4; y < y1; y += step) {
    const off = ((y - y0) / step) % 2 ? step / 2 : 0
    for (let x = off; x < W; x += step) {
      const r = 2.6
      const g = ctx.createRadialGradient(x, y, 0.2, x, y, r)
      g.addColorStop(0, "rgba(255,255,255,0.22)")
      g.addColorStop(0.6, "rgba(120,130,150,0.14)")
      g.addColorStop(1, "rgba(0,0,0,0.35)")
      ctx.fillStyle = g
      ctx.beginPath()
      ctx.arc(x, y, r, 0, Math.PI * 2)
      ctx.fill()
    }
  }
  speckle(ctx, y0, y1, 400, "rgba(255,255,255,0.04)", 1.2)
}

/** 竖向防滑凹槽（黑色哑光软胶） */
function gripSoftGrooves(
  ctx: CanvasRenderingContext2D,
  y0: number,
  y1: number
) {
  vBand(ctx, y0, y1, [
    [0, "#22242a"],
    [0.5, "#14161a"],
    [1, "#0c0d10"],
  ])
  const step = 13
  for (let x = 0; x < W; x += step) {
    // 凹槽：暗边 + 亮边形成立体感
    ctx.fillStyle = "rgba(0,0,0,0.55)"
    ctx.fillRect(x, y0, step * 0.45, y1 - y0)
    ctx.fillStyle = "rgba(255,255,255,0.07)"
    ctx.fillRect(x + step * 0.45, y0, step * 0.16, y1 - y0)
  }
  speckle(ctx, y0, y1, 300, "rgba(255,255,255,0.035)", 1.1)
}

/** 哑光皮革压纹 */
function gripLeatherEmboss(
  ctx: CanvasRenderingContext2D,
  y0: number,
  y1: number
) {
  vBand(ctx, y0, y1, [
    [0, "#2e2a2c"],
    [0.5, "#1d1a1c"],
    [1, "#141213"],
  ])
  // 皮革不规则压纹胞格
  ctx.save()
  for (let i = 0; i < 240; i++) {
    const x = rr(0, W)
    const y = rr(y0, y1)
    const r = rr(5, 13)
    ctx.strokeStyle = `rgba(0,0,0,${rr(0.16, 0.4)})`
    ctx.lineWidth = rr(0.7, 1.5)
    ctx.beginPath()
    ctx.ellipse(x, y, r, r * rr(0.55, 0.95), rr(0, Math.PI), 0, Math.PI * 2)
    ctx.stroke()
    ctx.strokeStyle = `rgba(255,255,255,${rr(0.03, 0.09)})`
    ctx.beginPath()
    ctx.ellipse(x + 1, y + 1, r, r * 0.8, rr(0, Math.PI), 0, Math.PI * 2)
    ctx.stroke()
  }
  ctx.restore()
  speckle(ctx, y0, y1, 500, "rgba(255,255,255,0.04)", 1.3)
}

/** 虎纹压花真皮：虎纹斑条 + 凹凸压花 */
function gripTigerLeather(
  ctx: CanvasRenderingContext2D,
  y0: number,
  y1: number
) {
  vBand(ctx, y0, y1, [
    [0, "#4a3a24"],
    [0.5, "#33260f"],
    [1, "#241a0a"],
  ])
  // 虎纹：沿杆长的黑色弯斑条
  ctx.save()
  for (let i = 0; i < 34; i++) {
    const x = rr(0, W)
    const y = rr(y0 - 20, y1)
    const len = rr(40, 120)
    ctx.strokeStyle = `rgba(18,12,6,${rr(0.5, 0.85)})`
    ctx.lineWidth = rr(3, 8)
    ctx.lineCap = "round"
    ctx.beginPath()
    ctx.moveTo(x, y)
    ctx.quadraticCurveTo(x + rr(-18, 18), y + len * 0.5, x + rr(-10, 10), y + len)
    ctx.stroke()
  }
  ctx.restore()
  // 压花凹凸
  speckle(ctx, y0, y1, 700, "rgba(255,255,255,0.06)", 1.6)
  speckle(ctx, y0, y1, 500, "rgba(0,0,0,0.3)", 1.6)
}

/** 粗纹防滑橡胶 */
function gripCoarseRubber(
  ctx: CanvasRenderingContext2D,
  y0: number,
  y1: number
) {
  vBand(ctx, y0, y1, [
    [0, "#2a2422"],
    [0.5, "#171312"],
    [1, "#0f0c0b"],
  ])
  // 粗横纹（大间距深槽）
  const step = 20
  for (let y = y0; y < y1; y += step) {
    ctx.fillStyle = "rgba(0,0,0,0.6)"
    ctx.fillRect(0, y, W, step * 0.5)
    ctx.fillStyle = "rgba(255,255,255,0.06)"
    ctx.fillRect(0, y + step * 0.5, W, 1.6)
  }
  speckle(ctx, y0, y1, 600, "rgba(255,255,255,0.05)", 1.7)
}

/** 哑光柔雾硅胶（可染色） */
function gripSiliconeMatte(
  ctx: CanvasRenderingContext2D,
  y0: number,
  y1: number,
  c0: string,
  c1: string
) {
  vBand(ctx, y0, y1, [
    [0, c0],
    [0.5, c1],
    [1, c0],
  ])
  // 柔雾：大量极细颗粒 + 轻微明暗斑
  speckle(ctx, y0, y1, 2200, "rgba(255,255,255,0.13)", 1.5)
  speckle(ctx, y0, y1, 1200, "rgba(0,0,0,0.07)", 1.5)
  ctx.save()
  for (let i = 0; i < 40; i++) {
    const x = rr(0, W)
    const y = rr(y0, y1)
    const r = rr(20, 55)
    const g = ctx.createRadialGradient(x, y, 1, x, y, r)
    g.addColorStop(0, "rgba(255,255,255,0.05)")
    g.addColorStop(1, "rgba(255,255,255,0)")
    ctx.fillStyle = g
    ctx.beginPath()
    ctx.arc(x, y, r, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.restore()
}

/** 深色手工缠绕皮线 */
function gripLeatherCord(
  ctx: CanvasRenderingContext2D,
  y0: number,
  y1: number
) {
  vBand(ctx, y0, y1, [
    [0, "#3a2c1c"],
    [0.5, "#241a10"],
    [1, "#181008"],
  ])
  // 螺旋缠绕的皮线（斜向粗股）
  const pitch = 26
  ctx.save()
  ctx.lineCap = "round"
  for (let d = -H; d < W + H; d += pitch) {
    ctx.strokeStyle = "rgba(20,12,6,0.75)"
    ctx.lineWidth = 11
    ctx.beginPath()
    ctx.moveTo(d, y0)
    ctx.lineTo(d + (y1 - y0), y1)
    ctx.stroke()
    ctx.strokeStyle = "rgba(205,170,115,0.42)"
    ctx.lineWidth = 7
    ctx.beginPath()
    ctx.moveTo(d + 2, y0)
    ctx.lineTo(d + 2 + (y1 - y0), y1)
    ctx.stroke()
    ctx.strokeStyle = "rgba(255,235,200,0.14)"
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.moveTo(d - 2, y0)
    ctx.lineTo(d - 2 + (y1 - y0), y1)
    ctx.stroke()
  }
  ctx.restore()
  speckle(ctx, y0, y1, 300, "rgba(255,255,255,0.05)", 1.2)
}

// ==================== 杆尾端盖造型（butt cap）====================

/** 端盖底：压暗收口，营造端面 */
function capBase(ctx: CanvasRenderingContext2D, y: number, fill: string) {
  band(ctx, y, H, fill)
  // 端面向下渐暗（模拟端面曲率）
  const g = ctx.createLinearGradient(0, y, 0, H)
  g.addColorStop(0, "rgba(0,0,0,0)")
  g.addColorStop(1, "rgba(0,0,0,0.45)")
  ctx.fillStyle = g
  ctx.fillRect(0, y, W, H - y)
}

/** 哑光金属环 + 内侧极简云纹线条（墨云龙阙） */
function capMatteRingCloud(ctx: CanvasRenderingContext2D, y: number) {
  vBand(ctx, y, H, [
    [0, "#151310"],
    [0.6, "#1c1a16"],
    [1, "#0a0908"],
  ])
  // 窄款哑光金属环
  ring(ctx, y + (H - y) * 0.34, (H - y) * 0.13, "#6e6a60", {
    edge: "rgba(255,255,255,0.16)",
  })
  speckle(ctx, y + (H - y) * 0.34, y + (H - y) * 0.47, 220, "rgba(255,255,255,0.07)", 1.3)
  // 金属环内侧极简云纹线条
  ctx.strokeStyle = "rgba(215,200,175,0.3)"
  ctx.lineWidth = 1.4
  cloudRibbon(ctx, y + (H - y) * 0.62, 7, "rgba(215,200,175,0.26)", 1.4)
  cloudRibbon(ctx, y + (H - y) * 0.78, 5, "rgba(215,200,175,0.18)", 1.2, 2)
}

/** 圆润竹根收口，无金属装饰（青竹听风） */
function capBambooRound(ctx: CanvasRenderingContext2D, y: number) {
  vBand(ctx, y, H, [
    [0, "#7d9c46"],
    [0.45, "#5e7c33"],
    [1, "#435c22"],
  ])
  // 圆润：一道浅色凸环 + 竹根纤维
  const mid = y + (H - y) * 0.3
  ring(ctx, mid, (H - y) * 0.1, "rgba(160,190,110,0.35)")
  woodGrain(ctx, y, H, { dark: "rgba(35,55,18,0.5)", light: "rgba(200,225,170,0.3)", lines: 60, wave: 3 })
  speckle(ctx, y, H, 300, "rgba(255,255,255,0.07)", 1.4)
  capBase(ctx, y + (H - y) * 0.72, "rgba(30,45,15,0.35)")
}

/** 环形鎏金饰件 + 简约羽纹（凤羽鎏金） */
function capGoldRingFeather(ctx: CanvasRenderingContext2D, y: number) {
  vBand(ctx, y, H, [
    [0, "#241a10"],
    [0.6, "#15100a"],
    [1, "#0a0806"],
  ])
  const h = H - y
  // 环形鎏金饰件（主环 + 细环）
  ring(ctx, y + h * 0.3, h * 0.16, "#c9a24a", { edge: "rgba(255,240,200,0.5)" })
  ring(ctx, y + h * 0.5, h * 0.045, "#e8c878")
  // 饰件表面简约羽纹（细弧线）
  ctx.strokeStyle = "rgba(255,235,180,0.4)"
  ctx.lineWidth = 1.3
  for (let i = 0; i < 7; i++) {
    const x = (i + 0.5) * (W / 7)
    ctx.beginPath()
    ctx.moveTo(x, y + h * 0.33)
    ctx.quadraticCurveTo(x + 9, y + h * 0.4, x, y + h * 0.46)
    ctx.stroke()
  }
  capBase(ctx, y + h * 0.62, "rgba(10,8,5,0.5)")
}

/** 方正小砚台造型，无亮色金属（千里砚山） */
function capInkstone(ctx: CanvasRenderingContext2D, y: number) {
  vBand(ctx, y, H, [
    [0, "#4b565b"],
    [0.6, "#39444a"],
    [1, "#2b3439"],
  ])
  const h = H - y
  speckle(ctx, y, H, 1600, "rgba(255,255,255,0.1)", 1.8)
  speckle(ctx, y, H, 1200, "rgba(0,0,0,0.25)", 1.8)
  // 方正砚台：两道直角收边（无亮色）
  ring(ctx, y + h * 0.28, h * 0.06, "#2a3338", { edge: "rgba(255,255,255,0.1)" })
  ring(ctx, y + h * 0.72, h * 0.05, "#232b30", { edge: "rgba(255,255,255,0.07)" })
  // 砚池（端部凹陷墨池）
  const g = ctx.createRadialGradient(W / 2, H - h * 0.08, 2, W / 2, H - h * 0.08, W * 0.5)
  g.addColorStop(0, "rgba(10,14,16,0.75)")
  g.addColorStop(1, "rgba(10,14,16,0)")
  ctx.fillStyle = g
  ctx.fillRect(0, y + h * 0.8, W, h * 0.2)
}

/** 圆形哑光金属饰片 + 极简电路标识（星核暗芒） */
function capMetalDisc(ctx: CanvasRenderingContext2D, y: number) {
  vBand(ctx, y, H, [
    [0, "#10141f"],
    [0.6, "#080a12"],
    [1, "#04050a"],
  ])
  const h = H - y
  speckle(ctx, y, H, 420, "rgba(160,190,255,0.09)", 1.3)
  // 圆形哑光金属饰片（在展开图上表现为一条带内嵌圆点的环带）
  const discY = y + h * 0.34
  ring(ctx, discY, h * 0.15, "#3b4354", { edge: "rgba(180,205,255,0.22)" })
  speckle(ctx, discY, discY + h * 0.15, 260, "rgba(255,255,255,0.06)", 1.2)
  // 极简电路标识
  ctx.strokeStyle = "rgba(90,200,255,0.65)"
  ctx.lineWidth = 1.6
  for (let i = 0; i < 4; i++) {
    const cx = (i + 0.5) * (W / 4)
    const cy = discY + h * 0.075
    ctx.beginPath()
    ctx.moveTo(cx - 12, cy)
    ctx.lineTo(cx - 3, cy)
    ctx.lineTo(cx - 3, cy - 6)
    ctx.lineTo(cx + 3, cy - 6)
    ctx.lineTo(cx + 3, cy)
    ctx.lineTo(cx + 12, cy)
    ctx.stroke()
    ctx.fillStyle = "rgba(120,215,255,0.75)"
    ctx.fillRect(cx + 12, cy - 2.5, 5, 5)
  }
  capBase(ctx, y + h * 0.72, "rgba(3,4,8,0.5)")
}

/** 多边形金属切面 + 镜面反光（霓虹溯光） */
function capPolyFacet(ctx: CanvasRenderingContext2D, y: number) {
  vBand(ctx, y, H, [
    [0, "#2b1a52"],
    [0.6, "#1a0f36"],
    [1, "#0d0722"],
  ])
  const h = H - y
  // 多边形切面：沿周向分面，每面不同明度 + 镜面亮边
  const faces = 8
  const fw = W / faces
  for (let i = 0; i < faces; i++) {
    const x0 = i * fw
    const t = i / faces
    const g = ctx.createLinearGradient(x0, y, x0 + fw, H)
    g.addColorStop(0, `rgba(${Math.round(150 + 90 * Math.sin(t * 6.3))},${Math.round(140 + 80 * Math.cos(t * 5.1))},210,0.55)`)
    g.addColorStop(1, "rgba(30,16,60,0.15)")
    ctx.fillStyle = g
    ctx.fillRect(x0, y + h * 0.18, fw, h * 0.72)
    // 镜面反光亮边
    ctx.fillStyle = "rgba(255,255,255,0.5)"
    ctx.fillRect(x0, y + h * 0.18, 1.6, h * 0.72)
    ctx.fillStyle = "rgba(200,150,255,0.22)"
    ctx.fillRect(x0 + fw - 1.6, y + h * 0.18, 1.6, h * 0.72)
  }
  ring(ctx, y + h * 0.12, h * 0.05, "#8f7fc0")
  capBase(ctx, y + h * 0.9, "rgba(8,4,20,0.4)")
}

/** 简洁钝锥形金属收口（虚空裂隙） */
function capBluntCone(ctx: CanvasRenderingContext2D, y: number) {
  vBand(ctx, y, H, [
    [0, "#15151a"],
    [0.6, "#0d0d10"],
    [1, "#070709"],
  ])
  const h = H - y
  // 钝锥：由宽到窄的暗金属渐变（端面收小）
  for (let i = 0; i < 26; i++) {
    const t = i / 26
    const yy = y + h * t
    const shade = 0.16 + 0.16 * (1 - t)
    ctx.fillStyle = `rgba(${Math.round(60 * shade * 4)},${Math.round(60 * shade * 4)},${Math.round(70 * shade * 4)},1)`
    ctx.fillRect(0, yy, W, h / 26 + 1)
  }
  // 幽紫内芯微光（与杆身裂隙呼应）
  const g = ctx.createLinearGradient(0, y, 0, H)
  g.addColorStop(0, "rgba(120,70,200,0)")
  g.addColorStop(1, "rgba(140,85,225,0.35)")
  ctx.fillStyle = g
  ctx.fillRect(0, y, W, h)
  ring(ctx, y + h * 0.06, h * 0.035, "rgba(150,150,165,0.5)")
  capBase(ctx, y + h * 0.88, "rgba(5,5,7,0.4)")
}

/** 小巧锥形金属配重，表面磨砂（幽刺夜影） */
function capConeWeight(ctx: CanvasRenderingContext2D, y: number) {
  vBand(ctx, y, H, [
    [0, "#2b2b33"],
    [0.6, "#1a1a20"],
    [1, "#101014"],
  ])
  const h = H - y
  // 锥形配重：向端面逐渐收窄的明度带
  for (let i = 0; i < 24; i++) {
    const t = i / 24
    const v = Math.round(70 - 34 * t)
    ctx.fillStyle = `rgb(${v},${v},${v + 6})`
    ctx.fillRect(0, y + h * t, W, h / 24 + 1)
  }
  speckle(ctx, y, H, 900, "rgba(255,255,255,0.09)", 1.4) // 磨砂
  ring(ctx, y + h * 0.08, h * 0.04, "rgba(190,190,205,0.45)")
  capBase(ctx, y + h * 0.9, "rgba(8,8,11,0.42)")
}

/** 不规则熔岩岩石造型，凹凸粗糙（烬火焚风） */
function capLavaRock(ctx: CanvasRenderingContext2D, y: number) {
  vBand(ctx, y, H, [
    [0, "#3a1a0e"],
    [0.6, "#24100a"],
    [1, "#150806"],
  ])
  const h = H - y
  // 粗糙岩块：随机多边形块面
  ctx.save()
  for (let i = 0; i < 130; i++) {
    const x = rr(0, W)
    const yy = rr(y, H)
    const r = rr(5, 16)
    const v = rr(0.06, 0.3)
    ctx.fillStyle = rnd() > 0.5 ? `rgba(0,0,0,${v})` : `rgba(255,140,60,${v * 0.5})`
    ctx.beginPath()
    ctx.moveTo(x + rr(-r, r), yy + rr(-r, r))
    for (let k = 0; k < 4; k++) ctx.lineTo(x + rr(-r, r), yy + rr(-r, r))
    ctx.closePath()
    ctx.fill()
  }
  ctx.restore()
  // 岩缝暗红余烬
  ctx.strokeStyle = "rgba(190,45,15,0.55)"
  ctx.lineWidth = 2
  for (let i = 0; i < 9; i++) {
    let x = rr(0, W)
    let yy = rr(y, H - 10)
    ctx.beginPath()
    ctx.moveTo(x, yy)
    for (let k = 0; k < 4; k++) {
      x += rr(-22, 22)
      yy += rr(4, 16)
      ctx.lineTo(x, yy)
    }
    ctx.stroke()
  }
  capBase(ctx, y + h * 0.86, "rgba(12,5,3,0.45)")
}

/** 圆润弧形收口，无硬质棱角（云糖幻梦） */
function capRoundedArc(ctx: CanvasRenderingContext2D, y: number) {
  vBand(ctx, y, H, [
    [0, "#f7d3e2"],
    [0.55, "#f0bcd4"],
    [1, "#dda6c6"],
  ])
  const h = H - y
  // 圆润弧：连续柔和明暗过渡（无硬边）
  for (let i = 0; i < 30; i++) {
    const t = i / 30
    const a = 0.14 * Math.sin(t * Math.PI)
    ctx.fillStyle = `rgba(255,255,255,${a.toFixed(3)})`
    ctx.fillRect(0, y + h * t, W, h / 30 + 1)
  }
  speckle(ctx, y, H, 900, "rgba(255,255,255,0.16)", 1.5)
  const g = ctx.createLinearGradient(0, y + h * 0.6, 0, H)
  g.addColorStop(0, "rgba(190,150,200,0)")
  g.addColorStop(1, "rgba(190,150,200,0.35)")
  ctx.fillStyle = g
  ctx.fillRect(0, y + h * 0.6, W, h * 0.4)
}

/** 多面冰晶切割造型，通透冷调（冰晶雪魄） */
function capIceFacet(ctx: CanvasRenderingContext2D, y: number) {
  vBand(ctx, y, H, [
    [0, "#e8f6ff"],
    [0.5, "#cfe9fa"],
    [1, "#a9cee8"],
  ])
  const h = H - y
  // 多面切割：三角/菱形切面 + 冷调高光边
  const facets = 10
  const fw = W / facets
  for (let i = 0; i < facets; i++) {
    const x0 = i * fw
    ctx.fillStyle = i % 2 ? "rgba(255,255,255,0.5)" : "rgba(150,195,225,0.28)"
    ctx.beginPath()
    ctx.moveTo(x0, y + h * 0.2)
    ctx.lineTo(x0 + fw, y + h * 0.34)
    ctx.lineTo(x0 + fw, H)
    ctx.lineTo(x0, H)
    ctx.closePath()
    ctx.fill()
    ctx.strokeStyle = "rgba(255,255,255,0.65)"
    ctx.lineWidth = 1.2
    ctx.beginPath()
    ctx.moveTo(x0, y + h * 0.2)
    ctx.lineTo(x0 + fw, y + h * 0.34)
    ctx.stroke()
  }
  speckle(ctx, y, H, 400, "rgba(255,255,255,0.35)", 1.6)
  capBase(ctx, y + h * 0.88, "rgba(120,165,200,0.28)")
}

/** 宽大圆形鎏金浮雕饰盘 + 繁复卷草纹（万象权杖） */
function capGoldMedallion(ctx: CanvasRenderingContext2D, y: number) {
  vBand(ctx, y, H, [
    [0, "#2a2113"],
    [0.6, "#181209"],
    [1, "#0c0905"],
  ])
  const h = H - y
  // 宽大圆形鎏金浮雕饰盘
  const discY = y + h * 0.16
  const discH = h * 0.5
  const g = ctx.createLinearGradient(0, discY, 0, discY + discH)
  g.addColorStop(0, "#f0d890")
  g.addColorStop(0.35, "#c9a24a")
  g.addColorStop(0.7, "#8a6a22")
  g.addColorStop(1, "#e0c070")
  ctx.fillStyle = g
  ctx.fillRect(0, discY, W, discH)
  // 繁复卷草纹（连续螺旋卷须）
  ctx.strokeStyle = "rgba(90,62,16,0.75)"
  ctx.lineWidth = 1.5
  for (let i = 0; i < 12; i++) {
    const cx = (i + 0.5) * (W / 12)
    const cy = discY + discH * 0.5
    ctx.beginPath()
    ctx.moveTo(cx - 10, cy + 12)
    ctx.bezierCurveTo(cx - 16, cy - 4, cx + 4, cy - 14, cx + 10, cy - 2)
    ctx.bezierCurveTo(cx + 15, cy + 6, cx + 4, cy + 12, cx, cy + 6)
    ctx.stroke()
  }
  // 局部哑光 / 局部抛光对比
  ctx.save()
  for (let i = 0; i < 40; i++) {
    const x = rr(0, W)
    const yy = rr(discY, discY + discH)
    ctx.fillStyle = `rgba(255,255,255,${rr(0.05, 0.3)})`
    ctx.fillRect(x, yy, rr(6, 26), rr(1, 3))
  }
  ctx.restore()
  ring(ctx, discY - h * 0.05, h * 0.035, "#e8c878", { edge: "rgba(255,245,210,0.6)" })
  capBase(ctx, discY + discH, "rgba(8,6,3,0.5)")
}

/** 主色环 + 细鳞纹端盖（屠龙斩 / 青龙 / 火麒麟共用，颜色参数化） */
function capScaleRing(
  ctx: CanvasRenderingContext2D,
  y: number,
  baseDark: string,
  scaleA: string,
  scaleB: string,
  ringColor: string
) {
  vBand(ctx, y, H, [
    [0, baseDark],
    [0.6, "rgba(0,0,0,0.35)"],
    [1, "rgba(0,0,0,0.5)"],
  ])
  const h = H - y
  // 主色金属环
  ring(ctx, y + h * 0.24, h * 0.14, ringColor, { edge: "rgba(255,255,255,0.4)" })
  // 端面细鳞（呼应杆身母题）
  drawScales(
    ctx,
    5,
    8,
    (r, c) => ((r + c) % 2 ? scaleA : scaleB),
    "rgba(0,0,0,0.45)",
    y + h * 0.46,
    H
  )
  capBase(ctx, y + h * 0.88, "rgba(0,0,0,0.4)")
}

/** 护目镜圆盘端盖（小黄人）：黑带 + 蓝圈白睛 + 高光点 */
function capGoggleDisc(ctx: CanvasRenderingContext2D, y: number) {
  vBand(ctx, y, H, [
    [0, "#1a1a1a"],
    [1, "#0d0d0d"],
  ])
  const h = H - y
  band(ctx, y, y + h * 0.16, "#1f6fb2")
  const cy = y + h * 0.55
  ctx.fillStyle = "#1f6fb2"
  ctx.beginPath()
  ctx.arc(W / 2, cy, W * 0.3, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = "#bfe3ff"
  ctx.beginPath()
  ctx.arc(W / 2, cy, W * 0.2, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = "#0a1a2a"
  ctx.beginPath()
  ctx.arc(W / 2, cy, W * 0.1, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = "rgba(255,255,255,0.55)"
  ctx.beginPath()
  ctx.arc(W / 2 - W * 0.08, cy - W * 0.07, W * 0.035, 0, Math.PI * 2)
  ctx.fill()
  capBase(ctx, y + h * 0.9, "rgba(0,0,0,0.4)")
}

/** 爱心粉盖（小猪佩奇）：粉色端面 + 居中大爱心 + 珠光点 */
function capHeartCap(ctx: CanvasRenderingContext2D, y: number) {
  vBand(ctx, y, H, [
    [0, "#ff8fbb"],
    [1, "#e86a9c"],
  ])
  const h = H - y
  const heart = (cx: number, cy: number, s: number) => {
    ctx.save()
    ctx.translate(cx, cy)
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
  heart(W / 2, y + h * 0.42, 1.7)
  heart(W * 0.18, y + h * 0.16, 0.7)
  heart(W * 0.84, y + h * 0.2, 0.6)
  capBase(ctx, y + h * 0.88, "rgba(0,0,0,0.22)")
}

/** 六边形护甲银盖（奥特曼）：银底 + 红色能量环 + 六角块阵 */
function capHexPlates(ctx: CanvasRenderingContext2D, y: number) {
  vBand(ctx, y, H, [
    [0, "#c9d3da"],
    [0.6, "#9fabb4"],
    [1, "#77828c"],
  ])
  const h = H - y
  ring(ctx, y + h * 0.14, h * 0.07, "#c81f1f", { edge: "rgba(255,255,255,0.35)" })
  const hex = (cx: number, cy: number, r: number) => {
    ctx.beginPath()
    for (let k = 0; k < 6; k++) {
      const a = (Math.PI / 3) * k - Math.PI / 6
      const x = cx + r * Math.cos(a)
      const yy = cy + r * Math.sin(a)
      k === 0 ? ctx.moveTo(x, yy) : ctx.lineTo(x, yy)
    }
    ctx.closePath()
    ctx.fillStyle = "#d7dde2"
    ctx.fill()
    ctx.strokeStyle = "#8d99a2"
    ctx.lineWidth = 2
    ctx.stroke()
  }
  for (let r = 0; r < 3; r++) {
    hex(W * 0.28, y + h * (0.4 + r * 0.2), 22)
    hex(W * 0.72, y + h * (0.5 + r * 0.2), 22)
  }
  capBase(ctx, y + h * 0.92, "rgba(0,0,0,0.35)")
}

// ==================== 主题构建（杆身） ====================

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
      return buildMoyunlongqueShaft()
    case "qingzhutingfeng":
      return buildQingzhutingfengShaft()
    case "fengyuliujin":
      return buildFengyuliujinShaft()
    case "qianliyanshan":
      return buildQianliyanshanShaft()
    case "xinghedanmang":
      return buildXinghedanmangShaft()
    case "nihongsuguang":
      return buildNihongsuguangShaft()
    case "xukonglilie":
      return buildXukonglilieShaft()
    case "youciyeying":
      return buildYouciyeyingShaft()
    case "jinhuofengfeng":
      return buildJinhuofengfengShaft()
    case "yuntianghuanmeng":
      return buildYuntianghuanmengShaft()
    case "bingjingxuepo":
      return buildBingjingxuepoShaft()
    case "wanxiangquanzhang":
      return buildWanxiangquanzhangShaft()
    default:
      return null
  }
}

/** 主题构建（杆尾：握把 + 装饰 + 端盖）。19 款全部有独立杆尾（v1.4.3 补齐遗留 6 款）。 */
function buildButt(themeId: string): Texture | null {
  const kind = getCueTheme(themeId).kind
  switch (kind) {
    case "dragon":
      return buildDragonButt()
    case "azure":
      return buildAzureButt()
    case "minions":
      return buildMinionsButt()
    case "peppa":
      return buildPeppaButt()
    case "qilin":
      return buildQilinButt()
    case "ultraman":
      return buildUltramanButt()
    case "moyunlongque":
      return buildMoyunlongqueButt()
    case "qingzhutingfeng":
      return buildQingzhutingfengButt()
    case "fengyuliujin":
      return buildFengyuliujinButt()
    case "qianliyanshan":
      return buildQianliyanshanButt()
    case "xinghedanmang":
      return buildXinghedanmangButt()
    case "nihongsuguang":
      return buildNihongsuguangButt()
    case "xukonglilie":
      return buildXukonglilieButt()
    case "youciyeying":
      return buildYouciyeyingButt()
    case "jinhuofengfeng":
      return buildJinhuofengfengButt()
    case "yuntianghuanmeng":
      return buildYuntianghuanmengButt()
    case "bingjingxuepo":
      return buildBingjingxuepoButt()
    case "wanxiangquanzhang":
      return buildWanxiangquanzhangButt()
    default:
      return null
  }
}

// ==================== 遗留 6 款主题（保持原样） ====================

/** 屠龙斩：暗红木底 + 金色龙鳞 + 剑光斜纹 */
function buildDragon(): Texture {
  srand(11)
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
  // 剑光斜纹（wrap 安全：跨接缝自动补画）
  drawWrapped(ctx, () => {
    ctx.strokeStyle = "rgba(255,240,200,0.55)"
    ctx.lineWidth = 6
    for (let i = -1; i < 4; i++) {
      ctx.beginPath()
      ctx.moveTo(i * 90, 0)
      ctx.lineTo(i * 90 + H * 0.32, H)
      ctx.stroke()
    }
  })
  // 尾部金属金箍
  ctx.fillStyle = "#e8c878"
  ctx.fillRect(0, H - 60, W, 60)
  return toTexture(cv)
}

/** 青龙：青蓝渐变 + 龙鳞 + 青色高光 */
function buildAzure(): Texture {
  srand(22)
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
  // 青色流光（左右对称，天然 wrap 安全）
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
  srand(33)
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
  srand(44)
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
  drawWrapped(ctx, () => {
    for (let r = 0; r < 9; r++) {
      for (let c = 0; c < 3; c++) {
        const x = 50 + c * 80 + (r % 2 ? 40 : 0)
        const y = 60 + r * 110
        heart(x, y, 1.1)
      }
    }
  })
  ctx.fillStyle = "#ff6fa8"
  ctx.fillRect(0, H - 60, W, 60)
  return toTexture(cv)
}

/** 火麒麟：橙红火焰渐变 + 金色火舌 */
function buildQilin(): Texture {
  srand(55)
  const { cv, ctx } = newCanvas()
  const g = ctx.createLinearGradient(0, 0, 0, H)
  g.addColorStop(0, "#ff7a1f")
  g.addColorStop(0.5, "#d8320a")
  g.addColorStop(1, "#7a1404")
  ctx.fillStyle = g
  ctx.fillRect(0, 0, W, H)
  // 火舌（wrap 安全）
  drawWrapped(ctx, () => {
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
  })
  ctx.fillStyle = "#ffd24a"
  ctx.fillRect(0, H - 60, W, 60)
  return toTexture(cv)
}

/** 奥特曼：银色金属底 + 红色能量条纹 + 六边形护甲块（原创意象，红银配色致敬） */
function buildUltraman(): Texture {
  srand(66)
  const { cv, ctx } = newCanvas()
  const g = ctx.createLinearGradient(0, 0, 0, H)
  g.addColorStop(0, "#e8eef2")
  g.addColorStop(0.5, "#b9c4cc")
  g.addColorStop(1, "#8c98a2")
  ctx.fillStyle = g
  ctx.fillRect(0, 0, W, H)
  // 金属高光竖纹（wrap 安全）
  drawWrapped(ctx, () => {
    ctx.strokeStyle = "rgba(255,255,255,0.45)"
    ctx.lineWidth = 3
    for (let i = 0; i < W; i += 24) {
      ctx.beginPath()
      ctx.moveTo(i, 0)
      ctx.lineTo(i + 8, H)
      ctx.stroke()
    }
  })
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

// ==================== 12 款特色球杆皮肤 · 杆身 ====================

/** 墨云龙阙：乌墨黑致密木质杆身 + 暗金龙鳞 + 连绵云纹环绕 */
function buildMoyunlongqueShaft(): Texture {
  srand(101)
  const { cv, ctx } = newCanvas()
  // 乌墨黑致密木质基底
  vBand(ctx, 0, H, [
    [0, "#1c1811"],
    [0.35, "#100d08"],
    [0.7, "#161209"],
    [1, "#0a0805"],
  ])
  woodGrain(ctx, 0, H, {
    dark: "rgba(0,0,0,0.55)",
    light: "rgba(150,130,90,0.16)",
    lines: 150,
    wave: 4,
    width: 1,
  })
  // 表层浮刻细腻暗金龙鳞：小型菱形，中心暗、边缘微凸，整体压低对比度
  const rows = 44
  const cols = 16
  const sw = W / cols
  const sh = H / rows
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = c * sw + (r % 2 ? sw / 2 : 0)
      const y = r * sh
      const cx = x + sw / 2
      const cy = y + sh / 2
      // 浮雕凸面：中心深、边缘微亮的径向渐变
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, sw * 0.55)
      g.addColorStop(0, "rgba(45,35,12,0.25)")
      g.addColorStop(0.55, "rgba(115,95,42,0.55)")
      g.addColorStop(0.85, "rgba(145,120,55,0.22)")
      g.addColorStop(1, "rgba(0,0,0,0)")
      ctx.fillStyle = g
      ctx.beginPath()
      ctx.moveTo(cx, y)
      ctx.lineTo(x + sw, cy)
      ctx.lineTo(cx, y + sh)
      ctx.lineTo(x, cy)
      ctx.closePath()
      ctx.fill()
      // 边缘极细暗金描线
      ctx.strokeStyle = "rgba(190,155,75,0.16)"
      ctx.lineWidth = 1
      ctx.stroke()
    }
  }
  // 连绵云纹顺着杆身弧度环绕分布
  for (let i = 0; i < 7; i++) {
    const y = H * (0.06 + i * 0.135)
    cloudRibbon(ctx, y, 13, "rgba(201,162,74,0.34)", 3.2, i * 0.8)
    cloudRibbon(ctx, y + 7, 8, "rgba(201,162,74,0.18)", 1.6, i * 0.8 + 1)
  }
  // 低调厚重：整体轻微压暗
  band(ctx, 0, H, "rgba(0,0,0,0.12)")
  return toTexture(cv)
}

/** 青竹听风：浅青仿竹杆身 + 分段竹节 + 细银勾边 + 纵向竹丝 */
function buildQingzhutingfengShaft(): Texture {
  srand(202)
  const { cv, ctx } = newCanvas()
  vBand(ctx, 0, H, [
    [0, "#cfe8b4"],
    [0.35, "#a8d487"],
    [0.7, "#86bd63"],
    [1, "#5f9a45"],
  ])
  // 细微纵向竹丝纹理
  woodGrain(ctx, 0, H, {
    dark: "rgba(60,95,40,0.35)",
    light: "rgba(235,250,215,0.4)",
    lines: 170,
    wave: 1.5,
    width: 1,
  })
  // 清晰分段竹节轮廓（沿杆长排布）+ 细银线勾边
  const seg = 7
  for (let i = 0; i <= seg; i++) {
    const y = (H / seg) * i
    const gh = 16
    // 竹节本体（略深的环）
    const g = ctx.createLinearGradient(0, y - gh / 2, 0, y + gh / 2)
    g.addColorStop(0, "rgba(70,110,45,0.15)")
    g.addColorStop(0.45, "rgba(55,92,34,0.75)")
    g.addColorStop(0.55, "rgba(70,110,45,0.6)")
    g.addColorStop(1, "rgba(70,110,45,0.1)")
    ctx.fillStyle = g
    ctx.fillRect(0, y - gh / 2, W, gh)
    // 细银线条勾勒竹节边缘
    ctx.strokeStyle = "rgba(238,248,235,0.75)"
    ctx.lineWidth = 1.8
    ctx.beginPath()
    ctx.moveTo(0, y - gh / 2)
    ctx.lineTo(W, y - gh / 2)
    ctx.stroke()
    ctx.strokeStyle = "rgba(210,230,205,0.4)"
    ctx.lineWidth = 1.2
    ctx.beginPath()
    ctx.moveTo(0, y + gh / 2)
    ctx.lineTo(W, y + gh / 2)
    ctx.stroke()
  }
  return toTexture(cv)
}

/** 凤羽鎏金：黑檀底 + 弧形幻彩鲍鱼贝羽片 + 鎏金勾边 */
function buildFengyuliujinShaft(): Texture {
  srand(303)
  const { cv, ctx } = newCanvas()
  vBand(ctx, 0, H, [
    [0, "#231b13"],
    [0.35, "#120d08"],
    [0.7, "#0d0906"],
    [1, "#070504"],
  ])
  woodGrain(ctx, 0, H, {
    dark: "rgba(0,0,0,0.6)",
    light: "rgba(160,130,90,0.14)",
    lines: 120,
    wave: 3,
  })
  // 幻彩鲍鱼贝贴片：排布模拟凤凰羽翼形态（沿杆身呈羽列；wrap 安全）
  drawWrapped(ctx, () => {
    for (let r = 0; r < 11; r++) {
      for (let c = 0; c < 3; c++) {
        const x = 46 + c * 84 + (r % 2 ? 42 : 0)
        const y = 54 + r * 92
      // 弧形羽片
        ctx.save()
        ctx.translate(x, y)
        ctx.rotate(-0.35 + (c - 1) * 0.22)
        const g = ctx.createLinearGradient(-26, -34, 26, 34)
        const hue = (r * 31 + c * 74) % 360
        g.addColorStop(0, `hsla(${hue},72%,78%,0.92)`)
        g.addColorStop(0.45, `hsla(${(hue + 55) % 360},68%,66%,0.88)`)
        g.addColorStop(1, `hsla(${(hue + 130) % 360},62%,52%,0.8)`)
        ctx.fillStyle = g
        ctx.beginPath()
        ctx.moveTo(0, -40)
        ctx.bezierCurveTo(24, -22, 24, 22, 0, 40)
        ctx.bezierCurveTo(-10, 22, -10, -22, 0, -40)
        ctx.closePath()
        ctx.fill()
        // 自然虹彩光泽（斜向高光）
        ctx.strokeStyle = "rgba(255,255,255,0.4)"
        ctx.lineWidth = 1.4
        ctx.beginPath()
        ctx.moveTo(-7, -26)
        ctx.lineTo(7, 24)
        ctx.stroke()
        // 边缘细鎏金线勾边
        ctx.strokeStyle = "rgba(232,200,120,0.9)"
        ctx.lineWidth = 1.6
        ctx.stroke()
        ctx.restore()
      }
    }
  })
  return toTexture(cv)
}

/** 千里砚山：青灰石砚哑光雾面 + 浅浮雕淡墨山水暗纹 */
function buildQianliyanshanShaft(): Texture {
  srand(404)
  const { cv, ctx } = newCanvas()
  vBand(ctx, 0, H, [
    [0, "#98a5ab"],
    [0.35, "#75838a"],
    [0.7, "#5c6a71"],
    [1, "#454f56"],
  ])
  // 哑光雾面：细密颗粒
  speckle(ctx, 0, H, 2600, "rgba(255,255,255,0.1)", 1.7)
  speckle(ctx, 0, H, 2000, "rgba(0,0,0,0.13)", 1.7)
  // 浅浮雕淡墨山水暗纹（远山轮廓，朦胧含蓄）
  const ridge = (baseY: number, amp: number, alpha: number, lw: number) => {
    ctx.strokeStyle = `rgba(38,50,56,${alpha})`
    ctx.lineWidth = lw
    ctx.beginPath()
    ctx.moveTo(0, baseY)
    let up = true
    for (let x = 0; x <= W; x += 16) {
      const y = baseY - (up ? amp : 0) * (0.55 + 0.45 * Math.sin(x * 0.05))
      ctx.lineTo(x, y)
      up = !up
    }
    ctx.stroke()
  }
  ctx.save()
  ctx.filter = "blur(1.2px)" // 朦胧含蓄
  ridge(H * 0.3, 34, 0.3, 7)
  ridge(H * 0.48, 46, 0.26, 6)
  ridge(H * 0.68, 28, 0.2, 5)
  ctx.restore()
  // 淡墨水痕
  ctx.save()
  for (let i = 0; i < 14; i++) {
    const x = rr(0, W)
    const y = rr(0, H)
    const r = rr(30, 90)
    const g = ctx.createRadialGradient(x, y, 1, x, y, r)
    g.addColorStop(0, "rgba(30,42,48,0.1)")
    g.addColorStop(1, "rgba(30,42,48,0)")
    ctx.fillStyle = g
    ctx.beginPath()
    ctx.arc(x, y, r, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.restore()
  // 低饱和沉静
  band(ctx, 0, H, "rgba(120,130,135,0.1)")
  return toTexture(cv)
}

/** 星核暗芒：深空哑光黑金属磨砂 + 星尘颗粒 + 青蓝电路螺旋 */
function buildXinghedanmangShaft(): Texture {
  srand(505)
  const { cv, ctx } = newCanvas()
  vBand(ctx, 0, H, [
    [0, "#131c30"],
    [0.35, "#0a1020"],
    [0.7, "#070b16"],
    [1, "#04050a"],
  ])
  // 细腻金属磨砂质感
  speckle(ctx, 0, H, 3200, "rgba(150,175,220,0.075)", 1.3)
  speckle(ctx, 0, H, 2200, "rgba(0,0,0,0.3)", 1.3)
  // 细碎嵌入式星尘颗粒
  for (let i = 0; i < 300; i++) {
    const x = rr(0, W)
    const y = rr(0, H)
    const r = rr(0.6, 2.1)
    const g = ctx.createRadialGradient(x, y, 0.1, x, y, r * 3)
    g.addColorStop(0, `rgba(225,240,255,${rr(0.55, 1)})`)
    g.addColorStop(1, "rgba(180,210,255,0)")
    ctx.fillStyle = g
    ctx.beginPath()
    ctx.arc(x, y, r * 3, 0, Math.PI * 2)
    ctx.fill()
  }
  // 内嵌纤细青蓝电路纹路（顺着杆身螺旋延伸）
  ctx.save()
  ctx.shadowColor = "#39c6ff"
  ctx.shadowBlur = 7
  for (let i = 0; i < 5; i++) {
    ctx.strokeStyle = `rgba(57,198,255,${0.4 + i * 0.09})`
    ctx.lineWidth = 1.7
    ctx.beginPath()
    const x0 = (i * 61) % W
    ctx.moveTo(x0, 0)
    // 螺旋：沿杆长推进的同时绕周向平移
    for (let t = 0; t <= 1; t += 0.02) {
      const x = (x0 + t * W * 1.25) % W
      const y = t * H
      ctx.lineTo(x, y)
    }
    ctx.stroke()
    // 电路节点
    ctx.fillStyle = "rgba(120,215,255,0.85)"
    for (let k = 1; k < 5; k++) {
      const t = k / 5
      ctx.fillRect(((x0 + t * W * 1.25) % W) - 2.2, t * H - 2.2, 4.4, 4.4)
    }
  }
  ctx.restore()
  return toTexture(cv)
}

/** 霓虹溯光：半透深紫玻璃 + 内部粉蓝渐变带状螺旋 */
function buildNihongsuguangShaft(): Texture {
  srand(606)
  const { cv, ctx } = newCanvas()
  vBand(ctx, 0, H, [
    [0, "#4a2a86"],
    [0.35, "#33195f"],
    [0.7, "#241046"],
    [1, "#180a30"],
  ])
  // 通透玻璃质感：竖向高光 + 内部层次（wrap 安全）
  ctx.save()
  drawWrapped(ctx, () => {
    for (let i = 0; i < 26; i++) {
      const x = rr(0, W)
      ctx.fillStyle = `rgba(255,255,255,${rr(0.03, 0.11)})`
      ctx.fillRect(x, 0, rr(2, 7), H)
    }
  })
  ctx.restore()
  // 内部粉蓝渐变带状结构（沿杆身螺旋延展；wrap 安全——辉光跨界补画）
  ctx.save()
  ctx.shadowColor = "#ff5fd0"
  ctx.shadowBlur = 14
  drawWrapped(ctx, () => {
    for (let i = 0; i < 3; i++) {
      const x0 = i * (W / 3)
      // 渐变相对「带自身起点」而非画布对角线：跨接缝补画的份与原件颜色一致
      const g = ctx.createLinearGradient(x0, 0, x0 + W * 0.9, H)
      g.addColorStop(0, "rgba(255,123,224,0.85)")
      g.addColorStop(0.5, "rgba(150,140,255,0.8)")
      g.addColorStop(1, "rgba(90,200,255,0.85)")
      ctx.strokeStyle = g
      ctx.lineWidth = 22
      ctx.beginPath()
      for (let t = 0; t <= 1; t += 0.01) {
        const x = (x0 + t * W * 0.9) % W
        const y = t * H
        t === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)
      }
      ctx.stroke()
    }
  })
  ctx.restore()
  // 内部色带层次通透分明：叠加细亮线（wrap 安全）
  ctx.save()
  ctx.globalAlpha = 0.5
  drawWrapped(ctx, () => {
    for (let i = 0; i < 3; i++) {
      ctx.strokeStyle = i % 2 ? "rgba(160,230,255,0.8)" : "rgba(255,190,240,0.8)"
      ctx.lineWidth = 2
      ctx.beginPath()
      const x0 = i * (W / 3) + 8
      for (let t = 0; t <= 1; t += 0.01) {
        const x = (x0 + t * W * 0.9) % W
        const y = t * H
        t === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)
      }
      ctx.stroke()
    }
  })
  ctx.restore()
  return toTexture(cv)
}

/** 虚空裂隙：纯哑光炭黑金属 + 纵向凹陷裂隙（内填半透幽紫） */
function buildXukonglilieShaft(): Texture {
  srand(707)
  const { cv, ctx } = newCanvas()
  vBand(ctx, 0, H, [
    [0, "#191919"],
    [0.35, "#111112"],
    [0.7, "#0c0c0d"],
    [1, "#070708"],
  ])
  // 纯哑光：极细均匀磨砂，几乎无高光
  speckle(ctx, 0, H, 3600, "rgba(255,255,255,0.045)", 1.2)
  speckle(ctx, 0, H, 3000, "rgba(0,0,0,0.35)", 1.2)
  // 纵向分布数道凹陷裂隙
  const rifts = 5
  for (let i = 0; i < rifts; i++) {
    const x0 = ((i + 0.5) * W) / rifts + rr(-14, 14)
    const wdt = rr(7, 15)
    // 凹陷：先画暗槽（凹陷阴影）
    ctx.fillStyle = "rgba(0,0,0,0.85)"
    ctx.fillRect(x0 - wdt / 2 - 2, 0, wdt + 4, H)
    // 裂隙内部填充半透幽紫材质
    const g = ctx.createLinearGradient(0, 0, 0, H)
    g.addColorStop(0, "rgba(90,45,160,0.5)")
    g.addColorStop(0.5, "rgba(155,92,255,0.8)")
    g.addColorStop(1, "rgba(90,45,160,0.5)")
    ctx.fillStyle = g
    ctx.fillRect(x0 - wdt / 2, 0, wdt, H)
    // 内壁高光（凹陷边缘）
    ctx.fillStyle = "rgba(200,170,255,0.35)"
    ctx.fillRect(x0 - wdt / 2, 0, 1.6, H)
    ctx.fillStyle = "rgba(120,80,190,0.5)"
    ctx.fillRect(x0 + wdt / 2 - 1.6, 0, 1.6, H)
    // 裂隙走向轻微起伏（利落但不呆板）
    ctx.save()
    ctx.globalCompositeOperation = "destination-out"
    ctx.fillStyle = "rgba(0,0,0,0.5)"
    for (let y = 0; y < H; y += 40) {
      ctx.fillRect(x0 - wdt / 2 + Math.sin(y * 0.012 + i) * 2.2, y, 2.2, 22)
    }
    ctx.restore()
  }
  return toTexture(cv)
}

/** 幽刺夜影：炭黑金属 + 放射状尖刺暗纹 + 小块深海贝母幻彩 */
function buildYouciyeyingShaft(): Texture {
  srand(808)
  const { cv, ctx } = newCanvas()
  vBand(ctx, 0, H, [
    [0, "#3d3d47"],
    [0.35, "#23232b"],
    [0.7, "#18181e"],
    [1, "#0e0e12"],
  ])
  // 金属细磨砂
  speckle(ctx, 0, H, 2400, "rgba(255,255,255,0.06)", 1.3)
  speckle(ctx, 0, H, 1800, "rgba(0,0,0,0.3)", 1.3)
  // 放射状尖刺暗纹（顺着杆身排布，尖刺朝杆头方向；wrap 安全）
  ctx.save()
  drawWrapped(ctx, () => {
    for (let i = 0; i < 76; i++) {
      const x = rr(0, W)
      const y = rr(-40, H)
      const h = rr(30, 74)
      const w = rr(9, 20)
      const g = ctx.createLinearGradient(x, y, x, y + h)
      g.addColorStop(0, "rgba(6,6,9,0.9)")
      g.addColorStop(1, "rgba(6,6,9,0.15)")
      ctx.fillStyle = g
      ctx.beginPath()
      ctx.moveTo(x - w / 2, y + h)
      ctx.lineTo(x, y)
      ctx.lineTo(x + w / 2, y + h)
      ctx.closePath()
      ctx.fill()
      // 尖刺侧边微光（金属冷光）
      ctx.strokeStyle = "rgba(180,190,215,0.16)"
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(x - w / 2, y + h)
      ctx.lineTo(x, y)
      ctx.stroke()
    }
  })
  ctx.restore()
  // 局部点缀小块深海贝母（低调幻彩珠光）
  for (let i = 0; i < 16; i++) {
    const x = rr(10, W - 10)
    const y = rr(10, H - 10)
    const r = rr(9, 19)
    ctx.save()
    ctx.translate(x, y)
    ctx.rotate(rr(0, Math.PI))
    const g = ctx.createLinearGradient(-r, -r, r, r)
    g.addColorStop(0, "rgba(140,220,255,0.75)")
    g.addColorStop(0.25, "rgba(210,160,255,0.7)")
    g.addColorStop(0.55, "rgba(160,255,230,0.6)")
    g.addColorStop(0.85, "rgba(130,160,220,0.45)")
    g.addColorStop(1, "rgba(80,90,140,0.15)")
    ctx.fillStyle = g
    ctx.beginPath()
    ctx.ellipse(0, 0, r, r * 0.66, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.strokeStyle = "rgba(220,235,255,0.42)"
    ctx.lineWidth = 1.2
    ctx.stroke()
    ctx.restore()
  }
  return toTexture(cv)
}

/** 烬火焚风：黑红渐变 + 自然熔岩龟裂（缝隙暗红） */
function buildJinhuofengfengShaft(): Texture {
  srand(909)
  const { cv, ctx } = newCanvas()
  vBand(ctx, 0, H, [
    [0, "#2a0d06"],
    [0.3, "#4a1207"],
    [0.6, "#240a04"],
    [1, "#100402"],
  ])
  // 厚重粗犷：岩石斑驳
  speckle(ctx, 0, H, 2200, "rgba(0,0,0,0.32)", 1.8)
  speckle(ctx, 0, H, 900, "rgba(120,50,25,0.2)", 1.8)
  // 自然熔岩龟裂纹理：多边形裂纹网
  const pts: [number, number][] = []
  for (let i = 0; i < 90; i++) pts.push([rr(0, W), rr(0, H)])
  ctx.save()
  ctx.lineCap = "round"
  for (const [x, y] of pts) {
    // 每个结点向 3~4 个方向延伸短裂痕
    const dirs = Math.floor(rr(3, 5))
    for (let d = 0; d < dirs; d++) {
      let cx = x
      let cy = y
      let a = rr(0, Math.PI * 2)
      // 暗红底色缝隙（先宽后窄的发光芯）
      ctx.strokeStyle = "rgba(120,20,6,0.85)"
      ctx.lineWidth = rr(4, 8)
      ctx.beginPath()
      ctx.moveTo(cx, cy)
      const steps = Math.floor(rr(2, 5))
      for (let s = 0; s < steps; s++) {
        a += rr(-0.7, 0.7)
        cx += Math.cos(a) * rr(14, 40)
        cy += Math.sin(a) * rr(14, 40)
        ctx.lineTo(cx, cy)
      }
      ctx.stroke()
      // 裂纹内芯余烬（橙红）
      ctx.strokeStyle = `rgba(255,110,30,${rr(0.35, 0.8)})`
      ctx.lineWidth = rr(1.2, 2.6)
      ctx.stroke()
    }
  }
  ctx.restore()
  // 龟裂块面：不规则暗块，增强"厚重"
  ctx.save()
  for (let i = 0; i < 40; i++) {
    const x = rr(0, W)
    const y = rr(0, H)
    const r = rr(18, 52)
    ctx.fillStyle = `rgba(0,0,0,${rr(0.1, 0.28)})`
    ctx.beginPath()
    ctx.moveTo(x + rr(-r, r), y + rr(-r, r))
    for (let k = 0; k < 5; k++) ctx.lineTo(x + rr(-r, r), y + rr(-r, r))
    ctx.closePath()
    ctx.fill()
  }
  ctx.restore()
  return toTexture(cv)
}

/** 云糖幻梦：粉白渐变半透果冻 + 朦胧柔和云朵暗纹 */
function buildYuntianghuanmengShaft(): Texture {
  srand(1010)
  const { cv, ctx } = newCanvas()
  vBand(ctx, 0, H, [
    [0, "#fff2f7"],
    [0.3, "#ffe0ec"],
    [0.62, "#fbd5e6"],
    [1, "#e9d6ff"],
  ])
  // 朦胧柔和云朵暗纹（wrap 安全）
  ctx.save()
  ctx.filter = "blur(3px)"
  drawWrapped(ctx, () => {
    for (let r = 0; r < 10; r++) {
      for (let c = 0; c < 3; c++) {
        const x = 52 + c * 82 + (r % 2 ? 41 : 0)
        const y = 58 + r * 104
        ctx.fillStyle = "rgba(255,255,255,0.62)"
        ctx.beginPath()
        ctx.arc(x - 17, y, 23, 0, Math.PI * 2)
        ctx.arc(x + 17, y, 23, 0, Math.PI * 2)
        ctx.arc(x, y - 15, 27, 0, Math.PI * 2)
        ctx.fill()
      }
    }
  })
  ctx.restore()
  // 果冻半透：柔和珠光 + 内部通透层次
  for (let i = 0; i < 22; i++) {
    const x = rr(0, W)
    const y = rr(0, H)
    const r = rr(18, 46)
    const g = ctx.createRadialGradient(x, y, 1, x, y, r)
    g.addColorStop(0, "rgba(255,255,255,0.5)")
    g.addColorStop(1, "rgba(255,255,255,0)")
    ctx.fillStyle = g
    ctx.beginPath()
    ctx.arc(x, y, r, 0, Math.PI * 2)
    ctx.fill()
  }
  // 整体色调柔和均匀：轻微提亮
  band(ctx, 0, H, "rgba(255,255,255,0.08)")
  return toTexture(cv)
}

/** 冰晶雪魄：透白半透冰晶 + 内部冰棱丝状纹路 + 薄冰切面轮廓 */
function buildBingjingxuepoShaft(): Texture {
  srand(1111)
  const { cv, ctx } = newCanvas()
  vBand(ctx, 0, H, [
    [0, "#f4fbff"],
    [0.35, "#dfeeF9"],
    [0.7, "#c2ddf0"],
    [1, "#a6c8e2"],
  ])
  // 内部自然冰棱丝状纹路
  ctx.save()
  ctx.lineCap = "round"
  for (let i = 0; i < 70; i++) {
    const x = rr(0, W)
    const y = rr(0, H)
    const len = rr(50, 190)
    const a = rr(-0.45, 0.45) + Math.PI / 2 // 大致沿杆长
    ctx.strokeStyle = `rgba(255,255,255,${rr(0.5, 0.95)})`
    ctx.lineWidth = rr(0.8, 2.4)
    ctx.beginPath()
    ctx.moveTo(x, y)
    ctx.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len)
    ctx.stroke()
    // 冷调冰棱阴影
    ctx.strokeStyle = `rgba(140,185,215,${rr(0.2, 0.5)})`
    ctx.lineWidth = rr(0.6, 1.6)
    ctx.beginPath()
    ctx.moveTo(x + 1.5, y + 1.5)
    ctx.lineTo(x + Math.cos(a) * len + 1.5, y + Math.sin(a) * len + 1.5)
    ctx.stroke()
  }
  ctx.restore()
  // 杆边缘薄冰切面轮廓（沿周向的清脆切面线；wrap 安全）
  ctx.save()
  drawWrapped(ctx, () => {
    for (let i = 0; i < 16; i++) {
      const x = (i * W) / 16 + rr(-5, 5)
      ctx.strokeStyle = "rgba(255,255,255,0.85)"
      ctx.lineWidth = rr(1, 2.6)
      ctx.beginPath()
      ctx.moveTo(x, 0)
      ctx.lineTo(x + rr(-10, 10), H)
      ctx.stroke()
      ctx.strokeStyle = "rgba(150,195,225,0.35)"
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(x + 3, 0)
      ctx.lineTo(x + 3 + rr(-10, 10), H)
      ctx.stroke()
    }
  })
  ctx.restore()
  // 通透干净：整体提亮 + 冷调
  band(ctx, 0, H, "rgba(230,245,255,0.14)")
  return toTexture(cv)
}

/** 万象权杖：黑金撞色金属 + 复古欧式几何浮雕雕花（层次立体） */
function buildWanxiangquanzhangShaft(): Texture {
  srand(1212)
  const { cv, ctx } = newCanvas()
  vBand(ctx, 0, H, [
    [0, "#241c0f"],
    [0.3, "#14100a"],
    [0.62, "#1b150c"],
    [1, "#0b0805"],
  ])
  // 黑金撞色：沿杆身交替的黑金竖带
  for (let i = 0; i < 8; i++) {
    const x = (i * W) / 8
    ctx.fillStyle = i % 2 ? "rgba(201,162,74,0.16)" : "rgba(0,0,0,0.3)"
    ctx.fillRect(x, 0, W / 8, H)
  }
  // 金属细拉丝
  speckle(ctx, 0, H, 2000, "rgba(255,235,190,0.05)", 1.2)
  // 复古欧式几何浮雕雕花（层次立体：暗底 + 主体 + 高光）
  const motif = (cx: number, cy: number, s: number) => {
    // 浮雕暗底（下沉阴影菱形）
    ctx.strokeStyle = "rgba(0,0,0,0.8)"
    ctx.lineWidth = 6 * s
    ctx.beginPath()
    ctx.moveTo(cx, cy - 30 * s)
    ctx.lineTo(cx + 22 * s, cy)
    ctx.lineTo(cx, cy + 30 * s)
    ctx.lineTo(cx - 22 * s, cy)
    ctx.closePath()
    ctx.stroke()
    // 主体鎏金几何菱格外框
    ctx.strokeStyle = "rgba(201,162,74,0.95)"
    ctx.lineWidth = 2.8 * s
    ctx.beginPath()
    ctx.moveTo(cx, cy - 28 * s)
    ctx.lineTo(cx + 20 * s, cy)
    ctx.lineTo(cx, cy + 28 * s)
    ctx.lineTo(cx - 20 * s, cy)
    ctx.closePath()
    ctx.stroke()
    // 内十字（几何骨架）
    ctx.beginPath()
    ctx.moveTo(cx, cy - 14 * s)
    ctx.lineTo(cx, cy + 14 * s)
    ctx.moveTo(cx - 12 * s, cy)
    ctx.lineTo(cx + 12 * s, cy)
    ctx.stroke()
    // 四角卷草小涡
    ctx.strokeStyle = "rgba(232,200,120,0.85)"
    ctx.lineWidth = 1.8 * s
    for (let k = 0; k < 4; k++) {
      const a = (Math.PI / 2) * k + Math.PI / 4
      const x = cx + Math.cos(a) * 20 * s
      const y = cy + Math.sin(a) * 20 * s
      ctx.beginPath()
      ctx.arc(x, y, 5 * s, a, a + Math.PI * 1.3)
      ctx.stroke()
    }
    // 高光（凸起受光面）
    ctx.strokeStyle = "rgba(255,245,210,0.5)"
    ctx.lineWidth = 1.2 * s
    ctx.beginPath()
    ctx.moveTo(cx, cy - 28 * s)
    ctx.lineTo(cx + 20 * s, cy)
    ctx.lineTo(cx, cy + 28 * s)
    ctx.lineTo(cx - 20 * s, cy)
    ctx.closePath()
    ctx.stroke()
  }
  for (let r = 0; r < 9; r++) {
    for (let c = 0; c < 2; c++) {
      motif(64 + c * 128, 60 + r * 112, 0.9)
    }
  }
  // 鎏金分隔环
  ring(ctx, H * 0.24, H * 0.022, "#c9a24a", { edge: "rgba(255,245,210,0.55)" })
  ring(ctx, H * 0.68, H * 0.022, "#c9a24a", { edge: "rgba(255,245,210,0.55)" })
  return toTexture(cv)
}

// ==================== 12 款特色球杆皮肤 · 杆尾（握把 + 装饰 + 端盖） ====================

/** 墨云龙阙：哑光黑檀握把（细密天然木纹）+ 窄哑光金属环（内侧极简云纹） */
function buildMoyunlongqueButt(): Texture {
  srand(1101)
  const { cv, ctx } = newCanvas()
  // 接缝过渡（与杆身衔接的一小段）：延续浮雕暗金龙鳞的细密风格
  vBand(ctx, 0, 46, [
    [0, "#100d08"],
    [1, "#161209"],
  ])
  for (let r = 0; r < 2; r++) {
    for (let c = 0; c < 10; c++) {
      const sw = W / 10
      const sh = 46 / 2
      const x = c * sw + (r % 2 ? sw / 2 : 0)
      const y = r * sh
      const cx = x + sw / 2
      const cy = y + sh / 2
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, sw * 0.55)
      g.addColorStop(0, "rgba(45,35,12,0.25)")
      g.addColorStop(0.55, "rgba(115,95,42,0.55)")
      g.addColorStop(0.85, "rgba(145,120,55,0.22)")
      g.addColorStop(1, "rgba(0,0,0,0)")
      ctx.fillStyle = g
      ctx.beginPath()
      ctx.moveTo(cx, y)
      ctx.lineTo(x + sw, cy)
      ctx.lineTo(cx, y + sh)
      ctx.lineTo(x, cy)
      ctx.closePath()
      ctx.fill()
      ctx.strokeStyle = "rgba(190,155,75,0.16)"
      ctx.lineWidth = 1
      ctx.stroke()
    }
  }
  // 握把：哑光黑檀肌理（让细密木纹更可见但仍保持哑光）
  gripWood(ctx, 46, GRIP_END, "#241c12", "#100c07", "rgba(195,175,135,0.45)")
  // 杆尾装饰带
  vBand(ctx, GRIP_END, DECOR_END, [
    [0, "#1a150e"],
    [0.5, "#100d08"],
    [1, "#0a0805"],
  ])
  cloudRibbon(ctx, GRIP_END + (DECOR_END - GRIP_END) * 0.3, 12, "rgba(201,162,74,0.32)", 3)
  cloudRibbon(ctx, GRIP_END + (DECOR_END - GRIP_END) * 0.62, 8, "rgba(201,162,74,0.2)", 2, 1.5)
  // 端盖
  capMatteRingCloud(ctx, DECOR_END)
  return toTexture(cv)
}

/** 青竹听风：竹根粗糙握把 + 圆润竹根收口（无金属） */
function buildQingzhutingfengButt(): Texture {
  srand(1202)
  const { cv, ctx } = newCanvas()
  vBand(ctx, 0, 46, [
    [0, "#86bd63"],
    [1, "#7ab158"],
  ])
  gripBambooRoot(ctx, 46, GRIP_END)
  vBand(ctx, GRIP_END, DECOR_END, [
    [0, "#6d8f3c"],
    [0.5, "#5a7a30"],
    [1, "#486424"],
  ])
  // 竹节收束
  ring(ctx, GRIP_END + (DECOR_END - GRIP_END) * 0.22, (DECOR_END - GRIP_END) * 0.07, "rgba(55,92,34,0.7)", {
    edge: "rgba(238,248,235,0.6)",
  })
  woodGrain(ctx, GRIP_END, DECOR_END, {
    dark: "rgba(40,70,22,0.45)",
    light: "rgba(215,240,190,0.3)",
    lines: 45,
    wave: 2,
  })
  capBambooRound(ctx, DECOR_END)
  return toTexture(cv)
}

/** 凤羽鎏金：深色编织缠线握把 + 环形鎏金饰件（简约羽纹） */
function buildFengyuliujinButt(): Texture {
  srand(1303)
  const { cv, ctx } = newCanvas()
  vBand(ctx, 0, 46, [
    [0, "#120d08"],
    [1, "#1a130c"],
  ])
  gripWovenCord(ctx, 46, GRIP_END, "#2c2114", "rgba(200,160,95,0.5)")
  vBand(ctx, GRIP_END, DECOR_END, [
    [0, "#1d1610"],
    [0.5, "#120d08"],
    [1, "#0a0705"],
  ])
  woodGrain(ctx, GRIP_END, DECOR_END, {
    dark: "rgba(0,0,0,0.6)",
    light: "rgba(160,130,90,0.14)",
    lines: 40,
    wave: 3,
  })
  // 装饰带上的细鎏金线
  ctx.strokeStyle = "rgba(232,200,120,0.5)"
  ctx.lineWidth = 1.6
  cloudRibbon(ctx, GRIP_END + (DECOR_END - GRIP_END) * 0.4, 10, "rgba(232,200,120,0.45)", 1.6)
  capGoldRingFeather(ctx, DECOR_END)
  return toTexture(cv)
}

/** 千里砚山：仿粗陶磨砂握把 + 方正小砚台端盖（无亮色金属） */
function buildQianliyanshanButt(): Texture {
  srand(1404)
  const { cv, ctx } = newCanvas()
  vBand(ctx, 0, 46, [
    [0, "#5c6a71"],
    [1, "#6b797f"],
  ])
  gripCeramic(ctx, 46, GRIP_END)
  vBand(ctx, GRIP_END, DECOR_END, [
    [0, "#5f6b71"],
    [0.5, "#4e5a60"],
    [1, "#414c52"],
  ])
  speckle(ctx, GRIP_END, DECOR_END, 700, "rgba(255,255,255,0.1)", 1.6)
  speckle(ctx, GRIP_END, DECOR_END, 600, "rgba(0,0,0,0.22)", 1.6)
  capInkstone(ctx, DECOR_END)
  return toTexture(cv)
}

/** 星核暗芒：防滑橡胶细密点阵握把 + 圆形哑光金属饰片（极简电路标识） */
function buildXinghedanmangButt(): Texture {
  srand(1505)
  const { cv, ctx } = newCanvas()
  vBand(ctx, 0, 46, [
    [0, "#0a1020"],
    [1, "#0e1424"],
  ])
  speckle(ctx, 0, 46, 120, "rgba(150,175,220,0.08)", 1.2)
  gripRubberDots(ctx, 46, GRIP_END)
  vBand(ctx, GRIP_END, DECOR_END, [
    [0, "#101724"],
    [0.5, "#0a0f1a"],
    [1, "#06080f"],
  ])
  speckle(ctx, GRIP_END, DECOR_END, 500, "rgba(150,175,220,0.07)", 1.3)
  // 装饰带：青蓝细电路线
  ctx.save()
  ctx.shadowColor = "#39c6ff"
  ctx.shadowBlur = 6
  ctx.strokeStyle = "rgba(57,198,255,0.5)"
  ctx.lineWidth = 1.5
  for (let i = 0; i < 3; i++) {
    const y = GRIP_END + (DECOR_END - GRIP_END) * (0.25 + i * 0.25)
    ctx.beginPath()
    ctx.moveTo(0, y)
    ctx.lineTo(W * 0.4, y)
    ctx.lineTo(W * 0.5, y - 12)
    ctx.lineTo(W, y - 12)
    ctx.stroke()
  }
  ctx.restore()
  capMetalDisc(ctx, DECOR_END)
  return toTexture(cv)
}

/** 霓虹溯光：黑色哑光软胶握把（竖向防滑凹槽）+ 多边形金属切面端盖 */
function buildNihongsuguangButt(): Texture {
  srand(1606)
  const { cv, ctx } = newCanvas()
  vBand(ctx, 0, 46, [
    [0, "#241046"],
    [1, "#2b1453"],
  ])
  gripSoftGrooves(ctx, 46, GRIP_END)
  vBand(ctx, GRIP_END, DECOR_END, [
    [0, "#2b1a52"],
    [0.5, "#1e1140"],
    [1, "#150c30"],
  ])
  // 装饰带：粉蓝霓虹细线
  ctx.save()
  ctx.shadowColor = "#ff5fd0"
  ctx.shadowBlur = 10
  ctx.strokeStyle = "rgba(255,123,224,0.75)"
  ctx.lineWidth = 2.4
  ctx.beginPath()
  ctx.moveTo(0, GRIP_END + (DECOR_END - GRIP_END) * 0.5)
  ctx.lineTo(W, GRIP_END + (DECOR_END - GRIP_END) * 0.5)
  ctx.stroke()
  ctx.strokeStyle = "rgba(90,200,255,0.75)"
  ctx.beginPath()
  ctx.moveTo(0, GRIP_END + (DECOR_END - GRIP_END) * 0.62)
  ctx.lineTo(W, GRIP_END + (DECOR_END - GRIP_END) * 0.62)
  ctx.stroke()
  ctx.restore()
  capPolyFacet(ctx, DECOR_END)
  return toTexture(cv)
}

/** 虚空裂隙：哑光皮革压纹握把 + 简洁钝锥形金属收口 */
function buildXukonglilieButt(): Texture {
  srand(1707)
  const { cv, ctx } = newCanvas()
  vBand(ctx, 0, 46, [
    [0, "#111112"],
    [1, "#151517"],
  ])
  gripLeatherEmboss(ctx, 46, GRIP_END)
  vBand(ctx, GRIP_END, DECOR_END, [
    [0, "#141416"],
    [0.5, "#0d0d0e"],
    [1, "#08080a"],
  ])
  speckle(ctx, GRIP_END, DECOR_END, 700, "rgba(255,255,255,0.04)", 1.2)
  // 装饰带：一道幽紫细缝（与杆身裂隙呼应）
  const g = ctx.createLinearGradient(0, 0, W, 0)
  g.addColorStop(0, "rgba(155,92,255,0.1)")
  g.addColorStop(0.5, "rgba(155,92,255,0.55)")
  g.addColorStop(1, "rgba(155,92,255,0.1)")
  ctx.fillStyle = g
  ctx.fillRect(0, GRIP_END + (DECOR_END - GRIP_END) * 0.42, W, 5)
  capBluntCone(ctx, DECOR_END)
  return toTexture(cv)
}

/** 幽刺夜影：虎纹压花真皮握把 + 小巧锥形金属配重（磨砂） */
function buildYouciyeyingButt(): Texture {
  srand(1808)
  const { cv, ctx } = newCanvas()
  vBand(ctx, 0, 46, [
    [0, "#18181e"],
    [1, "#1e1e25"],
  ])
  gripTigerLeather(ctx, 46, GRIP_END)
  vBand(ctx, GRIP_END, DECOR_END, [
    [0, "#1c1c22"],
    [0.5, "#131317"],
    [1, "#0c0c0f"],
  ])
  speckle(ctx, GRIP_END, DECOR_END, 600, "rgba(255,255,255,0.05)", 1.3)
  // 装饰带：金属细环
  ring(ctx, GRIP_END + (DECOR_END - GRIP_END) * 0.3, (DECOR_END - GRIP_END) * 0.05, "#4a4a56", {
    edge: "rgba(200,200,220,0.22)",
  })
  capConeWeight(ctx, DECOR_END)
  return toTexture(cv)
}

/** 烬火焚风：粗纹防滑橡胶握把 + 不规则熔岩岩石端盖 */
function buildJinhuofengfengButt(): Texture {
  srand(1909)
  const { cv, ctx } = newCanvas()
  vBand(ctx, 0, 46, [
    [0, "#240a04"],
    [1, "#33100a"],
  ])
  gripCoarseRubber(ctx, 46, GRIP_END)
  vBand(ctx, GRIP_END, DECOR_END, [
    [0, "#2e1208"],
    [0.5, "#1e0a05"],
    [1, "#140603"],
  ])
  // 装饰带：暗红余烬裂纹
  ctx.strokeStyle = "rgba(190,45,15,0.6)"
  ctx.lineWidth = 2.2
  for (let i = 0; i < 5; i++) {
    let x = rr(0, W)
    let y = GRIP_END + rr(0, (DECOR_END - GRIP_END) * 0.8)
    ctx.beginPath()
    ctx.moveTo(x, y)
    for (let k = 0; k < 3; k++) {
      x += rr(-26, 26)
      y += rr(6, 18)
      ctx.lineTo(x, y)
    }
    ctx.stroke()
  }
  capLavaRock(ctx, DECOR_END)
  return toTexture(cv)
}

/** 云糖幻梦：哑光柔雾硅胶握把（圆润）+ 圆润弧形端盖（无硬棱角） */
function buildYuntianghuanmengButt(): Texture {
  srand(2010)
  const { cv, ctx } = newCanvas()
  vBand(ctx, 0, 46, [
    [0, "#fbd5e6"],
    [1, "#fce0ee"],
  ])
  gripSiliconeMatte(ctx, 46, GRIP_END, "#f7cfdf", "#eebcd2")
  vBand(ctx, GRIP_END, DECOR_END, [
    [0, "#f9d2e2"],
    [0.5, "#f4c3d8"],
    [1, "#eeb6cf"],
  ])
  speckle(ctx, GRIP_END, DECOR_END, 900, "rgba(255,255,255,0.14)", 1.5)
  capRoundedArc(ctx, DECOR_END)
  return toTexture(cv)
}

/** 冰晶雪魄：磨砂冷白硅胶握把 + 多面冰晶切割端盖 */
function buildBingjingxuepoButt(): Texture {
  srand(2111)
  const { cv, ctx } = newCanvas()
  vBand(ctx, 0, 46, [
    [0, "#c2ddf0"],
    [1, "#d3e7f6"],
  ])
  gripSiliconeMatte(ctx, 46, GRIP_END, "#dfeef9", "#c6dcee")
  // 磨砂冷白：叠加冷调
  band(ctx, 46, GRIP_END, "rgba(200,225,245,0.16)")
  vBand(ctx, GRIP_END, DECOR_END, [
    [0, "#dfeeF9"],
    [0.5, "#cfe6f6"],
    [1, "#b9d6ec"],
  ])
  speckle(ctx, GRIP_END, DECOR_END, 700, "rgba(255,255,255,0.3)", 1.5)
  capIceFacet(ctx, DECOR_END)
  return toTexture(cv)
}

/** 万象权杖：深色手工缠绕皮线握把 + 宽大圆形鎏金浮雕饰盘（卷草纹） */
function buildWanxiangquanzhangButt(): Texture {
  srand(2212)
  const { cv, ctx } = newCanvas()
  vBand(ctx, 0, 46, [
    [0, "#14100a"],
    [1, "#1b150c"],
  ])
  gripLeatherCord(ctx, 46, GRIP_END)
  vBand(ctx, GRIP_END, DECOR_END, [
    [0, "#1f1810"],
    [0.5, "#14100a"],
    [1, "#0b0805"],
  ])
  // 装饰带：鎏金细环 + 几何菱格
  ring(ctx, GRIP_END + (DECOR_END - GRIP_END) * 0.16, (DECOR_END - GRIP_END) * 0.05, "#c9a24a", {
    edge: "rgba(255,245,210,0.5)",
  })
  ctx.strokeStyle = "rgba(201,162,74,0.4)"
  ctx.lineWidth = 1.4
  for (let i = 0; i < 8; i++) {
    const cx = (i + 0.5) * (W / 8)
    const cy = GRIP_END + (DECOR_END - GRIP_END) * 0.6
    ctx.beginPath()
    ctx.moveTo(cx, cy - 12)
    ctx.lineTo(cx + 9, cy)
    ctx.lineTo(cx, cy + 12)
    ctx.lineTo(cx - 9, cy)
    ctx.closePath()
    ctx.stroke()
  }
  capGoldMedallion(ctx, DECOR_END)
  return toTexture(cv)
}

// ==================== 遗留 6 款主题 · 杆尾（v1.4.3 补齐独立分区） ====================
// 此前这 6 款没有独立杆尾贴图（buildButt 返回 null → 整根共用一张贴图），
// 握把/装饰带/端盖三分区完全缺失，图案在杆尾段被拉伸错位。
// 现按各自母题补齐：握把（grip 工具）+ 装饰带（呼应杆身图案）+ 端盖（专属造型）。

/** 屠龙斩：暗红木握把 + 金鳞装饰带 + 鎏金鳞环端盖 */
function buildDragonButt(): Texture {
  srand(3111)
  const { cv, ctx } = newCanvas()
  vBand(ctx, 0, 46, [
    [0, "#3a0d0d"],
    [1, "#4a1212"],
  ])
  gripWood(ctx, 46, GRIP_END, "#4a1414", "#2a0b0b", "rgba(215,170,110,0.4)")
  vBand(ctx, GRIP_END, DECOR_END, [
    [0, "#331010"],
    [0.5, "#230a0a"],
    [1, "#160606"],
  ])
  // 金鳞装饰带（呼应杆身龙鳞）
  drawScales(
    ctx,
    5,
    8,
    (r, c) => ((r + c) % 2 ? "#caa23a" : "#9c7a1e"),
    "rgba(40,20,0,0.5)",
    GRIP_END + 10,
    DECOR_END - 10
  )
  capScaleRing(ctx, DECOR_END, "#2a0d0d", "#caa23a", "#9c7a1e", "#e8c878")
  return toTexture(cv)
}

/** 青龙：青蓝木握把 + 青鳞装饰带 + 青玉鳞环端盖 */
function buildAzureButt(): Texture {
  srand(3222)
  const { cv, ctx } = newCanvas()
  vBand(ctx, 0, 46, [
    [0, "#0e4a6e"],
    [1, "#12557a"],
  ])
  gripWood(ctx, 46, GRIP_END, "#0f4a68", "#09324a", "rgba(140,220,235,0.35)")
  vBand(ctx, GRIP_END, DECOR_END, [
    [0, "#0d4260"],
    [0.5, "#09344c"],
    [1, "#062838"],
  ])
  drawScales(
    ctx,
    5,
    8,
    (r, c) => ((r + c) % 2 ? "#5fd0e0" : "#2f9fc0"),
    "rgba(5,30,45,0.55)",
    GRIP_END + 10,
    DECOR_END - 10
  )
  capScaleRing(ctx, DECOR_END, "#0a3a52", "#5fd0e0", "#2f9fc0", "#3fe0c0")
  return toTexture(cv)
}

/** 小黄人：蓝色工装橡胶点阵握把 + 黄色装饰带（蓝口袋线）+ 护目镜圆盘端盖 */
function buildMinionsButt(): Texture {
  srand(3333)
  const { cv, ctx } = newCanvas()
  vBand(ctx, 0, 46, [
    [0, "#f4d000"],
    [1, "#e0bd00"],
  ])
  gripRubberDots(ctx, 46, GRIP_END)
  vBand(ctx, GRIP_END, DECOR_END, [
    [0, "#f4d000"],
    [0.5, "#e5c400"],
    [1, "#cfae00"],
  ])
  // 工装裤口袋线（双蓝条）
  const dh = DECOR_END - GRIP_END
  band(ctx, GRIP_END + dh * 0.4, GRIP_END + dh * 0.46, "#1f6fb2")
  band(ctx, GRIP_END + dh * 0.56, GRIP_END + dh * 0.62, "#1f6fb2")
  capGoggleDisc(ctx, DECOR_END)
  return toTexture(cv)
}

/** 小猪佩奇：粉色柔雾硅胶握把 + 深粉装饰带 + 白色爱心端盖 */
function buildPeppaButt(): Texture {
  srand(3444)
  const { cv, ctx } = newCanvas()
  vBand(ctx, 0, 46, [
    [0, "#ff9ec4"],
    [1, "#ff8fbb"],
  ])
  gripSiliconeMatte(ctx, 46, GRIP_END, "#ffaed0", "#f790ba")
  vBand(ctx, GRIP_END, DECOR_END, [
    [0, "#ff86b4"],
    [0.5, "#f2739f"],
    [1, "#e2618e"],
  ])
  speckle(ctx, GRIP_END, DECOR_END, 500, "rgba(255,255,255,0.18)", 1.4)
  capHeartCap(ctx, DECOR_END)
  return toTexture(cv)
}

/** 火麒麟：深红粗纹橡胶握把 + 火舌装饰带 + 鎏金鳞环端盖 */
function buildQilinButt(): Texture {
  srand(3555)
  const { cv, ctx } = newCanvas()
  vBand(ctx, 0, 46, [
    [0, "#d8320a"],
    [1, "#b82a08"],
  ])
  gripCoarseRubber(ctx, 46, GRIP_END)
  vBand(ctx, GRIP_END, DECOR_END, [
    [0, "#a32608"],
    [0.5, "#8a1f06"],
    [1, "#6e1804"],
  ])
  // 火舌点缀（呼应杆身）
  ctx.fillStyle = "rgba(255,220,120,0.72)"
  for (let i = 0; i < 10; i++) {
    const x = (i * 61 + 17) % W
    const y = GRIP_END + 12 + ((i * 53) % (DECOR_END - GRIP_END - 30))
    ctx.beginPath()
    ctx.moveTo(x, y + 26)
    ctx.quadraticCurveTo(x + 15, y - 6, x + 27, y + 20)
    ctx.quadraticCurveTo(x + 12, y + 13, x, y + 26)
    ctx.closePath()
    ctx.fill()
  }
  capScaleRing(ctx, DECOR_END, "#7a1404", "#ffd24a", "#ff9a2a", "#e8c878")
  return toTexture(cv)
}

/** 奥特曼：银灰橡胶点阵握把 + 红色能量环装饰带 + 六角护甲端盖 */
function buildUltramanButt(): Texture {
  srand(3666)
  const { cv, ctx } = newCanvas()
  vBand(ctx, 0, 46, [
    [0, "#c3ccd4"],
    [1, "#b3bec8"],
  ])
  gripRubberDots(ctx, 46, GRIP_END, ["#aeb9c2", "#8f9aa4", "#6f7a84"])
  vBand(ctx, GRIP_END, DECOR_END, [
    [0, "#b9c4cc"],
    [0.5, "#9aa6ae"],
    [1, "#7e8a92"],
  ])
  // 红色能量环带（呼应杆身）
  const dh = DECOR_END - GRIP_END
  ring(ctx, GRIP_END + dh * 0.26, dh * 0.09, "#c81f1f", {
    edge: "rgba(255,255,255,0.4)",
  })
  ring(ctx, GRIP_END + dh * 0.6, dh * 0.06, "#c81f1f")
  capHexPlates(ctx, DECOR_END)
  return toTexture(cv)
}

// ==================== v1.4.3 统一视觉增强层 ====================
// 背景见文件头注。所有主题（19 款 × 杆身/杆尾）构建完成后都经过 enhance()：
//   接缝金属接环 → 轴向形体 → 周向定向光照（强度自适应）。

/** 0xRRGGBB → "r,g,b" */
function rgbOf(a: number): string {
  return `${(a >> 16) & 255},${(a >> 8) & 255},${a & 255}`
}

/**
 * 周向周期的横向**灰度**渐变（供 multiply / screen 合成使用）：
 * 展开图 x 轴对应周向 0~360°，fn(t) 必须满足 fn(0) === fn(1)，
 * 否则贴图左右缝合处会出现一道硬边。
 * 用 33 个 colorstop 采样，对余弦型的明暗函数足够平滑。
 */
function hGray(
  ctx: CanvasRenderingContext2D,
  fn: (t: number) => number,
  n = 32
) {
  const g = ctx.createLinearGradient(0, 0, W, 0)
  for (let i = 0; i <= n; i++) {
    const t = i / n
    const v = Math.round(255 * Math.max(0, Math.min(1, fn(t))))
    g.addColorStop(t, `rgb(${v},${v},${v})`)
  }
  return g
}

type ReliefOpts = {
  /** 主光方位（0~1 周向；默认 0.30，略偏左上、接近场景主光方向） */
  theta?: number
  /** 总强度倍率（主题 relief 配置） */
  gain?: number
  /** 背光暗面峰值（multiply：最暗处乘 1-dark） */
  dark?: number
  /** 高光总能量（拆成宽受光面 + 窄镜面带两层，screen） */
  spec?: number
  /** 轮廓反光峰值（screen，主题 accent 色） */
  rim?: number
  /** 镜面高光锐度（越大越窄） */
  power?: number
  /** 轮廓反光颜色（"r,g,b"） */
  rimRgb?: string
}

/**
 * 圆柱定向光照：Lambert 暗面 + 宽受光面 + 窄镜面高光带 + 背光侧轮廓反光。
 *
 * 【合成模式】暗面用 multiply（乘性压暗：保持下层图案与饱和度，只是变暗）、
 * 亮面用 screen（提亮但封顶 255，不会过曝）—— 两者都会**扩大**明度动态
 * 范围。第一版曾用 source-over 的黑/白半透明叠加，实测（260×120 缩略图）
 * 亮色主题 rms 对比度全线下滑（p98-p2 收缩 34~103）：黑叠灰、白漂白，
 * 整体被压向中间灰，必须用乘性/加性合成。
 *
 * 四层全为周期 1 的周向函数，左右缝合无痕。
 */
function cylinderRelief(ctx: CanvasRenderingContext2D, o: ReliefOpts = {}) {
  const th = o.theta ?? 0.3
  const gain = o.gain ?? 1
  const dark = Math.min(0.72, (o.dark ?? 0.3) * gain)
  const spec = Math.min(0.85, (o.spec ?? 0.4) * gain)
  const rim = Math.min(0.5, (o.rim ?? 0.14) * gain)
  const pw = o.power ?? 6
  const cs = (t: number) => Math.cos(2 * Math.PI * (t - th))
  ctx.save()
  // ① 背光暗面（主光正对面最暗，向两侧平滑回升）
  ctx.globalCompositeOperation = "multiply"
  ctx.fillStyle = hGray(ctx, (t) => 1 - (0.5 - 0.5 * cs(t)) * dark)
  ctx.fillRect(0, 0, W, H)
  // ② 受光亮面（宽而柔）+ ③ 镜面高光带（窄而亮）
  ctx.globalCompositeOperation = "screen"
  ctx.fillStyle = hGray(ctx, (t) => Math.pow(Math.max(0, cs(t)), 1.7) * spec * 0.3)
  ctx.fillRect(0, 0, W, H)
  ctx.fillStyle = hGray(ctx, (t) => Math.pow(Math.max(0, cs(t)), pw) * spec * 0.7)
  ctx.fillRect(0, 0, W, H)
  // ④ 背光侧轮廓反光（环境 bounce，用主题 accent 作色彩点缀）
  const rc = (o.rimRgb ?? "190,215,255").split(",").map(Number)
  const g4 = ctx.createLinearGradient(0, 0, W, 0)
  for (let i = 0; i <= 32; i++) {
    const t = i / 32
    const a = Math.pow(Math.max(0, -cs(t)), 10) * rim
    g4.addColorStop(
      t,
      `rgb(${Math.round(rc[0] * a)},${Math.round(rc[1] * a)},${Math.round(rc[2] * a)})`
    )
  }
  ctx.fillStyle = g4
  ctx.fillRect(0, 0, W, H)
  ctx.restore()
}

/** 底图平均明度（0~1），供光照强度自适应 */
function meanLuma(ctx: CanvasRenderingContext2D): number {
  const d = ctx.getImageData(0, 0, W, H).data
  let s = 0
  let n = 0
  for (let i = 0; i < d.length; i += 4 * 16) {
    s += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]
    n++
  }
  return n ? s / n / 255 : 0.5
}

/** 轴向形体：两端轻收暗（multiply 乘性，保细节），避免"一根均匀塑料管"的观感 */
function axialDepth(ctx: CanvasRenderingContext2D, part: "shaft" | "butt") {
  const g = ctx.createLinearGradient(0, 0, 0, H)
  if (part === "shaft") {
    // 画布上=杆头，下=接缝
    g.addColorStop(0, "rgb(214,214,214)")
    g.addColorStop(0.24, "rgb(250,250,250)")
    g.addColorStop(0.85, "rgb(243,243,243)")
    g.addColorStop(1, "rgb(222,222,222)")
  } else {
    // 画布上=接缝，下=杆尾端
    g.addColorStop(0, "rgb(226,226,226)")
    g.addColorStop(0.16, "rgb(252,252,252)")
    g.addColorStop(1, "rgb(234,234,234)")
  }
  ctx.save()
  ctx.globalCompositeOperation = "multiply"
  ctx.fillStyle = g
  ctx.fillRect(0, 0, W, H)
  ctx.restore()
}

/**
 * 接缝金属接环：shaft 贴图画布底端画半枚 + butt 贴图画布顶端画半枚，
 * 两段 mesh 拼合后正好一整枚（宽度换算见 JOINT_SHAFT / JOINT_BUTT 注释）。
 * 用半透明叠加而非实色，让接环透出各主题的底色 —— 同一结构、各自成色。
 */
function jointCollar(
  ctx: CanvasRenderingContext2D,
  part: "shaft" | "butt",
  accent: number
) {
  const ar = rgbOf(accent)
  if (part === "shaft") {
    const y0 = H - JOINT_SHAFT
    band(ctx, y0 - 3, y0, "rgba(0,0,0,0.5)") // 与杆身图案的分界压边
    vBand(ctx, y0, y0 + JOINT_SHAFT * 0.52, [
      [0, `rgba(${ar},0.38)`],
      [0.55, "rgba(255,255,255,0.45)"],
      [1, `rgba(${ar},0.28)`],
    ])
    vBand(ctx, y0 + JOINT_SHAFT * 0.52, H, [
      [0, `rgba(${ar},0.28)`],
      [0.6, "rgba(0,0,0,0.26)"],
      [1, `rgba(${ar},0.16)`],
    ])
    band(ctx, y0 + 1, y0 + 2.6, "rgba(255,255,255,0.7)") // 抛光亮线
    band(ctx, H - 2.6, H - 0.6, "rgba(255,255,255,0.3)")
    return
  }
  const y1 = JOINT_BUTT
  vBand(ctx, 0, y1 * 0.48, [
    [0, "rgba(255,255,255,0.38)"],
    [0.55, `rgba(${ar},0.38)`],
    [1, `rgba(${ar},0.28)`],
  ])
  vBand(ctx, y1 * 0.48, y1, [
    [0, `rgba(${ar},0.28)`],
    [0.5, "rgba(255,255,255,0.3)"],
    [1, "rgba(0,0,0,0.32)"],
  ])
  band(ctx, y1 - 3, y1, "rgba(0,0,0,0.4)")
}

/**
 * 统一后处理入口。光照强度 = 主题 relief × 底图明度自适应：
 *   · 底图越暗 → 高光/轮廓越强（深色主题全靠明暗轮廓表达形体）；
 *   · 底图越亮 → 暗面越深（亮色主题靠对比而不是提亮）。
 */
function enhance(
  tex: Texture,
  themeId: string,
  part: "shaft" | "butt"
): Texture {
  const cv = (tex as CanvasTexture).image as HTMLCanvasElement
  const ctx = cv.getContext("2d")!
  const theme = getCueTheme(themeId)
  jointCollar(ctx, part, theme.accent)
  axialDepth(ctx, part)
  const v = meanLuma(ctx)
  cylinderRelief(ctx, {
    gain: theme.relief ?? 1,
    // 底图越暗 → 高光/轮廓越强（深色主题全靠明暗轮廓表达形体）
    spec: 0.22 + 0.52 * Math.pow(1 - v, 1.2),
    rim: 0.08 + 0.2 * (1 - v),
    // 底图越亮 → 暗面越深，但系数压低：亮色主题的背光面若被压穿
    // 缩略图背景阈值（L≈23），整根杆会"瘦一圈"（实测青龙掩膜 8.0→4.5%）
    dark: 0.12 + 0.22 * v,
    power: part === "butt" ? 5 : 6,
    rimRgb: rgbOf(theme.accent),
  })
  tex.needsUpdate = true
  return tex
}
