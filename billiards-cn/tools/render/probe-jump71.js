/**
 * #71 取证探针 —— 跳球「白球弹出后马上有另一个白球放在库边」。
 *
 * 假设：白球跳起（Airborne）飞越库边 → table.checkOffTable 瞬间把 pos 夹回
 *      库线内侧、z 归零、停球 → 渲染层白球 mesh 瞬移到库边 —— 用户眼中
 *      「凭空出现另一个白球放在库边」。
 *
 * 方法：扎杆大力朝最近库边打，每帧采样白球 (x,y,z)/state/offTable/速度，
 *      同时采样 cue.mesh 与 cue.placerMesh 的可见性，找出单帧大跳变。
 */
const puppeteer = require("puppeteer-core")
const fs = require("fs")
const OUT = "/tmp/v154-t71"
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
      "--enable-unsafe-swiftshader", "--user-data-dir=/tmp/chrome-t71",
      "--in-process-gpu", "--disable-gpu-sandbox", "--window-size=393,851",
    ],
    env: { ...process.env, DISPLAY: "" },
  })
  const page = await browser.newPage()
  await page.setCacheEnabled(false)
  await page.setViewport({ width: 393, height: 851, deviceScaleFactor: 2 })
  await page.evaluateOnNewDocument(() => {
    try { localStorage.setItem("billiards_cn_seenGuide_v1", "1") } catch (e) {}
  })
  const errs = []
  page.on("pageerror", (e) => errs.push("pageerror: " + String(e).slice(0, 200)))

  const R = {}
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

  // 等开局（PlaceBall 摆球 → 点摆球 → Aim）
  await waitFor(page, () => {
    const c = window.container
    const cue = c && c.table && c.table.cue
    return !!(cue && cue.aimInputs && !cue.aimInputs.isDisabled())
  }, 150000)
  const c0 = await page.evaluate(() => window.container.controller?.name)
  if (c0 === "PlaceBall") {
    await page.evaluate(() => document.getElementById("cueHit")?.click())
    await waitFor(page, () => {
      const c = window.container
      return !!(c.controller?.name === "Aim" && !c.table.cue.aimInputs.isDisabled())
    }, 30000)
  }
  await sleep(600)

  // 读白球与杆的状态
  const sample = () =>
    page.evaluate(() => {
      const c = window.container
      const cue = c.table.cue
      const cb = c.table.cueball
      return {
        x: +cb.pos.x.toFixed(3),
        y: +cb.pos.y.toFixed(3),
        z: +cb.pos.z.toFixed(3),
        st: cb.state,
        off: cb.offTable,
        air: cb.wasAirborne,
        cueVisible: cue.mesh ? cue.mesh.visible : null,
        placerVisible: cue.placerMesh ? cue.placerMesh.visible : null,
        ctrl: c.controller?.name,
      }
    })

  // 朝白球最近的库边打扎杆（大力+陡仰角）
  const setup = await page.evaluate(() => {
    const c = window.container
    const cue = c.table.cue
    const cb = c.table.cueball
    // 找最近的库边方向
    const TX = 1.02 // 大致 tableX（八球台），取更近的一边即可
    const TY = 0.51
    const cands = [
      { x: TX, y: cb.pos.y },
      { x: -TX, y: cb.pos.y },
      { x: cb.pos.x, y: TY },
      { x: cb.pos.x, y: -TY },
    ]
    let best = cands[0]
    let bd = Infinity
    for (const p of cands) {
      const d = Math.hypot(p.x - cb.pos.x, p.y - cb.pos.y)
      if (d < bd) { bd = d; best = p }
    }
    const angle = Math.atan2(best.y - cb.pos.y, best.x - cb.pos.x)
    cue.setAimAngle(angle, c.table)
    cue.setElevation(0.9)
    cue.setPower(0.95)
    return {
      aimAngle: +angle.toFixed(3),
      elev: cue.aim.elevation,
      power: +cue.aim.power.toFixed(2),
      ballPos: { x: +cb.pos.x.toFixed(3), y: +cb.pos.y.toFixed(3) },
      distToRail: +bd.toFixed(3),
    }
  })
  R.setup = setup
  await page.screenshot({ path: `${OUT}/before.png` })

  // 出杆 + 高频采样（页面内 rAF 循环采样，不受 CDP 往返限制）
  await page.evaluate(() => {
    window.__jumpSamples = []
    const cb = window.container.table.cueball
    const cue = window.container.table.cue
    const push = () => {
      window.__jumpSamples.push({
        t: performance.now(),
        x: +cb.pos.x.toFixed(4),
        y: +cb.pos.y.toFixed(4),
        z: +cb.pos.z.toFixed(4),
        st: cb.state,
        off: cb.offTable,
        air: cb.wasAirborne,
        cv: cue.mesh ? cue.mesh.visible : null,
        pv: cue.placerMesh ? cue.placerMesh.visible : null,
      })
      if (window.__jumpSampling) requestAnimationFrame(push)
    }
    window.__jumpSampling = true
    requestAnimationFrame(push)
  })
  await page.evaluate(() => document.getElementById("cueHit")?.click())
  // 等一杆结束（进入规则结算 + AI/下一控制器），最多 30s
  await waitFor(page, () => {
    const c = window.container
    return c.controller?.name !== "PlayShot" && c.controller?.name !== "Replay"
  }, 30000)
  await sleep(1500)
  await page.evaluate(() => { window.__jumpSampling = false })

  const samples = await page.evaluate(() => window.__jumpSamples)
  R.sampleCount = samples.length

  // 找单帧大跳变（>0.15m 的 x/y 瞬移 或 z 从 >0.05 直接归零）
  const jumps = []
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1]
    const b = samples[i]
    const dxy = Math.hypot(b.x - a.x, b.y - a.y)
    if (dxy > 0.15 || (a.z > 0.05 && b.z === 0 && a.state !== undefined && a.st !== b.st)) {
      jumps.push({ i, dt: +(b.t - a.t).toFixed(1), from: { x: a.x, y: a.y, z: a.z, st: a.st }, to: { x: b.x, y: b.y, z: b.z, st: b.st }, dxy: +dxy.toFixed(3) })
    }
  }
  R.jumps = jumps

  // 白球最高点与最终位置
  const maxZ = Math.max(...samples.map((s) => s.z))
  const last = samples[samples.length - 1]
  R.maxZ = +maxZ.toFixed(3)
  R.last = last
  // offTable 事件时刻
  const offIdx = samples.findIndex((s) => s.off)
  R.offTableAt = offIdx >= 0 ? { sample: offIdx, pos: { x: samples[offIdx].x, y: samples[offIdx].y, z: samples[offIdx].z } } : null
  // placerMesh 是否出现过
  R.placerAppeared = samples.some((s) => s.pv === true)
  await page.screenshot({ path: `${OUT}/after.png` })

  fs.writeFileSync(`${OUT}/result.json`, JSON.stringify(R, null, 2))
  console.log(JSON.stringify({ ...R, samples: undefined }, null, 2))
  fs.writeFileSync(`${OUT}/samples.json`, JSON.stringify(samples))
  await browser.close()
}

main().catch((e) => {
  console.error("FATAL", e)
  process.exit(1)
})
