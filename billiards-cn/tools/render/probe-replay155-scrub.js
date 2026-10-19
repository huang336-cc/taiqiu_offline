/**
 * v1.5.5 复现探针 —— 回放「进度条错误 + 偶发停止」实机取证。
 *
 * 用户反馈（v1.5.5 #5）：回放模式进度条错误，并且回放会偶发停止。
 * 要求：先实机复现，再改代码。
 *
 * 方法：
 *   A. 自然播放 30s：每 500ms 采样 idx/time/seek/paused/shotsLen/timer，
 *      检测①进度条回跳/跳变 ②非暂停状态下的播放停滞
 *   B. 真实鼠标拖动进度条 10 次（CDP Input，非 JS 赋值）：
 *      每次拖完观察 8s —— 检测拖后停死 / frac 与杆段错位 / paused 被悄悄置位
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
      "--enable-unsafe-swiftshader", "--user-data-dir=/tmp/chrome-r155",
      "--in-process-gpu", "--disable-gpu-sandbox", "--window-size=393,851",
    ],
    env: { ...process.env, DISPLAY: "" },
  })
}

/** 打 6 杆造整局压缩数据（玩家+bot 交替） */
async function buildGame(page) {
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
  const powers = [0.7, 0.55, 0.75, 0.6, 0.65, 0.5]
  for (let k = 0; k < 6; k++) {
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
      console.log(`shot ${k}: 等不到可出杆控制器，提前收杆`)
      break
    }
    await sleep(300)
    await page.evaluate((k, p) => {
      const c = window.container
      c.table.cue.setAimAngle(0.3 + k * 0.22, c.table)
      c.table.cue.setPower(p)
      c.controller = c.controller.playShot()
    }, k, powers[k])
    await waitFor(page, () => window.container.controller?.name !== "PlayShot", 60000)
    await sleep(1000)
  }
  return page.evaluate(() => window.container.recorder.getWholeGameCompressed())
}

/** 进回放页（sessionStorage 注入 + 跳转 fire-and-forget） */
async function seedAndOpen(page, compressed, rule) {
  const id = "probe155_" + Date.now()
  page.evaluate((id, rule, compressed) => {
    try { sessionStorage.setItem("bcr:" + id, compressed) } catch (e) {}
    globalThis.location.href = `play.html?replayId=${encodeURIComponent(id)}&ruletype=${encodeURIComponent(rule || "nineball")}`
  }, id, rule, compressed).catch((e) => console.log("nav eval failed:", e.message))
  await waitFor(page, () => {
    const c = document.querySelector("#viewP1 canvas")
    const l = document.getElementById("view3dLoading")
    return !!(c && c.width > 0) && (!l || getComputedStyle(l).display === "none")
  }, 90000)
  await waitFor(page, () => window.container?.controller?.name === "Replay", 60000)
}

/** 回放状态采样（controller 私有字段运行时可读） */
const SAMPLE = () => {
  const c = window.container
  const r = c && c.controller
  const seek = document.getElementById("replaySeek")
  const cum = []
  let acc = 0
  const metas = (r && r.shotMeta) || []
  for (const m of metas) { cum.push(acc); acc += Math.max(m.duration, 1e-3) }
  const total = acc
  const idx = r ? r.currentShotIndex : -1
  const frac = seek ? +seek.value / 1000 : -1
  let segLo = -1, segHi = -1
  if (idx >= 0 && idx < metas.length) {
    segLo = cum[idx] / total
    segHi = (cum[idx] + Math.max(metas[idx].duration, 1e-3)) / total
  }
  return {
    ctrl: r ? r.name : "none",
    idx,
    time: +Number(c.table.time || 0).toFixed(3),
    seek: +(frac * 1000).toFixed(0),
    frac: +frac.toFixed(4),
    segLo: +segLo.toFixed(4),
    segHi: +segHi.toFixed(4),
    paused: !!c.replayPaused,
    userPaused: !!(r && r.userPaused),
    scrub: !!(r && r.userScrubbing),
    shotsLen: r && r.shots ? r.shots.length : -1,
    metaLen: metas.length,
    timer: r ? r.timer !== undefined : false,
    onTable: c.table.balls.filter((b) => b.onTable()).length,
  }
}

