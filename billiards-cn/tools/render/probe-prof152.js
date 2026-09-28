/**
 * v1.5.2 —— 「开始游戏」3148ms 长任务的 **CPU Profiler 取证**。
 *
 * 已知（probe-enter152，CPU 6x 降速）：
 *   开始游戏 4845ms；资源加载都很小（最大 126ms）；
 *   长任务 8 个累计 4027ms，其中 **一个 3148ms 的长任务起于 1315ms**（load 之后），占 78%。
 *
 * 本探针用 CDP Profiler 抓取该时段的调用栈，按「自身耗时(self)」排出热点函数，
 * 直接回答：这 3 秒到底在执行什么代码。
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
      "--enable-unsafe-swiftshader", "--user-data-dir=/tmp/chrome-prof152",
      "--in-process-gpu", "--disable-gpu-sandbox", "--window-size=393,851",
    ],
    env: { ...process.env, DISPLAY: "" },
  })
  const page = await browser.newPage()
  await page.setCacheEnabled(false)
  const client = await page.createCDPSession()
  await client.send("Emulation.setCPUThrottlingRate", { rate: RATE })

  await page.goto(`${BASE}/menu.html`, { waitUntil: "domcontentloaded", timeout: 120000 })
  await sleep(2000)

  // 开始采样
  await client.send("Profiler.enable")
  await client.send("Profiler.setSamplingInterval", { interval: 200 })
  await client.send("Profiler.start")
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
  await sleep(300)
  const { profile } = await client.send("Profiler.stop")

  // 分析：按 self time 聚合
  const byId = new Map()
  for (const n of profile.nodes) byId.set(n.id, n)
  const self = new Map()
  const total = profile.samples.length
  const dt = (profile.endTime - profile.startTime) / 1000 / total // ms per sample
  for (const s of profile.samples) {
    const n = byId.get(s)
    if (!n) continue
    const f = n.callFrame
    const key = `${f.functionName || "(anonymous)"}  @${(f.url || "").split("/").pop().slice(0, 40)}:${f.lineNumber}`
    self.set(key, (self.get(key) || 0) + 1)
  }
  const rows = [...self.entries()]
    .map(([k, c]) => ({ k, ms: Math.round(c * dt), pct: (c / total) * 100 }))
    .sort((a, b) => b.ms - a.ms)

  console.log(`\n════════ ${LABEL} 开始游戏 CPU Profile（${RATE}x 降速）════════`)
  console.log(`  端到端 ${tScene}ms   采样 ${total} 个，覆盖 ${Math.round((profile.endTime - profile.startTime) / 1000)}ms`)
  console.log(`\n  ── 自身耗时 Top 25（self time）──`)
  for (const r of rows.slice(0, 25)) {
    console.log(`     ${String(r.ms).padStart(6)}ms  ${r.pct.toFixed(1).padStart(5)}%  ${r.k}`)
  }

  // 按文件聚合
  const byFile = new Map()
  for (const r of rows) {
    const m = r.k.match(/@([^:]+)/)
    const f = m ? m[1] : "(native)"
    byFile.set(f, (byFile.get(f) || 0) + r.ms)
  }
  console.log(`\n  ── 按文件聚合 ──`)
  for (const [f, ms] of [...byFile.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)) {
    console.log(`     ${String(ms).padStart(6)}ms  ${f}`)
  }

  fs.writeFileSync(`${OUT}/prof-${LABEL}-${RATE}x.json`, JSON.stringify({ label: LABEL, tScene, rows, byFile: [...byFile] }, null, 2))
  console.log(`\n  明细: ${OUT}/prof-${LABEL}-${RATE}x.json`)
  await browser.close()
}

main().catch((e) => { console.error("探针异常:", e); process.exit(2) })
