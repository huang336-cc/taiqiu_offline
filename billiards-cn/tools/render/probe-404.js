/** 抓 play.html（tutorial=1 / 普通入口）与 menu.html 加载期间所有 404/失败资源 */
const puppeteer = require("puppeteer-core")
const DIST = "/workspace/dev/source/billiards-cn/dist"

async function main() {
  const browser = await puppeteer.launch({
    executablePath: "/usr/bin/google-chrome",
    headless: "new",
    args: [
      "--no-sandbox", "--disable-dev-shm-usage", "--no-zygote", "--ozone-platform=headless",
      "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader",
      "--user-data-dir=/tmp/chrome-404", "--in-process-gpu", "--allow-file-access-from-files",
      "--window-size=393,851",
    ],
    env: { ...process.env, DISPLAY: "" },
  })
  const page = await browser.newPage()
  await page.setViewport({ width: 393, height: 851, hasTouch: true, isMobile: true })
  const bad = []
  page.on("requestfailed", (r) => bad.push("[FAIL] " + r.url() + " :: " + (r.failure() || {}).errorText))
  page.on("response", (r) => { if (r.status() >= 400) bad.push(`[${r.status()}] ` + r.url()) })
  page.on("console", (m) => { const t = m.text(); if (/404|ERR_|Failed to load/.test(t)) bad.push("[console] " + t) })

  for (const [label, url] of [
    ["menu", `file://${DIST}/menu.html`],
    ["play-tutorial", `file://${DIST}/play.html?ruletype=nineball&practice=true&tutorial=1`],
    ["play-normal", `file://${DIST}/play.html?ruletype=nineball&practice=true`],
  ]) {
    bad.length = 0
    await page.goto(url, { waitUntil: "load", timeout: 120000 }).catch((e) => bad.push("[goto] " + e.message))
    await new Promise((r) => setTimeout(r, 6000))
    console.log(`=== ${label} ===`)
    console.log(bad.length ? bad.map((b) => "  " + b).join("\n") : "  （无失败资源）")
  }
  await browser.close()
}
main().catch((e) => { console.error(e); process.exit(2) })
