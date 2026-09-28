/**
 * v1.4.7 卡顿复现 + 逐段耗时探针。
 *
 * 精确复现用户报告路径（冷启动后）：
 *   开始游戏 → 进 play → 齿轮 → 返回主菜单(弹窗) → 回 menu
 * 反复 N 次，测量**每一次**「进入游戏」与「退出游戏」的端到端耗时（ms），
 * 观察是否逐步变慢 —— 这是判断「累积型泄漏」还是「每次固定开销」的关键。
 *
 * 判据：
 *   - 若耗时逐轮显著递增 → 累积型（资源没释放 / 内存增长）
 *   - 若每轮都差不多 → 固定开销（初始化本身就是重活）
 * 另记录每轮的 canvas 数量，辅助判断 renderer 是否残留。
 */
const puppeteer = require("puppeteer-core")

const DIST = "/workspace/dev/source/billiards-cn/dist"
const LOOPS = parseInt(process.env.LOOPS || "5", 10)
const SETTLE = parseInt(process.env.SETTLE || "1500", 10) // 进游戏后停留，让渲染跑一会儿

async function newBrowser() {
  return puppeteer.launch({
    executablePath: "/usr/bin/google-chrome",
    headless: "new",
    args: [
      "--no-sandbox", "--hide-scrollbars",
      "--disable-dev-shm-usage", "--no-zygote", "--ozone-platform=headless",
      "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader",
      "--user-data-dir=" + (process.env.CHROME_DIR || "/tmp/chrome-timing147"),
      "--in-process-gpu", "--disable-gpu-sandbox",
      "--allow-file-access-from-files", "--window-size=393,851",
    ],
    env: { ...process.env, DISPLAY: "" },
  })
}

async function realTap(page, sel, label) {
  await page.touchscreen.touchStart(5, 5)
  await page.touchscreen.touchEnd()
  await new Promise((r) => setTimeout(r, 60))
  const el = await page.$(sel)
  if (!el) return { ok: false, why: `${sel} 不存在`, label }
  const box = await el.boundingBox()
  if (!box) return { ok: false, why: `${sel} 无 boundingBox`, label }
  await page.touchscreen.touchStart(box.x + box.width / 2, box.y + box.height / 2)
  await page.touchscreen.touchEnd()
  return { ok: true, label }
}

async function sceneReady(page) {
  for (let k = 0; k < 80; k++) {
    const st = await page.evaluate(() => {
      const c = document.querySelector("#viewP1 canvas")
      const l = document.getElementById("view3dLoading")
      return {
        canvasOk: !!(c && c.width > 0 && c.offsetHeight > 0),
        loadingHidden: !l || getComputedStyle(l).display === "none",
      }
    }).catch(() => ({ canvasOk: false, loadingHidden: false }))
    if (st.canvasOk && st.loadingHidden) return true
    await new Promise((r) => setTimeout(r, 200))
  }
  return false
}

async function menuReady(page) {
  for (let k = 0; k < 80; k++) {
    const ok = await page.evaluate(() => {
      const e = document.getElementById("btnStart")
      if (!e) return false
      const r = e.getBoundingClientRect()
      return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== "hidden"
    }).catch(() => false)
    if (ok) return true
    await new Promise((r) => setTimeout(r, 200))
  }
  return false
}

async function diag(page) {
  return page.evaluate(() => ({
    canvas: document.querySelectorAll("canvas").length,
    path: location.pathname.split("/").pop(),
    heapMB: performance.memory
      ? Math.round(performance.memory.usedJSHeapSize / 1048576)
      : null,
  })).catch(() => ({ canvas: -1, path: "?", heapMB: null }))
}

