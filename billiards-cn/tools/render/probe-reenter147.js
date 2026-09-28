/**
 * v1.4.8 回归验证：退出游戏再进入，画面是否正常（不变黑 / 不空白）。
 *
 * 为什么必须测：v1.4.8 在 View.dispose() 里递归释放了场景的 geometry /
 * material / **texture**。cue-preview-3d.js 的历史教训明确写着
 * 「绝不能 dispose map —— 否则缓存里的 Texture 被释放后，再次切回该主题球杆
 * 会变纯黑」。本项目只要释放发生在「页面卸载」时是安全的（下次进入是新页面、
 * 缓存重建），但这必须用实测证明，不能靠推理。
 *
 * 做法：完整走「进入 → 退出 → 再进入」，两次都在场景就绪后截图，
 * 由 Node 侧对比两张截图的亮度统计（交给 Python PIL 分析）。
 */
const puppeteer = require("puppeteer-core")

const DIST = "/workspace/dev/source/billiards-cn/dist"
const OUT = process.env.OUT || "/tmp/reenter147"

async function newBrowser() {
  return puppeteer.launch({
    executablePath: "/usr/bin/google-chrome",
    headless: "new",
    args: [
      "--no-sandbox", "--hide-scrollbars",
      "--disable-dev-shm-usage", "--no-zygote", "--ozone-platform=headless",
      "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader",
      "--user-data-dir=" + (process.env.CHROME_DIR || "/tmp/chrome-reenter147"),
      "--in-process-gpu", "--disable-gpu-sandbox",
      "--allow-file-access-from-files", "--window-size=393,851",
    ],
    env: { ...process.env, DISPLAY: "" },
  })
}

async function realTap(page, sel) {
  await page.touchscreen.touchStart(5, 5)
  await page.touchscreen.touchEnd()
  await new Promise((r) => setTimeout(r, 60))
  const el = await page.$(sel)
  if (!el) return false
  const box = await el.boundingBox()
  if (!box) return false
  await page.touchscreen.touchStart(box.x + box.width / 2, box.y + box.height / 2)
  await page.touchscreen.touchEnd()
  return true
}

async function waitFor(page, fn, tries = 120) {
  for (let k = 0; k < tries; k++) {
    const ok = await page.evaluate(fn).catch(() => false)
    if (ok) return true
    await new Promise((r) => setTimeout(r, 150))
  }
  return false
}

const READY = () => {
  const c = document.querySelector("#viewP1 canvas")
  const l = document.getElementById("view3dLoading")
  return !!(c && c.width > 0 && c.offsetHeight > 0) &&
    (!l || getComputedStyle(l).display === "none")
}

async function enterGame(page) {
  await realTap(page, "#btnStart")
  const inPlay = await waitFor(page, () => location.pathname.indexOf("play.html") >= 0)
  if (!inPlay) return false
  return waitFor(page, READY)
}

async function exitGame(page) {
  await realTap(page, "#menu")
  const ov = await waitFor(page, () => {
    const o = document.getElementById("helpOverlay")
    return !!(o && !o.hasAttribute("hidden") && o.offsetParent !== null)
  }, 60)
  if (!ov) return false
  await realTap(page, "#backToMenu")
  const dlg = await waitFor(page, () => !!document.getElementById("back-confirm-cn-backdrop"), 60)
  if (!dlg) return false
  await realTap(page, "#back-confirm-cn-backdrop .bcbtn.danger")
  return waitFor(page, () => location.pathname.indexOf("menu.html") >= 0 &&
    !!document.getElementById("btnStart"), 120)
}

async function main() {
  const browser = await newBrowser()
  const page = await browser.newPage()
  await page.setViewport({ width: 393, height: 851, hasTouch: true, isMobile: true, deviceScaleFactor: 1 })
  const errs = []
  page.on("pageerror", (e) => errs.push("[pageerror] " + e.message))

  await page.goto(`file://${DIST}/menu.html`, { waitUntil: "load", timeout: 120000 })
  await waitFor(page, () => !!document.getElementById("btnStart"))
  await new Promise((r) => setTimeout(r, 1000))

  // 第 1 次进入
  const ok1 = await enterGame(page)
  await new Promise((r) => setTimeout(r, 2500)) // 让场景稳定渲染
  await page.screenshot({ path: `${OUT}-1.png` })
  console.log("第1次进入:", ok1 ? "✓" : "✗")

  // 退出
  const okE = await exitGame(page)
  console.log("退出回菜单:", okE ? "✓" : "✗")
  await new Promise((r) => setTimeout(r, 1200))

  // 第 2 次进入（关键：验证纹理被 dispose 后重建是否正常）
  const ok2 = await enterGame(page)
  await new Promise((r) => setTimeout(r, 2500))
  await page.screenshot({ path: `${OUT}-2.png` })
  console.log("第2次进入:", ok2 ? "✓" : "✗")

  // 第 3 次（再看一次，确认持续正常）
  const okE2 = await exitGame(page)
  const ok3 = okE2 ? await enterGame(page) : false
  await new Promise((r) => setTimeout(r, 2500))
  await page.screenshot({ path: `${OUT}-3.png` })
  console.log("第3次进入:", ok3 ? "✓" : "✗")

  console.log("页面错误:", errs.length ? errs.slice(0, 5) : "无")
  await browser.close()
  process.exit(ok1 && okE && ok2 && ok3 ? 0 : 1)
}

main().catch((e) => { console.error(e); process.exit(2) })
