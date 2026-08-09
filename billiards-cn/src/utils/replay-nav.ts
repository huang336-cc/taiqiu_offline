import { getUID } from "./uid"

/**
 * 回放数据「经 sessionStorage 传递」工具。
 *
 * 背景：v1.2.4 及之前，回放靠 `index.html?state=<超长压缩串>` 跳转，
 * 完整对局的压缩串远超 Android WebView 对 URL 长度的限制，被截断后
 * 只回放出前几个球（用户反馈「只会回放到第 6 个球」）。
 *
 * 这里改为把完整压缩串写入 sessionStorage，URL 只带一个短 replayId，
 * 由 BrowserContainer 启动时从 sessionStorage 读回，彻底规避 URL 截断。
 */
const BCR_PREFIX = "bcr:"

/** 把完整回放压缩串存入 sessionStorage，并跳转到回放页 */
export function storeReplayAndNavigate(
  compressed: string,
  ruletype = "nineball"
): void {
  const id = getUID() + "_" + Date.now()
  try {
    sessionStorage.setItem(BCR_PREFIX + id, compressed)
  } catch (e) {
    console.error("[replay-nav] sessionStorage 写入失败", e)
  }
  const url = `index.html?replayId=${encodeURIComponent(
    id
  )}&ruletype=${encodeURIComponent(ruletype)}`
  globalThis.location.href = url
}

/** 从 sessionStorage 读回指定 replayId 的完整回放压缩串 */
export function readReplayFromStorage(replayId: string | null): string | null {
  if (!replayId) return null
  try {
    return sessionStorage.getItem(BCR_PREFIX + replayId)
  } catch {
    return null
  }
}

/** 从 `?state=` 形式的回放 URL 中提取完整压缩串（未截断的 JS 字符串） */
export function extractStateFromReplayUrl(url: string): string | null {
  try {
    const params = new URL(url).searchParams
    return params.get("state")
  } catch {
    return null
  }
}
