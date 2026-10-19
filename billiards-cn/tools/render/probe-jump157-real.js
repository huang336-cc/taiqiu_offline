/**
 * v1.5.7（#86）跳球**浏览器实机**验证。
 *
 * 无头 harness（tools/harness/jump157.ts）已经把物理层标定到真实区间，但
 * 用户要求的是「实机测试验证」—— 必须在真实页面里真的打一杆跳球，量白球
 * 离台面的最大高度，而不是只在 Node 里跑物理。
 *
 * 做法：进自由练习 → 把其余球挪开 → 设定抬杆角（**弧度**）与力度 → 真出杆 →
 * 在 rAF 里持续采样 cueball.pos.z 的峰值。
 *
 * 判据（真实跳球：越过一颗球即可，高度 5~20cm）：
 *   ① 满力 72° 最高点 ≤ 30cm（修复前实测 99.4cm —— 飞一米高）
 *   ② 满力 45° 最高点 ∈ [8, 20]cm
 *   ③ 仰角越大跳得越高、飞得越近
 *   ④ 0° 不跳
 */
const puppeteer = require("puppeteer-core")
const fs = require("fs")
const OUT = "/tmp/v157-jump"
const BASE = process.env.BASE || "http://127.0.0.1:8181"
const R = 0.03275
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

let pass = 0
let fail = 0
function ok(name, cond, detail) {
  if (cond) {
    pass++
    console.log(`PASS  ${name}  ${detail ? JSON.stringify(detail) : ""}`)
  } else {
    fail++
    console.log(`FAIL  ${name}  ${detail ? JSON.stringify(detail) : ""}`)
  }
}

async function waitFor(page, fn, budget = 120000, every = 150) {
  const t0 = Date.now()
  while (Date.now() - t0 < budget) {
    if (await page.evaluate(fn).catch(() => false)) return Date.now() - t0
    await sleep(every)
  }
  return -1
}

