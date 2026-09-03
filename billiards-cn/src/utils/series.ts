/**
 * v1.3.65：系列赛比分（人机对战连胜统计）。
 *
 * 背景：结算面板原本只有「再来一局 / 查看回放 / 保存回放 / 返回主菜单」四个按钮，
 * 「再来一局」走 `location.reload()`，会把 URL 上的 `?bot=&ruletype=` 等参数原样
 * 带回来重开一局 —— 但**没有任何地方记录连打下来赢了几局**，玩家和电脑之间
 * 「打到几比几」全靠自己记。本次补上这个累计。
 *
 * 生命周期（与用户确认的规则一致）：
 *   - 结算时（赢或输）累加一局；
 *   - 点「再来一局」→ reload 保留参数，比分继续累加；
 *   - 点「返回主菜单」→ 回到 menu.html，比分清零；
 *   - 换玩法（八球 → 九球）→ 自动归零重来，不同玩法混记没有意义。
 *
 * 存储用 localStorage（与 settings.ts 同一套持久化习惯），不依赖网络、
 * 不依赖后端，APK 离线可用。localStorage 在 file:// / https:// 虚拟站点下均可用。
 */

const SERIES_KEY = "billiards_cn_series_v1"

/** 系列赛单条记录。`rule` 用于识别「换玩法要清零」。 */
export interface SeriesScore {
  rule: string
  you: number
  cpu: number
}

/** localStorage 在部分隐私模式 / 极端 WebView 配置下会直接抛异常，
 *  所有读写都必须吞掉异常，不能让统计功能把结算流程带崩。 */
function read(): SeriesScore | null {
  try {
    const raw = globalThis.localStorage?.getItem(SERIES_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<SeriesScore>
    if (typeof parsed?.you !== "number" || typeof parsed?.cpu !== "number") {
      return null
    }
    return {
      rule: typeof parsed.rule === "string" ? parsed.rule : "",
      you: parsed.you,
      cpu: parsed.cpu,
    }
  } catch (e) {
    return null
  }
}

function write(score: SeriesScore): void {
  try {
    globalThis.localStorage?.setItem(SERIES_KEY, JSON.stringify(score))
  } catch (e) {
    /* 忽略：存不下就当本次没记，不影响游戏 */
  }
}

/**
 * 取当前玩法的系列赛比分。
 * 若本地记录属于**别的玩法**，返回 0:0（不落盘，等真正结算时才写入新玩法）。
 */
export function getSeries(rule: string): SeriesScore {
  const s = read()
  if (!s || s.rule !== rule) {
    return { rule, you: 0, cpu: 0 }
  }
  return s
}

/**
 * 结算时调用：把刚打完的这一局计入系列赛。
 * @param rule 当前玩法名（rulename）
 * @param iWon 本局玩家是否获胜
 * @returns 累加后的比分（含本局）
 */
export function recordResult(rule: string, iWon: boolean): SeriesScore {
  const s = getSeries(rule)
  if (iWon) {
    s.you += 1
  } else {
    s.cpu += 1
  }
  s.rule = rule
  write(s)
  return s
}

/** 清零（返回主菜单、或换玩法时调用）。 */
export function resetSeries(): void {
  try {
    globalThis.localStorage?.removeItem(SERIES_KEY)
  } catch (e) {
    /* 忽略 */
  }
}

/**
 * 结算面板上展示的那一行文案，例如「系列赛　你 2 : 1 电脑」。
 * 不在人机对战模式下（或一局都没打）时返回空串，调用方直接跳过即可。
 */
export function seriesText(rule: string, opponentLabel = "电脑"): string {
  const s = getSeries(rule)
  if (s.you === 0 && s.cpu === 0) return ""
  return `系列赛　你 ${s.you} : ${s.cpu} ${opponentLabel}`
}
