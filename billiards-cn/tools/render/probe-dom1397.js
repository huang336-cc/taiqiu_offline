/**
 * v1.3.97 黑椭圆 DOM 检查：elementFromPoint 看屏幕 (637,200)/(中线若干点) 上是什么元素。
 */
const puppeteer = require("puppeteer-core")

const DIST = "/workspace/dev/source/billiards-cn/dist"

async function main() {
  const browser = await puppeteer.launch({
    executablePath: "/usr/bin/google-chrome",
    headless: "new",
    args: [
      "--no-sandbox", "--hide-scrollbars", "--disable-dev-shm-usage", "--no-zygote",
      "--ozone-platform=headless", "--use-gl=angle", "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader", "--user-data-dir=/tmp/chrome-probe-dom",
      "--in-process-gpu", "--disable-gpu-sandbox", "--allow-file-access-from-files",
      "--window-size=1280,720",
    ],
    env: { ...process.env, DISPLAY: "" },
  })
  const page = await browser.newPage()
  await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 1 })
  await page.goto(`file://${DIST}/play.html?debug=1&bot=Professional`, {
    waitUntil: "load",
    timeout: 120000,
  })
  await new Promise((r) => setTimeout(r, 12000))

  const info = await page.evaluate(() => {
    const pts = [
      [637, 200], [640, 202], [269, 267], [637, 190], [640, 215],
    ]
    const out = []
    for (const [x, y] of pts) {
      const el = document.elementFromPoint(x, y)
      if (!el) { out.push(`(${x},${y}) -> null`); continue }
      const r = el.getBoundingClientRect()
      const cs = getComputedStyle(el)
      out.push(
        `(${x},${y}) -> <${el.tagName.toLowerCase()} class="${el.className}" id="${el.id}"> ` +
        `rect=(${Math.round(r.x)},${Math.round(r.y)},${Math.round(r.width)}x${Math.round(r.height)}) ` +
        `bg=${cs.backgroundColor} display=${cs.display} visibility=${cs.visibility} opacity=${cs.opacity}`
      )
    }
    // 另外找出页面上所有"黑色小椭圆嫌疑"元素：宽 15-60px、高 8-40px、深色背景、位置在屏幕中上部
    const suspects = []
    for (const el of document.querySelectorAll("body *")) {
      const r = el.getBoundingClientRect()
      const cs = getComputedStyle(el)
      if (r.width >= 12 && r.width <= 80 && r.height >= 6 && r.height <= 50) {
        const bg = cs.backgroundColor
        const m = bg.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/)
        const dark = m && +m[1] < 80 && +m[2] < 80 && +m[3] < 80
        const solid = cs.display !== "none" && cs.visibility !== "hidden" && +cs.opacity > 0.1
        if (dark && solid && r.y < 400 && r.y > 80) {
          suspects.push(
            `<${el.tagName.toLowerCase()} class="${String(el.className).slice(0, 60)}"> ` +
            `rect=(${Math.round(r.x)},${Math.round(r.y)},${Math.round(r.width)}x${Math.round(r.height)}) bg=${bg}`
          )
        }
      }
    }
    return { pts: out, suspects: suspects.slice(0, 20) }
  })
  console.log(info.pts.join("\n"))
  console.log("\n深色小元素嫌疑名单：")
  console.log(info.suspects.length ? info.suspects.join("\n") : "（无）")
  await browser.close()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
