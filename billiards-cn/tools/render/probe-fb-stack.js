/** football 场景切换运行时堆栈抓取 */
const puppeteer = require("puppeteer-core")
async function main() {
  const browser = await puppeteer.launch({
    executablePath: "/usr/bin/google-chrome",
    headless: "new",
    args: [
      "--no-sandbox",
      "--use-gl=angle",
      "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader",
      "--user-data-dir=/tmp/chrome-fb-stack",
      "--in-process-gpu",
      "--disable-gpu-sandbox",
      "--allow-file-access-from-files",
      "--window-size=1200,540",
    ],
  })
  const page = await browser.newPage()
  await page.setViewport({ width: 1200, height: 540 })
  await page.goto(
    "file:///workspace/project/source/billiards-cn/dist/play.html?debug=1&bot=Professional",
    { waitUntil: "load", timeout: 120000 }
  )
  let ready = false
  for (let i = 0; i < 8 && !ready; i++) {
    ready = await page
      .evaluate(() => {
        try {
          const v = globalThis.__bc?.container?.view
          return !!(v && v.scene && v.camera)
        } catch {
          return false
        }
      })
      .catch(() => false)
    if (!ready) await new Promise((r) => setTimeout(r, 8000))
  }
  await new Promise((r) => setTimeout(r, 2000))
  const out = await page.evaluate(() => {
    try {
      globalThis.__bc.container.view.applyScene("football")
      return "OK"
    } catch (e) {
      return (
        "FAIL: " + e.message + "\n" + (e.stack || "").split("\n").slice(0, 8).join("\n")
      )
    }
  })
  console.log(out)
  await browser.close()
}
main().catch((e) => {
  console.error("ERR", e.message)
  process.exit(1)
})
