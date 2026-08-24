import { NineBall } from "./nineball"

/**
 * 专业模式（Professional）：基于九球规则的更困难变体。
 *
 * 难度强化点：
 * - aiNoiseScale = 0.55：电脑 AI 瞄准噪声更小，出杆更精准、失误更少。
 *   所有 bot 策略（TheFarJaw / ClawBreak 等）的 generateShot 噪声都会乘以该缩放，
 *   让电脑在走位与进球上更稳定，玩家更难取胜。
 * - 其余规则（开球、进球、犯规、胜负）完全复用九球逻辑，保证玩法一致、
 *   不引入新的规则歧义。
 */
export class Professional extends NineBall {
  rulename = "professional"
  aiNoiseScale = 0.55
}
