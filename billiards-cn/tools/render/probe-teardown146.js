/**
 * v1.4.6 WebGL 释放验证专项探针。
 *
 * 直接验证游戏「退出时是否真释放 WebGLRenderer」：
 *   进游戏 → 调 window.__onExitToMenu（退出时的资源释放钩子）→ 断言 canvas 被
 *   移除（context 释放）→ reload 重新进入 → 断言 sceneReady 正常（能重建）。
 * 反复 N 次。修复前（无 __onExitToMenu 钩子）：hasHook=false、canvas 不被移除；
 * 修复后：每次 teardown 后 canvas=0、reload 后 canvas=1、sceneReady 全成功。
 * 这能在 headless（不触发 context 上限）下，明确证明「释放 renderer」逻辑生效，
 * 而不仅是「导航不破坏」。
 */
const puppeteer = require("puppeteer-core")
const DIST = "/workspace/dev/source/billiards-cn/dist"
const N = parseInt(process.env.N || "4", 10)

async function newBrowser() {
  return puppeteer.launch({
    executablePath: "/usr/bin/google-chrome",
    headless: "new",
    args: [
      "--no-sandbox", "--hide-scrollbars",
      "--disable-dev-shm-usage", "--no-zygote", "--ozone-platform=headless",
      "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader",
      "--user-data-dir=" + (process.env.CHROME_DIR || "/tmp/cl154"), "--in-process-gpu", "--disable-gpu-sandbox",
      "--max-active-webgl-contexts=" + (process.env.CTX_LIMIT || "6"),
      "--allow-file-access-from-files", "--window-size=393,851",
    ],
    env: { ...process.env, DISPLAY: "" },
  })
}

async function realTap(page, sel, label) {
  await page.touchscreen.touchStart(5, 5)
  await page.touchscreen.touchEnd()
  await new Promise((r) => setTimeout(r, 60))
  const el = await page.$(sel)
  if (!el) return { ok: false, why: `${sel} 不存在`, label }
  const box = await el.boundingBox()
  if (!box) return { ok: false, why: `${sel} 无 boundingBox`, label }
  await page.touchscreen.touchStart(box.x + box.width / 2, box.y + box.height / 2)
  await page.touchscreen.touchEnd()
  return { ok: true, label }
}

async function sceneReady(page) {
  for (let k = 0; k < 40; k++) {
    const st = await page.evaluate(() => {
      const c = document.querySelector("#viewP1 canvas")
      const l = document.getElementById("view3dLoading")
      return {
        ok: !!(c && c.width > 0 && c.offsetHeight > 0),
        loadingHidden: !l || getComputedStyle(l).display === "none",
      }
    }).catch(() => ({ ok: false, loadingHidden: false }))
    if (st.ok) return true
    await new Promise((r) => setTimeout(r, 500))
  }
  return false
}

function canvasCount(page) {
  return page.evaluate(() => document.querySelectorAll("#viewP1 canvas").length)
}

async function main() {
  const browser = await newBrowser()
  const page = await browser.newPage()
  await page.setViewport({ width: 393, height: 851, hasTouch: true, isMobile: true, deviceScaleFactor: 2 })
  const errs = []
  page.on("pageerror", (e) => errs.push("[pageerror] " + e.message))
  page.on("console", (m) => {
    if (m.type() === "error" && !/wave\.jpg|Failed to load resource/.test(m.text())) errs.push("[console] " + m.text())
  })

  await page.goto(`file://${DIST}/menu.html`, { waitUntil: "load", timeout: 120000 })
  await new Promise((r) => setTimeout(r, 800))

  await realTap(page, "#btnStart", "btnStart")
  await page.waitForFunction(() => location.pathname.includes("play.html"), { timeout: 8000 })
  const ready0 = await sceneReady(page)
  console.log("首次进游戏 sceneReady:", ready0 ? "✓" : "✗", "canvas:", await canvasCount(page))

  let ok = ready0
  for (let i = 1; i <= N; i++) {
    const before = await canvasCount(page)
    const hasHook = await page.evaluate(() => typeof window.__onExitToMenu === "function")
    await page.evaluate(() => { try { if (window.__onExitToMenu) window.__onExitToMenu() } catch (e) {} })
    // 同步立即检查：removeChild 是同步 DOM 操作，rAF 重建需下一帧（~16ms），
    // 故此处已反映 dispose 是否真的把 canvas 移除了（区分「没移除」与「移除后被重建」）
    const afterTear = await canvasCount(page)
    await new Promise((r) => setTimeout(r, 400))
    await page.reload({ waitUntil: "load", timeout: 30000 })
    await new Promise((r) => setTimeout(r, 300))
    const ready = await sceneReady(page)
    const afterReload = await canvasCount(page)
    console.log(`第${i}次: hook=${hasHook} teardown前=${before} teardown后=${afterTear} reload后=${afterReload} sceneReady=${ready ? "✓" : "✗"}`)
    if (!hasHook || afterTear !== 0 || !ready || afterReload < 1) ok = false
  }
  console.log("页面错误:", errs.length ? errs.slice(0, 5) : "无")
  console.log(ok && errs.length === 0 ? "\n✓ 释放 renderer 验证通过（teardown 生效，且反复重进可重建）" : "\n✗ 验证失败")
  await browser.close()
  process.exit(ok && errs.length === 0 ? 0 : 1)
}
main().catch((e) => { console.error(e); process.exit(2) })
