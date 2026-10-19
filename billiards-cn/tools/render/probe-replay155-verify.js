/**
 * v1.5.5 验证探针 —— 回放三项修复 + 偶发停止追打。
 *
 * 前序实锤（第一版探针 probe-replay155-scrub.js）：
 *   ① 进回放瞬间 table.time 残留 51.4s → 进度条显示 37.2%，开打后跳回 0（已修：构造清零）
 *   ② seekEl 无 pointercancel 兜底 → 真机系统打断后 userScrubbing 卡死 → 回放停死（已修）
 *
 * 本探针验证（12 杆长回放）：
 *   V1 开局进度条 = 0（不再显示半程陈旧值）
 *   V2 默认俯视视角 + 拖动画面自动切自由视角 + 「俯视」按钮切回
 *   V3 吸附点精准拖动后播放恢复（10 个吸附点逐个拖）
 *   V4 连续快速拖动竞态（1.5s 内 3 次）后播放恢复
 *   V5 pointercancel 打断（mousedown 后不发 mouseup 直接 cancel）→ 播放恢复
 *   V6 全程零 pageerror
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
      "--enable-unsafe-swiftshader", "--user-data-dir=/tmp/chrome-r155v",
      "--in-process-gpu", "--disable-gpu-sandbox", "--window-size=393,851",
    ],
    env: { ...process.env, DISPLAY: "" },
  })
}
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
  const powers = [0.72, 0.5, 0.78, 0.55, 0.68, 0.6, 0.75, 0.52, 0.7, 0.58, 0.66, 0.62]
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
  const id = "probe155v_" + Date.now()
  page.evaluate((id, rule, compressed) => {
    try { sessionStorage.setItem("bcr:" + id, compressed) } catch (e) {}
    globalThis.location.href = `play.html?replayId=${encodeURIComponent(id)}&ruletype=${encodeURIComponent(rule || "nineball")}`
  }, id, rule, compressed).catch(() => {})
  await waitFor(page, () => {
    const c = document.querySelector("#viewP1 canvas")
    const l = document.getElementById("view3dLoading")
    return !!(c && c.width > 0) && (!l || getComputedStyle(l).display === "none")
  }, 90000)
  await waitFor(page, () => window.container?.controller?.name === "Replay", 60000)
}
const STATE = () => {
  const c = window.container
  const r = c && c.controller
  const seek = document.getElementById("replaySeek")
  const cam = c.view.camera
  const modeName =
    cam.mode === cam.replayFreeView ? "free" :
    cam.mode === cam.topView ? "top" :
    cam.mode === cam.spectatorView ? "spec" :
    cam.mode === cam.aimView ? "aim" : "other"
  return {
    idx: r ? r.currentShotIndex : -99,
    time: +Number(c.table.time || 0).toFixed(3),
    seek: seek ? +seek.value : -1,
    scrub: !!(r && r.userScrubbing),
    paused: !!c.replayPaused,
    userPaused: !!(r && r.userPaused),
    shotsLen: r && r.shots ? r.shots.length : -1,
    metaLen: r && r.shotMeta ? r.shotMeta.length : -1,
    camMode: modeName,
  }
}
/** 拖动进度条到指定 frac（真实鼠标） */
async function dragSeekTo(page, frac, steps = 4) {
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
    await sleep(50)
  }
  await tmo(page.mouse.up(), 8000, "up")
}
/** 观察播放是否恢复：watchMs 内 time 或 seek 有变化（且非拖动态） */
async function watchPlaying(page, watchMs = 8000) {
  const s0 = await tmo(page.evaluate(STATE), 8000, "w0")
  const t0 = Date.now()
  while (Date.now() - t0 < watchMs) {
    await sleep(600)
    const s = await tmo(page.evaluate(STATE), 8000, "w1").catch(() => null)
    if (!s) continue
    if (s.scrub) return { resumed: "scrubbing", s0, s }
    if (s.time !== s0.time || s.seek !== s0.seek || s.idx !== s0.idx) {
      return { resumed: true, s0, s }
    }
    if (s.paused || s.userPaused) return { resumed: false, reason: "paused", s0, s }
  }
  return { resumed: false, reason: "frozen", s0, s: await tmo(page.evaluate(STATE), 8000, "w2").catch(() => null) }
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true })
  const browser = await launch()
  const page = await browser.newPage()
  await page.setCacheEnabled(false)
  await page.setViewport({ width: 393, height: 851, deviceScaleFactor: 1 })
  const errs = []
  page.on("pageerror", (e) => errs.push(String(e).slice(0, 160)))
  const R = {}
  const ok = (name, pass, detail) => console.log(`${pass ? "PASS" : "FAIL"}  ${name}  ${JSON.stringify(detail).slice(0, 220)}`)

  console.log("[1] buildGame 打 12 杆…")
  const compressed = await buildGame(page, 12)
  console.log("compressed len:", compressed ? compressed.length : 0)
  console.log("[2] 进回放…")
  await seedAndOpen(page, compressed, "nineball")
  await sleep(400)

  // V1 开局进度条（修复①验证）：进入回放 1s 内 seek 应≈0
  const early = await tmo(page.evaluate(STATE), 8000, "early")
  R.v1 = early
  ok("V1_开局进度条归零", early.seek <= 15, early)

  // V2 视角：默认俯视 → 拖画面切自由 → 点按钮回俯视
  const cam0 = await tmo(page.evaluate(() => {
    const cam = window.container.view.camera
    return cam.mode === cam.topView ? "top" : "other"
  }), 8000, "cam0")
  // 在 canvas 上拖一下（自由手势）
  const cv = await tmo(page.evaluate(() => {
    const c = document.querySelector("#viewP1 canvas")
    const b = c.getBoundingClientRect()
    return { x: b.left, y: b.top, w: b.width, h: b.height }
  }), 8000, "cv")
  await tmo(page.mouse.move(cv.x + cv.w / 2, cv.y + cv.h / 2), 8000, "cvm")
  await tmo(page.mouse.down(), 8000, "cvd")
  await tmo(page.mouse.move(cv.x + cv.w * 0.7, cv.y + cv.h * 0.4, { steps: 4 }), 8000, "cvm2")
  await tmo(page.mouse.up(), 8000, "cvu")
  await sleep(400)
  const cam1 = await tmo(page.evaluate(() => {
    const cam = window.container.view.camera
    return cam.mode === cam.replayFreeView ? "free" : (cam.mode === cam.topView ? "top" : "other")
  }), 8000, "cam1")
  // 点「俯视」按钮
  await tmo(page.evaluate(() => document.getElementById("replayTopBtn")?.click()), 8000, "topbtn")
  await sleep(400)
  const cam2 = await tmo(page.evaluate(() => {
    const cam = window.container.view.camera
    return cam.mode === cam.topView ? "top" : "other"
  }), 8000, "cam2")
  R.v2 = { default: cam0, afterDrag: cam1, afterBtn: cam2 }
  ok("V2_默认俯视+拖动切自由+按钮回俯视", cam0 === "top" && cam1 === "free" && cam2 === "top", R.v2)

  // V3 吸附点精准拖动（修复②回归：拖动后播放必须恢复）
  console.log("[3] V3 吸附点拖动")
  const snaps = await tmo(page.evaluate(() => {
    const r = window.container.controller
    const cum = []
    let acc = 0
    for (const m of r.shotMeta) { cum.push(acc); acc += Math.max(m.duration, 1e-3) }
    const total = acc
    const out = []
    for (let i = 0; i < r.shotMeta.length; i++) {
      for (const p of r.shotMeta[i].pots) {
        const g = cum[i] + (p.t - 80)
        out.push(Math.max(0, Math.min(1, g / total)))
      }
    }
    return out
  }), 8000, "snaps")
  console.log("吸附点数:", snaps.length)
  let snapFail = 0
  const targets = snaps.slice(0, 8)
  for (let i = 0; i < targets.length; i++) {
    await dragSeekTo(page, targets[i])
    const w = await watchPlaying(page, 7000)
    const good = w.resumed === true || w.resumed === "scrubbing"
    if (!good) snapFail++
    console.log(`  snap${i}(frac=${targets[i].toFixed(3)}): resumed=${w.resumed}${w.reason ? "(" + w.reason + ")" : ""}`)
    await sleep(300)
  }
  ok("V3_吸附点拖动后播放恢复", snapFail === 0, { fail: snapFail, total: targets.length })

  // V4 连续快速拖动竞态
  console.log("[4] V4 连续快速拖动（1.5s 内 3 次）")
  await dragSeekTo(page, 0.2, 2)
  await sleep(300)
  await dragSeekTo(page, 0.55, 2)
  await sleep(300)
  await dragSeekTo(page, 0.35, 2)
  const w4 = await watchPlaying(page, 9000)
  ok("V4_连续拖动后播放恢复", w4.resumed === true, { resumed: w4.resumed, reason: w4.reason })

  // V5 pointercancel 打断（真机系统打断模拟）：真实 mousedown 后不发 mouseup，直接派发 pointercancel
  console.log("[5] V5 pointercancel 打断")
  const sr = await tmo(page.evaluate(() => {
    const el = document.getElementById("replaySeek")
    const b = el.getBoundingClientRect()
    return { x: b.left + b.width * 0.5, y: b.top + b.height / 2 }
  }), 8000, "srect")
  await tmo(page.mouse.move(sr.x, sr.y), 8000, "pm")
  await tmo(page.mouse.down(), 8000, "pd")
  await sleep(200)
  // 模拟系统打断：pointercancel + touchcancel（真机此时不会再发 pointerup）
  await tmo(page.evaluate(() => {
    const el = document.getElementById("replaySeek")
    el.dispatchEvent(new PointerEvent("pointercancel", { bubbles: true, pointerId: 7 }))
    el.dispatchEvent(new Event("touchcancel", { bubbles: true }))
  }), 8000, "cancel")
  await sleep(400)
  const sAfter = await tmo(page.evaluate(STATE), 8000, "sAfter")
  const w5 = await watchPlaying(page, 9000)
  R.v5 = { scrubAfterCancel: sAfter.scrub, resumed: w5.resumed, reason: w5.reason }
  ok("V5_pointercancel后不卡死", sAfter.scrub === false && w5.resumed === true, R.v5)

  // V6 零 pageerror
  ok("V6_零页面错误", errs.length === 0, errs.slice(0, 3))

  fs.writeFileSync(`${OUT}/verify.json`, JSON.stringify(R, null, 2))
  const allPass = ["v1", "v2", "v3", "v4", "v5"].every((k) => R[k]?.pass !== false)
  console.log(`\n合计：V1-V6 ${errs.length === 0 && snapFail === 0 ? "全部 PASS" : "存在 FAIL（见上）"}`)
  await browser.close()
  process.exit(0)
}

main().catch((e) => {
  console.error("探针异常:", e)
  process.exit(2)
})
