/**
 * #71 J1 诊断探针：为什么 headless 下白球悬空后物理冻结、控制器 383ms 就换了。
 *
 * 出杆后每 500ms 采集：
 *   ctrl          当前控制器名
 *   st/off/x/z    白球状态
 *   stat          table.allStationary()
 *   raf           rAF 心跳计数增量（animate 是否还活着）
 *   q             inputQueue 长度
 *   oc            outcome 数量
 */
const puppeteer = require("puppeteer-core")
const fs = require("fs")
const OUT = "/tmp/v154-t71d"
const BASE = process.env.BASE || "http://127.0.0.1:8160/dist"
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function waitFor(page, fn, budget) {
  const t0 = Date.now()
  while (Date.now() - t0 < budget) {
    if (await page.evaluate(fn).catch(() => false)) return Date.now() - t0
    await sleep(60)
  }
  return -1
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true })
  const browser = await puppeteer.launch({
    executablePath: "/usr/bin/google-chrome",
    headless: "new",
    args: [
      "--no-sandbox", "--hide-scrollbars", "--disable-dev-shm-usage", "--no-zygote",
      "--ozone-platform=headless", "--use-gl=angle", "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader", "--user-data-dir=/tmp/chrome-t71d",
      "--in-process-gpu", "--disable-gpu-sandbox", "--window-size=393,851",
    ],
    env: { ...process.env, DISPLAY: "" },
  })
  const page = await browser.newPage()
  await page.setCacheEnabled(false)
  await page.setViewport({ width: 393, height: 851, deviceScaleFactor: 2 })
  await page.evaluateOnNewDocument(() => {
    try { localStorage.setItem("billiards_cn_seenGuide_v1", "1") } catch (e) {}
    // rAF 心跳：animate 每帧都会经过 requestAnimationFrame 调度
    window.__rafCount = 0
    const orig = window.requestAnimationFrame.bind(window)
    window.requestAnimationFrame = (cb) => orig((t) => { window.__rafCount++; cb(t) })
  })
  const errs = []
  page.on("pageerror", (e) => errs.push("pageerror: " + String(e).slice(0, 300)))
  page.on("console", (m) => {
    const t = m.text()
    if (/error|exception|Depth/i.test(t)) errs.push("console: " + t.slice(0, 300))
  })

  await page.goto(`${BASE}/menu.html`, { waitUntil: "domcontentloaded", timeout: 120000 })
  await waitFor(page, () => {
    const e = document.getElementById("btnStart")
    return !!e && e.getBoundingClientRect().width > 0
  }, 60000)
  await sleep(800)
  await page.evaluate(() => document.getElementById("btnStart")?.click())
  await waitFor(page, () => {
    const c = document.querySelector("#viewP1 canvas")
    const l = document.getElementById("view3dLoading")
    return !!(c && c.width > 0) && (!l || getComputedStyle(l).display === "none")
  }, 90000)
  await sleep(2000)
  await waitFor(page, () => {
    const c = window.container
    const cue = c && c.table && c.table.cue
    return !!(cue && cue.aimInputs && !cue.aimInputs.isDisabled())
  }, 150000)
  if ((await page.evaluate(() => window.container.controller?.name)) === "PlaceBall") {
    await page.evaluate(() => document.getElementById("cueHit")?.click())
    if ((await waitFor(page, () => window.container.controller?.name === "Aim", 30000)) < 0) {
      throw new Error("放球后未进入瞄准")
    }
  }
  await sleep(600)

  // 打点：朝最近库边扎杆 + 大力（playShot 前必须重设力度，cueHit 已覆盖过一次）
  const setup = await page.evaluate(() => {
    const c = window.container
    const cue = c.table.cue
    const cb = c.table.cueball
    const TX = 1.02, TY = 0.51
    const cands = [
      { x: TX, y: cb.pos.y }, { x: -TX, y: cb.pos.y },
      { x: cb.pos.x, y: TY }, { x: cb.pos.x, y: -TY },
    ]
    let best = cands[0], bd = Infinity
    for (const p of cands) {
      const d = Math.hypot(p.x - cb.pos.x, p.y - cb.pos.y)
      if (d < bd) { bd = d; best = p }
    }
    cue.setAimAngle(Math.atan2(best.y - cb.pos.y, best.x - cb.pos.x), c.table)
    cue.setElevation(0.9)
    cue.setPower(0.95)
    return {
      ctrlBefore: c.controller.name,
      angle: +cue.aim.angle.toFixed(3),
      power: +cue.aim.power.toFixed(3),
      elev: +cue.aim.elevation.toFixed(3),
      pos: { x: +cb.pos.x.toFixed(3), y: +cb.pos.y.toFixed(3) },
    }
  })
  console.log("出杆前:", JSON.stringify(setup))

  await page.evaluate(() => {
    const c = window.container
    c.controller = c.controller.playShot()
  })

  // 每 500ms 采一次全局状态，连续 24s
  const trace = []
  for (let i = 0; i < 48; i++) {
    const s = await page.evaluate(() => {
      const c = window.container
      const cb = c.table.cueball
      return {
        ctrl: c.controller?.name,
        st: cb.state,
        off: !!cb.offTable,
        x: +cb.pos.x.toFixed(3),
        y: +cb.pos.y.toFixed(3),
        z: +cb.pos.z.toFixed(3),
        vx: +cb.vel.x.toFixed(2),
        vz: +cb.vel.z.toFixed(2),
        stat: c.table.allStationary(),
        q: c.inputQueue.length,
        oc: c.table.outcome.length,
        raf: window.__rafCount,
      }
    }).catch(() => null)
    if (s) trace.push({ t: i * 0.5, ...s })
    await sleep(500)
  }
  // 打印关键转折：ctrl / st / raf 变化的时刻
  let prev = ""
  for (const s of trace) {
    const key = `${s.ctrl}|${s.st}|${s.stat}`
    if (key !== prev) {
      console.log(`t=${s.t}s  ctrl=${s.ctrl}  st=${s.st}  stat=${s.stat}  off=${s.off}  pos=(${s.x},${s.y},${s.z})  vel=(${s.vx},${s.vz})  q=${s.q}  oc=${s.oc}  raf=${s.raf}`)
      prev = key
    }
  }
  console.log("末帧 raf 增量:", trace[trace.length-1].raf - trace[trace.length-6]?.raf, "(最后2.5s)")
  console.log("页面错误:", JSON.stringify(errs.slice(0, 5)))
  fs.writeFileSync(`${OUT}/trace.json`, JSON.stringify(trace, null, 2))
  await browser.close()
}

main().catch((e) => { console.error("FATAL", e); process.exit(1) })
