/**
 * v1.4.7 累积检测探针：跨页面全局资源是否逐轮增长。
 *
 * 上一版已证明 headless 下「进入/退出耗时不递增」且 dispose 同步阻塞仅 1~73ms，
 * 即复现不出真机卡顿。真机与 headless 的关键差异在于 **bfcache / 内存**：
 * 整页导航离开后旧文档若被保留（persisted），其 three.js 场景、纹理、JS 堆
 * 都不释放，反复进出就会累积，最终表现为「几次之后开始卡」。
 *
 * 本探针用 CDP Performance.getMetrics 采集**全局**计数（不受当前页面限制）：
 *   Documents —— 文档数，若逐轮 +1 且不回落 => 旧页面被 bfcache 保留（累积实锤）
 *   Nodes     —— DOM 节点总数
 *   JSHeapUsedSize —— JS 堆
 * 并用 Emulation.setCPUThrottlingRate 降速 CPU 模拟中低端安卓机（放大卡顿）。
 */
const puppeteer = require("puppeteer-core")

const DIST = "/workspace/dev/source/billiards-cn/dist"
const LOOPS = parseInt(process.env.LOOPS || "4", 10)
const SETTLE = parseInt(process.env.SETTLE || "1200", 10)
const THROTTLE = parseInt(process.env.THROTTLE || "1", 10)

async function newBrowser() {
  return puppeteer.launch({
    executablePath: "/usr/bin/google-chrome",
    headless: "new",
    args: [
      "--no-sandbox", "--hide-scrollbars",
      "--disable-dev-shm-usage", "--no-zygote", "--ozone-platform=headless",
      "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader",
      "--user-data-dir=" + (process.env.CHROME_DIR || "/tmp/chrome-mem147"),
      "--in-process-gpu", "--disable-gpu-sandbox",
      "--allow-file-access-from-files", "--window-size=393,851",
    ],
    env: { ...process.env, DISPLAY: "" },
  })
}

async function realTap(page, sel) {
  await page.touchscreen.touchStart(5, 5)
  await page.touchscreen.touchEnd()
  await new Promise((r) => setTimeout(r, 60))
  const el = await page.$(sel)
  if (!el) return false
  const box = await el.boundingBox()
  if (!box) return false
  await page.touchscreen.touchStart(box.x + box.width / 2, box.y + box.height / 2)
  await page.touchscreen.touchEnd()
  return true
}

async function waitFor(page, fn, tries = 80) {
  for (let k = 0; k < tries; k++) {
    const ok = await page.evaluate(fn).catch(() => false)
    if (ok) return true
    await new Promise((r) => setTimeout(r, 100))
  }
  return false
}

async function main() {
  const browser = await newBrowser()
  const page = await browser.newPage()
  await page.setViewport({ width: 393, height: 851, hasTouch: true, isMobile: true, deviceScaleFactor: 2 })
  const client = await page.createCDPSession()
  await client.send("Performance.enable")
  if (THROTTLE > 1) {
    await client.send("Emulation.setCPUThrottlingRate", { rate: THROTTLE })
    console.log(`[设置] CPU 节流 ×${THROTTLE}（模拟中低端安卓机）`)
  }

  const pick = async () => {
    const { metrics } = await client.send("Performance.getMetrics")
    const m = {}
    for (const x of metrics) m[x.name] = x.value
    return {
      Documents: m.Documents,
      Nodes: m.Nodes,
      JSHeapMB: m.JSHeapUsedSize ? +(m.JSHeapUsedSize / 1048576).toFixed(1) : null,
      Listeners: m.JSEventListeners,
    }
  }

  const errs = []
  page.on("pageerror", (e) => errs.push("[pageerror] " + e.message))

  await page.goto(`file://${DIST}/menu.html`, { waitUntil: "load", timeout: 120000 })
  await waitFor(page, () => !!document.getElementById("btnStart"))
  await new Promise((r) => setTimeout(r, 1000))

  console.log("基线      :", JSON.stringify(await pick()))
  const rows = []
  for (let i = 1; i <= LOOPS; i++) {
    // 进入
    const t0 = Date.now()
    await realTap(page, "#btnStart")
    const inPlay = await waitFor(page, () => location.pathname.indexOf("play.html") >= 0)
    const ready = inPlay
      ? await waitFor(page, () => {
          const c = document.querySelector("#viewP1 canvas")
          const l = document.getElementById("view3dLoading")
          return !!(c && c.width > 0 && c.offsetHeight > 0) &&
            (!l || getComputedStyle(l).display === "none")
        }, 150)
      : false
    const tEnter = Date.now() - t0
    await new Promise((r) => setTimeout(r, SETTLE))

    // 退出
    const t1 = Date.now()
    await realTap(page, "#menu")
    await waitFor(page, () => {
      const o = document.getElementById("helpOverlay")
      return !!(o && !o.hasAttribute("hidden") && o.offsetParent !== null)
    })
    await realTap(page, "#backToMenu")
    await waitFor(page, () => !!document.getElementById("back-confirm-cn-backdrop"))
    await realTap(page, "#back-confirm-cn-backdrop .bcbtn.danger")
    const backOk = await waitFor(page, () => location.pathname.indexOf("menu.html") >= 0 &&
      !!document.getElementById("btnStart"), 150)
    const tExit = Date.now() - t1

    const m = await pick()
    rows.push({ i, tEnter, tExit, ...m, backOk })
    console.log(`第${i}次: 进入=${tEnter}ms 退出=${tExit}ms | Documents=${m.Documents} Nodes=${m.Nodes} JS堆=${m.JSHeapMB}MB 监听器=${m.Listeners}`)
    await new Promise((r) => setTimeout(r, 400))
  }

  console.log("\n" + "-".repeat(70))
  const f = rows[0], l = rows[rows.length - 1]
  console.log(`Documents: ${f.Documents} → ${l.Documents}  ${l.Documents > f.Documents ? "⚠ 累积（旧文档被保留）" : "✓ 未累积"}`)
  console.log(`Nodes    : ${f.Nodes} → ${l.Nodes}  ${l.Nodes > f.Nodes ? "⚠ 累积" : "✓ 未累积"}`)
  console.log(`JS堆     : ${f.JSHeapMB}MB → ${l.JSHeapMB}MB`)
  console.log(`进入耗时 : ${f.tEnter}ms → ${l.tEnter}ms`)
  console.log(`退出耗时 : ${f.tExit}ms → ${l.tExit}ms`)
  console.log("页面错误:", errs.length ? errs.slice(0, 5) : "无")
  await browser.close()
  process.exit(0)
}

main().catch((e) => { console.error(e); process.exit(2) })