const READY = () => {
  const c = window.container
  const ctrl = c?.controller
  if (!ctrl) return false
  if (ctrl.name === "PlaceBall") {
    document.getElementById("cueHit")?.click()
    return false
  }
  return ctrl.name === "Aim" && typeof ctrl.playShot === "function"
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true })
  const browser = await puppeteer.launch({
    executablePath: "/usr/bin/google-chrome",
    headless: true,
    protocolTimeout: 120000,
    args: [
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--use-gl=angle",
      "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader",
      "--user-data-dir=/tmp/chrome-jump157",
      "--window-size=393,851",
    ],
    env: { ...process.env, DISPLAY: "" },
  })
  const page = await browser.newPage()
  await page.setCacheEnabled(false)
  await page.setViewport({ width: 393, height: 851, deviceScaleFactor: 1 })
  const errs = []
  page.on("pageerror", (e) => errs.push(String(e).slice(0, 300)))

  console.log("[1] 进自由练习…")
  await page.goto(`${BASE}/play.html?practice=true&ruletype=eightball`, {
    waitUntil: "domcontentloaded",
    timeout: 120000,
  })
  const ready = await waitFor(page, READY, 150000)
  console.log(`    就绪 ${ready}ms`)
  if (ready < 0) throw new Error("页面未就绪")

  const rows = []
  for (const deg of [0, 30, 45, 60, 72]) {
    // 等回到可出杆状态（上一杆出杆后控制器会走 PlayShot → 静止 → Aim）
    const back = await waitFor(page, READY, 120000)
    if (back < 0) {
      console.log(`  ${deg}°: 等不到可出杆状态，跳过`)
      continue
    }
    // 每杆前把台面恢复：其余球挪到边角，白球摆到台面左侧空地
    const okSetup = await page.evaluate(() => {
      const c = window.container
      const t = c.table
      const balls = t.balls
      const X = 1.408
      const Y = 0.704
      balls.forEach((b, i) => {
        if (i === 0) return
        // 清场：其余球全部标记「已落袋」，白球独跑 —— 否则跳起来会撞到别的
        // 球、落点被反弹搅乱（实测 45° 落点 -28cm 就是撞球弹回造成的假象）。
        b.state = "InPocket"
      })
      const cue = balls[0]
      cue.pos.set(-0.9, 0, 0)
      cue.setStationary()
      t.cue.moveTo(cue.pos)
      return !!cue
    })
    if (!okSetup) {
      console.log(`  ${deg}°: 摆球失败`)
      continue
    }

    // 装采样器 + 设定抬杆角（弧度！）/ 力度 / 方向
    await page.evaluate((d) => {
      const c = window.container
      const cue = c.table.cue
      window.__apex = 0
      window.__samples = []
      window.__landed = null
      // ⚠️ 不能靠 requestAnimationFrame 采样：软件渲染（swiftshader）下帧率
      // 只有十几 fps，30° 那档整个空中段才 0.23 秒，rAF 一帧都踩不到 ——
      // 实测峰值恒为 0，是**采样漏帧**的假象，不是物理没跳。
      // 改为钩住 table.advance：每个物理步都采一次，一次都不漏。
      const t = c.table
      if (!t.__patched) {
        const orig = t.advance.bind(t)
        t.advance = (dt) => {
          orig(dt)
          const z = t.cueball?.pos?.z ?? 0
          if (z > (window.__apex ?? 0)) window.__apex = z
          // 首次「起跳后又落回台面」的时刻即落地，记录落点
          if (window.__apex > 1e-6 && z <= 1e-6 && window.__landed === null) {
            window.__landed = Number(t.cueball.pos.x)
          }
        }
        t.__patched = true
      }
      // 抬杆角单位是**弧度**（UI 上限 2π/5 = 72°）
      cue.aim.elevation = (d * Math.PI) / 180
      cue.aim.offset.set(0, 0, 0)
      cue.aim.power = 0.9 * 160 * 0.03275
      cue.setAimAngle(0, c.table) // 朝 +x
      cue.aim.power = 0.9 * 160 * 0.03275
      cue.updateAimInput()
    }, deg)

    const pre = await page.evaluate(() => ({
      elev: Number(window.container.table.cue.aim.elevation),
      power: Number(window.container.table.cue.aim.power),
      angle: Number(window.container.table.cue.aim.angle),
      dirX: window.container.table.cue.aim.dir ? Number(window.container.table.cue.aim.dir.x) : null,
      hasDir: !!window.container.table.cue.aim.dir,
      x0: Number(window.container.table.cueball.pos.x),
      y0: Number(window.container.table.cueball.pos.y),
    }))
    // 出杆前记下起点（判定这一杆到底有没有打出去）
    const x0 = await page.evaluate(() => Number(window.container.table.cueball.pos.x))
    await page.evaluate(() => {
      const c = window.container
      c.controller = c.controller.playShot()
    })
    // 固定采样 3 秒：球起跳→落地→滚停全程都在 rAF 采样窗口内。
    // （不能靠 allStationary 判结束 —— 出杆生效前它就已经是 true，
    //   会立刻取消采样器，采到的峰值恒为 0。）
    await sleep(3000)
    const res = await page.evaluate(() => {
      const c2 = window.container
      const c = window.container
      return {
        apex: window.__apex,
        landed: window.__landed,
        elev: Number(c.table.cue.aim.elevation),
        cueX: Number(c.table.cueball.pos.x),
      }
    })
    const apexCm = res.apex * 100
    // 飞行距离 = 落地点 - 起点（起跳点即出杆点）；3 秒后位移受落地后旋
    // 影响（实测 45° 会被后旋拉回 -22cm），不能拿来当飞行距离。
    const flightCm = (res.landed ?? res.cueX) === null ? 0 : ((res.landed ?? res.cueX) - x0) * 100
    const restCm = (res.cueX - x0) * 100
    rows.push({ deg, apexCm: +apexCm.toFixed(2), flightCm: +flightCm.toFixed(1) })
    console.log(
      `  ${String(deg).padStart(2)}°  抬杆=${pre.elev.toFixed(4)}rad  力度=${pre.power.toFixed(
        3
      )}  朝向角=${pre.angle.toFixed(3)}(dirX=${pre.dirX === null ? "n/a" : pre.dirX.toFixed(2)})  起点x=${pre.x0.toFixed(3)}` +
      `  最高 ${apexCm.toFixed(2)}cm  飞越 ${flightCm.toFixed(1)}cm  3s后位移 ${restCm.toFixed(1)}cm`
    )
  }

  console.log("")
  const get = (d) => rows.find((r) => r.deg === d)
  const m0 = get(0)
  const m30 = get(30)
  const m45 = get(45)
  const m72 = get(72)
  if (m72) ok("①满力72°最高≤30cm", m72.apexCm <= 30, { 实测: m72.apexCm, 修复前: 99.4 })
  if (m45) ok("②满力45°最高∈[8,20]cm", m45.apexCm >= 8 && m45.apexCm <= 20, { 实测: m45.apexCm })
  if (m0) ok("④0°不跳", m0.apexCm < 0.5, { 实测: m0.apexCm })
  if (m30 && m45 && m72)
    ok(
      "③仰角越大跳越高",
      m30.apexCm < m45.apexCm && m45.apexCm < m72.apexCm,
      { "30°": m30.apexCm, "45°": m45.apexCm, "72°": m72.apexCm }
    )
  if (m45 && m72) ok("③b仰角越大飞越近", m72.flightCm < m45.flightCm, { "45°": m45.flightCm, "72°": m72.flightCm })
  ok("⑤零页面错误", errs.length === 0, { errs: errs.slice(0, 3) })

  console.log(`\n  通过 ${pass} / 失败 ${fail}`)
  await browser.close()
  if (fail > 0) process.exitCode = 1
}

main().catch((e) => {
  console.error("FATAL", e)
  process.exit(1)
})