async function main() {
  const browser = await newBrowser()
  const page = await browser.newPage()
  await page.setViewport({ width: 393, height: 851, hasTouch: true, isMobile: true, deviceScaleFactor: 2 })
  const errs = []
  page.on("pageerror", (e) => errs.push("[pageerror] " + e.message))
  page.on("console", (m) => {
    if (m.type() === "error" && !/wave\.jpg|Failed to load resource/.test(m.text())) {
      errs.push("[console] " + m.text())
    }
  })

  await page.goto(`file://${DIST}/menu.html`, { waitUntil: "load", timeout: 120000 })
  await menuReady(page)
  await new Promise((r) => setTimeout(r, 800))

  const rows = []
  for (let i = 1; i <= LOOPS; i++) {
    // ---------- 进入游戏 ----------
    const t0 = Date.now()
    const a1 = await realTap(page, "#btnStart", `L${i} 开始游戏`)
    let inPlay = false
    try {
      await page.waitForFunction(() => location.pathname.includes("play.html"), { timeout: 10000 })
      inPlay = true
    } catch {}
    const tNav = Date.now() - t0
    const ready = inPlay ? await sceneReady(page) : false
    const tEnter = Date.now() - t0
    const dPlay = await diag(page)

    if (!ready) {
      console.log(`第${i}次: 进入失败（sceneReady 超时）导航=${tNav}ms`)
      rows.push({ i, tEnter: -1, tExit: -1 })
      break
    }

    await new Promise((r) => setTimeout(r, SETTLE))

    // ---------- 退出游戏 ----------
    const t1 = Date.now()
    await realTap(page, "#menu", `L${i} 齿轮`)
    try {
      await page.waitForFunction(() => {
        const o = document.getElementById("helpOverlay")
        return o && !o.hasAttribute("hidden") && o.offsetParent !== null
      }, { timeout: 5000 })
    } catch {}
    await realTap(page, "#backToMenu", `L${i} 返回主菜单按钮`)
    try {
      await page.waitForFunction(() => !!document.getElementById("back-confirm-cn-backdrop"), { timeout: 5000 })
    } catch {}
    // 对照实验开关：DISABLE_TEARDOWN=1 时把释放钩子替换为空函数，
    // 用于确认「点击→跳转」的耗时是否由 __onExitToMenu（renderer.dispose）造成。
    if (process.env.DISABLE_TEARDOWN === "1") {
      await page.evaluate(() => { window.__onExitToMenu = () => {} })
    }
    // 细分：点击「返回主菜单」→ URL 跳转（这段同步执行 __onExitToMenu / dispose）
    const tClickExit = Date.now()
    await realTap(page, "#back-confirm-cn-backdrop .bcbtn.danger", `L${i} 弹窗返回主菜单`)
    let navOk = false
    try {
      await page.waitForFunction(() => location.pathname.includes("menu.html"), { timeout: 15000 })
      navOk = true
    } catch {}
    const tUrlChanged = Date.now()
    const backOk = navOk ? await menuReady(page) : false
    const tMenuReady = Date.now()
    const tExit = Date.now() - t1
    // 点击 → URL 跳转：含同步 dispose，这一段若很大说明 dispose 阻塞了主线程
    const tClickToNav = tUrlChanged - tClickExit
    // URL 跳转 → 菜单就绪：menu.html 加载 + 初始化（含球杆 3D 预览）
    const tMenuInit = tMenuReady - tUrlChanged
    const dMenu = await diag(page)

    rows.push({
      i,
      tEnter,
      tNav,
      tInit: tEnter - tNav,
      tExit,
      canvasPlay: dPlay.canvas,
      canvasMenu: dMenu.canvas,
      heapMB: dMenu.heapMB,
      backOk,
    })
    console.log(
      `第${i}次: 进入=${tEnter}ms(导航${tNav}+初始化${tEnter - tNav}) | ` +
      `退出=${tExit}ms [点击→跳转 ${tClickToNav} + 菜单初始化 ${tMenuInit}] ` +
      `| canvas: play=${dPlay.canvas} menu=${dMenu.canvas} | 堆=${dMenu.heapMB}MB | 回菜单=${backOk ? "✓" : "✗"}`
    )
    await new Promise((r) => setTimeout(r, 400))
  }

  console.log("\n" + "-".repeat(72))
  const okRows = rows.filter((r) => r.tEnter > 0 && r.tExit > 0)
  if (okRows.length >= 2) {
    const f = okRows[0]
    const l = okRows[okRows.length - 1]
    console.log(`进入耗时: 首轮 ${f.tEnter}ms → 末轮 ${l.tEnter}ms  (×${(l.tEnter / f.tEnter).toFixed(2)})`)
    console.log(`退出耗时: 首轮 ${f.tExit}ms → 末轮 ${l.tExit}ms  (×${(l.tExit / f.tExit).toFixed(2)})`)
  }
  console.log("页面错误:", errs.length ? errs.slice(0, 5) : "无")
  await browser.close()
  process.exit(0)
}

main().catch((e) => { console.error(e); process.exit(2) })
