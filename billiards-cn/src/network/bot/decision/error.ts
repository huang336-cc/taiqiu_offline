import { DecisionContext, clamp01 } from "./shotcontext"
import { PowerTier } from "./power"

/**
 * v1.3.91：误差模型（专业级 AI 决策层）。
 *
 * 改造前专业档的误差是**恒定**的：aimNoise = 0.0015 弧度、powerJitter = 0。
 * 这带来两个方向上的失真：
 *   ① 简单球与高难球用同一个（极小的）误差 → 长台薄球也几乎必进，
 *      观感是「无脑百分百进球的神仙球」；
 *   ② 没有难度分层，玩家感受不到「这球难打」。
 *
 * 职业选手的真实分布是：**简单球几乎不失误，难球会打丢但不离谱**。
 * 因此这里把误差拆成四个乘子：
 *   难度缩放 × 力度档缩放 × 手感波动 × 压力系数
 *
 * 重要：误差只改变「瞄准角与力度」的输入，**不改物理**。
 * 球体运动仍严格由共享物理引擎推演，失误是难度自然产生的，不做剧本式送分。
 */

export interface ErrorBudget {
  /** 传给 generateShot 的瞄准角噪声（弧度，均匀分布 ±noise/2） */
  aimNoise: number
  /** 力度抖动比例（实际力度 = 计划 × (1 ± jitter)） */
  powerJitter: number
  /** 扎杆附加的抬杆角噪声（弧度） */
  elevationNoise: number
}

/** 难度 → 误差倍率：d=0 时 ×0.5，d=1 时 ×3.5，中间按 1.3 次幂过渡 */
function difficultyScale(difficulty: number): number {
  return 0.5 + 3.0 * Math.pow(clamp01(difficulty), 1.3)
}

/** 力度档 → 误差倍率：越发力越难精准（炸球不保证完美散开） */
function tierScale(tier: PowerTier): number {
  switch (tier) {
    case "break":
      return 2.2
    case "firm":
      return 1.35
    case "medium":
      return 1.0
    default:
      return 0.85
  }
}

/**
 * 计算本杆的误差预算。
 *
 * @param difficulty 本杆进攻难度 0~1（防守/解球杆传估算难度）
 * @param tier       力度档位
 * @param isJump     是否为扎杆（贴球场景备选，执行难度更高）
 */
export function errorBudget(
  ctx: DecisionContext,
  difficulty: number,
  tier: PowerTier,
  isJump = false
): ErrorBudget {
  const p = ctx.profile
  const d = clamp01(difficulty)
  const ts = tierScale(tier)

  // 手感波动：连续进球 2 颗以上开始轻微上浮，最多 +25%
  const streak = 1 + 0.25 * clamp01((ctx.potStreak - 2) / 5)
  // 赛点压力：张力感，误差略增
  const pressure = 1 + 0.15 * ctx.pressure
  // 扎杆：固定叠加执行难度
  const jump = isJump ? 1.8 : 1.0

  return {
    aimNoise: p.aimNoise * difficultyScale(d) * ts * streak * pressure * jump,
    // 专业档基准 powerJitter = 0，这里按难度线性注入（简单球仍趋近 0）
    powerJitter: p.powerJitter + 0.035 * d * ts,
    elevationNoise: isJump ? 0.06 : 0,
  }
}
