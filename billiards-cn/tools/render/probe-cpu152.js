/**
 * v1.5.2 卡顿 —— **CPU 6x 降速下的 A/B 分段对照**（与 v1.5.0 发布说明同一口径）。
 *
 * 背景：
 *   · v1.5.0 发布说明称「返回主菜单首帧 4.1s → 1.6~2.2s」，口径是 CDP CPU 6x 降速。
 *   · 本轮无降速实测：v1.5.0 退出 R1=3866ms / R2=2293ms，v1.5.1 R1=4488ms / R2=2194ms。
 *   · 分段显示 menu.html 首屏只占 1~39ms（v1.5.0 的履历抽离确实生效），
 *     __onExitToMenu 仅 0.4ms，主线程最大阻塞 101ms —— 时间不在 JS 里。
 *
 * 本探针在 **CPU 6x 降速** 下重测同一路径，并把「开始游戏」也纳入
 * （用户同时报告了「开始游戏卡顿」，而这条路径此前从未被优化过）。
 *
 * 测量：
 *   T1 冷启动 → 菜单首帧
 *   T2 开始游戏 → 场景就绪（细分：点击→URL变play / URL变→场景就绪）
 *   T3 退出 → 菜单首帧（细分：点击→beforeunload→pagehide→URL变menu→菜单就绪）
 */
const puppeteer = require("puppeteer-core")
const fs = require("fs")
const OUT = "/tmp/v152"
const RATE = parseInt(process.env.RATE || "6", 10)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function launch(dir) {
  return puppeteer.launch({
    executablePath: "/usr/bin/google-chrome",
    headless: "new",
    args: [
      "--no-sandbox", "--hide-scrollbars", "--disable-dev-shm-usage", "--no-zygote",
      "--ozone-platform=headless", "--use-gl=angle", "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader", `--user-data-dir=/tmp/chrome-cpu-${dir}`,
      "--in-process-gpu", "--disable-gpu-sandbox", "--window-size=393,851",
    ],
    env: { ...process.env, DISPLAY: "" },
  })
}

async function realTap(page, sel) {
  const el = await page.$(sel)
  if (!el) return false
  await el.evaluate((e) => { try { e.scrollIntoView({ block: "center" }) } catch (err) {} })
  await sleep(60)
  const box = await el.boundingBox()
  if (!box) return false
  await page.touchscreen.touchStart(box.x + box.width / 2, box.y + box.height / 2)
  await page.touchscreen.touchEnd()
  return true
}

async function waitFor(page, fn, budget) {
  const t0 = Date.now()
  while (Date.now() - t0 < budget) {
    if (await page.evaluate(fn).catch(() => false)) return Date.now() - t0
    await sleep(40)
  }
  return -1
}

const menuReadyFn = () => {
  const e = document.getElementById("btnStart")
  if (!e) return false
  const r = e.getBoundingClientRect()
  return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== "hidden"
}
const sceneReadyFn = () => {
  const c = document.querySelector("#viewP1 canvas")
  const l = document.getElementById("view3dLoading")
  return !!(c && c.width > 0 && c.offsetHeight > 0) && (!l || getComputedStyle(l).display === "none")
}

