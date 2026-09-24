const { chromium } = require("playwright-core")
const path = require("path")
;(async () => {
  const browser = await chromium.launch({ executablePath: "/root/.cache/ms-playwright/chromium-1208/chrome-linux64/chrome", args: ["--no-sandbox"] })
  const page = await browser.newPage({ viewport: { width: 480, height: 900 }, deviceScaleFactor: 2 })
  const errs = []
  page.on("pageerror", e => errs.push(e.message))
  await page.goto("https://a7b9dc0cd0da80587.app.workbuddy.host/menu.html", { waitUntil: "networkidle" })
  await page.waitForTimeout(1200)
  const ver = await page.evaluate(() => window.__BILLIARDS_VERSION__)
  // 三张缩略图屏
  for (const [name, id] of [["scene","screen-scene"],["cue","screen-cuetheme"],["table","screen-tableskin"]]) {
    await page.evaluate((sid) => {
      document.querySelectorAll(".screen").forEach(x => x.style.display = "none")
      document.getElementById(sid).style.display = "block"
    }, id)
    await page.waitForTimeout(500)
    await page.screenshot({ path: "/tmp/accept-" + name + ".png" })
  }
  console.log("online version:", ver, "| pageerrors:", errs.length)
  await browser.close()
})()
