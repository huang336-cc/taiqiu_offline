/**
 * v1.5.0 首屏成本探针：分段测量 menu.html / play.html 从导航到可交互的耗时。
 *
 * 假设（待验证）：真机「点返回主菜单后画面冻结 3.5 秒」并不是退出清理慢，
 * 而是 **menu.html 首屏太重** —— 导航提交后旧画面会一直保持显示，直到新文档完成
 * 首次绘制。所以玩家看到的「冻结」= 新页面首屏时间。
 * 同理「点开始游戏卡几秒才进入」= play.html 首屏时间。
 *
 * 手段：
 *   1. CDP Emulation.setCPUThrottlingRate 模拟中低端手机 CPU（服务器 CPU 快 4~8 倍，
 *      不降速的话所有耗时都会被低估一个数量级 —— 这正是前几版误判的原因之一）。
 *   2. 全部用页面内 Performance API / rAF 自检计时，不依赖 puppeteer 轮询。
 *   3. 单独计时「皮肤 3D 预览」这一懒加载重活。
 *
 * 用法：THROTTLE=6 node probe-menu150.js
 */
const puppeteer = require("puppeteer-core")
const DIST = "/workspace/dev/source/billiards-cn/dist"
const THROTTLE = parseInt(process.env.THROTTLE || "6", 10)
const LOOPS = parseInt(process.env.LOOPS || "2", 10)

async function realTap(page, sel) {
  await page.touchscreen.touchStart(5, 5)
  await page.touchscreen.touchEnd()
  await new Promise((r) => setTimeout(r, 80))
  const el = await page.$(sel)
  if (!el) return false
  const box = await el.boundingBox()
  if (!box) return false
  await page.touchscreen.touchStart(box.x + box.width / 2, box.y + box.height / 2)
  await page.touchscreen.touchEnd()
  return true
}

async function main() {
  const browser = await puppeteer.launch({
    executablePath: "/usr/bin/google-chrome",
    headless: "new",
    args: [
      "--no-sandbox", "--hide-scrollbars", "--disable-dev-shm-usage", "--no-zygote",
      "--ozone-platform=headless", "--use-gl=angle", "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader", "--user-data-dir=" + (process.env.CHROME_DIR || "/tmp/chrome-menu150"),
      "--in-process-gpu", "--disable-gpu-sandbox", "--allow-file-access-from-files",
      "--window-size=393,851",
    ],
    env: { ...process.env, DISPLAY: "" },
  })
  const page = await browser.newPage()
  await page.setViewport({ width: 393, height: 851, hasTouch: true, isMobile: true, deviceScaleFactor: 2 })

  const lines = []
  page.on("console", (m) => { const t = m.text(); if (t.startsWith("BOOT ")) lines.push(t.slice(5)) })
  page.on("pageerror", (e) => lines.push("[pageerror] " + e.message))

  await page.evaluateOnNewDocument(() => {
    const tag = () => (location.pathname.split("/").pop() || "?").split(".")[0]
    const log = (s) => console.log("BOOT " + tag() + " " + s)
    window.__bootLogged = false
    document.addEventListener("DOMContentLoaded", () => {
      window.__dcl = performance.now()
      const nav = performance.getEntriesByType && performance.getEntriesByType("navigation")[0]
      log(`DOMContentLoaded=${Math.round(performance.now())}ms` +
        (nav ? ` responseEnd=${Math.round(nav.responseEnd)}ms domInteractive=${Math.round(nav.domInteractive)}ms` : ""))
    })
    window.addEventListener("load", () => {
      log(`load=${Math.round(performance.now())}ms`)
      // 首帧绘制完成（连续两帧都画出来了）
      requestAnimationFrame(() => requestAnimationFrame(() => {
        log(`firstFrames=${Math.round(performance.now())}ms`)
      }))
      // 皮肤 3D 预览：监听 skin-preview-3d.js 注入与首张渲染完成
      let started = false
      const iv = setInterval(() => {
        if (!started && window.SkinPreview3D) { started = true; log(`skinPreview注入=${Math.round(performance.now())}ms`) }
        const cv = document.querySelectorAll("canvas")
        if (cv.length > 0 && !window.__cvLogged) {
          // 有 3D canvas 即认为预览开始渲染
          window.__cvLogged = true
          log(`首个canvas出现=${Math.round(performance.now())}ms 数量=${cv.length}`)
        }
      }, 100)
      setTimeout(() => clearInterval(iv), 20000)
    })
  })

  const client = await page.target().createCDPSession()
  await client.send("Emulation.setCPUThrottlingRate", { rate: THROTTLE })
  console.log(`=== CPU 降速 ${THROTTLE}x ===`)

  await page.goto(`file://${DIST}/menu.html`, { waitUntil: "load", timeout: 300000 })
  await new Promise((r) => setTimeout(r, 8000))
  console.log("\n[初次进入 menu.html]")
  lines.splice(0).forEach((l) => console.log("  " + l))

  for (let i = 1; i <= LOOPS; i++) {
    console.log(`\n---------- 第 ${i} 轮 ----------`)
    lines.length = 0
    const t0 = Date.now()
    await realTap(page, "#btnStart")
    await new Promise((r) => setTimeout(r, 12000))
    console.log(`[进入 play] 外部计时≈${Date.now() - t0}ms`)
    lines.splice(0).forEach((l) => console.log("  " + l))

    lines.length = 0
    await realTap(page, "#menu")
    await new Promise((r) => setTimeout(r, 1200))
    await realTap(page, "#backToMenu")
    await new Promise((r) => setTimeout(r, 1200))
    const t1 = Date.now()
    await realTap(page, "#back-confirm-cn-backdrop .bcbtn.danger")
    await new Promise((r) => setTimeout(r, 12000))
    console.log(`[返回 menu] 外部计时≈${Date.now() - t1}ms`)
    lines.splice(0).forEach((l) => console.log("  " + l))
  }

  await browser.close()
  process.exit(0)
}
main().catch((e) => { console.error(e); process.exit(2) })
