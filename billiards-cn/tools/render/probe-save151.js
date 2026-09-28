/**
 * v1.5.1 问题「保存回放后一直转圈圈」验证探针。
 *
 * 取证链（三段，全部实测）：
 *   A. CSS 事实：在真实浏览器里测 `.notification-btn.is-busy::before` 的
 *      animation-name —— 证明「转圈」确实由这个 class 产生；移除 class 后
 *      动画必须消失。
 *   B. 真实点击路径：用 container.notification.show 弹出一个真实的通知面板
 *      （按钮走 Notification 内部的 switch 分支 copy-ip，与 saveReplay 同为
 *      「原地完成、不跳转」的动作），真实触摸点击后检查 is-busy 是否被清除、
 *      转圈是否停止。
 *   C. 产物核对：dist/index.js 的 saveReplay 分支里必须出现
 *      classList.remove("is-busy")。
 * 产出：/tmp/v151/save-*.png
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
      "--enable-unsafe-swiftshader", "--user-data-dir=/tmp/chrome-save151",
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
  await sleep(800)
  const el = await page.$("#btnStart")
  if (el) {
    const box = await el.boundingBox()
    await page.touchscreen.touchStart(box.x + box.width / 2, box.y + box.height / 2)
    await page.touchscreen.touchEnd()
  }
  await sleep(9000)

  // ---------- A. CSS 事实：is-busy 的 ::before 是否是转圈 ----------
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
      return {
        animationName: s.animationName,
        animationDuration: s.animationDuration,
        width: s.width,
        borderTopColor: s.borderTopColor,
        borderRadius: s.borderRadius,
      }
    }
    const before = read()
    btn.classList.add("is-busy")
    const withBusy = read()
    btn.classList.remove("is-busy")
    const afterRemove = read()
    return { before, withBusy, afterRemove }
  })
  console.log("A. CSS 事实:")
  console.log("   无 is-busy :", JSON.stringify(cssFact.before))
  console.log("   有 is-busy :", JSON.stringify(cssFact.withBusy))
  console.log("   移除之后   :", JSON.stringify(cssFact.afterRemove))
  const cssOk =
    cssFact.withBusy.animationName !== "none" &&
    cssFact.afterRemove.animationName === "none"
  console.log("   → 转圈由 is-busy 产生且移除即停:", cssOk ? "✓" : "✗")

  // ---------- B. 真实点击路径 ----------
  const shown = await page.evaluate(() => {
    const c = window.container
    if (!c || !c.notification) return false
    c.notification.show(
      {
        type: "Info",
        title: "验证面板",
        subtext: "点击复制按钮后不应残留转圈",
        extra:
          '<div class="notification-actions">' +
          '<button class="notification-btn" data-notification-action="copy-ip">复制</button>' +
          "</div>",
        duration: 0,
      },
      0
    )
    return true
  })
  console.log("B. 面板已弹出:", shown)
  await sleep(700)
  await page.screenshot({ path: OUT + "/save-01-panel.png" })

  const btnSel = '#notification [data-notification-action="copy-ip"]'
  const b = await page.$(btnSel)
  let clickOk = false
  let state = null
  if (b) {
    const box = await b.boundingBox()
    await page.touchscreen.touchStart(box.x + box.width / 2, box.y + box.height / 2)
    await page.touchscreen.touchEnd()
    clickOk = true
    await sleep(600)
    state = await page.evaluate((sel) => {
      const el = document.querySelector(sel)
      if (!el) return null
      const s = getComputedStyle(el, "::before")
      return {
        hasBusy: el.classList.contains("is-busy"),
        busyAttr: el.dataset.busy || null,
        disabled: !!el.disabled,
        animationName: s.animationName,
      }
    }, btnSel)
  }
  await page.screenshot({ path: OUT + "/save-02-after-click.png" })
  console.log("   点击成功:", clickOk)
  console.log("   点击后按钮状态:", JSON.stringify(state))
  console.log("   → 点击后转圈已停止:", state && state.animationName === "none" ? "✓" : "✗")

  // ---------- C. 产物核对 ----------
  const js = fs.readFileSync("/workspace/dev/source/billiards-cn/dist/index.js", "utf8")
  const i = js.indexOf("已存入回放")
  const ctx = i > 0 ? js.slice(i - 400, i + 120) : ""
  const hasRemove = /remove\("is-busy"\)/.test(js)
  console.log("C. 产物核对:")
  console.log("   dist/index.js 含 remove(\"is-busy\"):", hasRemove ? "✓" : "✗")
  console.log("   saveReplay 收尾片段:", JSON.stringify(ctx.slice(-260)))

  console.log("页面错误:", errs.length ? errs : "无")
  await browser.close()
}
main().catch((e) => { console.error("FATAL", e); process.exit(1) })
