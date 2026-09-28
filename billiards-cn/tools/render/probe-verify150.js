/**
 * v1.5.0 专项验证探针：
 *   A. 退出遮罩 —— 点击「返回主菜单」确认后，遮罩应立即出现（150ms 内），
 *      遮罩为深蓝底(#0a2a3d) + 转圈 + 「加载中…」。
 *   B. 履历懒注入 —— 主菜单 → 关于 → 变更履历，内容应成功注入且 v1.5.0 置顶；
 *      第二次打开不重复加载。
 *   C. 履历打开耗时（首次加载 changelog-data.js）。
 * 产出：/tmp/v150/*.png 截图 + 控制台断言结果。
 */
const puppeteer = require("puppeteer-core")
const DIST = "/workspace/dev/source/billiards-cn/dist"
const OUT = "/tmp/v150"
const fs = require("fs")

async function realTap(page, sel) {
  await page.touchscreen.touchStart(5, 5)
  await page.touchscreen.touchEnd()
  await new Promise((r) => setTimeout(r, 80))
  const el = await page.$(sel)
  if (!el) return false
  // 先滚到可见区域，否则按钮在滚动容器外时触摸坐标落在视口外、点击无效
  await el.evaluate((e) => { try { e.scrollIntoView({ block: "center" }) } catch (err) {} })
  await new Promise((r) => setTimeout(r, 150))
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
      "--enable-unsafe-swiftshader", "--user-data-dir=/tmp/chrome-v150",
      "--in-process-gpu", "--disable-gpu-sandbox", "--allow-file-access-from-files",
      "--window-size=393,851",
    ],
    env: { ...process.env, DISPLAY: "" },
  })
  const page = await browser.newPage()
  await page.setViewport({ width: 393, height: 851, hasTouch: true, isMobile: true, deviceScaleFactor: 2 })
  const errs = []
  page.on("pageerror", (e) => errs.push(e.message))

  // 遮罩出现时刻：用 MutationObserver 在页面内记录（避免 puppeteer 查询时页面已跳转）
  await page.evaluateOnNewDocument(() => {
    window.__maskAt = null
    window.__clickAt = null
    document.addEventListener("click", (e) => {
      const t = e.target
      if (t && t.closest && t.closest("#back-confirm-cn-backdrop .bcbtn.danger")) {
        window.__clickAt = performance.now()
      }
    }, true)
    const start = () => {
      if (!document.body) { setTimeout(start, 5); return }
      new MutationObserver((muts) => {
        for (const m of muts) {
          for (const n of m.addedNodes) {
            if (n && n.id === "bc-exit-loading") {
              window.__maskAt = performance.now()
              console.log("MASK_AT " + performance.now() + " " + (window.__clickAt != null ? Math.round(performance.now() - window.__clickAt) : -1))
              // 同一时刻上报实际计算样式（跳转很快，靠 puppeteer 往返查不到）
              var cs = getComputedStyle(n)
              var r = n.getBoundingClientRect()
              console.log("MASK_STYLE " + JSON.stringify({
                z: cs.zIndex, bg: cs.backgroundColor, pos: cs.position,
                w: Math.round(r.width), h: Math.round(r.height),
                text: n.textContent, spinner: !!n.querySelector("div")
              }))
            }
          }
        }
      }).observe(document.body, { childList: true })
    }
    start()
  })
  page.on("console", (m) => {
    const t = m.text()
    if (t.startsWith("MASK_AT ")) console.log("  遮罩出现: 点击后 " + t.split(" ")[2] + "ms")
    if (t.startsWith("MASK_STYLE ")) console.log("  遮罩样式: " + t.slice(11))
  })

  await page.goto(`file://${DIST}/menu.html`, { waitUntil: "load", timeout: 120000 })
  await sleep(1500)

  // ---------- B. 履历懒注入 ----------
  console.log("=== B. 履历懒注入 ===")
  // 变更履历按钮在「设置」屏内（#screen-settings），需先打开设置
  const opened = await realTap(page, "#btnSettings")
  console.log("打开设置屏:", opened)
  await sleep(800)
  // 打开变更履历
  const t0 = Date.now()
  await realTap(page, "#btnChangelog")
  let filled = false
  for (let k = 0; k < 60; k++) {
    filled = await page.evaluate(() => {
      const b = document.getElementById("changelogBody")
      return !!(b && b.getAttribute("data-filled") === "1" && b.innerHTML.length > 100000)
    }).catch(() => false)
    if (filled) break
    await sleep(100)
  }
  const info = await page.evaluate(() => {
    const b = document.getElementById("changelogBody")
    const h3s = b ? [...b.querySelectorAll("h3")].slice(0, 3).map((x) => x.textContent.trim()) : []
    const active = document.querySelector(".screen.active")
    return { len: b ? b.innerHTML.length : 0, h3s, active: active ? active.id : "?", version: window.__BILLIARDS_VERSION__ }
  })
  console.log(`履历注入: filled=${filled} 耗时=${Date.now() - t0}ms 注入长度=${info.len}`)
  console.log(`置顶条目: ${JSON.stringify(info.h3s)}`)
  console.log(`当前屏: ${info.active} | 版本: ${info.version}`)
  await page.screenshot({ path: OUT + "/changelog.png" })
  // 第二次：先回主页再进，确认不重复加载（data-filled 保持）
  const back = await page.evaluate(() => {
    const b = document.querySelector('#screen-changelog .back-btn, #screen-changelog [data-back]')
    if (b) b.click()
    return !!b
  })
  await sleep(400)
  await realTap(page, "#btnChangelog")
  await sleep(300)
  const again = await page.evaluate(() => {
    const b = document.getElementById("changelogBody")
    return { filled: b ? b.getAttribute("data-filled") : null, len: b ? b.innerHTML.length : 0 }
  })
  console.log(`二次打开: data-filled=${again.filled} 长度=${again.len}（应保持 1 与不变）`)

  // ---------- A. 退出遮罩 ----------
  console.log("\n=== A. 退出遮罩 ===")
  // 回到首页（设置屏的返回按钮）
  await page.evaluate(() => {
    const b = document.querySelector('#screen-settings .back-btn, #screen-settings [data-back]')
    if (b) b.click()
    else if (typeof showScreen === "function") showScreen("home")
  })
  await sleep(600)
  const homeOk = await page.evaluate(() => {
    const a = document.querySelector(".screen.active")
    return a ? a.id : "?"
  })
  console.log("回到:", homeOk)
  await realTap(page, "#btnStart")
  // 等 play 就绪（canvas 可见）
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
  await sleep(800)
  await realTap(page, "#menu")
  await sleep(700)
  await realTap(page, "#backToMenu")
  await sleep(700)
  const hasDlg = await page.evaluate(() => !!document.getElementById("back-confirm-cn-backdrop"))
  console.log("退出弹窗出现:", hasDlg)
  // 点击确认，立即连拍
  await realTap(page, "#back-confirm-cn-backdrop .bcbtn.danger")
  await page.screenshot({ path: OUT + "/exit_000ms.png" })
  await sleep(150)
  await page.screenshot({ path: OUT + "/exit_150ms.png" })
  await sleep(350)
  await page.screenshot({ path: OUT + "/exit_500ms.png" })
  // 遮罩状态（在跳转前的窗口里尽量抓）
  const mask = await page.evaluate(() => {
    const m = document.getElementById("bc-exit-loading")
    return m ? { exists: true } : { exists: false }
  }).catch(() => ({ exists: "页面已跳转" }))
  console.log("遮罩状态:", JSON.stringify(mask))
  // 等 3 秒后应已回到 menu
  await sleep(3000)
  const at = await page.evaluate(() => location.pathname.split("/").pop()).catch(() => "?")
  console.log("3 秒后所在页面:", at)
  await sleep(1500)
  await page.screenshot({ path: OUT + "/menu_after.png" })

  console.log("\n页面错误:", errs.length ? errs : "无")
  await browser.close()
  process.exit(0)
}
main().catch((e) => { console.error(e); process.exit(2) })
