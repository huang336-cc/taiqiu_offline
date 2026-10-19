/**
 * v1.5.7（#86）跳球物理实机测量。
 *
 * 上一版（#78）的探针用 setElevation(45) —— 那是 **45 弧度**，而 UI 的抬杆
 * 滑条 clamp 到 2π/5 = 72°（1.2566 rad），单位是弧度。构造本身就错，测出来的
 * apex 1.0263 m 不代表真实玩法。本探针一律用**弧度**，覆盖真实可达的抬杆角。
 *
 * 测什么（每个仰角一组）：
 *   起跳垂直速度 vz0、水平初速 vh0、最高点 h、滞空时间 T、水平飞行距离 d、
 *   落地后水平速度 vh1、落地损失比例
 *
 * 真实台球跳球参考（职业/爱好者实测）：
 *   跳起高度 5~20 cm；飞行（越过障碍）水平距离 20~60 cm；落地后仍能走位。
 *
 * 理论对照（纯抛体，无空气阻力）：
 *   h = vz0²/(2g)；T = 2·vz0/g；d = vh0·T   （g = 9.8）
 */
const puppeteer = require("puppeteer-core")
const fs = require("fs")
const OUT = "/tmp/v157-jump"
const BASE = process.env.BASE || "http://127.0.0.1:8160/dev/source/billiards-cn/dist"
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function waitFor(page, fn, budget = 60000, every = 200) {
  const t0 = Date.now()
  while (Date.now() - t0 < budget) {
    if (await page.evaluate(fn).catch(() => false)) return Date.now() - t0
    await sleep(every)
  }
  return -1
}
async function launch() {
  return puppeteer.launch({
    executablePath: "/usr/bin/google-chrome",
    headless: true,
    protocolTimeout: 120000,
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu",
      "--user-data-dir=/tmp/chrome-jump157", "--window-size=393,851"],
    env: { ...process.env, DISPLAY: "" },
  })
}

