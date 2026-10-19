/**
 * v1.5.6 发版冒烟探针 —— 升号 + changelog + 游戏健康三连检。
 *
 *   S1 menu.html 运行时版本串 __BILLIARDS_VERSION__ === 1.5.6-26100101
 *   S2 #versionCell 可见文本含 1.5.6
 *   S3 点「变更履历」→ #changelogBody 渲染 v1.5.6 标题 + #78~#83 六条目 + v1.5.5 历史仍在
 *   S4 进 8球人机对战 → canvas 渲染 + 瞄准就绪（自动关 Tutorial / 过 PlaceBall）+ 3s 零 pageerror
 *   S5 跳转球落地衰减：发射跳球后白球水平速度落地后显著低于落地前
 *   截图：changelog.png / play.png
 */
const puppeteer = require("puppeteer-core")
const fs = require("fs")
const OUT = "/tmp/v158-release"
const BASE = process.env.BASE || "http://127.0.0.1:8170"
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function tmo(p, ms, label) {
  return Promise.race([
    p,
    new Promise((_, rej) => setTimeout(() => rej(new Error(`TMO(${label})`)), ms)),
  ])
}
async function waitFor(page, fn, timeout = 30000, every = 200) {
  const t0 = Date.now()
  let r
  while ((r = await page.evaluate(fn).catch(() => false)) === false) {
    if (Date.now() - t0 > timeout) return -1
    await sleep(every)
  }
  return Date.now() - t0
}
async function launch() {
  return puppeteer.launch({
    executablePath: "/usr/bin/google-chrome",
    headless: true,
    protocolTimeout: 45000,
    args: [
      "--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu",
      "--user-data-dir=/tmp/chrome-relv156", "--window-size=393,851",
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
  const ok = (name, pass, detail) => console.log(`${pass ? "PASS" : "FAIL"}  ${name}  ${JSON.stringify(detail).slice(0, 240)}`)

  // ---------- [1] menu 版本 ----------
  console.log("[1] 开菜单页验版本…")
  await page.goto(`${BASE}/menu.html`, { waitUntil: "domcontentloaded", timeout: 60000 })
  await sleep(1500)
  const ver = await page.evaluate(() => ({
    raw: window.__BILLIARDS_VERSION__,
    cell: document.getElementById("versionCell")?.textContent?.trim() || "",
  }))
  ok("S1_运行时版本串", ver.raw === "1.5.8-26101510", ver)
  ok("S2_版本显示单元格", ver.cell.includes("1.5.8"), { cell: ver.cell.slice(0, 60) })

  // ---------- [2] 变更履历渲染 ----------
  console.log("[2] 点变更履历…")
  await page.evaluate(() => document.getElementById("btnChangelog")?.click())
  const cl = await waitFor(page, () => {
    const b = document.getElementById("changelogBody")
    return !!(b && b.textContent.includes("v1.5.8") && b.textContent.includes("#88"))
  }, 15000)
  const clBody = await page.evaluate(() => {
    const b = document.getElementById("changelogBody")
    return {
      v158: b?.querySelector("h3")?.textContent || "",
      items: ["#88"].filter((t) => b?.textContent.includes(t)),
      v157kept: b?.textContent.includes("v1.5.7"),
    }
  })
  ok("S3_履历v1.5.8条目渲染", cl > 0 && clBody.v158.includes("v1.5.8") && clBody.items.length === 1 && clBody.v157kept, clBody)
  await page.screenshot({ path: `${OUT}/changelog.png` })

  // ---------- [3] 游戏健康 ----------
  console.log("[3] 进 8球人机对战…")
  await page.goto(`${BASE}/play.html?ruletype=eightball&bot=ClawBreak`, { waitUntil: "domcontentloaded", timeout: 120000 })
  await waitFor(page, () => {
    const c = document.querySelector("#viewP1 canvas")
    const l = document.getElementById("view3dLoading")
    return !!(c && c.width > 0) && (!l || getComputedStyle(l).display === "none")
  }, 90000)
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
  await sleep(3000)
  const diag = await page.evaluate(() => ({
    ctrl: window.container?.controller?.name,
    rule: window.container?.rules?.rulename,
  }))
  ok("S4_游戏健康瞄准就绪", ready >= 0 && errs.length === 0, { ready_ms: ready, ...diag, pageErr: errs })
  await page.screenshot({ path: `${OUT}/play.png` })

  // ---------- [4] #78 跳球落地衰减（线上产物实测） ----------
  // 写法与已验证通过的 probe-jump156.js 一致：setAimAngle 必须带第二参 table，
  // 采样器要在击球前挂好，击球走 controller.playShot()。
  console.log("[4] 跳球落地衰减…")
  await page.evaluate(() => {
    window.__samples = []
    const c = window.container
    window.__timer = setInterval(() => {
      const b = c.table.cueball // 白球（table.cue 是球杆）
      if (!b || !b.pos) return
      window.__samples.push({
        st: String(b.state),
        z: +b.pos.z.toFixed(4),
        vx: +b.vel.x.toFixed(4),
        vy: +b.vel.y.toFixed(4),
        vz: +b.vel.z.toFixed(4),
      })
    }, 4)
  })
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
  let jump = { err: "no airborne segment", n: samples.length }
  const airIdx = samples.map((s, i) => (s.st === "Airborne" ? i : -1)).filter((i) => i >= 0)
  if (airIdx.length > 0) {
    const last = airIdx[airIdx.length - 1]
    const before = samples[last]
    const after = samples[last + 1] || samples[last + 2]
    const hv = (s) => Math.hypot(s.vx, s.vy)
    jump = after
      ? {
          before: { vh: +hv(before).toFixed(4), vz: before.vz, z: before.z },
          after: { vh: +hv(after).toFixed(4), vz: after.vz, z: after.z },
          lossRatio: +(1 - hv(after) / hv(before)).toFixed(4),
          airFrames: airIdx.length,
          apex: +Math.max(...airIdx.map((i) => samples[i].z)).toFixed(4),
          n: samples.length,
        }
      : { err: "no landing frame", airFrames: airIdx.length }
  }
  const jPass =
    !jump.err && jump.after.vh < jump.before.vh * 0.95 && Math.abs(jump.after.vz) < 1e-6
  ok("S5_跳球落地水平速度衰减", jPass, jump)

  await browser.close()
  const allPass =
    ver.raw === "1.5.8-26101510" && ver.cell.includes("1.5.8") &&
    cl > 0 && clBody.v158.includes("v1.5.8") && clBody.items.length === 1 && clBody.v157kept &&
    ready >= 0 && errs.length === 0 && jPass
  console.log("合计：发版冒烟", allPass ? "PASS" : "FAIL")
}
main().catch((e) => { console.error("FATAL", e); process.exit(1) })
