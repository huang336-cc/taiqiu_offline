/**
 * v1.4.2 发布冒烟：起本地 http 服务 + 无头 Chromium 打开发布页与游戏菜单页，
 * 断言 ① 发布页标题为 v1.4.2 ② 菜单页注入版本为 1.4.2-26092402
 * ③ 变更履历首条为 v1.4.2 ④ 两页均无 JS 运行时错误。
 */
import http from "http"
import fs from "fs"
import path from "path"
import puppeteer from "puppeteer-core"

const DIST = path.resolve(__dirname, "../../dist")
const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".mp3": "audio/mpeg",
  ".gltf": "model/gltf+json",
}

async function main() {
  const server = http.createServer((req, res) => {
    const url = decodeURIComponent((req.url || "/").split("?")[0])
    const file = path.join(DIST, url === "/" ? "index.html" : url)
    if (!file.startsWith(DIST) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404)
      res.end("404")
      return
    }
    res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" })
    fs.createReadStream(file).pipe(res)
  })
  await new Promise<void>((r) => server.listen(8099, r))

  const browser = await puppeteer.launch({
    executablePath: "/usr/bin/chromium",
    args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"],
    headless: true,
  })

  const errors: string[] = []
  const results: string[] = []

  async function open(pagePath: string) {
    const page = await browser.newPage()
    page.on("pageerror", (e) => errors.push(`[${pagePath}] pageerror: ${e.message}`))
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(`[${pagePath}] console: ${m.text()}`)
    })
    await page.goto(`http://127.0.0.1:8099/${pagePath}`, {
      waitUntil: "networkidle2",
      timeout: 60000,
    })
    return page
  }

  // ① 发布页
  const pub = await open("index.html")
  const pubTitle = await pub.title()
  const pubVer = await pub.$eval(".ver", (el) => el.textContent || "")
  const pubDl = await pub.$$eval(".dl", (els) =>
    els.map((e) => e.getAttribute("href") || "")
  )
  results.push(`发布页标题: ${pubTitle}`)
  results.push(`发布页版本行: ${pubVer.trim()}`)
  results.push(`下载链接: ${pubDl.join(" , ")}`)

  // ② 游戏菜单页
  const menu = await open("menu.html")
  const injected = await menu.evaluate(
    () => (window as any).__BILLIARDS_VERSION__
  )
  const firstLog = await menu.$eval(
    "#screen-changelog .setting-group h3",
    (el) => el.textContent || ""
  )
  results.push(`菜单页注入版本: ${injected}`)
  results.push(`变更履历首条: ${firstLog.trim()}`)

  await browser.close()
  server.close()

  console.log("=== 冒烟结果 ===")
  results.forEach((r) => console.log("  " + r))
  console.log("=== JS 错误 ===")
  if (errors.length === 0) {
    console.log("  无")
  } else {
    errors.slice(0, 20).forEach((e) => console.log("  " + e))
  }

  const ok =
    pubTitle.includes("v1.4.2") &&
    pubVer.includes("v1.4.2") &&
    pubDl.some((h) => h.includes("v1.4.2")) &&
    injected === "1.4.2-26092402" &&
    firstLog.includes("v1.4.2")
  console.log(ok ? "\n✅ 发布冒烟通过" : "\n❌ 发布冒烟失败")
  process.exit(ok && errors.length === 0 ? 0 : 1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
