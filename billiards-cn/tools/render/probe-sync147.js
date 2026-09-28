/**
 * v1.4.7 真实阻塞测量探针（绕开 puppeteer 轮询延迟）。
 *
 * 为什么需要它：headless 用 swiftshader **软件渲染** 3D，play 页面渲染循环占满 CPU，
 * 导致 page.waitForFunction（默认 raf 轮询）的检测被推迟数秒 —— 上一版探针量到的
 * 「点击→跳转 4.3s」很可能是**测量假象**，不是真实卡顿。
 *
 * 本探针改为**全部在页面内计时**：
 *   - evaluateOnNewDocument 给每个新文档注入打点脚本
 *   - 用页面内 rAF 自检就绪（不依赖 puppeteer 轮询）
 *   - 通过 console.log("MARK ...") 实时上报，由 Node 侧收集配对
 * 输出三类耗时：
 *   进入端到端 = PLAY_READY - MENU_CLICK
 *   退出端到端 = MENU_READY  - EXIT_CLICK
 *   退出同步阻塞 = CLICK_TO_UNLOAD（点击退出按钮 → beforeunload，这段是主线程被同步占住的时间）
 */
const puppeteer = require("puppeteer-core")

const DIST = "/workspace/dev/source/billiards-cn/dist"
const LOOPS = parseInt(process.env.LOOPS || "4", 10)
const SETTLE = parseInt(process.env.SETTLE || "1500", 10)

