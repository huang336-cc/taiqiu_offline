/**
 * v1.5.2 卡顿回归定位探针 —— **A/B 对比 v1.5.0 与 v1.5.1**。
 *
 * 用户报告：v1.5.1 又出现「退出主菜单 / 开始游戏卡顿」，而这是 v1.5.0 修过的。
 * 本探针不推理，只做对照测量：
 *
 *   同一台机器、同一浏览器配置、同一路径，分别跑
 *     /tmp/ab150/dist  (v1.5.0 网页资源，从 billiards-cn-v1.5.0.apk 解出)
 *     /tmp/ab151/dist  (v1.5.1 当前资源)
 *
 * 测量 4 个量：
 *   T1 冷启动进入菜单首帧        (menu.html 加载到首帧)
 *   T2 点击「开始游戏」→ 场景就绪 (进入 play.html 到可交互)
 *   T3 点齿轮 → 确认退出 → 菜单首帧可见
 *   T4 第 2 轮重复 T2/T3（看是否累积）
 *
 * 另外统计每一轮的关键资源指标：
 *   - domInteractive / domContentLoaded（HTML 解析成本）
 *   - JS 堆大小（是否累积）
 *   - canvas 数量（renderer 是否残留）
 *   - history.length（v1.5.1 引入子屏历史栈后是否增长失控）
 *
 * 用法：node probe-lag152.js
 */
const puppeteer = require("puppeteer-core")
const fs = require("fs")
const OUT = "/tmp/v152"
const PORT_A = 8150 // v1.5.0
const PORT_B = 8151 // v1.5.1
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function newBrowser(dir) {
  return puppeteer.launch({
    executablePath: "/usr/bin/google-chrome",
    headless: "new",
    args: [
      "--no-sandbox", "--hide-scrollbars", "--disable-dev-shm-usage", "--no-zygote",
      "--ozone-platform=headless", "--use-gl=angle", "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader", `--user-data-dir=/tmp/chrome-lag-${dir}`,
      "--in-process-gpu", "--disable-gpu-sandbox", "--window-size=393,851",
    ],
    env: { ...process.env, DISPLAY: "" },
  })
}

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

/** 等菜单首屏真正可交互：主屏存在且「开始游戏」按钮有尺寸 */
async function menuReady(page, budgetMs) {
  const t0 = Date.now()
  while (Date.now() - t0 < budgetMs) {
    const ok = await page.evaluate(() => {
      const home = document.querySelector(".screen.active, #screen-home")
      if (!home) return false
      const btn = document.getElementById("btnStart")
      if (!btn) return false
      const r = btn.getBoundingClientRect()
      return r.width > 0 && r.height > 0
    }).catch(() => false)
    if (ok) return Date.now() - t0
    await sleep(30)
  }
  return -1
}

/** 等场景就绪：出现 canvas 且尺寸正常 */
async function sceneReady(page, budgetMs) {
  const t0 = Date.now()
  while (Date.now() - t0 < budgetMs) {
    const ok = await page.evaluate(() => {
      const c = document.querySelector("canvas")
      if (!c) return false
      return c.width > 0 && c.height > 0
    }).catch(() => false)
    if (ok) return Date.now() - t0
    await sleep(30)
  }
  return -1
}

async function collectMetrics(page) {
  return page.evaluate(() => {
    const nav = performance.getEntriesByType("navigation")[0] || {}
    return {
      domInteractive: nav.domInteractive ? Math.round(nav.domInteractive) : -1,
      domContentLoaded: nav.domContentLoadedEventEnd ? Math.round(nav.domContentLoadedEventEnd) : -1,
      heapMB: performance.memory ? +(performance.memory.usedJSHeapSize / 1048576).toFixed(1) : -1,
      canvases: document.querySelectorAll("canvas").length,
      historyLen: history.length,
      nodes: (document.getElementsByTagName("*") || []).length,
    }
  }).catch(() => ({}))
}

