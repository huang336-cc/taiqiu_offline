const { chromium } = require("playwright-core")
const path = require("path")
const OUT = process.argv[2] || "/tmp/menu-thumbs"
;(async () => {
  const browser = await chromium.launch({ executablePath: "/root/.cache/ms-playwright/chromium-1208/chrome-linux64/chrome", args: ["--no-sandbox","--allow-file-access-from-files"] })
  const page = await browser.newPage({ viewport: { width: 480, height: 900 }, deviceScaleFactor: 2 })
  await page.goto("file://" + path.resolve(__dirname, "../../dist/menu.html"), { waitUntil: "networkidle" })
  await page.waitForTimeout(900)

  // 场景
  await page.click('#sceneCards .skin-card', { force: true }).catch(()=>{})
  await page.waitForTimeout(200)
  // 找到「环境场景」入口并点击
  const opened = await page.evaluate(() => {
    const el = Array.from(document.querySelectorAll("*")).find(e => e.children.length===0 && /环境场景/.test(e.textContent))
    if (el) { el.click(); return true }
    return false
  })
  await page.waitForTimeout(600)
  await page.screenshot({ path: OUT + "-scene.png", fullPage: false })
  console.log("opened scene:", opened)

  // 直接显示三个 screen 截图
  for (const [name, id] of [["scene","screen-scene"],["cue","screen-cuetheme"],["table","screen-tableskin"]]) {
    const ok = await page.evaluate((sid) => {
      const s = document.getElementById(sid)
      if (!s) return false
      // 确保 applyCardPreviews 已跑
      document.querySelectorAll(".screen").forEach(x => x.style.display = "none")
      s.style.display = "block"
      return true
    }, id)
    await page.waitForTimeout(300)
    await page.screenshot({ path: OUT + "-" + name + ".png" })
    console.log(name, id, ok)
  }
  await browser.close()
})()
