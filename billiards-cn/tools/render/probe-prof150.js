/**
 * v1.5.0：用 CDP 采样分析器定位 menu.html 启动的 JS 热点（self time top）。
 * 目的：找出「返回主菜单首屏 3 秒」到底花在哪些函数上，避免继续凭猜测优化。
 * 用法：THROTTLE=6 node probe-prof150.js
 */
const puppeteer = require("puppeteer-core")
const DIST = "/workspace/dev/source/billiards-cn/dist"
const THROTTLE = parseInt(process.env.THROTTLE || "6", 10)

async function main() {
  const browser = await puppeteer.launch({
    executablePath: "/usr/bin/google-chrome",
    headless: "new",
    args: [
      "--no-sandbox", "--hide-scrollbars", "--disable-dev-shm-usage", "--no-zygote",
      "--ozone-platform=headless", "--use-gl=angle", "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader", "--user-data-dir=/tmp/chrome-prof150",
      "--in-process-gpu", "--disable-gpu-sandbox", "--allow-file-access-from-files",
      "--window-size=393,851",
    ],
    env: { ...process.env, DISPLAY: "" },
  })
  const page = await browser.newPage()
  await page.setViewport({ width: 393, height: 851, hasTouch: true, isMobile: true, deviceScaleFactor: 2 })
  const client = await page.target().createCDPSession()
  await client.send("Emulation.setCPUThrottlingRate", { rate: THROTTLE })
  await client.send("Profiler.enable")
  await client.send("Profiler.setSamplingInterval", { interval: 200 })

  await client.send("Profiler.start")
  await page.goto(`file://${DIST}/menu.html`, { waitUntil: "load", timeout: 300000 })
  await new Promise((r) => setTimeout(r, 6000))
  const { profile } = await client.send("Profiler.stop")

  // 统计 self time
  const byId = new Map()
  profile.nodes.forEach((n) => byId.set(n.id, n))
  const self = new Map()
  const total = profile.samples.length
  profile.samples.forEach((id) => self.set(id, (self.get(id) || 0) + 1))
  const rows = [...self.entries()].map(([id, c]) => {
    const n = byId.get(id)
    if (!n) return null
    const f = n.callFrame
    const name = (f.functionName || "(anonymous)") + "  @" + (f.url || "").split("/").pop() + ":" + (f.lineNumber + 1)
    return { name, pct: (c / total) * 100, ms: (c / total) * (profile.endTime - profile.startTime) / 1000 }
  }).filter(Boolean).sort((a, b) => b.pct - a.pct)

  console.log(`\n=== menu.html 启动 CPU 热点（CPU 降速 ${THROTTLE}x，采样 ${total} 个）===`)
  console.log(`总采样时长 ≈ ${((profile.endTime - profile.startTime) / 1000).toFixed(0)} ms\n`)
  rows.slice(0, 22).forEach((r, i) => {
    console.log(`${String(i + 1).padStart(2)}. ${r.pct.toFixed(1).padStart(5)}%  ${r.ms.toFixed(0).padStart(5)}ms  ${r.name}`)
  })

  // 聚合：程序自身脚本 vs 浏览器内部
  const agg = {}
  rows.forEach((r) => {
    const k = r.name.includes("@") ? r.name.split("@")[1].split(":")[0] : "?"
    agg[k] = (agg[k] || 0) + r.pct
  })
  console.log(`\n--- 按文件聚合 ---`)
  Object.entries(agg).sort((a, b) => b[1] - a[1]).slice(0, 10).forEach(([k, v]) => console.log(`  ${k}: ${v.toFixed(1)}%`))

  await browser.close()
  process.exit(0)
}
main().catch((e) => { console.error(e); process.exit(2) })
