/**
 * B3 对照实验：弹窗显示期间，一次 backdrop 空白触摸是否会关闭弹窗。
 * 以及：无前摇直接 tap 弹窗「返回主菜单」是否能正常退出。
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
      "--enable-unsafe-swiftshader", "--user-data-dir=/tmp/chrome-e2e146b",
      "--in-process-gpu", "--disable-gpu-sandbox", "--allow-file-access-from-files",
      "--window-size=393,851",
    ],
    env: { ...process.env, DISPLAY: "" },
  })
  const page = await browser.newPage()
  await page.setViewport({ width: 393, height: 851, hasTouch: true, isMobile: true, deviceScaleFactor: 2 })
  await page.goto(`file://${DIST}/play.html?ruletype=nineball&practice=true`, { waitUntil: "load", timeout: 120000 })
  await new Promise((r) => setTimeout(r, 2500))

  // 直接用 evaluate 调 __showExitConfirm 打开弹窗（跳过齿轮路径，聚焦弹窗本身）
  await page.evaluate(() => globalThis.__showExitConfirm())
  await new Promise((r) => setTimeout(r, 300))
  let dialog = await page.evaluate(() => !!document.getElementById("back-confirm-cn-backdrop"))
  console.log("① 弹窗已显示:", dialog)

  // 实验1：在 backdrop 空白处真触摸一次（模拟用户多余触摸/连点前摇）
  await page.touchscreen.touchStart(5, 5)
  await page.touchscreen.touchEnd()
  await new Promise((r) => setTimeout(r, 400))
  dialog = await page.evaluate(() => !!document.getElementById("back-confirm-cn-backdrop"))
  console.log("② backdrop 空白触摸后弹窗仍存在?", dialog, dialog ? "（未复现）" : "←←← 弹窗被关掉（复现！）")

  if (!dialog) {
    // 实验2：重新弹窗，不碰空白，直接 tap「返回主菜单」
    await page.evaluate(() => globalThis.__showExitConfirm())
    await new Promise((r) => setTimeout(r, 300))
    const btn = await page.$("#back-confirm-cn-backdrop .bcbtn.danger")
    const box = await btn.boundingBox()
    console.log("③ 重开弹窗，按钮位置:", JSON.stringify(box))
    await page.touchscreen.touchStart(box.x + box.width / 2, box.y + box.height / 2)
    await page.touchscreen.touchEnd()
    try {
      await page.waitForFunction(() => location.pathname.includes("menu.html"), { timeout: 8000 })
      console.log("④ 直接 tap『返回主菜单』→ 成功回主菜单 ✓", page.url())
    } catch {
      console.log("④ 直接 tap『返回主菜单』→ 未跳转 ✗ 当前:", page.url())
    }
  }

  // 实验3：弹窗刚出现的瞬间（<100ms）触摸空白 —— 模拟连点节奏
  await page.evaluate(() => globalThis.__showExitConfirm())
  await page.touchscreen.touchStart(5, 5)   // 不等待，立即摸空白
  await page.touchscreen.touchEnd()
  await new Promise((r) => setTimeout(r, 400))
  dialog = await page.evaluate(() => !!document.getElementById("back-confirm-cn-backdrop"))
  console.log("⑤ 弹窗出现瞬间立即摸空白 → 弹窗仍存在?", dialog, dialog ? "" : "←←← 0ms 内也被关")

  await browser.close()
}
main().catch((e) => { console.error(e); process.exit(2) })