async function newBrowser() {
  return puppeteer.launch({
    executablePath: "/usr/bin/google-chrome",
    headless: "new",
    args: [
      "--no-sandbox", "--hide-scrollbars",
      "--disable-dev-shm-usage", "--no-zygote", "--ozone-platform=headless",
      "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader",
      "--user-data-dir=" + (process.env.CHROME_DIR || "/tmp/chrome-sync147"),
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

async function main() {
  const browser = await newBrowser()
  const page = await browser.newPage()
  await page.setViewport({ width: 393, height: 851, hasTouch: true, isMobile: true, deviceScaleFactor: 2 })

  const marks = []
  const errs = []
  page.on("console", (m) => {
    const t = m.text()
    if (t.startsWith("MARK ")) {
      const p = t.split(" ")
      marks.push({ name: p[1], at: parseInt(p[2], 10), extra: p[3] ? parseInt(p[3], 10) : null })
    } else if (m.type() === "error" && !/wave\.jpg|Failed to load resource/.test(t)) {
      errs.push("[console] " + t)
    }
  })
  page.on("pageerror", (e) => errs.push("[pageerror] " + e.message))

  // 每个新文档注入页面内打点
  await page.evaluateOnNewDocument(() => {
    const isPlay = () => location.pathname.indexOf("play.html") >= 0
    const isMenu = () => location.pathname.indexOf("menu.html") >= 0
    const mark = (name, extra) =>
      console.log("MARK " + name + " " + Date.now() + (extra != null ? " " + extra : ""))

    // 捕获阶段记录点击时刻（在任何业务 handler 之前）
    document.addEventListener("click", (e) => {
      const t = e.target
      if (!t || !t.closest) return
      if (isMenu() && t.closest("#btnStart")) mark("MENU_CLICK")
      if (isPlay() && t.closest("#back-confirm-cn-backdrop .bcbtn.danger")) {
        window.__exitClickAt = performance.now()
        mark("EXIT_CLICK")
      }
    }, true)

    // beforeunload：距退出点击多久 => 主线程被同步占住的时长
    window.addEventListener("beforeunload", () => {
      if (window.__exitClickAt != null) {
        mark("CLICK_TO_UNLOAD", Math.round(performance.now() - window.__exitClickAt))
        window.__exitClickAt = null
      }
    })

    // 页面内 rAF 自检就绪
    const selfCheck = (cond, name) => {
      let done = false
      const tick = () => {
        if (done) return
        let ok = false
        try { ok = cond() } catch (e) { ok = false }
        if (ok) { done = true; mark(name) } else requestAnimationFrame(tick)
      }
      requestAnimationFrame(tick)
    }
    if (isPlay()) {
      selfCheck(() => {
        const c = document.querySelector("#viewP1 canvas")
        const l = document.getElementById("view3dLoading")
        return !!(c && c.width > 0 && c.offsetHeight > 0) &&
          (!l || getComputedStyle(l).display === "none")
      }, "PLAY_READY")
    }
    if (isMenu()) {
      selfCheck(() => {
        const e = document.getElementById("btnStart")
        const r = e && e.getBoundingClientRect()
        return !!(e && r && r.width > 0 && r.height > 0)
      }, "MENU_READY")
    }
  })

  await page.goto(`file://${DIST}/menu.html`, { waitUntil: "load", timeout: 120000 })
  await new Promise((r) => setTimeout(r, 1200))

  const rows = []
  for (let i = 1; i <= LOOPS; i++) {
    marks.length = 0

    // ---------- 进入 ----------
    await realTap(page, "#btnStart", `L${i} 开始游戏`)
    // 等 PLAY_READY 出现（页面内自报）
    for (let k = 0; k < 100 && !marks.some((m) => m.name === "PLAY_READY"); k++) {
      await new Promise((r) => setTimeout(r, 100))
    }
    await new Promise((r) => setTimeout(r, SETTLE))

    // ---------- 退出 ----------
    await realTap(page, "#menu", `L${i} 齿轮`)
    for (let k = 0; k < 60; k++) {
      const shown = await page.evaluate(() => {
        const o = document.getElementById("helpOverlay")
        return !!(o && !o.hasAttribute("hidden") && o.offsetParent !== null)
      }).catch(() => false)
      if (shown) break
      await new Promise((r) => setTimeout(r, 100))
    }
    await realTap(page, "#backToMenu", `L${i} 返回主菜单按钮`)
    for (let k = 0; k < 60; k++) {
      const shown = await page.evaluate(() => !!document.getElementById("back-confirm-cn-backdrop")).catch(() => false)
      if (shown) break
      await new Promise((r) => setTimeout(r, 100))
    }
    await realTap(page, "#back-confirm-cn-backdrop .bcbtn.danger", `L${i} 弹窗返回主菜单`)
    for (let k = 0; k < 120 && !marks.some((m) => m.name === "MENU_READY"); k++) {
      await new Promise((r) => setTimeout(r, 100))
    }

    const get = (n) => marks.find((m) => m.name === n)
    const mc = get("MENU_CLICK"), pr = get("PLAY_READY")
    const ec = get("EXIT_CLICK"), mr = get("MENU_READY"), cu = get("CLICK_TO_UNLOAD")
    const tEnter = mc && pr ? pr.at - mc.at : -1
    const tExit = ec && mr ? mr.at - ec.at : -1
    const tBlock = cu ? cu.extra : -1
    rows.push({ i, tEnter, tExit, tBlock })
    console.log(
      `第${i}次: 进入=${tEnter}ms | 退出=${tExit}ms | 退出同步阻塞=${tBlock}ms`
    )
    await new Promise((r) => setTimeout(r, 400))
  }

  console.log("\n" + "-".repeat(66))
  const ok = rows.filter((r) => r.tEnter > 0 && r.tExit > 0)
  if (ok.length >= 2) {
    console.log(`进入: ${ok[0].tEnter}ms → ${ok[ok.length - 1].tEnter}ms`)
    console.log(`退出: ${ok[0].tExit}ms → ${ok[ok.length - 1].tExit}ms`)
    const b = rows.map((r) => r.tBlock).filter((x) => x >= 0)
    if (b.length) console.log(`退出同步阻塞(点击→unload): ${b.join(" / ")} ms`)
  }
  console.log("页面错误:", errs.length ? errs.slice(0, 5) : "无")
  await browser.close()
  process.exit(0)
}

main().catch((e) => { console.error(e); process.exit(2) })
