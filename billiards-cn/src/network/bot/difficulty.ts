/**
 * v1.3.58：AI 电脑难度分级。
 *
 * 背景：此前「难度」只是 URL 里一个 bot 名字字符串，BotEventHandler 用
 * if/else 三分叉选策略，三档之间**没有任何参数差异** ——
 * AimCalculator 的 noise 实参在所有调用点都写死为 0，唯一生效的随机性
 * （随机旋转）反而只加在最弱的稳健档上，形成难度倒挂：
 * 稳健 < 激进 ≈ 专业，而「专业」与「激进」出杆完全一样（满力打远袋角）。
 *
 * 现在把每档的能力拆成显式参数，策略按参数决定行为，三档才有真实区分度。
 */

export interface DifficultyProfile {
  /** 与 URL 的 bot 参数一致的标识 */
  readonly id: BotDifficultyId
  /** 中文短名（比分栏括号内的显示） */
  readonly zh: string
  /** 英文短名 */
  readonly en: string
  /**
   * 瞄准角噪声（弧度）。出杆角度会叠加 ±aimNoise/2 的均匀随机偏差。
   * 参考量级：1 米距离上 0.01 rad ≈ 1 cm 偏移，职业选手打丢的临界约 0.3~0.5 cm。
   */
  readonly aimNoise: number
  /** 力度抖动比例（0 = 力度精准）。实际力度 = 计划力度 ×(1 ± powerJitter) */
  readonly powerJitter: number
  /**
   * 是否枚举所有「目标球 × 袋口」组合并评分挑选。
   * 关闭时只按距离挑最近/最远的一颗球直取最佳袋口（稳健档的打法）。
   */
  readonly evaluateCandidates: boolean
  /** 切球角余弦下限：低于该值（球太薄）的组合直接不考虑。越大越保守 */
  readonly minCutCos: number
  /** 是否预判母球停位、避开会摔袋的打法 */
  readonly avoidScratch: boolean
  /** 是否按「打进后母球朝向剩余球群」做走位评分 */
  readonly positionPlay: boolean
  /** 是否用高低杆/加塞主动控制母球（专业档的核心能力） */
  readonly useSpin: boolean
  /** 是否按距离自适应力度（近用小力、远用大力），而不是一律满力 */
  readonly adaptivePower: boolean
  /** 无球可进时是否做安全球（轻碰并把母球留在难打的位置） */
  readonly safetyPlay: boolean
}

export type BotDifficultyId = "ClawBreak" | "TheFarJaw" | "Professional"

/**
 * 三档难度参数。
 *
 * 设计原则（对应「专业级不要出现低级失误，母球控制要精确」）：
 * - 稳健：真会打丢。瞄准噪声 0.030 rad（1 米外偏移约 3cm，足以打丢薄球），
 *   力度抖动 12%，不做走位也不做防摔袋 —— 像个刚学会打球的人。
 * - 激进：能连续进球但不稳定。噪声 0.010 rad（1 米外约 1cm），力度抖动 5%，
 *   会挑球但只按切球角排序，不做母球控制，容易走位崩掉或摔袋。
 * - 专业：接近零失误。噪声 0.0015 rad（1 米外约 1.5mm，基本等于无误差），
 *   力度零抖动，完整候选评分 + 防摔袋 + 走位 + 旋转控制 + 力度自适应。
 */
export const DIFFICULTY: Record<BotDifficultyId, DifficultyProfile> = {
  ClawBreak: {
    id: "ClawBreak",
    zh: "电脑(稳健)",
    en: "CPU(Steady)",
    aimNoise: 0.03,
    powerJitter: 0.12,
    evaluateCandidates: false,
    minCutCos: 0.15,
    avoidScratch: false,
    positionPlay: false,
    useSpin: false,
    adaptivePower: false,
    safetyPlay: false,
  },
  TheFarJaw: {
    id: "TheFarJaw",
    zh: "电脑(激进)",
    en: "CPU(Aggressive)",
    aimNoise: 0.01,
    powerJitter: 0.05,
    evaluateCandidates: true,
    minCutCos: 0.2,
    avoidScratch: true,
    positionPlay: false,
    useSpin: false,
    adaptivePower: true,
    safetyPlay: false,
  },
  Professional: {
    id: "Professional",
    zh: "电脑(专业)",
    en: "CPU(Pro)",
    // 1.5 毫弧度：2 米外偏移约 3mm，小于球半径的 1/10，等同于零失误
    aimNoise: 0.0015,
    powerJitter: 0,
    evaluateCandidates: true,
    // 只打切球角余弦 ≥0.34（约 70° 以内）的球，太薄的球不冒险
    minCutCos: 0.34,
    avoidScratch: true,
    positionPlay: true,
    useSpin: true,
    adaptivePower: true,
    safetyPlay: true,
  },
}

/** 由 URL 的 bot 参数取难度档位，未知值退回稳健档 */
export function difficultyFor(botName: string | null | undefined):
  DifficultyProfile {
  if (botName === "TheFarJaw") return DIFFICULTY.TheFarJaw
  if (botName === "Professional") return DIFFICULTY.Professional
  return DIFFICULTY.ClawBreak
}

/**
 * 按力度抖动系数扰动计划力度。
 * 抖动用均匀分布而非高斯：高斯尾部可能偶发出极端力度（爆冲或软杆），
 * 均匀分布把误差严格限制在 ±powerJitter 内，观感是「力度不稳」而不是「抽风」。
 */
export function jitterPower(power: number, jitter: number): number {
  if (jitter <= 0) return power
  return power * (1 + (Math.random() * 2 - 1) * jitter)
}
