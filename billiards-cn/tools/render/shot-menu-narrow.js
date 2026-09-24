const { chromium } = require("playwright-core")
const path = require("path")
;(async () => {
  const browser = await chromium.launch({ executablePath: "/root/.cache/ms-playwright/chromium-1208/chrome-linux64/chrome", args: ["--no-sandbox","--allow-file-access-from-files"] })
  for (const w of [360, 390]) {
    const page = await browser.newPage({ viewport: { width: w, height: 800 }, deviceScaleFactor: 2 })
    await page.goto("file://" + path.resolve(__dirname, "../../dist/menu.html"), { waitUntil: "networkidle" })
    await page.waitForTimeout(800)
    const r = await page.evaluate(() => {
      const out = {}
      document.querySelectorAll(".screen").forEach(s => s.style.display = "none")
      const s = document.getElementById("screen-cuetheme")
      s.style.display = "block"
      const sw = document.querySelector("#cueThemeCards .skin-swatch")
      const card = document.querySelector("#cueThemeCards .skin-card")
      const cs = getComputedStyle(sw)
      out.swatch = { w: cs.width, h: cs.height, bs: cs.backgroundSize }
      const cr = card.getBoundingClientRect()
      out.card = { w: cr.width, h: cr.height }
      const scroll = s.querySelector(".scroll")
      out.overflowX = scroll ? scroll.scrollWidth - scroll.clientWidth : -1
      return out
    })
    console.log("width=" + w, JSON.stringify(r))
    await page.screenshot({ path: "/tmp/narrow-" + w + ".png" })
    await page.close()
  }
  await browser.close()
})()
