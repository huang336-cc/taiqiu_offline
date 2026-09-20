/** 定位中央柱：elementFromPoint + 页面 DOM 检查 */
const puppeteer = require("puppeteer-core")
const DIST = "/workspace/project/source/billiards-cn/dist"

async function main() {
  const browser = await puppeteer.launch({
    executablePath: "/usr/bin/google-chrome",
    headless: "new",
    args: [
      "--no-sandbox",
      "--use-gl=angle",
      "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader",
      `--user-data-dir=/tmp/chrome-dom-${Date.now()}`,
      "--in-process-gpu",
      "--disable-gpu-sandbox",
      "--allow-file-access-from-files",
      "--window-size=1200,540",
    ],
  })
  const page = await browser.newPage()
  await page.setViewport({ width: 1200, height: 540 })
  await page.goto(`file://${DIST}/play.html?debug=1&bot=Professional`, {
    waitUntil: "load",
    timeout: 120000,
  })
  let ready = false
  for (let i = 0; i < 8 && !ready; i++) {
    ready = await page
      .evaluate(() => {
        const v = globalThis.__bc?.container?.view
        try {
          return !!(v && v.scene && v.camera && v.renderer?.getContext?.())
        } catch {
          return false
        }
      })
      .catch(() => false)
    if (!ready) await new Promise((r) => setTimeout(r, 8000))
  }
  await new Promise((r) => setTimeout(r, 2000))
  await page.evaluate(() => {
    globalThis.__bc.container.view.applyScene("basketball")
    globalThis.__bc.container.view.camera.forceMode("aim")
  })
  await new Promise((r) => setTimeout(r, 2000))

  const out = await page.evaluate(() => {
    const desc = (el) => {
      if (!el) return null
      const r = el.getBoundingClientRect()
      return {
        tag: el.tagName,
        id: el.id || null,
        cls: (el.className || "").toString().slice(0, 80),
        rect: [
          Math.round(r.left),
          Math.round(r.top),
          Math.round(r.width),
          Math.round(r.height),
        ],
        bg: (el.style?.background || "").slice(0, 60),
        img: el.tagName === "IMG" ? el.src.split("/").pop() : null,
      }
    }
    // 柱子点位上的 DOM 链（从顶到底）
    const chain = (px, py) => {
      const out = []
      let el = document.elementFromPoint(px, py)
      while (el && out.length < 6) {
        out.push(desc(el))
        el = el.parentElement
      }
      return out
    }
    // 全页面中「宽度 60~120、高度 >100、位于 x 500~700」的嫌疑元素
    const suspects = []
    for (const el of document.querySelectorAll("body *")) {
      const r = el.getBoundingClientRect()
      if (
        r.width > 40 &&
        r.width < 200 &&
        r.height > 80 &&
        r.left > 450 &&
        r.right < 750 &&
        r.top < 50
      )
        suspects.push(desc(el))
    }
    return {
      at45: chain(600, 45),
      at100: chain(600, 100),
      at8: chain(600, 8),
      suspects,
    }
  })
  console.log(JSON.stringify(out, null, 1))
  await browser.close()
}
main().catch((e) => {
  console.error("FAIL", e.message)
  process.exit(1)
})
