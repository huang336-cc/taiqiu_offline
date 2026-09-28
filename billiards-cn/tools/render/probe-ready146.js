/** A2 验证：play.html 场景就绪判定（tutorial=1 与普通入口各测一次 + 截图） */
const puppeteer = require("puppeteer-core")
const DIST = "/workspace/dev/source/billiards-cn/dist"

const READY_PROBE = () => {
  const bc = globalThis.__bc
  const view = bc && bc.container && bc.container.view
  if (!view) return { ok: false, why: "no view", keys: bc ? Object.keys(bc) : null }
  let gl = null
  try { gl = view.renderer && view.renderer.getContext ? view.renderer.getContext() : null } catch (e) { return { ok: false, why: "gl throw" } }
  return {
    ok: !!(view.scene && view.camera && gl),
    why: `scene=${!!view.scene} cam=${!!view.camera} gl=${!!gl}`,
    keys: view ? Object.keys(view).slice(0, 12) : null,
  }
}

async function test(browser, url, label) {
  const page = await browser.newPage()
  await page.setViewport({ width: 393, height: 851, hasTouch: true, isMobile: true, deviceScaleFactor: 2 })
  const errs = []
  page.on("pageerror", (e) => errs.push(e.message))
  await page.goto(url, { waitUntil: "load", timeout: 120000 })
  let ready = false, last = null
  for (let i = 0; i < 40 && !ready; i++) {
    last = await page.evaluate(READY_PROBE).catch((e) => ({ ok: false, why: e.message }))
    ready = !!(last && last.ok)
    if (!ready) await new Promise((r) => setTimeout(r, 500))
  }
  console.log(`${ready ? "✓" : "✗"} ${label} 就绪=${ready} 最后探测:`, JSON.stringify(last))
  if (errs.length) console.log("   页面错误:", errs.slice(0, 3))
  await page.screenshot({ path: `/tmp/ready-${label.includes("引导") ? "tut" : "normal"}.png` })
  await page.close()
  return ready
}

async function main() {
  const browser = await puppeteer.launch({
    executablePath: "/usr/bin/google-chrome",
    headless: "new",
    args: [
      "--no-sandbox", "--hide-scrollbars", "--disable-dev-shm-usage", "--no-zygote",
      "--ozone-platform=headless", "--use-gl=angle", "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader", "--user-data-dir=/tmp/chrome-ready146",
      "--in-process-gpu", "--disable-gpu-sandbox", "--allow-file-access-from-files",
      "--window-size=393,851",
    ],
    env: { ...process.env, DISPLAY: "" },
  })
  await test(browser, `file://${DIST}/play.html?ruletype=nineball&practice=true&tutorial=1`, "新手引导入口")
  await test(browser, `file://${DIST}/play.html?ruletype=nineball&practice=true`, "普通练习入口")
  await browser.close()
}
main().catch((e) => { console.error(e); process.exit(2) })
