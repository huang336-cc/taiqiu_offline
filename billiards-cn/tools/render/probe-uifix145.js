/**
 * 【v1.4.5】UI 无响应修复的行为级验证。
 *
 * 修复 A（play 页）：300ms 内连续 touchend 不再对交互元素 preventDefault。
 *   验证：快速连发 touchend —— 打在按钮上的那次 e.defaultPrevented 必须为
 *   false（修复前为 true，click 被吞），打在空白处的仍为 true（保留防双击缩放）。
 *
 * 修复 B（menu 页）：btnStart 在 init 最前面绑定，点击后跳转 play.html。
 *   验证：真实 CDP 点击 → 等待 URL 变为 play.html?ruletype=...
 */
const puppeteer = require("puppeteer-core")

;(async () => {
  const browser = await puppeteer.launch({
    executablePath: "/usr/bin/google-chrome",
    headless: "new",
    args: [
      "--no-sandbox", "--hide-scrollbars", "--disable-dev-shm-usage",
      "--no-zygote", "--ozone-platform=headless",
      "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader",
      "--user-data-dir=/tmp/chrome-uifix145", "--in-process-gpu", "--disable-gpu-sandbox",
      "--allow-file-access-from-files", "--window-size=800,600",
    ],
    env: { ...process.env, DISPLAY: "" },
  })
  let fail = 0

  // ---------- 修复 A：play 页 touchend 防抖 ----------
  {
    const page = await browser.newPage()
    await page.setViewport({ width: 800, height: 600 })
    await page.goto("file:///workspace/dev/source/billiards-cn/dist/play.html?debug=1&bot=Professional", {
      waitUntil: "load", timeout: 120000,
    })
    await new Promise((r) => setTimeout(r, 3000))

    const r = await page.evaluate(async () => {
      const fire = (target) => {
        const ev = new TouchEvent("touchend", { bubbles: true, cancelable: true })
        target.dispatchEvent(ev)
        return ev.defaultPrevented
      }
      const wait = (ms) => new Promise((res) => setTimeout(res, ms))
      const btn = document.getElementById("cueHit")
      const body = document.body
      const log = []
      // t0: 点空白（建立 lastTouch 基线）
      log.push(["t0 空白(首触)", fire(body)])
      await wait(60)
      // t0+60ms: 快速点按钮 —— 修复前这里被吞（true），修复后必须放行（false）
      log.push(["t+60ms 按钮", fire(btn)])
      await wait(60)
      // t0+120ms: 再点空白（距上次 <300ms，非交互 → 仍防抖）
      log.push(["t+120ms 空白", fire(body)])
      await wait(60)
      // t0+180ms: 再点按钮（距上次空白触摸 <300ms → 修复前被吞，修复后放行）
      log.push(["t+180ms 按钮", fire(btn)])
      return log
    })
    const btnResults = r.filter((x) => x[0].includes("按钮")).map((x) => x[1])
    const blankDebounce = r[2][1] === true
    const okA = btnResults.every((v) => v === false) && blankDebounce
    if (!okA) fail++
    console.log(`修复A(游戏页 touchend): ${okA ? "✓" : "✗"}  明细: ${JSON.stringify(r)}`)
    await page.close()
  }

  // ---------- 修复 B：menu 页开始游戏 ----------
  {
    const page = await browser.newPage()
    await page.setViewport({ width: 800, height: 600 })
    await page.goto("file:///workspace/dev/source/billiards-cn/dist/menu.html", {
      waitUntil: "load", timeout: 120000,
    })
    await new Promise((r) => setTimeout(r, 1500))
    const hasBtn = await page.evaluate(() => {
      const b = document.getElementById("btnStart")
      return !!b && b.getBoundingClientRect().width > 0
    })
    try {
      await Promise.all([
        page.waitForNavigation({ waitUntil: "load", timeout: 30000 }),
        page.click("#btnStart"),
      ])
    } catch (e) {
      // 若已有 navigation 进行中也无妨，下面直接检查 URL
    }
    const url = page.url()
    const okB = hasBtn && url.includes("play.html?ruletype=")
    if (!okB) fail++
    console.log(`修复B(菜单页开始游戏): ${okB ? "✓" : "✗"}  btn可见=${hasBtn}  url=${url}`)
    await page.close()
  }

  await browser.close()
  console.log(fail === 0 ? "\n全部通过" : `\n失败 ${fail} 项`)
  process.exit(fail === 0 ? 0 : 1)
})().catch((e) => {
  console.error(e)
  process.exit(2)
})
