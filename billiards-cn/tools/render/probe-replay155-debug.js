/**
 * v1.5.5 取证探针 —— V1 time 写回源头 + V4 连续拖动 paused 真相。
 *
 * 背景：probe-replay155-verify.js 跑出 V1 FAIL（进回放 time=47511 残留）
 * 与 V4 FAIL（连续 3 次快速拖动后 reason=paused）。构造清零代码确认在
 * dist/index.js 里（table.time=0 ×3），故 V1 必有「清零后再写回」的路径；
 * V4 拖的是 0.2/0.55/0.35 非局末，hasNext=false 解释不了，需逐帧状态取证。
 *
 * 手段：
 *   A. addScriptToEvaluateOnNewDocument 注入挂钩 —— container.table 一出现就
 *      defineProperty 覆盖 time setter，仅在「Replay 且 currentShotIndex<0」
 *      空闲窗口记录写入（值 + 调用栈），避开物理模拟的写入风暴。
 *   B. 真实鼠标 3 次快速拖动（0.2→0.55→0.35），每次 up 后立刻抓完整状态，
 *      随后 9s 逐采样记录 paused/scrub/time/queue，拿到 paused=true 的出现时序。
 */
const puppeteer = require("puppeteer-core")
const fs = require("fs")
const OUT = "/tmp/v155-replay"
const BASE = process.env.BASE || "http://127.0.0.1:8160/dist"
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function tmo(p, ms, label) {
  return Promise.race([
    p,
    new Promise((_, rej) => setTimeout(() => rej(new Error(`TMO(${label})`)), ms)),
  ])
}
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
    headless: "new",
    protocolTimeout: 45000,
    args: [
      "--no-sandbox", "--hide-scrollbars", "--disable-dev-shm-usage", "--no-zygote",
      "--ozone-platform=headless", "--use-gl=angle", "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader", "--user-data-dir=/tmp/chrome-r155d",
      "--in-process-gpu", "--disable-gpu-sandbox", "--window-size=393,851",
    ],
    env: { ...process.env, DISPLAY: "" },
  })
}
/** document-start 注入：hook table.time setter（仅 Replay+idx<0 窗口记录） */
const HOOK_SRC = `
(function(){
  window.__timeHook = { writes: [], initial: null, hookedAt: 0, atReplay: null }
  let hooked = false
  const timer = setInterval(() => {
    if (hooked) { clearInterval(timer); return }
    const c = window.container
    if (c && c.table && typeof c.table.time === "number") {
      hooked = true
      const t = c.table
      let val = t.time
      window.__timeHook.initial = +Number(val).toFixed(3)
      window.__timeHook.hookedAt = Math.round(performance.now())
      Object.defineProperty(t, "time", {
        configurable: true,
        get() { return val },
        set(v) {
          const cc = window.container
          const r = cc && cc.controller
          const idle = !r || (r.name === "Replay" && (r.currentShotIndex === undefined || r.currentShotIndex < 0))
          if (idle && window.__timeHook.writes.length < 400) {
            window.__timeHook.writes.push({
              v: +Number(v).toFixed(3),
              ms: Math.round(performance.now()),
              ctrl: r ? r.name : "none",
              stack: (new Error().stack || "").split("\\n").slice(2, 6).join(" | ").slice(0, 280),
            })
          }
          val = v
        },
      })
    }
  }, 3)
  const t2 = setInterval(() => {
    const c = window.container
    if (c && c.controller && c.controller.name === "Replay") {
      window.__timeHook.atReplay = { time: +Number(c.table.time).toFixed(3), ms: Math.round(performance.now()) }
      clearInterval(t2)
    }
  }, 10)
  setTimeout(() => { clearInterval(t2) }, 120000)
})()
`
async function buildGame(page, n) {
  await page.goto(`${BASE}/play.html?bot=ClawBreak`, { waitUntil: "domcontentloaded", timeout: 120000 })
  await waitFor(page, () => {
    const c = document.querySelector("#viewP1 canvas")
    const l = document.getElementById("view3dLoading")
    return !!(c && c.width > 0) && (!l || getComputedStyle(l).display === "none")
  }, 90000)
  await sleep(1500)
  await waitFor(page, () => {
    const c = window.container
    const cue = c && c.table && c.table.cue
    return !!(cue && cue.aimInputs && !cue.aimInputs.isDisabled())
  }, 150000)
  const powers = [0.72, 0.5, 0.78, 0.55, 0.68, 0.6]
  for (let k = 0; k < n; k++) {
    const ready = await waitFor(page, () => {
      const c = window.container
      const ctrl = c && c.controller
      if (!ctrl) return false
      if (ctrl.name === "PlaceBall") {
        document.getElementById("cueHit")?.click()
        return false
      }
      return typeof ctrl.playShot === "function"
    }, 45000)
    if (ready < 0) {
      console.log(`shot ${k}: 提前收杆`)
      break
    }
    await sleep(300)
    await page.evaluate((k, p) => {
      const c = window.container
      c.table.cue.setAimAngle(0.3 + k * 0.19, c.table)
      c.table.cue.setPower(p)
      c.controller = c.controller.playShot()
    }, k, powers[k])
    await waitFor(page, () => window.container.controller?.name !== "PlayShot", 60000)
    await sleep(900)
  }
  return page.evaluate(() => window.container.recorder.getWholeGameCompressed())
}
async function seedAndOpen(page, compressed, rule) {
  const id = "probe155d_" + Date.now()
  await page.evaluate((id, rule, compressed) => {
    try { sessionStorage.setItem("bcr:" + id, compressed) } catch (e) {}
    try { window.__timeHook && (window.__timeHook.writes.length = 0) } catch (e) {}
    globalThis.location.href = `play.html?replayId=${encodeURIComponent(id)}&ruletype=${encodeURIComponent(rule || "nineball")}`
  }, id, rule, compressed).catch(() => {})
  await waitFor(page, () => {
    const c = document.querySelector("#viewP1 canvas")
    const l = document.getElementById("view3dLoading")
    return !!(c && c.width > 0) && (!l || getComputedStyle(l).display === "none")
  }, 90000)
  await waitFor(page, () => window.container?.controller?.name === "Replay", 60000)
}
const DBG = () => {
  const c = window.container
  const r = c && c.controller
  const seek = document.getElementById("replaySeek")
  return {
    name: r ? r.name : "none",
    idx: r ? r.currentShotIndex : -99,
    shotsLen: r && r.shots ? r.shots.length : -1,
    userPaused: !!(r && r.userPaused),
    scrub: !!(r && r.userScrubbing),
    replayPaused: !!c.replayPaused,
    timer: r && r.timer !== undefined && r.timer !== null ? "set" : "undef",
    stationary: !!(c.table && c.table.allStationary && c.table.allStationary()),
    time: +Number(c.table.time || 0).toFixed(2),
    seek: seek ? +seek.value : -1,
    qLen: c.eventQueue ? c.eventQueue.length : -1,
  }
}
async function dragSeekTo(page, frac, steps = 2) {
  const r = await tmo(page.evaluate(() => {
    const el = document.getElementById("replaySeek")
    const b = el.getBoundingClientRect()
    return { x: b.left, y: b.top, w: b.width, h: b.height, val: +el.value }
  }), 8000, "rect")
  const y = r.y + r.h / 2
  const curF = r.val / 1000
  const curX = r.x + r.w * curF
  const tgtX = r.x + r.w * Math.max(0, Math.min(1, frac))
  await tmo(page.mouse.move(curX, y), 8000, "m0")
  await tmo(page.mouse.down(), 8000, "down")
  for (let i = 1; i <= steps; i++) {
    await tmo(page.mouse.move(curX + ((tgtX - curX) * i) / steps, y), 8000, "m" + i)
    await sleep(40)
  }
  await tmo(page.mouse.up(), 8000, "up")
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true })
  const browser = await launch()
  const page = await browser.newPage()
  await page.setCacheEnabled(false)
  await page.setViewport({ width: 393, height: 851, deviceScaleFactor: 1 })
  await page.evaluateOnNewDocument(HOOK_SRC)
  const errs = []
  page.on("pageerror", (e) => errs.push(String(e).slice(0, 160)))

  console.log("[1] buildGame 打 6 杆…")
  const compressed = await buildGame(page, 6)
  console.log("compressed len:", compressed ? compressed.length : 0)
  console.log("[2] 进回放（挂钩已装）…")
  await seedAndOpen(page, compressed, "nineball")
  await sleep(800)

  // ---- A. V1 取证：挂钩数据 ----
  const hook = await tmo(page.evaluate(() => window.__timeHook), 8000, "hook")
  console.log("\n=== A. time 挂钩取证 ===")
  console.log("hook 初始值(挂上时):", hook.initial, " atReplay:", JSON.stringify(hook.atReplay))
  console.log("idx=-1 窗口写入数:", hook.writes.length)
  for (const w of hook.writes.slice(0, 40)) {
    console.log(`  t=${w.ms} ctrl=${w.ctrl} time=${w.v}\n    ${w.stack}`)
  }
  const now = await tmo(page.evaluate(() => ({
    time: +Number(window.container.table.time).toFixed(3),
    idx: window.container.controller.currentShotIndex,
    seek: +document.getElementById("replaySeek").value,
  })), 8000, "now")
  console.log("当前:", JSON.stringify(now))

  // ---- B. V4 取证：3 次快速拖动 ----
  console.log("\n=== B. V4 连续拖动取证 ===")
  // 等第一杆打完再开始（避免和开局 delay 竞态混淆）
  await waitFor(page, () => window.container.controller.currentShotIndex >= 0, 30000)
  await sleep(1500)
  const seq = []
  const drags = [0.2, 0.55, 0.35]
  for (let i = 0; i < drags.length; i++) {
    await dragSeekTo(page, drags[i])
    const d = await tmo(page.evaluate(DBG), 8000, "dbg" + i)
    seq.push({ after: "drag" + i + "(" + drags[i] + ")", ...d })
    console.log(`drag${i}(${drags[i]}) up后:`, JSON.stringify(d))
    if (i < drags.length - 1) await sleep(300)
  }
  // 9s 逐采样
  const t0 = Date.now()
  const samples = []
  while (Date.now() - t0 < 9000) {
    await sleep(500)
    const d = await tmo(page.evaluate(DBG), 8000, "smp").catch(() => null)
    if (d) samples.push({ t: Math.round(Date.now() - t0), ...d })
  }
  console.log("\n9s 采样序列:")
  for (const s of samples) console.log(`  +${s.t}ms ${JSON.stringify(s)}`)
  const firstPaused = samples.find((s) => s.replayPaused || s.userPaused)
  console.log("\n首个 paused 采样:", firstPaused ? JSON.stringify(firstPaused) : "无（全程未 paused）")
  console.log("pageerror:", errs.length ? errs.slice(0, 3) : "无")

  fs.writeFileSync(`${OUT}/debug.json`, JSON.stringify({ hook: { initial: hook.initial, atReplay: hook.atReplay, writes: hook.writes.slice(0, 120) }, seq, samples, errs }, null, 2))
  await browser.close()
  process.exit(0)
}

main().catch((e) => {
  console.error("探针异常:", e)
  process.exit(2)
})
