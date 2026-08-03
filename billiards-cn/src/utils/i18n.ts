/**
 * 中文文案集中管理
 *
 * 所有面向用户的文字统一在此维护，便于校对与调整。
 */

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

export const T = {
  // 通用
  foul: "犯规",
  ballInHand: "自由球（可任意摆放母球）",
  gameOver: "本局结束",
  youWon: "你赢了",
  youLost: "你输了",
  newGame: "再来一局",
  backToMenu: "返回主菜单",
  replay: "回放本局",
  close: "关闭",
  confirm: "确定",
  cancel: "取消",

  // 局面提示
  breakTitle: "开球",
  yourTurn: "轮到你出杆",
  placeCueBall: "请摆放母球",
  systemError: "系统错误",
  replayComplete: "回放结束",

  // 对局信息
  vsBot: "对战电脑",
  practice: "自由练习",

  // 得分板
  player: "玩家",
  computer: "电脑",
  breakScore: "连续得分",
  solids: "全色球",
  stripes: "花色球",

  // 击球按钮
  hitButton: "击球",
  placeBallButton: "摆球",
  placeWhite: "摆白球",
  placeYellow: "摆黄球",
  placeRed: "摆红球",
  continueButton: "继续",
}
