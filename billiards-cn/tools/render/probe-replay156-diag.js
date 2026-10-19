/**
 * v1.5.6 诊断探针 —— 回放四项取证（不修只测，先把现象钉死）。
 *
 *   D1 进球吸附点：shotMeta.pots 数据量 vs DOM .replay-snap 元素与分色
 *   D2 seek 往返精度：拖到 A→记录全局时刻→拖到 B→再拖回 A，比较两次 A 的时刻
 *   D3 末尾时刻：拖到 100% 后的全局时刻 vs gameTotals().total（应≈对局结束）
 *   D4 进回放是否弹「自由练习 / 祝你好运」通知横幅
 *   D5 全程零 pageerror
 */
const puppeteer = require("puppeteer-core")
const fs = require("fs")
const OUT = "/tmp/v156-diag"
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
    protocolTimeout: 45000,
    args: [
      "--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu",
      "--user-data-dir=/tmp/chrome-r156d", "--window-size=393,851",
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

async function seedAndOpen(page, compressed, rule) {
  const id = "probe156_" + Date.now()
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

/** 回放内部全局时刻（与 tickSeekUI 同口径） */
const G = () => {
  const c = window.container
  const r = c && c.controller
  if (!r || !r.shotMeta) return null
  let acc = 0
  const cum = []
  for (const m of r.shotMeta) { cum.push(acc); acc += Math.max(m.duration, 1e-3) }
  const idx = r.currentShotIndex
  const shotTime = idx < 0 ? 0 : c.table.time
  return {
    idx,
    shotTime: +Number(shotTime).toFixed(1),
    globalT: +Number(idx < 0 ? 0 : cum[idx] + shotTime).toFixed(1),
    total: +acc.toFixed(1),
    seek: +document.getElementById("replaySeek").value,
    metaLen: r.shotMeta.length,
    potsTotal: r.shotMeta.reduce((s, m) => s + (m.pots ? m.pots.length : 0), 0),
    potsOwner: r.shotMeta.reduce((a, m) => a.concat((m.pots || []).map((p) => p.owner)), []),
  }
}

const SNAPS = () => {
  const box = document.getElementById("replaySeekSnaps")
  if (!box) return { exists: false }
  const els = Array.from(box.querySelectorAll(".replay-snap"))
  return {
    exists: true,
    count: els.length,
    items: els.slice(0, 8).map((e) => ({
      cls: e.className.replace("replay-snap ", ""),
      bg: getComputedStyle(e).backgroundColor,
      left: e.style.left,
    })),
  }
}

async function dragSeekTo(page, frac, steps = 4) {
  const r = await tmo(page.evaluate(() => {
    const el = document.getElementById("replaySeek")
    const b = el.getBoundingClientRect()
    return { x: b.left, y: b.top, w: b.width, h: b.height, val: +el.value }
  }), 8000, "rect")
  const y = r.y + r.h / 2
  const curX = r.x + r.w * (r.val / 1000)
  const tgtX = r.x + r.w * Math.max(0, Math.min(1, frac))
  await tmo(page.mouse.move(curX, y), 8000, "m0")
  await tmo(page.mouse.down(), 8000, "down")
  for (let i = 1; i <= steps; i++) {
    await tmo(page.mouse.move(curX + ((tgtX - curX) * i) / steps, y), 8000, "m" + i)
    await sleep(50)
  }
  await tmo(page.mouse.up(), 8000, "up")
  await sleep(400)
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true })
  const browser = await launch()
  const page = await browser.newPage()
  await page.setCacheEnabled(false)
  await page.setViewport({ width: 393, height: 851, deviceScaleFactor: 1 })
  const errs = []
  page.on("pageerror", (e) => errs.push(String(e).slice(0, 160)))

  console.log("[1] buildGame 打 12 杆…")
  const compressed = await buildGame(page, 12)
  console.log("compressed len:", compressed ? compressed.length : 0)

  console.log("[2] 进回放（同时监听通知横幅）…")
  // 进回放前挂一个 MutationObserver 记录所有出现的通知横幅文本
  await page.evaluate(() => {
    window.__notifs = []
    const scan = () => {
      document.querySelectorAll(".notification-banner, .notification-text-group").forEach((el) => {
        const txt = (el.textContent || "").replace(/\s+/g, " ").slice(0, 80)
        if (txt && window.__notifs.indexOf(txt) === -1) window.__notifs.push(txt)
      })
    }
    window.__notifTimer = setInterval(scan, 120)
  })
  await seedAndOpen(page, compressed, "nineball")
  await sleep(2500)

  // ---- D4 通知横幅 ----
  const notifs = await page.evaluate(() => {
    clearInterval(window.__notifTimer)
    return window.__notifs || []
  })
  const hasFreePractice = notifs.some((t) => t.includes("自由练习") || t.includes("祝你好运"))
  console.log(`${hasFreePractice ? "FAIL" : "PASS"}  D4_进回放不弹自由练习横幅  ${JSON.stringify(notifs.slice(0, 5))}`)

  // ---- D1 吸附点 ----
  await sleep(1200)
  const g1 = await tmo(page.evaluate(G), 8000, "g1")
  const snaps = await tmo(page.evaluate(SNAPS), 8000, "snaps")
  console.log("D1 数据层 pots:", g1.potsTotal, "归属分布:", JSON.stringify(g1.potsOwner.reduce((a, o) => { a[o] = (a[o] || 0) + 1; return a }, {})))
  console.log("D1 DOM:", JSON.stringify(snaps))
  const domOk = snaps.count > 0 && snaps.count === g1.potsTotal
  const colored = snaps.items.some((s) => s.cls === "snap-player") || snaps.items.some((s) => s.cls === "snap-ai")
  console.log(`${domOk ? "PASS" : "FAIL"}  D1_吸附点数量匹配  ${JSON.stringify({ dom: snaps.count, data: g1.potsTotal })}`)
  console.log(`${colored ? "PASS" : "FAIL"}  D1_吸附点有分色class  ${JSON.stringify(snaps.items.slice(0, 4))}`)
  await page.screenshot({ path: `${OUT}/seek-d1.png` })

  // ---- D2 seek 往返精度 ----
  console.log("[3] D2 往返精度 A(0.35) → B(0.70) → A(0.35)…")
  await dragSeekTo(page, 0.35)
  await sleep(700)
  const a1 = await tmo(page.evaluate(G), 8000, "a1")
  await dragSeekTo(page, 0.70)
  await sleep(700)
  const b1 = await tmo(page.evaluate(G), 8000, "b1")
  await dragSeekTo(page, 0.35)
  await sleep(700)
  const a2 = await tmo(page.evaluate(G), 8000, "a2")
  const drift = Math.abs(a2.globalT - a1.globalT)
  console.log("  A1:", JSON.stringify(a1))
  console.log("  B1:", JSON.stringify(b1))
  console.log("  A2:", JSON.stringify(a2))
  console.log(`${drift <= 120 ? "PASS" : "FAIL"}  D2_往返同一frac时刻一致  ${JSON.stringify({ a1T: a1.globalT, a2T: a2.globalT, driftMs: +drift.toFixed(1), a1seek: a1.seek, a2seek: a2.seek })}`)

  // ---- D3 末尾时刻 ----
  console.log("[4] D3 拖到末尾…")
  await dragSeekTo(page, 1.0)
  await sleep(1500)
  const tail = await tmo(page.evaluate(G), 8000, "tail")
  const ratio = tail.total > 0 ? tail.globalT / tail.total : 0
  console.log("  末尾状态:", JSON.stringify(tail))
  console.log(`${ratio >= 0.97 ? "PASS" : "FAIL"}  D3_末尾达到对局结束  ${JSON.stringify({ globalT: tail.globalT, total: tail.total, ratio: +ratio.toFixed(3), idx: tail.idx, metaLen: tail.metaLen, seek: tail.seek })}`)
  await page.screenshot({ path: `${OUT}/seek-d3-tail.png` })

  console.log(`${errs.length === 0 ? "PASS" : "FAIL"}  D5_零页面错误  ${JSON.stringify(errs.slice(0, 4))}`)
  await browser.close()
}
main().catch((e) => { console.error("FATAL", e); process.exit(1) })
