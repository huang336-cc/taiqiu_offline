/**
 * 触发浏览器/WebView 下载一个文本（或任意字符串）内容。
 * 离线单机环境下，文件通过 Blob + <a download> 写入系统下载目录。
 * 若环境不支持（例如部分老版本 WebView 在 file:// 下忽略 a.download），
 * 返回 false，调用方应改用 IndexedDB 等持久化兜底。
 */
export function downloadText(
  filename: string,
  text: string,
  mime = "application/octet-stream"
): boolean {
  try {
    const blob = new Blob([text], { type: mime })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = filename
    a.style.display = "none"
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    setTimeout(() => URL.revokeObjectURL(url), 1000)
    return true
  } catch (e) {
    console.error("downloadText failed", e)
    return false
  }
}
