/**
 * v1.5.1 合并验证探针（问题 1 的最后一环 + 问题 5）。
 *
 * 问题 1（继续对战又弹引导）无法走完整对局（headless 下练习模式卡在 PlaceBall、
 * 人机模式进不了玩家回合），改为直接验证它的**直接原因函数**：
 *   restartGame() 重开时是否把 URL 上的一次性参数 tutorial=1 剥掉。
 * 做法：用真实的 Notification 面板渲染一个 data-notification-action="reload"
 * 的「继续对战」按钮，真实触摸点击 → restartGame 触发真实导航 → 检查落地 URL。
 *
 * 问题 5（保存回放一直转圈）：验证 is-busy 的 CSS 转圈事实，以及真实点击
 * 「原地完成」类动作后 busy 是否被清除。
 */
const puppeteer = require("puppeteer-core")
const fs = require("fs")
const OUT = "/tmp/v151"
const BASE = "http://127.0.0.1:8099"
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function main() {
  fs.mkdirSync(OUT, { recursive: true })
  const browser = await puppeteer.launch({
    executablePath: "/usr/bin/google-chrome",
    headless: "new",
    args: [
      "--no-sandbox", "--hide-scrollbars", "--disable-dev-shm-usage", "--no-zygote",
      "--ozone-platform=headless", "--use-gl=angle", "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader", "--user-data-dir=/tmp/chrome-misc151",
      "--in-process-gpu", "--disable-gpu-sandbox", "--window-size=1422,640",
    ],
    env: { ...process.env, DISPLAY: "" },
  })
  const page = await browser.newPage()
  await page.setCacheEnabled(false)
  await page.setViewport({ width: 1422, height: 640, hasTouch: true, isMobile: true, deviceScaleFactor: 1 })
  const errs = []
  page.on("pageerror", (e) => errs.push(e.message))

  // ================= 问题 1：reload 动作是否剥离 tutorial =================
  await page.goto(BASE + "/play.html?practice=true&tutorial=1", {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  })
  await sleep(8000)
  const url0 = page.url()
  console.log("── 问题1：继续对战（reload 动作）")
  console.log("   起始 URL:", url0)

  // 用真实 Notification 面板渲染「继续对战」按钮（与结算面板同一套动作名）
  await page.evaluate(() => {
    const c = window.container
    c.notification.show(
      {
        type: "GameOver",
        title: "本局结束",
        extra:
          '<div class="notification-actions">' +
          '<button class="notification-btn" data-notification-action="reload">继续对战</button>' +
          "</div>",
        duration: 0,
      },
      0
    )
  })
  await sleep(800)
  const btn = await page.$('#notification [data-notification-action="reload"]')
  if (!btn) {
    console.log("   !! 未找到继续对战按钮")
  } else {
    const b = await btn.boundingBox()
    await page.touchscreen.touchStart(b.x + b.width / 2, b.y + b.height / 2)
    await page.touchscreen.touchEnd()
    await sleep(6000)
  }
  const url1 = page.url()
  console.log("   重开后 URL:", url1)
  const stripped = !/tutorial=1/.test(url1)
  console.log("   tutorial=1 已剥离:", stripped ? "✓" : "✗")
  console.log("   _r 时间戳已带上:", /_r=\d+/.test(url1) ? "✓" : "✗")
  await page.screenshot({ path: OUT + "/misc-01-after-rematch.png" })

  // ================= 问题 5：is-busy 转圈 =================
  console.log("── 问题5：保存回放转圈")

  // A. CSS 事实
  const cssFact = await page.evaluate(() => {
    const host = document.createElement("div")
    host.id = "notification"
    const btn = document.createElement("button")
    btn.className = "notification-btn"
    btn.textContent = "保存回放"
    host.appendChild(btn)
    document.body.appendChild(host)
    const read = () => {
      const s = getComputedStyle(btn, "::before")
      return { animationName: s.animationName, animationDuration: s.animationDuration, width: s.width }
    }
    const before = read()
    btn.classList.add("is-busy")
    const busy = read()
    btn.classList.remove("is-busy")
    const removed = read()
    return { before, busy, removed }
  })
  console.log("   A. CSS: 无class =", JSON.stringify(cssFact.before))
  console.log("          有class =", JSON.stringify(cssFact.busy))
  console.log("          移除后 =", JSON.stringify(cssFact.removed))
  console.log(
    "          → 转圈由 is-busy 产生、移除即停:",
    cssFact.busy.animationName !== "none" && cssFact.removed.animationName === "none" ? "✓" : "✗"
  )

  // B. 真实点击「原地完成」动作（copy-ip，与 saveReplay 同类）
  await page.evaluate(() => {
    const c = window.container
    c.notification.show(
      {
        type: "Info",
        title: "验证面板",
        extra:
          '<div class="notification-actions">' +
          '<button class="notification-btn" data-notification-action="copy-ip">复制</button>' +
          "</div>",
        duration: 0,
      },
      0
    )
  })
  await sleep(700)
  const cbtn = await page.$('#notification [data-notification-action="copy-ip"]')
  let after = null
  if (cbtn) {
    const b = await cbtn.boundingBox()
    await page.touchscreen.touchStart(b.x + b.width / 2, b.y + b.height / 2)
    await page.touchscreen.touchEnd()
    await sleep(700)
    after = await page.evaluate(() => {
      const el = document.querySelector('#notification [data-notification-action="copy-ip"]')
      if (!el) return null
      return {
        hasBusy: el.classList.contains("is-busy"),
        animationName: getComputedStyle(el, "::before").animationName,
      }
    })
  }
  console.log("   B. 真实点击后按钮:", JSON.stringify(after))
  console.log(
    "          → 点击后不再转圈:",
    after && !after.hasBusy && after.animationName === "none" ? "✓" : "✗"
  )
  await page.screenshot({ path: OUT + "/misc-02-copy.png" })

  // C. 产物核对
  const js = fs.readFileSync("/workspace/dev/source/billiards-cn/dist/index.js", "utf8")
  const i = js.indexOf("已存入回放")
  console.log("   C. 产物：saveReplay 收尾片段:", JSON.stringify(i > 0 ? js.slice(i - 160, i + 60) : "未找到"))
  console.log("          含 remove(\"is-busy\"):", /remove\("is-busy"\)/.test(js) ? "✓" : "✗")
  console.log("          含 _r,tutorial 丢弃表:", /"state","replayId","replay","_r","tutorial"/.test(js) ? "✓" : "✗")

  console.log("页面错误:", errs.length ? errs.slice(0, 3) : "无")
  await browser.close()
}
main().catch((e) => { console.error("FATAL", e); process.exit(1) })
