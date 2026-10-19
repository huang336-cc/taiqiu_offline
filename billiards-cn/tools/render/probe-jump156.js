/**
 * v1.5.6（#78）取证探针 —— 跳球落地前后速度对比。
 *
 * 构造：抬杆角拉满 + 大力，让白球腾空；高频采样白球状态序列，
 * 找出 Airborne → 落地 的转折帧，比较落地前/后的水平速度。
 *
 * 断言（修复目标）：
 *   J1 白球确实腾空（出现 Airborne 状态）
 *   J2 落地后水平速度 < 落地前水平速度（当前实现：相等，即失败）
 */
const puppeteer = require("puppeteer-core")
const fs = require("fs")
const OUT = "/tmp/v156-jump"
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
async function launch() {
  return puppeteer.launch({
    executablePath: "/usr/bin/google-chrome",
    headless: true,
    protocolTimeout: 45000,
    args: [
      "--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu",
      "--user-data-dir=/tmp/chrome-jump156", "--window-size=393,851",
    ],
    env: { ...process.env, DISPLAY: "" },
  })
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true })
  const browser = await launch()
  const page = await browser.newPage()
  await page.setCacheEnabled(false)
  await page.setViewport({ width: 393, height: 851, deviceScaleFactor: 1 })
  const errs = []
  page.on("pageerror", (e) => errs.push(String(e).slice(0, 160)))
  const ok = (n, p, d) => console.log(`${p ? "PASS" : "FAIL"}  ${n}  ${JSON.stringify(d).slice(0, 260)}`)

  console.log("[1] 进 9球人机对战…")
  await page.goto(`${BASE}/play.html?bot=ClawBreak`, { waitUntil: "domcontentloaded", timeout: 120000 })
  await waitFor(page, () => {
    const c = document.querySelector("#viewP1 canvas")
    const l = document.getElementById("view3dLoading")
    return !!(c && c.width > 0) && (!l || getComputedStyle(l).display === "none")
  }, 90000)
  await sleep(1500)
  const ready = await waitFor(page, () => {
    const c = window.container
    const cue = c && c.table && c.table.cue
    if (!c || !cue || !cue.aimInputs) return false
    const ack = document.querySelector('[data-tut-ack="1"]')
    if (ack) { ack.click(); return false }
    const n = c.controller && c.controller.name
    if (n === "PlaceBall") { document.getElementById("cueHit")?.click(); return false }
    return !cue.aimInputs.isDisabled()
  }, 150000)
  if (ready < 0) throw new Error("瞄准未就绪")
  console.log("瞄准就绪")

  // 高频采样器：记录白球状态序列（每 4ms）
  await page.evaluate(() => {
    window.__samples = []
    const c = window.container
    window.__timer = setInterval(() => {
      const b = c.table.cueball // 白球（table.cue 是球杆）
      if (!b || !b.pos) return
      window.__samples.push({
        st: b.state,
        z: +b.pos.z.toFixed(4),
        vx: +b.vel.x.toFixed(4),
        vy: +b.vel.y.toFixed(4),
        vz: +b.vel.z.toFixed(4),
        t: +Number(c.table.time).toFixed(1),
      })
    }, 4)
  })

  console.log("[2] 抬杆 + 大力打跳球…")
  await page.evaluate(() => {
    const c = window.container
    const cue = c.table.cue
    cue.setAimAngle(0.0, c.table)
    cue.setElevation(45) // 抬杆角拉高制造跳球
    cue.setPower(0.9)
    c.controller = c.controller.playShot()
  })
  await sleep(6000)
  const samples = await page.evaluate(() => {
    clearInterval(window.__timer)
    return window.__samples
  })
  console.log("采样数:", samples.length)

  // 找 Airborne 段与其落地转折
  const airIdx = samples.map((s, i) => (s.st === "Airborne" ? i : -1)).filter((i) => i >= 0)
  const airborne = airIdx.length > 0
  let landing = null
  if (airborne) {
    const last = airIdx[airIdx.length - 1]
    const before = samples[last]
    const after = samples[last + 1] || samples[last + 2]
    const hv = (s) => Math.hypot(s.vx, s.vy)
    landing = {
      落地前: { st: before.st, z: before.z, 水平速度: +hv(before).toFixed(4), vz: before.vz },
      落地后: after ? { st: after.st, z: after.z, 水平速度: +hv(after).toFixed(4), vz: after.vz } : null,
      空中帧数: airIdx.length,
      最高点: +Math.max(...airIdx.map((i) => samples[i].z)).toFixed(4),
    }
  }
  const speeds = samples.map((s) => +Math.hypot(s.vx, s.vy).toFixed(3))
  console.log("水平速度序列(抽样):", JSON.stringify(speeds.filter((_, i) => i % 8 === 0).slice(0, 30)))
  ok("J1_白球腾空", airborne, { 空中采样帧: airIdx.length, 最高z: landing && landing.最高点 })
  if (landing && landing.落地后) {
    const v1 = landing.落地前.水平速度
    const v2 = landing.落地后.水平速度
    ok("J2_落地后速度衰减", v2 < v1 * 0.999, landing)
  } else {
    console.log("跳过 J2（未捕获落地帧）", JSON.stringify(landing))
  }
  ok("J3_零页面错误", errs.length === 0, { errs: errs.slice(0, 3) })
  await browser.close()
}
main().catch((e) => { console.error("FATAL", e); process.exit(1) })