/** 在页面里跑一次「白球独跑」的跳球测量，返回轨迹指标 */
const RUN_JUMP = (elevRad, powerFrac) => {
  const c = window.container
  const t = c.table
  const b = t.cueball
  // 其他球全部设为进袋：不参与碰撞、不干扰，白球独跑
  t.balls.forEach((x) => {
    if (x === b) return
    x.state = "InPocket"
    x.vel.set(0, 0, 0)
    x.rvel.set(0, 0, 0)
  })
  // 白球放到台面左侧空旷处，朝 +x 打
  b.pos.set(-1.05, 0, 0)
  b.vel.set(0, 0, 0)
  b.rvel.set(0, 0, 0)
  b.state = "Stationary"
  b.pocket = undefined
  t.cue.aim.angle = 0
  t.cue.aim.offset.set(0, 0, 0)
  t.cue.aim.elevation = elevRad
  t.cue.aim.power = powerFrac * (160 * 0.03275)
  t.time = 0
  t.hit()

  const step = c.step || 0.001953125
  const s = []
  let guard = 0
  let landed = -1
  let hitRail = false
  while (guard++ < 200000) {
    const st = b.state
    s.push({
      z: b.pos.z, vz: b.vel.z,
      vx: b.vel.x, vy: b.vel.y,
      x: b.pos.x, y: b.pos.y, st,
    })
    t.advance(step)
    if (landed < 0 && s.length > 1 && s[s.length - 1].z <= 0 && s[s.length - 2].z > 0) {
      landed = s.length - 1
    }
    if (landed >= 0 && guard > landed + 3) break
    if (Math.abs(b.pos.x) > 1.2) { hitRail = true }
    if (b.state === "InPocket") break
  }
  const vh = (p) => Math.hypot(p.vx, p.vy)
  const airIdx = s.map((p, i) => (p.z > 1e-6 ? i : -1)).filter((i) => i >= 0)
  if (airIdx.length === 0 || landed < 0) {
    return { elevRad, deg: Math.round((elevRad * 180) / Math.PI), airborne: false, frames: s.length }
  }
  const first = airIdx[0]
  const apexIdx = airIdx.reduce((m, i) => (s[i].z > s[m].z ? i : m), airIdx[0])
  const before = s[landed - 1]
  const after = s[landed]
  const vz0 = s[first].vz
  const vh0 = vh(s[first])
  const T = (landed - first) * step * 1000
  return {
    deg: Math.round((elevRad * 180) / Math.PI),
    elevRad: +elevRad.toFixed(3),
    airborne: true,
    vz0: +vz0.toFixed(3),
    vh0: +vh0.toFixed(3),
    apex_m: +s[apexIdx].z.toFixed(4),
    apex_cm: +((s[apexIdx].z - 0.03275) * 100).toFixed(1), // 球底离台高度（扣掉半径）
    T_ms: +T.toFixed(1),
    flight_m: +Math.abs(s[landed].x - s[first].x).toFixed(3),
    flight_cm: +(Math.abs(s[landed].x - s[first].x) * 100).toFixed(1),
    vh_before_land: +vh(before).toFixed(3),
    vh_after_land: +vh(after).toFixed(3),
    landLoss: +(1 - vh(after) / vh(before)).toFixed(3),
    // 理论（纯抛体）
    theory_apex_m: +((vz0 * vz0) / (2 * 9.8)).toFixed(4),
    theory_T_ms: +((2 * vz0) / 9.8 * 1000).toFixed(1),
    hitRail,
  }
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true })
  const browser = await launch()
  const page = await browser.newPage()
  await page.setCacheEnabled(false)
  await page.setViewport({ width: 393, height: 851, deviceScaleFactor: 1 })
  const errs = []
  page.on("pageerror", (e) => errs.push(String(e).slice(0, 200)))

  console.log("[1] 进 9球人机对战…")
  await page.goto(`${BASE}/play.html?bot=ClawBreak`, { waitUntil: "domcontentloaded", timeout: 120000 })
  await waitFor(page, () => {
    const c = document.querySelector("#viewP1 canvas")
    const l = document.getElementById("view3dLoading")
    return !!(c && c.width > 0) && (!l || getComputedStyle(l).display === "none")
  }, 90000)
  await waitFor(page, () => {
    const c = window.container
    const cue = c && c.table && c.table.cue
    if (!cue || !cue.aimInputs) return false
    const ack = document.querySelector('[data-tut-ack="1"]')
    if (ack) { ack.click(); return false }
    if (c.controller?.name === "PlaceBall") { document.getElementById("cueHit")?.click(); return false }
    return !cue.aimInputs.isDisabled()
  }, 150000)
  await sleep(1200)

  console.log("[2] 逐仰角测量（power=0.9 → 4.716 m/s）…")
  const angles = [0, 0.15, 0.3, 0.52, 0.79, 1.05, 1.2566] // 0° 9° 17° 30° 45° 60° 72°
  const rows = []
  for (const a of angles) {
    const r = await page.evaluate(RUN_JUMP, a, 0.9)
    rows.push(r)
    console.log("  " + JSON.stringify(r))
  }
  console.log("\n[3] 汇总表")
  console.log("  角度    vz0     vh0    最高(cm)  滞空(ms)  飞行(cm)  落地损失  (球底离台)")
  for (const r of rows) {
    if (!r.airborne) { console.log(`  ${String(r.deg).padStart(3)}°   未离台`); continue }
    console.log(
      `  ${String(r.deg).padStart(3)}°  ${String(r.vz0).padStart(6)}  ${String(r.vh0).padStart(6)}  ` +
      `${String(r.apex_cm).padStart(7)}  ${String(r.T_ms).padStart(8)}  ${String(r.flight_cm).padStart(8)}  ` +
      `${String(r.landLoss).padStart(8)}`
    )
  }
  console.log("\n  真实跳球参考：最高 5~20 cm，飞行 20~60 cm")
  console.log("[4] pageerror:", JSON.stringify(errs.slice(0, 3)))
  await browser.close()
}
main().catch((e) => { console.error("FATAL", e && e.message); process.exit(1) })
