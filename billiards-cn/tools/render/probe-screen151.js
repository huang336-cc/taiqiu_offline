/**
 * v1.5.1 子屏历史栈回归验证。
 *
 * 本版给菜单每个子屏压了一条 history（让 Android 返回键在菜单内逐层回退），
 * 但球杆全屏预览此前也自己压了一条、并在关闭时 history.back() 清掉它。
 * 那次 back 会走到新增的 popstate 处理里，若不作区分就会**多退一级子屏**。
 * 本探针验证这条路径没有被带坏：
 *   1. 首页 → 球杆主题屏
 *   2. 打开全屏预览 → 关闭（✕）→ 当前屏必须仍是「球杆主题」，不能退回首页
 *   3. 再按返回键 → 应回到首页
 *   4. 首页 → 设置 → 变更履历 → 点返回按钮 → 应回到设置（不是首页）
 */
const puppeteer = require("puppeteer-core")
const fs = require("fs")
const OUT = "/tmp/v151"
const BASE = "http://127.0.0.1:8099"
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function tap(page, sel) {
  const el = await page.$(sel)
  if (!el) return false
  await el.evaluate((e) => { try { e.scrollIntoView({ block: "center" }) } catch (err) {} })
  await sleep(150)
  const b = await el.boundingBox()
  if (!b) return false
  await page.touchscreen.touchStart(b.x + b.width / 2, b.y + b.height / 2)
  await page.touchscreen.touchEnd()
  await sleep(400)
  return true
}
const cur = (page) =>
  page.evaluate(() => {
    const a = document.querySelector(".screen.active")
    return {
      screen: a ? a.id : null,
      preview: !!document.querySelector("#cuePreviewOverlay.active"),
    }
  })

async function main() {
  fs.mkdirSync(OUT, { recursive: true })
  const browser = await puppeteer.launch({
    executablePath: "/usr/bin/google-chrome",
    headless: "new",
    args: [
      "--no-sandbox", "--hide-scrollbars", "--disable-dev-shm-usage", "--no-zygote",
      "--ozone-platform=headless", "--use-gl=angle", "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader", "--user-data-dir=/tmp/chrome-screen151",
      "--in-process-gpu", "--disable-gpu-sandbox", "--window-size=393,851",
    ],
    env: { ...process.env, DISPLAY: "" },
  })
  const page = await browser.newPage()
  await page.setCacheEnabled(false)
  await page.setViewport({ width: 393, height: 851, hasTouch: true, isMobile: true, deviceScaleFactor: 2 })
  const errs = []
  page.on("pageerror", (e) => errs.push(e.message))

  await page.goto(BASE + "/menu.html", { waitUntil: "networkidle2", timeout: 60000 })
  await sleep(1200)
  console.log("1. 初始:", JSON.stringify(await cur(page)))

  // 首页 → 球杆主题
  const ok1 = await tap(page, '#customRows .menu-row[data-target="cuetheme"]')
  await sleep(800)
  console.log("2. 进入球杆主题:", ok1, JSON.stringify(await cur(page)))

  // 打开全屏预览（点已选中的卡片）
  const ok2 = await tap(page, "#cueThemeCards .skin-card")
  await sleep(1500)
  const s2 = await cur(page)
  console.log("3. 打开全屏预览:", ok2, JSON.stringify(s2))

  // 关闭预览（✕）
  const ok3 = await tap(page, "#cuePreviewOverlay [data-close-cue-preview]")
  await sleep(1200)
  const s3 = await cur(page)
  console.log("4. 关闭预览:", ok3, JSON.stringify(s3))
  console.log("   → 关闭预览后仍在球杆主题屏（未多退一级）:", s3.screen === "screen-cuetheme" && !s3.preview ? "✓" : "✗")

  // 返回键 → 应回首页
  await page.goBack().catch(() => {})
  await sleep(900)
  const s4 = await cur(page)
  console.log("5. 按返回键:", JSON.stringify(s4))
  console.log("   → 回到首页:", s4.screen === "screen-home" ? "✓" : "✗")

  // 首页 → 设置 → 变更履历 → 点返回按钮
  await tap(page, "#btnSettings")
  await sleep(500)
  await tap(page, "#btnChangelog")
  await sleep(1500)
  const s5 = await cur(page)
  console.log("6. 设置→变更履历:", JSON.stringify(s5))
  const okBack = await tap(page, "#screen-changelog > .back-btn")
  await sleep(900)
  const s6 = await cur(page)
  console.log("7. 点返回按钮:", okBack, JSON.stringify(s6))
  console.log("   → 回到设置页:", s6.screen === "screen-settings" ? "✓" : "✗")

  await page.screenshot({ path: OUT + "/screen-final.png" })
  console.log("页面错误:", errs.length ? errs.slice(0, 3) : "无")
  await browser.close()
}
main().catch((e) => { console.error("FATAL", e); process.exit(1) })