async function runOne(base, label, browser) {
  const page = await browser.newPage()
  await page.setCacheEnabled(false)
  const errs = []
  page.on("pageerror", (e) => errs.push(String(e).slice(0, 120)))
  const result = { label, rounds: [], errs: [] }

  // T1 冷启动进入菜单
  const t1a = Date.now()
  await page.goto(`${base}/dist/menu.html`, { waitUntil: "domcontentloaded", timeout: 60000 })
  const t1 = await menuReady(page, 30000)
  result.rounds.push({ what: "T1 冷启动进菜单首帧", ms: t1, ...(await collectMetrics(page)) })

  for (let round = 1; round <= 2; round++) {
    // T2 开始游戏
    const started = await page.evaluate(() => {
      const b = document.querySelector("#btnStart")
      if (!b) return false
      b.click()
      return true
    })
    if (!started) { result.rounds.push({ what: `R${round} 开始游戏`, ms: -1, note: "找不到开始按钮" }); break }
    const t2 = await sceneReady(page, 45000)
    await sleep(1200)
    const m2 = await collectMetrics(page)
    result.rounds.push({ what: `R${round} 开始游戏→场景就绪`, ms: t2, ...m2 })

    // T3 点齿轮（#menu）→ 帮助浮层 → #backToMenu → 确认弹窗 → 回菜单
    // 细分三段，用于定位卡在哪一段：
    //   tGearToConfirm : 点齿轮 → 确认弹窗出现
    //   tClickToNav    : 点「返回主菜单」→ URL 变成 menu.html（含同步 teardown）
    //   tNavToReady    : URL 变化 → 菜单首帧可交互（menu.html 加载 + 初始化）
    await sleep(500)
    const t3start = Date.now()
    const gearTapped = await realTap(page, "#menu")
    if (!gearTapped) {
      result.rounds.push({ what: `R${round} 未找到齿轮 #menu`, ms: -1 })
      break
    }
    // 等帮助浮层
    let overlayOk = false
    for (let k = 0; k < 60; k++) {
      overlayOk = await page.evaluate(() => {
        const o = document.getElementById("helpOverlay")
        return !!(o && !o.hasAttribute("hidden") && o.offsetParent !== null)
      }).catch(() => false)
      if (overlayOk) break
      await sleep(100)
    }
    const tGearToOverlay = Date.now() - t3start
    if (!overlayOk) {
      result.rounds.push({ what: `R${round} 帮助浮层未出现`, ms: -1, url: page.url() })
      break
    }
    // 点「返回主菜单」按钮
    await realTap(page, "#backToMenu")
    let confirmOk = false
    for (let k = 0; k < 60; k++) {
      confirmOk = await page.evaluate(() => !!document.getElementById("back-confirm-cn-backdrop")).catch(() => false)
      if (confirmOk) break
      await sleep(100)
    }
    const tGearToConfirm = Date.now() - t3start
    if (!confirmOk) {
      result.rounds.push({ what: `R${round} 确认弹窗未出现`, ms: -1, url: page.url() })
      break
    }
    // 点弹窗里的「返回主菜单」
    const tClickExit = Date.now()
    await realTap(page, "#back-confirm-cn-backdrop .bcbtn.danger")
    let navOk = false
    for (let k = 0; k < 300; k++) {
      navOk = await page.evaluate(() => location.pathname.includes("menu.html")).catch(() => false)
      if (navOk) break
      await sleep(50)
    }
    const tClickToNav = Date.now() - tClickExit
    if (!navOk) {
      result.rounds.push({ what: `R${round} 退出未导航回菜单`, ms: -1, url: page.url() })
      break
    }
    const tNavToReady = await menuReady(page, 30000)
    const t3 = Date.now() - t3start
    result.rounds.push({
      what: `R${round} 退出→菜单首帧`, ms: t3,
      齿轮到浮层: tGearToOverlay,
      齿轮到确认弹窗: tGearToConfirm,
      点击到URL跳转: tClickToNav,
      URL跳转到菜单就绪: tNavToReady,
      ...(await collectMetrics(page)),
    })
  }
  result.errs = errs
  await page.close()
  return result
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true })
  const bases = [
    { base: `http://127.0.0.1:${PORT_A}`, label: "v1.5.0", dir: "8150" },
    { base: `http://127.0.0.1:${PORT_B}`, label: "v1.5.1", dir: "8151" },
  ]
  const all = []
  for (const b of bases) {
    console.log(`\n════════ ${b.label} (${b.base}) ════════`)
    const browser = await newBrowser(b.dir)
    const r = await runOne(b.base, b.label, browser)
    await browser.close()
    for (const x of r.rounds) {
      const extra = `domInt=${x.domInteractive ?? "-"} heap=${x.heapMB ?? "-"}MB canvas=${x.canvases ?? "-"} hist=${x.historyLen ?? "-"}`
      console.log(`   ${x.what.padEnd(26)} ${String(x.ms).padStart(6)}ms   ${extra}`)
    }
    console.log(`   页面错误: ${r.errs.length ? JSON.stringify(r.errs.slice(0, 3)) : "无"}`)
    all.push(r)
  }

  console.log("\n════════ 对照汇总 ════════")
  const rows = ["T1 冷启动进菜单首帧", "R1 开始游戏→场景就绪", "R1 退出→菜单首帧", "R2 开始游戏→场景就绪", "R2 退出→菜单首帧"]
  for (const w of rows) {
    const a = all[0].rounds.find((x) => x.what === w)
    const b = all[1].rounds.find((x) => x.what === w)
    if (!a || !b) continue
    const d = (b.ms >= 0 && a.ms >= 0) ? b.ms - a.ms : NaN
    const flag = isNaN(d) ? "" : (d > 400 ? "  ⚠ 变慢" : (d < -400 ? "  ✓ 变快" : "  ≈ 持平"))
    console.log(`   ${w.padEnd(26)} v1.5.0=${String(a.ms).padStart(6)}ms  v1.5.1=${String(b.ms).padStart(6)}ms  差 ${isNaN(d) ? "- " : (d > 0 ? "+" : "") + d}ms${flag}`)
  }
  fs.writeFileSync(OUT + "/lag-ab.json", JSON.stringify(all, null, 2))
  console.log(`\n   明细: ${OUT}/lag-ab.json`)
}

main().catch((e) => { console.error("探针异常:", e); process.exit(2) })
