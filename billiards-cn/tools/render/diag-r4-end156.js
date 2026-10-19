/**
 * v1.5.6 R4 诊断：拖到进度条尽头时 globalT 只到 total 的 ~97.9%。
 *
 * 取证目标 —— 这一截缺失时间到底来自哪里：
 *   D1 逐杆 duration / cum / total 全量导出，定位缺口落在哪一杆
 *   D2 最后一杆：预演记录 duration vs 实跑 table.time（live 重跑）
 *   D3 最后一杆：同一份 meta 在 r.simTable 上重跑，得 simT —— 区分
 *      「live 桌子与 sim 桌子物理结果不同」还是「duration 记账本身偏大」
 *   D4 末尾 seek 后的 idx / seek / table.time
 */
const puppeteer = require("puppeteer-core")
const fs = require("fs")
const OUT = "/tmp/v156-r4diag"
const BASE = process.env.BASE || "http://127.0.0.1:8160/dist"
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
function tmo(p, ms, label) {
  return Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`TMO(${label})`)), ms))])
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
    headless: true,
    protocolTimeout: 120000,
    args: [
      "--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu",
      "--user-data-dir=/tmp/chrome-r4d", "--window-size=393,851",
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
  const powers = [0.72, 0.5, 0.78, 0.55, 0.68, 0.6]
  for (let k = 0; k < n; k++) {
    const ready = await waitFor(page, () => {
      const c = window.container
      const ctrl = c && c.controller
      if (!ctrl) return false
      if (ctrl.name === "PlaceBall") { document.getElementById("cueHit")?.click(); return false }
      return typeof ctrl.playShot === "function"
    }, 45000)
    if (ready < 0) { console.log(`shot ${k}: 提前收杆`); break }
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

async function main() {
  fs.mkdirSync(OUT, { recursive: true })
  const browser = await launch()
  const page = await browser.newPage()
  await page.setCacheEnabled(false)
  await page.setViewport({ width: 393, height: 851, deviceScaleFactor: 1 })
  const errs = []
  page.on("pageerror", (e) => errs.push(String(e).slice(0, 160)))

  console.log("[1] 打 6 杆…")
  const compressed = await buildGame(page, 6)

  console.log("[2] 落 IndexedDB 并进回放…")
  await page.evaluate((compressed) => {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open("billiards_replays", 1)
      req.onupgradeneeded = () => {
        const db = req.result
        if (!db.objectStoreNames.contains("replays")) db.createObjectStore("replays", { keyPath: "id" })
      }
      req.onsuccess = () => {
        const db = req.result
        const tx = db.transaction("replays", "readwrite")
        tx.objectStore("replays").put({
          id: "r4diag_" + Date.now(),
          rule: "nineball",
          compressed,
          createdAt: Date.now(),
          score: 0,
          label: "R4诊断回放",
        })
        tx.oncomplete = () => resolve(true)
        tx.onerror = () => reject(tx.error)
      }
      req.onerror = () => reject(req.error)
    })
  }, compressed)
  await page.goto(`${BASE}/menu.html`, { waitUntil: "domcontentloaded", timeout: 60000 })
  await sleep(1500)
  await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll("button, .menu-item, [id*=replay], [id*=Replay]"))
      .find((b) => (b.textContent || "").includes("查看回放"))
    if (btn) btn.click()
  })
  await sleep(1200)
  await page.evaluate(() => {
    const infos = document.querySelectorAll(".replay-item .replay-info")
    if (infos.length) infos[0].click()
  })
  const got = await waitFor(page, () => window.container?.controller?.name === "Replay", 60000)
  if (got < 0) throw new Error("未进入回放")
  await sleep(2500)

  // ---- D1 逐杆 duration / cum ----
  const d1 = await tmo(page.evaluate(() => {
    const r = window.container.controller
    const cum = []
    let acc = 0
    for (const m of r.shotMeta) { cum.push(+acc.toFixed(1)); acc += Math.max(m.duration, 1e-3) }
    return {
      durations: r.shotMeta.map((m) => +m.duration.toFixed(1)),
      cum,
      total: +acc.toFixed(1),
      metaLen: r.shotMeta.length,
    }
  }), 15000, "d1")
  console.log("D1 逐杆时长:", JSON.stringify(d1))

  // ---- D2 拖到尽头后的实测 ----
  await page.evaluate(() => {
    const el = document.getElementById("replaySeek")
    el.value = "1000"
    el.dispatchEvent(new Event("input", { bubbles: true }))
    el.dispatchEvent(new Event("change", { bubbles: true }))
  })
  await sleep(1500)
  const d2 = await tmo(page.evaluate(() => {
    const c = window.container
    const r = c.controller
    const cum = []
    let acc = 0
    for (const m of r.shotMeta) { cum.push(acc); acc += Math.max(m.duration, 1e-3) }
    const idx = r.currentShotIndex
    return {
      idx, metaLen: r.shotMeta.length,
      lastDuration: +r.shotMeta[idx].duration.toFixed(1),
      liveTableTime: +c.table.time.toFixed(1),
      cumLast: +cum[idx].toFixed(1),
      globalT: +(cum[idx] + c.table.time).toFixed(1),
      total: +acc.toFixed(1),
      seek: +document.getElementById("replaySeek").value,
      moving: c.table.balls.filter((b) => b.inMotion()).length,
    }
  }), 15000, "d2")
  console.log("D2 拖到尽头:", JSON.stringify(d2))

  // ---- D3 最后一杆：live 重跑 vs sim 重跑 ----
  const d3 = await tmo(page.evaluate(() => {
    const c = window.container
    const r = c.controller
    const idx = r.shotMeta.length - 1
    const meta = r.shotMeta[idx]
    const step = c.step
    // (a) live 桌子重跑
    r.restoreShotStart(meta)
    c.table.hit()
    let g1 = 0
    while (!c.table.allStationary() && g1++ < 500000) c.table.advance(step)
    const liveT = +c.table.time.toFixed(1)
    // (b) simTable 重跑（与 precomputeShot 完全同参）
    const sim = r.simTable
    if (!sim) return { liveT, simT: null, err: "no simTable" }
    meta.layout.forEach((s, i) => {
      const b = sim.balls[i]
      if (!b) return
      b.pos.set(s.pos[0], s.pos[1], s.pos[2])
      b.vel.set(0, 0, 0)
      b.rvel.set(0, 0, 0)
      b.state = s.state
    })
    sim.cueball = sim.balls[meta.cueballIdx]
    sim.cue.aim = meta.aim.copy()
    sim.time = 0
    sim.outcome.length = 0
    sim.hit()
    let g2 = 0
    while (!sim.allStationary() && g2++ < 500000) sim.advance(step)
    const simT = +sim.time.toFixed(1)
    return {
      idx,
      metaDuration: +meta.duration.toFixed(1),
      liveT, simT,
      liveMinusMeta: +(liveT - meta.duration).toFixed(1),
      simMinusMeta: +(simT - meta.duration).toFixed(1),
      liveGuard: g1, simGuard: g2,
      step,
    }
  }), 60000, "d3")
  console.log("D3 末杆重跑对比:", JSON.stringify(d3))

  console.log("D4 页面错误:", JSON.stringify(errs.slice(0, 4)))
  await browser.close()
}
main().catch((e) => { console.error("FATAL", e && e.message); process.exit(1) })
