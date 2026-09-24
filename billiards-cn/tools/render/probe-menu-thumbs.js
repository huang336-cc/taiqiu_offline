const { chromium } = require("playwright-core")
const path = require("path")
;(async () => {
  const browser = await chromium.launch({ executablePath: "/root/.cache/ms-playwright/chromium-1208/chrome-linux64/chrome", args: ["--no-sandbox","--allow-file-access-from-files"] })
  const page = await browser.newPage({ viewport: { width: 480, height: 900 }, deviceScaleFactor: 2 })
  const url = "file://" + path.resolve(__dirname, "../../dist/menu.html")
  const errors = []
  page.on("pageerror", e => errors.push("PAGEERROR: " + e.message))
  page.on("console", m => { if (m.type() === "error") errors.push("CONSOLE: " + m.text()) })
  await page.goto(url, { waitUntil: "networkidle" })
  await page.waitForTimeout(800)

  // 进入「环境场景」
  const info = await page.evaluate(() => {
    const out = { errors: [], cards: [] }
    const groups = ["#sceneCards", "#cueThemeCards", "#tableSkinCards"]
    for (const g of groups) {
      const root = document.querySelector(g)
      if (!root) { out.errors.push("no " + g); continue }
      root.querySelectorAll(".skin-card").forEach(c => {
        const sw = c.querySelector(".skin-swatch")
        const cs = sw ? getComputedStyle(sw) : null
        out.cards.push({
          g,
          key: c.getAttribute("data-scene") || c.getAttribute("data-cuetheme") || c.getAttribute("data-tableskin"),
          bg: sw ? (sw.style.backgroundImage || "").slice(0, 40) : "NO-SWATCH",
          hasPv: sw ? sw.dataset.pv || "" : "",
          w: cs ? cs.width : "", h: cs ? cs.height : "",
          bgSize: cs ? cs.backgroundSize : "",
        })
      })
    }
    return out
  })
  console.log("=== errors ===", info.errors, errors)
  console.log("=== cards (count " + info.cards.length + ") ===")
  info.cards.forEach(c => console.log(JSON.stringify(c)))
  await browser.close()
})()
