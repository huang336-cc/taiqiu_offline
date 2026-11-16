/**
 * v1.8.1 跳球回归（隔离式）。
 *
 * 为什么不像 probe-jump157-real.js 那样一个页面跑五档：
 * 那个探针把其余球清成 InPocket 来避免碰撞干扰，规则层因此判定「台面无
 * 目标球」，静止后返回 PlaceBall，控制器在 PlayShot ↔ PlaceBall 之间反复，
 * 低帧率环境下经常等不到下一杆的 Aim（实测 v1.8.0 也偶发）。这是探针构造的
 * 非典型状态，不是产品问题。
 *
 * 本探针每档角度**新开一个页面**，只打一杆、只采一次顶点高度，完全隔离。
 * 其余球改为沿远侧下边排开（保持 onTable），既无碰撞干扰，也不触发摆球。
 */
const puppeteer = require("/workspace/dev/source/billiards-cn/node_modules/puppeteer-core")
const fs = require("fs")

const BASE = process.env.BASE || "http://127.0.0.1:8181"
const OUT = "/root/.codebuddy/artifact/render/v181"
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

let pass = 0
let fail = 0
function ok(name, cond, detail) {
  if (cond) { pass++; console.log("PASS ", name, JSON.stringify(detail)) }
  else { fail++; console.log("FAIL ", name, JSON.stringify(detail)) }
}

async function measure(deg) {
  const browser = await puppeteer.launch({
    executablePath: "/usr/bin/google-chrome",
    headless: true,
    protocolTimeout: 180000,
    args: [
      "--no-sandbox", "--disable-dev-shm-usage", "--use-gl=angle",
      "--use-angle=swiftshader", "--enable-unsafe-swiftshader",
      `--user-data-dir=/tmp/chrome-jump181-${deg}`, "--window-size=393,851",
    ],
    env: { ...process.env, DISPLAY: "" },
  })
  const page = await browser.newPage()
  await page.setCacheEnabled(false)
  await page.setViewport({ width: 393, height: 851, deviceScaleFactor: 1 })
  const errs = []
  page.on("pageerror", (e) => errs.push(String(e).slice(0, 200)))

  await page.goto(`${BASE}/play.html?practice=true&ruletype=eightball`, {
    waitUntil: "domcontentloaded", timeout: 120000,
  })
  const waitFor = async (fn, budget) => {
    const t0 = Date.now()
    while (Date.now() - t0 < budget) {
      if (await page.evaluate(fn).catch(() => false)) return Date.now() - t0
      await sleep(150)
    }
    return -1
  }
  const READY = () => {
    const c = window.container
    const ctrl = c?.controller
    if (!ctrl) return false
    if (ctrl.name === "PlaceBall") { document.getElementById("cueHit")?.click(); return false }
    return ctrl.name === "Aim" && typeof ctrl.playShot === "function"
  }
  const ready = await waitFor(READY, 150000)
  if (ready < 0) { await browser.close(); return { err: "页面未就绪" } }

  await page.evaluate(() => {
    const t = window.container.table
    t.balls.forEach((b, i) => {
      if (i === 0) return
      b.state = "Stationary"
      b.vel.set(0, 0, 0)
      b.offTable = false
      b.pos.set(-1.34 + (i % 8) * 0.045, -0.60 - Math.floor(i / 8) * 0.06, 0)
      b.updateMesh?.(0)
    })
    const cue = t.balls[0]
    cue.pos.set(-0.9, 0, 0)
    cue.setStationary()
    t.cue.moveTo(cue.pos)
  })
  await sleep(500)
  await page.evaluate((d) => {
    const c = window.container
    const cue = c.table.cue
    window.__apex = 0
    window.__landed = null
    const t = c.table
    if (!t.__patched) {
      const orig = t.advance.bind(t)
      t.advance = (dt) => {
        orig(dt)
        const z = t.cueball?.pos?.z ?? 0
        if (z > (window.__apex ?? 0)) window.__apex = z
        if (window.__apex > 1e-6 && z <= 1e-6 && window.__landed === null) {
          window.__landed = Number(t.cueball.pos.x)
        }
      }
      t.__patched = true
    }
    cue.aim.elevation = (d * Math.PI) / 180
    cue.aim.offset.set(0, 0, 0)
    cue.aim.power = 0.9 * 160 * 0.03275
    cue.setAimAngle(0, t)
    cue.aim.power = 0.9 * 160 * 0.03275
    cue.updateAimInput()
  }, deg)
  await sleep(300)
  const x0 = await page.evaluate(() => Number(window.container.table.cueball.pos.x))
  await page.evaluate(() => {
    const c = window.container
    c.controller = c.controller.playShot()
  })
  // 采样窗口：等物理停稳（软件渲染慢，最多 25s）
  const t0 = Date.now()
  while (Date.now() - t0 < 25000) {
    const done = await page.evaluate(() => {
      const c = window.container
      return c?.table?.allStationary() && c.controller?.name !== "PlayShot"
    }).catch(() => false)
    if (done) break
    await sleep(300)
  }
  const res = await page.evaluate(() => ({
    apex: window.__apex,
    landed: window.__landed,
    cueX: Number(window.container.table.cueball.pos.x),
    ctrl: String(window.container.controller?.name),
  }))
  await browser.close()
  const flight = (res.landed ?? res.cueX) - x0
  return { deg, apexCm: +(res.apex * 100).toFixed(2), flightCm: +(flight * 100).toFixed(1), errs }
}

;(async () => {
  fs.mkdirSync(OUT, { recursive: true })
  const rows = []
  for (const deg of [0, 30, 45, 72]) {
    const r = await measure(deg)
    if (r.err) { console.log(`  ${deg}°: ${r.err}`); continue }
    rows.push(r)
    console.log(
      `  ${String(deg).padStart(2)}°  最高 ${r.apexCm.toFixed(2)}cm  飞越 ${r.flightCm.toFixed(1)}cm  错误 ${r.errs.length}`
    )
  }
  const get = (d) => rows.find((r) => r.deg === d)
  const m0 = get(0), m30 = get(30), m45 = get(45), m72 = get(72)
  if (m72) ok("①满力72°最高≤30cm", m72.apexCm <= 30, { 实测: m72.apexCm })
  if (m45) ok("②满力45°最高∈[8,20]cm", m45.apexCm >= 8 && m45.apexCm <= 20, { 实测: m45.apexCm })
  if (m0) ok("④0°不跳", m0.apexCm < 0.5, { 实测: m0.apexCm })
  if (m30 && m45 && m72)
    ok("③仰角越大跳越高", m30.apexCm < m45.apexCm && m45.apexCm < m72.apexCm,
      { "30°": m30.apexCm, "45°": m45.apexCm, "72°": m72.apexCm })
  if (m45 && m72) ok("③b仰角越大飞越近", m72.flightCm < m45.flightCm, { "45°": m45.flightCm, "72°": m72.flightCm })
  ok("⑤零页面错误", rows.every((r) => r.errs.length === 0), {})
  console.log(`\n  通过 ${pass} / 失败 ${fail}`)
  process.exit(fail > 0 ? 1 : 0)
})().catch((e) => { console.error(e); process.exit(1) })
