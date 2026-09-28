/**
 * v1.5.2 —— 「开始游戏」慢的定位探针。
 *
 * 已知（CPU 6x 降速，probe-cpu152）：
 *   开始游戏总耗时 3.6~5.3s，其中「导航到 play.html」仅 0.15~0.6s，
 *   「play.html → 场景就绪」占 3.2~3.9s —— 大头在这里，且 v1.5.0/v1.5.1 完全持平
 *   （即这条路径从未被优化过，不是 v1.5.1 的回归）。
 *
 * 本探针把 play.html 的启动拆开测：
 *   1. navigation timing（domInteractive / DCL / load）—— 文档与脚本解析成本
 *   2. 资源加载明细（谁最大、谁最慢）
 *   3. 长任务（>50ms 的主线程阻塞段）及其起止
 *   4. 场景就绪时刻（首帧 canvas 可绘制）
 *   5. 关键阶段打点（若页面暴露）
 */
const puppeteer = require("puppeteer-core")
const fs = require("fs")
const OUT = "/tmp/v152"
const BASE = process.env.BASE || "http://127.0.0.1:8151/dist"
const LABEL = process.env.LABEL || "v1.5.1"
const RATE = parseInt(process.env.RATE || "6", 10)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function main() {
  fs.mkdirSync(OUT, { recursive: true })
  const browser = await puppeteer.launch({
    executablePath: "/usr/bin/google-chrome",
    headless: "new",
    args: [
      "--no-sandbox", "--hide-scrollbars", "--disable-dev-shm-usage", "--no-zygote",
      "--ozone-platform=headless", "--use-gl=angle", "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader", "--user-data-dir=/tmp/chrome-enter152",
      "--in-process-gpu", "--disable-gpu-sandbox", "--window-size=393,851",
    ],
    env: { ...process.env, DISPLAY: "" },
  })
  const page = await browser.newPage()
  await page.setCacheEnabled(false)
  const client = await page.createCDPSession()
  await client.send("Emulation.setCPUThrottlingRate", { rate: RATE })

  // 在 play.html 文档创建时注入收集器
  await page.evaluateOnNewDocument(() => {
    window.__perf = { longTasks: [], marks: [] }
    try {
      new PerformanceObserver((list) => {
        for (const e of list.getEntries()) {
          window.__perf.longTasks.push({ start: Math.round(e.startTime), dur: Math.round(e.duration) })
        }
      }).observe({ entryTypes: ["longtask"] })
    } catch (e) {}
    document.addEventListener("DOMContentLoaded", () => {
      window.__perf.dcl = Math.round(performance.now())
    })
    window.addEventListener("load", () => {
      window.__perf.load = Math.round(performance.now())
      // 收集资源
      window.__perf.resources = performance.getEntriesByType("resource").map((r) => ({
        name: r.name.split("/").pop().slice(0, 46),
        dur: Math.round(r.duration),
        size: r.transferSize || r.encodedBodySize || 0,
        type: r.initiatorType,
      })).sort((a, b) => b.dur - a.dur)
    })
  })

  // 菜单 → 开始游戏
  await page.goto(`${BASE}/menu.html`, { waitUntil: "domcontentloaded", timeout: 120000 })
  await sleep(2000)
  const t0 = Date.now()
  await page.evaluate(() => { const b = document.getElementById("btnStart"); if (b) b.click() })
  for (let k = 0; k < 800; k++) {
    const ok = await page.evaluate(() => {
      const c = document.querySelector("#viewP1 canvas")
      const l = document.getElementById("view3dLoading")
      return !!(c && c.width > 0 && c.offsetHeight > 0) && (!l || getComputedStyle(l).display === "none")
    }).catch(() => false)
    if (ok) break
    await sleep(50)
  }
  const tScene = Date.now() - t0
  await sleep(1200)

  const data = await page.evaluate(() => {
    const nav = performance.getEntriesByType("navigation")[0] || {}
    return {
      nav: {
        domInteractive: nav.domInteractive ? Math.round(nav.domInteractive) : -1,
        domContentLoaded: nav.domContentLoadedEventEnd ? Math.round(nav.domContentLoadedEventEnd) : -1,
        loadEvent: nav.loadEventEnd ? Math.round(nav.loadEventEnd) : -1,
        responseEnd: nav.responseEnd ? Math.round(nav.responseEnd) : -1,
      },
      perf: window.__perf || {},
      now: Math.round(performance.now()),
    }
  }).catch(() => ({}))

  console.log(`\n════════ ${LABEL} 开始游戏启动分解（CPU ${RATE}x 降速）════════`)
  console.log(`  端到端「点击→场景就绪」: ${tScene}ms`)
  if (data.nav) {
    const n = data.nav
    console.log(`\n  ── navigation timing ──`)
    console.log(`     响应结束 responseEnd      ${n.responseEnd}ms`)
    console.log(`     文档可交互 domInteractive ${n.domInteractive}ms`)
    console.log(`     DOMContentLoaded          ${n.domContentLoaded}ms`)
    console.log(`     load 事件结束             ${n.loadEvent}ms`)
    const afterLoad = tScene - (n.loadEvent > 0 ? n.loadEvent : 0)
    console.log(`     ⇒ load 之后到场景就绪还需 ${afterLoad}ms`)
  }
  if (data.perf && data.perf.resources) {
    console.log(`\n  ── 资源加载 Top 10（按时长）──`)
    for (const r of data.perf.resources.slice(0, 10)) {
      console.log(`     ${r.name.padEnd(46)} ${String(r.dur).padStart(6)}ms  ${(r.size / 1024).toFixed(0)}KB  ${r.type}`)
    }
  }
  if (data.perf && data.perf.longTasks) {
    const lt = data.perf.longTasks.slice().sort((a, b) => b.dur - a.dur)
    const total = lt.reduce((s, x) => s + x.dur, 0)
    console.log(`\n  ── 长任务（>50ms 主线程阻塞）共 ${lt.length} 个，累计 ${total}ms ──`)
    for (const x of lt.slice(0, 12)) {
      console.log(`     ${String(x.dur).padStart(6)}ms  起于 ${x.start}ms`)
    }
  }
  fs.writeFileSync(`${OUT}/enter-${LABEL}-${RATE}x.json`, JSON.stringify({ label: LABEL, rate: RATE, tScene, ...data }, null, 2))
  console.log(`\n  明细: ${OUT}/enter-${LABEL}-${RATE}x.json`)
  await browser.close()
}

main().catch((e) => { console.error("探针异常:", e); process.exit(2) })
