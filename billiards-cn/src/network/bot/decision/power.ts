import { Vector3 } from "three"
import { R } from "../../../model/physics/constants"
import { cueSpeedFor } from "../powerphysics"
import { DecisionContext } from "./shotcontext"
import { OffenseCandidate } from "./offense"

/**
 * v1.3.91：力度档位体系（专业级 AI 决策层）。
 *
 * 核心修正：改造前 choosePower() 直接拿 cueSpeedFor() 的反解值当最终力度 ——
 * 而 cueSpeedFor 解的是「物体球**刚好**够滚到袋口」的最小速度（×margin 1.2），
 * 于是每一杆都是小力轻推（实测平均仅 31.8R），用户反馈「所有球都小力轻推」。
 *
 * 职业选手的思路正好相反：**先按局面选力度档位，再校验这一档够不够进袋**。
 *   - 近台袋口球 → 中力（不是小力），打厚实、抗干扰
 *   - 长台 / 大角度薄球 → 中大力，保证球滚得到、母球走得开
 *   - 需要母球大范围走位 → 中大力
 *   - 炸球 / 开球 → 大力
 *   - 只有贴球防守、贴球薄球、精细停球才用小力
 *
 * 因此本模块里 cueSpeedFor 的返回值降级为「**合法性下界**」（required），
 * 真正的力度由档位区间决定，两者取「够用且不超供」的平衡点。
 */

export type PowerTier = "touch" | "medium" | "firm" | "break"

/**
 * 档位对应的出杆速度区间（m/s）。
 * 换算参考：R = 0.03275m，故 30R ≈ 0.98 m/s，90R ≈ 2.95 m/s。
 */
export const TIER_RANGE: Record<PowerTier, [number, number]> = {
  touch: [21 * R, 41 * R], //  0.69~1.34 m/s  精细控位 / 贴球 / 薄球防守
  medium: [49 * R, 79 * R], // 1.60~2.59 m/s  常规进攻 + 走位（职业主流）
  firm: [79 * R, 116 * R], //  2.59~3.80 m/s  长台 / 大角度 / 大范围走位
  break: [128 * R, 159 * R], // 4.19~5.21 m/s 炸球（maxPower = 160R）
}

/** 档位中文名（日志与 harness 指标用） */
export const TIER_LABEL: Record<PowerTier, string> = {
  touch: "小力轻推",
  medium: "中力",
  firm: "中大力",
  break: "大力炸球",
}

export interface PowerChoice {
  /** 最终出杆速度（m/s） */
  power: number
  tier: PowerTier
  /** 物理反解得到的「进袋所需最小速度」（m/s） */
  required: number
  /** 是否因摔袋风险被迫收力（但仍不低于 required） */
  downgraded: boolean
}

/** 长台判定：母球→目标 + 目标→袋 总路程超过该值（米） */
const LONG_SHOT = 1.8
/** 大角度薄球判定：cutCos 低于该值 */
const THIN_SHOT_CUT = 0.55

/**
 * 选择力度档位与最终力度。
 *
 * @param cand     入选的进攻候选（提供距离/切角/袋口）
 * @param position 走位评估结果（quality 越低越需要主动走位）
 * @param spin     已确定的杆法（低杆会削弱母球滚动效率，需补偿）
 */
export function choosePowerTier(
  ctx: DecisionContext,
  cand: OffenseCandidate,
  position: { quality: number; targetTravel: number },
  spin: Vector3
): PowerChoice {
  // 1) 物理下界：物体球滚到袋口边界时仍保有撞库余速（沿用 v1.3.74 的合法性保险）
  const required = cueSpeedFor(
    cand.cueToBall,
    cand.ballToPocketTrue + 2 * cand.pocketRadius,
    cand.pocketRadius,
    cand.cutCos,
    spin.y,
    spin.length(),
    1.2
  )

  // 2) 档位决策（职业思维：距离与走位需求优先，而非「够进就行」）
  const total = cand.cueToBall + cand.ballToPocketTrue
  let tier: PowerTier
  if (ctx.isBreak) {
    tier = "break" // 开球必然发力
  } else if (ctx.cueTouching) {
    tier = "touch" // 只有贴球场景才默认小力
  } else if (total > LONG_SHOT || cand.cutCos < THIN_SHOT_CUT) {
    tier = "firm" // 长台 / 大角度薄球 → 中大力
  } else if (position.targetTravel > 1.2) {
    tier = "firm" // 需要母球跑较远做位 → 中大力
  } else {
    tier = "medium" // 默认中力（**不再是小力**）
  }
  // 赛点压力：长台搏球再抬一档（小幅冒险，增加博弈张力）
  if (tier === "medium" && ctx.pressure > 0.5 && total > 1.2) tier = "firm"

  const [lo, hi] = TIER_RANGE[tier]

  // 3) 取「档位内、够用且不超供」的值：以 required 上浮 10% 为基准，夹进档位区间
  let power = Math.max(lo, Math.min(hi, required * 1.1))
  // 反解异常值保护：不能低于档位下限（否则又变回小力），也不能超档位上限
  power = Math.min(Math.max(power, lo), hi)

  // 4) 摔袋风险收力（v1.3.91 分级）。
  //
  // 力度整体抬到中力后，母球跑得比小力时代远得多，改造前那套「只在
  // scratchRisk < 1.6R 才收力」的阈值是按小力标定的，实测摔袋率从 1~2%
  // 升到 4~5%。这里改为按轨迹离袋距离分三档收力：
  //   < 1.6R（几乎正对袋口） → 收到「够进袋」的最低可用力度
  //   < 2.4R                 → 压到小力上界（明显减速，但仍远高于 required）
  //   < 3.6R                 → 压到中力下界（轻微收力）
  // 所有收力都**不低于 required**，保证球仍能滚到袋口、不犯「无球碰库」。
  let downgraded = false
  if (ctx.profile.avoidScratch) {
    const rr = cand.scratchRisk
    let capped: number | null = null
    if (rr < 1.6 * R) capped = Math.max(required, TIER_RANGE.touch[1])
    else if (rr < 2.4 * R) capped = Math.max(required, TIER_RANGE.touch[1])
    else if (rr < 3.6 * R) capped = Math.max(required, TIER_RANGE.medium[0])
    if (capped !== null && power > capped) {
      power = capped
      downgraded = true
    }
  }
  return { power, tier, required, downgraded }
}

/** 把力度换算回 R 单位（日志/调试可读性） */
export function toR(power: number): number {
  return power / R
}
