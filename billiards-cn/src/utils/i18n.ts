/**
 * 中英文案集中管理（v1.3.22 起支持运行时中英切换）
 *
 * 所有面向用户的文字统一在此维护，便于校对与调整。
 * 旧导出 `T` 保留为「默认中文」以保证向后兼容；新代码请用 `t("xxx")`。
 */

import { Settings } from "./settings"

/** 规则名：键→中文（不变，规则名本身就是中文） */
export const RULE_NAMES: Record<string, string> = {
  nineball: "九球",
  eightball: "八球",
  snooker: "斯诺克",
  threecushion: "三库开伦",
  sagu: "四球",
  "threecushion-drill": "开伦练习",
  drill: "练习模式",
}

export function ruleName(key: string | undefined): string {
  if (!key) return "台球"
  return RULE_NAMES[key] ?? key
}

/** 犯规原因翻译表：把引擎产生的英文原因映射为中文 */
const FOUL_REASONS: Record<string, string> = {
  "Cue ball potted": "母球落袋",
  "No ball hit": "空杆，未击中任何球",
  "Wrong ball hit first": "首个击中的球不对",
  "No cushion after contact": "碰撞后无球碰库",
  "Cue ball hit nothing": "母球未击中任何球",
  "Potted opponent ball": "打进对方的球",
  "Hit opponent ball first": "先碰到对方的球",
  "Potted black ball": "黑八提前落袋",
  "No rail after contact": "击球后无球碰库",
}

export function foulReason(reason: string | undefined): string {
  if (!reason) return "犯规"
  const hit = FOUL_REASONS[reason.trim()]
  if (hit) return hit
  return translateFoulHeuristic(reason)
}

/** 兜底：对包含常见英文关键词的原因做启发式翻译 */
function translateFoulHeuristic(reason: string): string {
  const r = reason.toLowerCase()
  if (r.includes("cue ball") && r.includes("pot")) return "母球落袋"
  if (r.includes("no ball hit") || r.includes("hit nothing"))
    return "空杆，未击中任何球"
  if (r.includes("wrong ball")) return "击球目标错误"
  if (r.includes("cushion") || r.includes("rail")) return "碰撞后无球碰库"
  if (r.includes("foul")) {
    const m = /\((\d+)\s*points?\)/i.exec(reason)
    if (m) return `犯规（对方加 ${m[1]} 分）`
    return "犯规"
  }
  return reason
}

/** v1.3.22：双语文案表。键名沿用旧 T 字段名，值为 { zh, en }。 */
const STRINGS: Record<string, { zh: string; en: string }> = {
  // 通用
  foul: { zh: "犯规", en: "Foul" },
  ballInHand: { zh: "自由球（可任意摆放母球）", en: "Ball in hand (place the cue ball anywhere)" },
  gameOver: { zh: "本局结束", en: "Game Over" },
  youWon: { zh: "你赢了", en: "You Won" },
  youLost: { zh: "你输了", en: "You Lost" },
  newGame: { zh: "再来一局", en: "New Game" },
  backToMenu: { zh: "返回主菜单", en: "Back to Menu" },
  replay: { zh: "回放本局", en: "Replay" },
  close: { zh: "关闭", en: "Close" },
  confirm: { zh: "确定", en: "Confirm" },
  cancel: { zh: "取消", en: "Cancel" },

  // 局面提示
  breakTitle: { zh: "开球", en: "Break" },
  yourTurn: { zh: "轮到你出杆", en: "Your Turn" },
  placeCueBall: { zh: "请摆放母球", en: "Place the Cue Ball" },
  systemError: { zh: "系统错误", en: "System Error" },
  replayComplete: { zh: "回放结束", en: "Replay Complete" },

  // 对局信息
  vsBot: { zh: "对战电脑", en: "vs CPU" },
  practice: { zh: "自由练习", en: "Practice" },

  // 得分板
  player: { zh: "玩家", en: "You" },
  opponent: { zh: "对手", en: "Opponent" },
  computer: { zh: "电脑", en: "CPU" },
  breakScore: { zh: "连续得分", en: "Run" },
  solids: { zh: "全色球", en: "Solids" },
  stripes: { zh: "花色球", en: "Stripes" },

  // 击球按钮
  hitButton: { zh: "击球", en: "Shoot" },
  placeBallButton: { zh: "摆球", en: "Place" },
  placeWhite: { zh: "摆白球", en: "Place White" },
  placeYellow: { zh: "摆黄球", en: "Place Yellow" },
  placeRed: { zh: "摆红球", en: "Place Red" },
  continueButton: { zh: "继续", en: "Continue" },
}

/**
 * 取得当前界面语言下的文案。
 * 取值失败时优雅降级为中文（保证旧调用方永远拿到非空字符串）。
 */
export function t(key: keyof typeof STRINGS): string {
  const entry = STRINGS[key]
  if (!entry) return String(key)
  let lang: "zh" | "en" = "zh"
  try {
    const s = Settings.get().language
    if (s === "en" || s === "zh") lang = s
  } catch (_) {
    // 初始化阶段 Settings 尚未注入，保守回退中文
  }
  return entry[lang] || entry.zh
}

/** 旧导出：保持向后兼容（始终为中文）。新代码请改用 t()。 */
export const T: { [K in keyof typeof STRINGS]: string } = new Proxy(
  {} as { [K in keyof typeof STRINGS]: string },
  {
    get(_t, key: string) {
      const entry = STRINGS[key]
      return entry ? entry.zh : String(key)
    },
  }
)