/** 真实拖动进度条到 frac（CDP 鼠标：down → 分步 move → up） */
async function dragSeekTo(page, frac) {
  const r = await tmo(page.evaluate(() => {
    const el = document.getElementById("replaySeek")
    const b = el.getBoundingClientRect()
    return { x: b.left, y: b.top, w: b.width, h: b.height, val: +el.value }
  }), 8000, "seek-rect")
  const y = r.y + r.h / 2
  const curF = r.val / 1000
  const curX = r.x + r.w * curF
  const tgtX = r.x + r.w * Math.max(0, Math.min(1, frac))
  await tmo(page.mouse.move(curX, y), 8000, "drag-move0")
  await tmo(page.mouse.down(), 8000, "drag-down")
  for (let i = 1; i <= 5; i++) {
    await tmo(page.mouse.move(curX + ((tgtX - curX) * i) / 5, y), 8000, "drag-move" + i)
    await sleep(60)
  }
  await tmo(page.mouse.up(), 8000, "drag-up")
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true })
  const browser = await launch()
  const page = await browser.newPage()
  await page.setCacheEnabled(false)
  await page.setViewport({ width: 393, height: 851, deviceScaleFactor: 1 })
  const errs = []
  page.on("pageerror", (e) => errs.push(String(e).slice(0, 160)))

  console.log("[1] buildGame 打 6 杆…")
  const compressed = await buildGame(page)
  console.log("compressed len:", compressed ? compressed.length : 0)
  console.log("[2] 进回放…")
  await seedAndOpen(page, compressed, "nineball")
  await sleep(2000)

  const report = { phaseA: [], phaseB: [], anomalies: [] }

  // ---------- A. 自然播放 30s ----------
  console.log("[3] A 阶段：自然播放 30s 采样")
  let prevSeek = -1
  for (let i = 0; i < 60; i++) {
    const s = await tmo(page.evaluate(SAMPLE), 8000, "sampleA").catch(() => null)
    if (!s) continue
    report.phaseA.push(s)
    // 停滞检测：非暂停非拖动、还有杆没放、连续样本 time+seek 全不变
    const last2 = report.phaseA.slice(-13)
    if (
      last2.length === 13 &&
      !last2[12].paused && !last2[12].userPaused && !last2[12].scrub &&
      last2[12].idx < last2[12].metaLen - 1 &&
      last2.every((x) => x.time === last2[0].time && x.seek === last2[0].seek && x.idx === last2[0].idx)
    ) {
      report.anomalies.push({ kind: "A_停滞6s", at: i, sample: s })
      console.log("!! A 停滞:", JSON.stringify(s))
      break
    }
    prevSeek = s.seek
    await sleep(500)
  }

  // ---------- B. 真实拖动 10 次 ----------
  console.log("[4] B 阶段：真实拖动 10 次")
  const fracs = [0.3, 0.6, 0.15, 0.8, 0.45, 0.7, 0.25, 0.9, 0.5, 0.35]
  for (let k = 0; k < fracs.length; k++) {
    const s0 = await tmo(page.evaluate(SAMPLE), 8000, "s0").catch(() => null)
    await dragSeekTo(page, fracs[k])
    await sleep(2500)
    const s1 = await tmo(page.evaluate(SAMPLE), 8000, "s1").catch(() => null)
    if (!s1) continue
    // 错位检测：非拖动态下 frac 不在本杆区间
    let misaligned = false
    if (!s1.scrub && s1.idx >= 0 && s1.segLo >= 0) {
      misaligned = s1.frac < s1.segLo - 0.02 || s1.frac > s1.segHi + 0.02
    }
    // 拖后停止检测：再观察 5.5s，time/seek 完全不动且未暂停（还有后续杆）
    await sleep(5500)
    const s2 = await tmo(page.evaluate(SAMPLE), 8000, "s2").catch(() => null)
    let stuckAfterDrag = false
    if (s2 && !s2.paused && !s2.userPaused && !s2.scrub && s2.idx < s2.metaLen - 1 &&
        s2.time === s1.time && s2.seek === s1.seek && s2.idx === s1.idx) {
      stuckAfterDrag = true
    }
    const rec = { k, frac: fracs[k], before: s0, after: s1, later: s2, misaligned, stuckAfterDrag }
    report.phaseB.push(rec)
    if (misaligned) report.anomalies.push({ kind: "B_错位", k, frac: fracs[k], s1 })
    if (stuckAfterDrag) report.anomalies.push({ kind: "B_拖后停死", k, frac: fracs[k], s1, s2 })
    if (s1 && s1.paused && s0 && !s0.paused && !s0.userPaused && s1.idx < s1.metaLen - 1) {
      report.anomalies.push({ kind: "B_被悄悄暂停", k, frac: fracs[k], s1 })
    }
    console.log(
      `drag${k} -> frac=${fracs[k]} | after: idx=${s1.idx} frac=${s1.frac} seg=[${s1.segLo},${s1.segHi}] paused=${s1.paused} | ` +
      (misaligned ? "!!错位 " : "") + (stuckAfterDrag ? "!!停死 " : "") + (s1.paused ? "[paused]" : "")
    )
    await sleep(400)
  }

  console.log("\n===== 异常汇总 =====")
  console.log(JSON.stringify(report.anomalies, null, 1))
  fs.writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 2))
  await browser.close()
  process.exit(report.anomalies.length ? 1 : 0)
}

main().catch((e) => {
  console.error("探针异常:", e)
  process.exit(2)
})
