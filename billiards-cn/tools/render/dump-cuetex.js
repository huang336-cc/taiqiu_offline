const path = require("path")
const fs = require("fs")
const { chromium } = require("playwright-core")
const DIST = path.resolve("/workspace/dev/source/billiards-cn/dist")
;(async () => {
  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] })
  const page = await browser.newPage()
  page.on("pageerror", (e) => console.error("PAGEERROR:", e.message))
  await page.goto("about:blank")
  await page.addScriptTag({ path: path.join(DIST, "three.standalone.js") })
  await page.addScriptTag({ path: path.join(DIST, "cue-texture-factory.js") })
  const ids = await page.evaluate(() => window.CueGameCue.CUE_THEMES.map((t) => t.id))
  for (const id of ids) {
    if (id === "auto") continue
    const data = await page.evaluate(`(() => {
      const g = window.CueGameCue
      const dump = (tex) => tex.image.toDataURL("image/png")
      const s = g.getCueTexture("${id}")
      const b = g.getCueButtTexture("${id}")
      return JSON.stringify({ shaft: s ? dump(s) : null, butt: b ? dump(b) : null })
    })()`)
    fs.writeFileSync(`/tmp/texdump/${id}.json`, data)
  }
  await browser.close()
  console.log("dumped", ids.length - 1, "themes")
})()
