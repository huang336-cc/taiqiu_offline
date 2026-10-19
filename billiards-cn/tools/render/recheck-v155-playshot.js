/** v1.5.5 发版冒烟补充：引导走完后复核 3D 渲染帧非黑（play.png 黑屏复核）。 */
const puppeteer = require("puppeteer-core")
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const BASE = process.env.BASE || "http://127.0.0.1:8160/dist"

async function main() {
  const browser = await puppeteer.launch({
    executablePath: "/usr/bin/google-chrome",
    headless: true,
    protocolTimeout: 45000,
    args: [
      "--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu",
      "--user-data-dir=/tmp/chrome-relw", "--window-size=393,851",
    ],
    env: { ...process.env, DISPLAY: "" },
  })
  const page = await browser.newPage()
  await page.setCacheEnabled(false)
  await page.setViewport({ width: 393, height: 851, deviceScaleFactor: 1 })
  const errs = []
  page.on("pageerror", (e) => errs.push(String(e).slice(0, 120)))
  await page.goto(`${BASE}/play.html?ruletype=eightball&bot=ClawBreak`, { waitUntil: "domcontentloaded", timeout: 120000 })
  // 用短 evaluate 轮询（waitForFunction 常驻 handle 在加载忙时会卡 protocolTimeout）
  for (let i = 0; i < 450; i++) {
    const r = await page.evaluate(() => {
      const c = document.querySelector("#viewP1 canvas")
      const l = document.getElementById("view3dLoading")
      return !!(c && c.width > 0) && (!l || getComputedStyle(l).display === "none")
    }).catch(() => false)
    if (r) break
    await sleep(200)
  }
  await sleep(1500)

  // 等瞄准就绪（自动点掉 Tutorial 第 1 步）
  for (let i = 0; i < 750; i++) {
    const r = await page.evaluate(() => {
      const c = window.container
      const cue = c && c.table && c.table.cue
      if (!c || !cue || !cue.aimInputs) return false
      const ack = document.querySelector('[data-tut-ack="1"]')
      if (ack) { ack.click(); return false }
      const n = c.controller && c.controller.name
      if (n === "PlaceBall") { document.getElementById("cueHit")?.click(); return false }
      return !cue.aimInputs.isDisabled()
    }).catch(() => false)
    if (r) break
    await sleep(200)
  }
  await sleep(800)

  // 真实拖动 canvas（触发 Tutorial step2→3），再点「击球」出杆（step3→finish）
  const box = await page.evaluate(() => {
    const c = document.querySelector("#viewP1 canvas")
    const r = c.getBoundingClientRect()
    return { x: r.x, y: r.y, w: r.width, h: r.height }
  })
  await page.mouse.move(box.x + box.w * 0.6, box.y + box.h * 0.5)
  await page.mouse.down()
  await page.mouse.move(box.x + box.w * 0.4, box.y + box.h * 0.5, { steps: 8 })
  await page.mouse.up()
  await sleep(500)
  await page.evaluate(() => document.getElementById("cueHit")?.click())
  await sleep(2500) // 等引导结束 + bot 回合动起来

  const stat = await page.evaluate(() => ({
    tutActive: !!(document.querySelector(".tut-overlay, [class*=tut]")),
    ctrl: window.container?.controller?.name,
  }))
  await page.screenshot({ path: "/tmp/v155-release/play2.png" })
  console.log("stat:", JSON.stringify(stat), "pageErr:", JSON.stringify(errs))
  await browser.close()
}
main().catch((e) => { console.error("FATAL", e); process.exit(1) })
