// 【v1.4.4】球桌贴图 dump：把 TABLE_SKINS 的台呢 / 桌框贴图导出为 PNG（dataURL），
// 供 Python 像素统计验证（模型读不了 jpg，只能量化验证）。
// 用法：node tools/render/dump-tabtex.js  → /tmp/texdump/table-<id>-<kind>.json
const path = require("path")
const fs = require("fs")
const { chromium } = require("playwright-core")
const DIST = path.resolve("/workspace/dev/source/billiards-cn/dist")
;(async () => {
  fs.mkdirSync("/tmp/texdump", { recursive: true })
  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] })
  const page = await browser.newPage()
  page.on("pageerror", (e) => console.error("PAGEERROR:", e.message))
  await page.goto("about:blank")
  await page.addScriptTag({ path: path.join(DIST, "three.standalone.js") })
  await page.addScriptTag({ path: path.join(DIST, "skin-factory.js") })
  const ids = await page.evaluate(`(function(){ return window.CueGameSkin.TABLE_SKINS.map(function(t){return t.id}).join(",") })()`)
  const list = ids.split(",").filter(Boolean)
  for (const id of list) {
    for (const kind of ["cloth", "frame", "marks"]) {
      const data = await page.evaluate(`(function(){
        var g = window.CueGameSkin
        var t = g.${kind === "cloth" ? "getClothTexture" : kind === "frame" ? "getFrameTexture" : "getClothMarksTexture"}("${id}")
        return t ? t.image.toDataURL("image/png") : null
      })()`)
      if (data) fs.writeFileSync(`/tmp/texdump/table-${id}-${kind}.json`, data)
    }
  }
  await browser.close()
  console.log("dumped", list.length, "table skins")
})()
