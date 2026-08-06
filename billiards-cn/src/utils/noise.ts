/**
 * 确定性程序化噪声工具（v1.1.6 雪山升级）。
 *
 * 使用 three.MathUtils.seededRandom 提供 **确定性** 伪随机数，避免每次切换
 * 场景后山形重新洗牌。基于 value-noise + 多阶 FBM（fractional brownian motion），
 * 用于：
 *   - 雪山顶点位移（让远山轮廓不再像规则的圆锥）
 *   - 雪地/冰面顶点色扰动
 *   - 冰锥随机角度偏转，破对称
 *
 * 不引入 SimplexNoise / ImprovedNoise 依赖，零运行时 chunk 开销。
 */

import { MathUtils } from "three"

/**
 * 给定种子返回一个 [0,1) 的确定性随机数生成器（闭包）。
 * 不同种子对应完全独立的随机序列，便于「同一座山每次长一样」。
 */
export function makeSeededRng(seed: number): () => number {
  let s = (seed | 0) || 1
  return () => {
    s = (s * 1664525 + 1013904223) | 0
    return ((s >>> 0) % 100000) / 100000
  }
}

/**
 * 平滑 value-noise：先用 makeSeededRng 生成一张 hash 表，再用三次样条
 * 平滑插值。给定 (x, y) → [0,1)。
 */
export function makeValueNoise2D(seed: number, tableSize = 256): (x: number, y: number) => number {
  const rng = makeSeededRng(seed)
  const table = new Float32Array(tableSize * tableSize)
  for (let i = 0; i < table.length; i++) table[i] = rng()

  const wrap = (n: number) => ((n % tableSize) + tableSize) % tableSize
  // 三次样条 6t^5-15t^4+10t^3，比普通 lerp 更平滑
  const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10)

  return (x: number, y: number) => {
    const xi = Math.floor(x)
    const yi = Math.floor(y)
    const xf = x - xi
    const yf = y - yi
    const u = fade(xf)
    const v = fade(yf)

    const x0 = wrap(xi)
    const x1 = wrap(xi + 1)
    const y0 = wrap(yi)
    const y1 = wrap(yi + 1)

    const a = table[y0 * tableSize + x0]
    const b = table[y0 * tableSize + x1]
    const c = table[y1 * tableSize + x0]
    const d = table[y1 * tableSize + x1]

    const ab = a + (b - a) * u
    const cd = c + (d - c) * u
    return ab + (cd - ab) * v
  }
}

/**
 * 分数布朗运动（fBm）：在 value-noise 上叠加多个倍频 + 振幅衰减，
 * 得到具有分形特征的连续噪声。`octaves` 越多细节越丰富（也更贵）。
 *
 * @param noise 已构造的 value-noise 函数
 * @param x     输入坐标（任意尺度，建议先用 frequency 缩放）
 * @param y     输入坐标
 * @param octaves  倍频数（推荐 3-5）
 * @param lacunarity  频率倍数（推荐 2.0）
 * @param gain  振幅倍数（推荐 0.5）
 */
export function fbm2D(
  noise: (x: number, y: number) => number,
  x: number,
  y: number,
  octaves = 4,
  lacunarity = 2.0,
  gain = 0.5
): number {
  let amp = 1
  let freq = 1
  let sum = 0
  let norm = 0
  for (let i = 0; i < octaves; i++) {
    sum += amp * noise(x * freq, y * freq)
    norm += amp
    amp *= gain
    freq *= lacunarity
  }
  return sum / norm
}

/** 简单 LCG 备用（与 MathUtils.seededRandom 行为一致，但保留备用入口） */
export function lcgRandom(seed: number): () => number {
  return () => MathUtils.seededRandom(seed)
}