async function run(base, label, dir, rounds) {
  const browser = await launch(dir)
  const page = await browser.newPage()
  await page.setCacheEnabled(false)
  const client = await page.createCDPSession()
  await client.send("Emulation.setCPUThrottlingRate", { rate: RATE })
  const errs = []
  page.on("pageerror", (e) => errs.push(String(e).slice(0, 100)))
  const out = { label, rows: [], errs }

  // T1 冷启动进菜单
  await page.goto(`${base}/menu.html`, { waitUntil: "domcontentloaded", timeout: 120000 })
  const t1 = await waitFor(page, menuReadyFn, 60000)
  out.rows.push({ what: "T1 冷启动→菜单首帧", ms: t1 })
  await sleep(1200)

  for (let i = 1; i <= rounds; i++) {
    // --- T2 开始游戏 ---
    const t2a = Date.now()
    await page.evaluate(() => { const b = document.getElementById("btnStart"); if (b) b.click() })
    const toPlay = await waitFor(page, () => location.pathname.includes("play.html"), 40000)
    const tScene = await waitFor(page, sceneReadyFn, 60000)
    out.rows.push({ what: `R${i} 开始游戏→场景就绪`, ms: Date.now() - t2a, 导航: toPlay, 场景: tScene })
    await sleep(1500)

    // --- T3 退出 ---
    await realTap(page, "#menu")
    await waitFor(page, () => {
      const o = document.getElementById("helpOverlay")
      return !!(o && !o.hasAttribute("hidden") && o.offsetParent !== null)
    }, 20000)
    await realTap(page, "#backToMenu")
    await waitFor(page, () => !!document.getElementById("back-confirm-cn-backdrop"), 20000)

    // 注册卸载事件打点
    await page.evaluate(() => {
      window.__mk = {}
      window.addEventListener("beforeunload", () => { window.__mk.bu = performance.now() })
      window.addEventListener("pagehide", () => { window.__mk.ph = performance.now() })
    })
    const t3a = Date.now()
    await page.evaluate(() => { window.__mk.click = performance.now() })
    await realTap(page, "#back-confirm-cn-backdrop .bcbtn.danger")
    const toMenuUrl = await waitFor(page, () => location.pathname.includes("menu.html"), 60000)
    const tReady = await waitFor(page, menuReadyFn, 60000)
    const total = Date.now() - t3a
    const mk = await page.evaluate(() => window.__mk || {}).catch(() => ({}))
    out.rows.push({
      what: `R${i} 退出→菜单首帧`, ms: total,
      到URL变menu: toMenuUrl, URL变到就绪: tReady,
      点击到beforeunload: mk.click && mk.bu ? Math.round(mk.bu - mk.click) : -1,
      beforeunload到pagehide: mk.bu && mk.ph ? Math.round(mk.ph - mk.bu) : -1,
    })
    await sleep(1000)
  }
  await browser.close()
  return out
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true })
  const rounds = parseInt(process.env.ROUNDS || "2", 10)
  const targets = [
    { base: "http://127.0.0.1:8150/dist", label: "v1.5.0", dir: "8150" },
    { base: "http://127.0.0.1:8151/dist", label: "v1.5.1", dir: "8151" },
  ]
  console.log(`CPU 降速倍率: ${RATE}x   轮次: ${rounds}\n`)
  const all = []
  for (const t of targets) {
    console.log(`════════ ${t.label} ════════`)
    const r = await run(t.base, t.label, t.dir, rounds)
    for (const x of r.rows) {
      const kv = Object.keys(x).filter((k) => !["what", "ms"].includes(k)).map((k) => `${k}=${x[k]}`)
      console.log(`   ${x.what.padEnd(24)} ${String(x.ms).padStart(6)}ms   ${kv.join("  ")}`)
    }
    console.log(`   页面错误: ${r.errs.length ? JSON.stringify(r.errs.slice(0, 2)) : "无"}\n`)
    all.push(r)
  }
  console.log("════════ 对照 ════════")
  for (const w of ["T1 冷启动→菜单首帧", "R1 开始游戏→场景就绪", "R1 退出→菜单首帧", "R2 开始游戏→场景就绪", "R2 退出→菜单首帧"]) {
    const a = all[0].rows.find((x) => x.what === w), b = all[1].rows.find((x) => x.what === w)
    if (!a || !b) continue
    const d = b.ms - a.ms
    const flag = d > 500 ? " ⚠ v1.5.1 变慢" : d < -500 ? " ✓ v1.5.1 变快" : " ≈ 持平"
    console.log(`   ${w.padEnd(24)} v1.5.0=${String(a.ms).padStart(6)}ms  v1.5.1=${String(b.ms).padStart(6)}ms  差 ${d > 0 ? "+" : ""}${d}ms${flag}`)
  }
  fs.writeFileSync(`${OUT}/cpu${RATE}-ab.json`, JSON.stringify(all, null, 2))
  console.log(`\n明细: ${OUT}/cpu${RATE}-ab.json`)
}

main().catch((e) => { console.error("探针异常:", e); process.exit(2) })
