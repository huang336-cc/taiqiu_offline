/**
 * #70 诊断：回放页主线程是否被长时间阻塞（疑似 precomputeAllShots）。
 * 手工构造 2 杆最小回放状态 → 打开回放 → 每 3 秒探测主线程响应。
 */
const puppeteer = require("puppeteer-core")
const fs = require("fs")
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const OUT = "/tmp/v154-t70diag"
const BASE = process.env.BASE || "http://127.0.0.1:8160/dist"

async function waitFor(page, fn, budget) {
  const t0 = Date.now()
  while (Date.now() - t0 < budget) {
    if (await page.evaluate(fn).catch(() => false)) return Date.now() - t0
    await sleep(80)
  }
  return -1
}

async function safeEval(page, fn, timeoutMs = 15000) {
  let timer
  const timeout = new Promise((res) => { timer = setTimeout(() => res({ __timeout: true }), timeoutMs) })
  try {
    const r = await Promise.race([page.evaluate(fn), timeout])
    clearTimeout(timer)
    return r
  } catch (e) {
    clearTimeout(timer)
    return { __error: e.message.slice(0, 120) }
  }
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true })
  const browser = await puppeteer.launch({
    executablePath: "/usr/bin/google-chrome",
    headless: "new",
    protocolTimeout: 1200000,
    args: [
      "--no-sandbox", "--hide-scrollbars", "--disable-dev-shm-usage", "--no-zygote",
      "--ozone-platform=headless", "--use-gl=angle", "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader",
      "--user-data-dir=/tmp/chrome-t70diag-" + Math.random().toString(36).slice(2),
      "--in-process-gpu", "--disable-gpu-sandbox", "--window-size=393,851",
    ],
    env: { ...process.env, DISPLAY: "" },
  })
  const page = await browser.newPage()
  await page.setCacheEnabled(false)
  await page.setViewport({ width: 393, height: 851, deviceScaleFactor: 2 })
  await page.evaluateOnNewDocument(() => { try { localStorage.setItem("billiards_cn_seenGuide_v1", "1") } catch (e) {} })
  const errs = []
  page.on("pageerror", (e) => errs.push("pageerror: " + e.message))
  page.on("console", (m) => { if (m.type() === "error") errs.push("console: " + m.text().slice(0, 120)) })
  page.on("dialog", (d) => { errs.push("dialog: " + d.message()); d.accept().catch(() => {}) })

  await page.goto(`${BASE}/play.html?bot=ClawBreak`, { waitUntil: "domcontentloaded", timeout: 120000 })
  await waitFor(page, () => {
    const c = document.querySelector("#viewP1 canvas")
    const l = document.getElementById("view3dLoading")
    return !!(c && c.width > 0) && (!l || getComputedStyle(l).display === "none")
  }, 90000)
  await sleep(1500)
  const stateStr = await page.evaluate(() => {
    const t = window.container.table
    const aim = t.cue.aim
    const aimJson = {
      type: "aim",
      pos: [aim.pos.x, aim.pos.y, aim.pos.z],
      angle: aim.angle,
      offset: [aim.offset.x, aim.offset.y, aim.offset.z],
      power: 0.5,
      elevation: 0,
      i: aim.i,
    }
    return JSON.stringify({
      init: t.shortSerialise(),
      shots: [aimJson, { ...aimJson, power: 0.4 }],
      start: 0,
      now: Date.now(),
      score: 0,
      wholeGame: true,
      v: 1,
    })
  })
  console.log("state built, len:", stateStr.length)

  await page.goto(`${BASE}/menu.html`, { waitUntil: "domcontentloaded", timeout: 120000 })
  await sleep(500)
  const id = "diag70_" + Date.now()
  await page.evaluate((id, compressed) => {
    return new Promise((resolve, reject) => {
      const open = indexedDB.open("billiards_replays", 1)
      open.onupgradeneeded = () => {
        const db = open.result
        if (!db.objectStoreNames.contains("replays")) db.createObjectStore("replays", { keyPath: "id" })
      }
      open.onsuccess = () => {
        const db = open.result
        const tx = db.transaction("replays", "readwrite")
        tx.objectStore("replays").put({ id, rule: "nineball", compressed, createdAt: Date.now(), score: 1, label: "diag" })
        tx.oncomplete = () => { db.close(); resolve(true) }
        tx.onerror = () => reject(tx.error)
      }
      open.onerror = () => reject(open.error)
    })
  }, id, stateStr)
  await page.evaluate((id, compressed) => {
    try { sessionStorage.setItem("bcr:" + id, compressed) } catch (e) {}
    globalThis.location.href = `play.html?replayId=${encodeURIComponent(id)}&ruletype=nineball`
  }, id, stateStr).catch(() => {})
  console.log("navigating to replay...")
  const cvMs = await waitFor(page, () => {
    const c = document.querySelector("#viewP1 canvas")
    const l = document.getElementById("view3dLoading")
    return !!(c && c.width > 0) && (!l || getComputedStyle(l).display === "none")
  }, 90000)
  console.log("canvas ready in", cvMs, "ms")

  for (let i = 0; i < 20; i++) {
    const t0 = Date.now()
    const r = await safeEval(page, () => {
      const c = window.container
      return {
        ctrl: c && c.controller && c.controller.name,
        paused: !!(c && c.replayPaused),
        time: c && c.table ? Math.round(c.table.time) : null,
        metaLen: c && c.controller && c.controller.shotMeta ? c.controller.shotMeta.length : null,
        mode: c && c.view && c.view.camera ? (c.view.camera.mode === c.view.camera.replayFreeView ? "free" : "other") : null,
      }
    }, 8000)
    const dt = Date.now() - t0
    const slow = r && r.__timeout ? "  <-- BLOCKED >8s" : ""
    console.log(`poll#${i} eval=${dt}ms`, JSON.stringify(r), slow)
    await sleep(2000)
  }
  console.log("errors:", errs.slice(0, 6).join(" | ") || "(none)")
  await page.screenshot({ path: `${OUT}/diag.png` })
  await browser.close()
}

main().catch((e) => { console.error("FATAL", e.message); process.exit(1) })
