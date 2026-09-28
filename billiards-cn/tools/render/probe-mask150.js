/**
 * v1.5.0 退出遮罩视觉验证：把 location.replace 打桩为 no-op（不真跳转），
 * 让遮罩留在屏幕上以便截图与像素分析，确认它是「深蓝底 + 转圈 + 加载中…」。
 */
const puppeteer = require("puppeteer-core")
const fs = require("fs")
const DIST = "/workspace/dev/source/billiards-cn/dist"
const OUT = "/tmp/v150"

async function realTap(page, sel) {
  await page.touchscreen.touchStart(5, 5)
  await page.touchscreen.touchEnd()
  await new Promise((r) => setTimeout(r, 80))
  const el = await page.$(sel)
  if (!el) return false
  await el.evaluate((e) => { try { e.scrollIntoView({ block: "center" }) } catch (err) {} })
  await new Promise((r) => setTimeout(r, 120))
  const box = await el.boundingBox()
  if (!box) return false
  await page.touchscreen.touchStart(box.x + box.width / 2, box.y + box.height / 2)
  await page.touchscreen.touchEnd()
  return true
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function main() {
  fs.mkdirSync(OUT, { recursive: true })
  const browser = await puppeteer.launch({
    executablePath: "/usr/bin/google-chrome",
    headless: "new",
    args: [
      "--no-sandbox", "--hide-scrollbars", "--disable-dev-shm-usage", "--no-zygote",
      "--ozone-platform=headless", "--use-gl=angle", "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader", "--user-data-dir=/tmp/chrome-mask150",
      "--in-process-gpu", "--disable-gpu-sandbox", "--allow-file-access-from-files",
      "--window-size=393,851",
    ],
    env: { ...process.env, DISPLAY: "" },
  })
  const page = await browser.newPage()
  await page.setViewport({ width: 393, height: 851, hasTouch: true, isMobile: true, deviceScaleFactor: 2 })
  page.on("pageerror", (e) => console.log("[pageerror]", e.message))

  await page.goto(`file://${DIST}/menu.html`, { waitUntil: "load", timeout: 120000 })
  await sleep(1200)
  await realTap(page, "#btnStart")
  for (let k = 0; k < 150; k++) {
    const ok = await page.evaluate(() => {
      const c = document.querySelector("#viewP1 canvas")
      const l = document.getElementById("view3dLoading")
      return !!(c && c.width > 0 && c.offsetHeight > 0) && (!l || getComputedStyle(l).display === "none")
    }).catch(() => false)
    if (ok) break
    await sleep(100)
  }
  console.log("已进入游戏")
  await sleep(600)

  // location.replace 无法打桩（location 不可写），改用重度 CPU 降速让跳转变慢，
  // 这样点击后几百毫秒内旧文档仍在，遮罩可以被截到。
  const client = await page.target().createCDPSession()
  await client.send("Emulation.setCPUThrottlingRate", { rate: 15 })
  console.log("CPU 降速 15x（让跳转变慢以便截图）")

  await realTap(page, "#menu")
  await sleep(600)
  await realTap(page, "#backToMenu")
  await sleep(600)
  const dlg = await page.evaluate(() => !!document.getElementById("back-confirm-cn-backdrop"))
  console.log("退出弹窗:", dlg)
  await realTap(page, "#back-confirm-cn-backdrop .bcbtn.danger")
  await sleep(250)
  const st = await page.evaluate(() => {
    const m = document.getElementById("bc-exit-loading")
    return {
      url: location.pathname.split("/").pop(),
      mask: m ? { z: getComputedStyle(m).zIndex, bg: getComputedStyle(m).backgroundColor, text: m.textContent } : null,
    }
  }).catch((e) => ({ url: "已跳转", mask: null }))
  console.log("点击 250ms 后所在页:", st.url)
  console.log("遮罩:", JSON.stringify(st.mask))
  await page.screenshot({ path: OUT + "/mask_only.png" })

  await browser.close()
  process.exit(0)
}
main().catch((e) => { console.error(e); process.exit(2) })
