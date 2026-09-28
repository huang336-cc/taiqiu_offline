/**
 * v1.5.2 退出卡顿 —— **分段计时探针**（不推理，只测量）。
 *
 * 上一轮 A/B（probe-lag152）已定位：退出总耗时 3.8~4.5s，
 * 但 menu.html 首屏只占 1~39ms —— 时间全花在「点击确认 → URL 跳转」这段
 * **同步执行**的代码上（2277ms / 2588ms）。
 *
 * back-confirm-cn.js 的 btnExit 点击处理共 5 步：
 *   1. removeDialog()              移除弹窗
 *   2. 铺全屏遮罩 #bc-exit-loading  （v1.5.0 加的"即时反馈"）
 *   3. localStorage.removeItem
 *   4. window.__onExitToMenu()     ← v1.4.6 引入的 WebGL/Audio 释放
 *   5. location.replace("menu.html")
 *
 * 本探针把 4、5 步 hook 住，用 performance.now() 精确计时，
 * 并用 MutationObserver 记录遮罩出现的真实时刻（验证"即时反馈"是否真的即时）。
 * 数据通过 console.log 输出（跨导航也能收到）。
 */
const puppeteer = require("puppeteer-core")
const fs = require("fs")
const OUT = "/tmp/v152"
const BASE = process.env.BASE || "http://127.0.0.1:8151/dist" // 默认 v1.5.1
const LABEL = process.env.LABEL || "v1.5.1"
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function realTap(page, sel) {
  const el = await page.$(sel)
  if (!el) return false
  await el.evaluate((e) => { try { e.scrollIntoView({ block: "center" }) } catch (err) {} })
  await sleep(80)
  const box = await el.boundingBox()
  if (!box) return false
  await page.touchscreen.touchStart(box.x + box.width / 2, box.y + box.height / 2)
  await page.touchscreen.touchEnd()
  return true
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true })
  const browser = await puppeteer.launch({
    executablePath: "/usr/bin/google-chrome",
    headless: "new",
    args: [
      "--no-sandbox", "--hide-scrollbars", "--disable-dev-shm-usage", "--no-zygote",
      "--ozone-platform=headless", "--use-gl=angle", "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader", "--user-data-dir=/tmp/chrome-exit152",
      "--in-process-gpu", "--disable-gpu-sandbox", "--window-size=393,851",
    ],
    env: { ...process.env, DISPLAY: "" },
  })
  const page = await browser.newPage()
  await page.setCacheEnabled(false)
  const logs = []
  page.on("console", (m) => {
    const t = m.text()
    if (t.startsWith("[EXIT]")) logs.push(t)
  })
  page.on("pageerror", (e) => logs.push("[ERR] " + String(e).slice(0, 150)))

  // 注入 hook：在文档创建初期就替换 __onExitToMenu 与 location.replace
  await page.evaluateOnNewDocument(() => {
    window.__lag = { t0: 0, marks: [] }
    // 记录遮罩出现时刻
    const obs = new MutationObserver(() => {
      if (!window.__lag.maskAt && document.getElementById("bc-exit-loading")) {
        window.__lag.maskAt = performance.now()
        console.log("[EXIT] maskAppeared=" + window.__lag.maskAt.toFixed(1))
      }
    })
    document.addEventListener("DOMContentLoaded", () => {
      obs.observe(document.body, { childList: true })
    })
    // hook __onExitToMenu
    let wrapped = false
    Object.defineProperty(window, "__onExitToMenu", {
      configurable: true,
      set(fn) {
        this.__realExit = fn
        wrapped = true
        this.__wrappedExit = function () {
          const a = performance.now()
          console.log("[EXIT] onExitToMenu_BEGIN=" + a.toFixed(1))
          let r
          try { r = this.__realExit.apply(this, arguments) }
          catch (e) { console.log("[EXIT] onExitToMenu_THREW=" + String(e).slice(0, 120)); throw e }
          const b = performance.now()
          console.log("[EXIT] onExitToMenu_END=" + b.toFixed(1) + " dur=" + (b - a).toFixed(1))
          return r
        }
        // 让外部读到的是包装后的
        Object.defineProperty(window, "__onExitToMenuWrapped", { value: true, configurable: true })
      },
      get() { return this.__wrappedExit || this.__realExit },
    })
    // hook location.replace
    try {
      const origReplace = window.location.replace.bind(window.location)
      window.location.replace = function (u) {
        const t = performance.now()
        console.log("[EXIT] locationReplace=" + t.toFixed(1) + " url=" + u)
        return origReplace(u)
      }
    } catch (e) {}
  })

  // 进入游戏
  await page.goto(`${BASE}/menu.html`, { waitUntil: "domcontentloaded", timeout: 60000 })
  await sleep(1500)
  await page.evaluate(() => { const b = document.getElementById("btnStart"); if (b) b.click() })
  for (let k = 0; k < 200; k++) {
    const ok = await page.evaluate(() => {
      const c = document.querySelector("#viewP1 canvas")
      const l = document.getElementById("view3dLoading")
      return !!(c && c.width > 0) && (!l || getComputedStyle(l).display === "none")
    }).catch(() => false)
    if (ok) break
    await sleep(100)
  }
  await sleep(1500)

  // 齿轮 → 帮助浮层 → 返回主菜单 → 确认弹窗
  await realTap(page, "#menu")
  for (let k = 0; k < 80; k++) {
    const ok = await page.evaluate(() => {
      const o = document.getElementById("helpOverlay")
      return !!(o && !o.hasAttribute("hidden") && o.offsetParent !== null)
    }).catch(() => false)
    if (ok) break
    await sleep(100)
  }
  await realTap(page, "#backToMenu")
  for (let k = 0; k < 80; k++) {
    const ok = await page.evaluate(() => !!document.getElementById("back-confirm-cn-backdrop")).catch(() => false)
    if (ok) break
    await sleep(100)
  }

  // 点击确认前打一个时间原点
  await page.evaluate(() => {
    window.__lag.t0 = performance.now()
    console.log("[EXIT] CLICK_BASE=" + window.__lag.t0.toFixed(1))
  })
  await realTap(page, "#back-confirm-cn-backdrop .bcbtn.danger")
  await sleep(6000) // 等导航完成 + 收集日志

  console.log(`\n════════ ${LABEL} 退出路径分段计时 ════════`)
  const base = logs.find((l) => l.includes("CLICK_BASE"))
  const t0 = base ? parseFloat(base.split("=")[1]) : 0
  const rel = (l) => {
    const m = l.match(/=(\d+\.\d+)/)
    return m ? (parseFloat(m[1]) - t0).toFixed(1) : "?"
  }
  for (const l of logs) {
    if (l.includes("CLICK_BASE")) { console.log(`   ${l.replace("[EXIT] ", "")}   (原点)`); continue }
    console.log(`   ${l.replace("[EXIT] ", "").padEnd(48)} +${rel(l)}ms`)
  }

  // 解析关键量
  const get = (key) => {
    const l = logs.find((x) => x.includes(key))
    return l ? parseFloat(l.match(/=(\d+\.\d+)/)[1]) : null
  }
  const b = get("onExitToMenu_BEGIN"), e = get("onExitToMenu_END")
  const mask = get("maskAppeared"), rep = get("locationReplace")
  console.log("\n   ── 结论 ──")
  if (b !== null && e !== null) {
    console.log(`   __onExitToMenu 耗时: ${(e - b).toFixed(1)}ms   ${e - b > 500 ? "← ⚠ 主线程阻塞元凶" : "(不是瓶颈)"}`)
  } else {
    console.log("   __onExitToMenu 未被执行（可能未定义）")
  }
  if (mask !== null && t0) console.log(`   遮罩出现延迟: ${(mask - t0).toFixed(1)}ms`)
  if (b !== null && t0) console.log(`   点击 → 开始释放: ${(b - t0).toFixed(1)}ms`)
  if (rep !== null && t0) console.log(`   点击 → location.replace: ${(rep - t0).toFixed(1)}ms`)

  fs.writeFileSync(`${OUT}/exit-${LABEL}.json`, JSON.stringify({ label: LABEL, logs, t0 }, null, 2))
  console.log(`\n   明细: ${OUT}/exit-${LABEL}.json`)
  await browser.close()
}

main().catch((e) => { console.error("探针异常:", e); process.exit(2) })
