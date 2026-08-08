/**
 * 离线单机版：不访问任何短链服务，直接回传原始链接。
 */
export function shorten(url, action) {
  action(url)
}

export function share(url) {
  const shareData = {
    title: "奥特曼的台球",
    url: url,
  }
  if (navigator.canShare?.(shareData)) {
    navigator.share(shareData).catch(() => {
      navigator.clipboard?.writeText(url)
    })
    return "已调起分享"
  }
  navigator.clipboard?.writeText(url)
  return "链接已复制到剪贴板"
}
