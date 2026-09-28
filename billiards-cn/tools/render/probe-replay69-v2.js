/**
 * #69 复现探针 v2：多杆回放 + 深度取证。
 *
 * v1 教训：只打 1 杆 → shots 队列播完即耗尽 → handleStationary 自动
 * replayPaused=true（replay.ts:1273「回放结束」语义）—— 那是正常结束，
 * 不是 bug。用户回放的是整局（几十杆），若 shots 提前耗尽才会「不动」。
 *
 * v2：连续打 4 杆（等每次可出杆）→ compressed（应含 ≥4 杆）→ 快速退回
 * 主菜单 → 我的回放点选 → 回放页深度取证：
 *   ctrl / replayMode / replayPaused / timeScale / userPaused /
 *   shotMeta.length / allShots.length / shots.length / currentShotIndex /
 *   table.time / 白球位置
 */
const puppeteer = require("puppeteer-core")
const fs = require("fs")
const OUT = "/tmp/v154-t69v2"
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

async function launch() {
  return puppeteer.launch({
    executablePath: "/usr/bin/google-chrome",
    headless: "new",
    args: [
      "--no-sandbox", "--hide-scrollbars", "--disable-dev-shm-usage", "--no-zygote",
      "--ozone-platform=headless", "--use-gl=angle", "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader", "--user-data-dir=/tmp/chrome-t69v2-" + Math.random().toString(36).slice(2),
      "--in-process-gpu", "--disable-gpu-sandbox", "--window-size=393,851",
    ],
    env: { ...process.env, DISPLAY: "" },
  })
}

async function newPage(browser) {
  const page = await browser.newPage()
  await page.setCacheEnabled(false)
  await page.setViewport({ width: 393, height: 851, deviceScaleFactor: 2 })
  await page.evaluateOnNewDocument(() => {
    try { localStorage.setItem("billiards_cn_seenGuide_v1", "1") } catch (e) {}
  })
  return page
}

/** 等到轮到玩家可出杆（Aim 且可用）；PlaceBall 时先点摆球 */
async function waitMyTurn(page, budget) {
  const ok = await waitFor(page, () => {
    const c = window.container
    const cue = c && c.table && c.table.cue
    const n = c && c.controller && c.controller.name
    if (n === "PlaceBall" && cue && cue.aimInputs && !cue.aimInputs.isDisabled()) return true
    return !!(n === "Aim" && cue && cue.aimInputs && !cue.aimInputs.isDisabled())
  }, budget)
  if (ok < 0) return false
  if ((await page.evaluate(() => window.container.controller?.name)) === "PlaceBall") {
    await page.evaluate(() => document.getElementById("cueHit")?.click())
    if ((await waitFor(page, () => window.container.controller?.name === "Aim", 30000)) < 0) return false
  }
  return true
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true })
  const browser = await launch()
  const page = await newPage(browser)
  await page.goto(`${BASE}/play.html?bot=ClawBreak`, { waitUntil: "domcontentloaded", timeout: 120000 })
  await waitFor(page, () => {
    const c = document.querySelector("#viewP1 canvas")
    const l = document.getElementById("view3dLoading")
    return !!(c && c.width > 0) && (!l || getComputedStyle(l).display === "none")
  }, 90000)
  await sleep(1500)

  // 连续打 4 杆
  let shotOk = 0
  for (let i = 0; i < 4; i++) {
    if (!(await waitMyTurn(page, 120000))) { console.log(`第${i + 1}杆：等不到玩家回合，停`); break }
    await sleep(500)
    await page.evaluate((k) => {
      const c = window.container
      const cue = c.table.cue
      cue.setAimAngle(0.3 + 0.1 * k, c.table)
      cue.setPower(0.5)
      c.controller = c.controller.playShot()
    }, i)
    await waitFor(page, () => window.container.controller?.name !== "PlayShot", 60000)
    await sleep(1000)
    shotOk++
  }
  console.log("完成杆数:", shotOk)

  const saved = await page.evaluate(() => {
    const comp = window.container.recorder.getWholeGameCompressed()
    const rule = window.container.rules.rulename
    // 检查压缩串里有多少杆（数 AIM 事件）
    let aims = -1
    try {
      const json = JSON.parse(comp)
      aims = json.shots ? json.shots.length : -1
    } catch { aims = -2 }
    return new Promise((resolve) => {
      const open = indexedDB.open("billiards_replays", 1)
      open.onupgradeneeded = () => {
        const db = open.result
        if (!db.objectStoreNames.contains("replays")) {
          db.createObjectStore("replays", { keyPath: "id" })
        }
      }
      open.onsuccess = () => {
        const db = open.result
        const rec = { id: "probe2_" + Date.now(), rule, compressed: comp, createdAt: Date.now(), score: 1, label: "probe2" }
        const tx = db.transaction("replays", "readwrite")
        tx.objectStore("replays").put(rec)
        tx.oncomplete = () => { db.close(); resolve({ id: rec.id, rule, len: comp.length, shotsInJson: aims }) }
        tx.onerror = () => { db.close(); resolve({ id: rec.id, rule, len: comp.length, shotsInJson: aims, putError: String(tx.error) }) }
      }
      open.onerror = () => resolve({ id: "openfail", rule, len: comp.length, shotsInJson: aims })
    })
  })
  console.log("保存:", JSON.stringify(saved))

  // 快速退回主菜单
  await page.evaluate(() => { globalThis.location.href = "menu.html" })
  await page.goto(`${BASE}/menu.html`, { waitUntil: "domcontentloaded", timeout: 120000 }).catch(() => {})
  await sleep(1200)
  const pick = await page.evaluate(() => {
    return new Promise((resolve, reject) => {
      const open = indexedDB.open("billiards_replays", 1)
      open.onsuccess = () => {
        const db = open.result
        const tx = db.transaction("replays", "readonly")
        const req = tx.objectStore("replays").getAll()
        req.onsuccess = () => {
          db.close()
          const list = (req.result || []).sort((a, b) => b.createdAt - a.createdAt)
          if (list.length === 0) { resolve(null); return }
          const r = list[0]
          try { sessionStorage.setItem("bcr:" + r.id, r.compressed) } catch (e) { resolve({ pickError: String(e) }); return }
          resolve({ id: r.id, rule: r.rule, len: r.compressed.length })
        }
        req.onerror = () => { db.close(); reject(req.error) }
      }
      open.onerror = () => reject(open.error)
    })
  })
  console.log("菜单选取:", JSON.stringify(pick))
  if (!pick || !pick.id) { console.log("记录丢失"); await browser.close(); return }

  await page.evaluate((id, rule) => {
    globalThis.location.href = `play.html?replayId=${encodeURIComponent(id)}&ruletype=${encodeURIComponent(rule || "nineball")}`
  }, pick.id, pick.rule)
  await waitFor(page, () => {
    const c = document.querySelector("#viewP1 canvas")
    const l = document.getElementById("view3dLoading")
    return !!(c && c.width > 0) && (!l || getComputedStyle(l).display === "none")
  }, 90000)
  await sleep(2000)

  // 深度采样 15s
  const samples = []
  for (let i = 0; i < 15; i++) {
    const s = await page.evaluate(() => {
      const c = window.container
      const rp = c && c.controller
      const cb = c && c.table && c.table.cueball
      return {
        ctrl: rp && rp.name,
        paused: !!(c && c.replayPaused),
        ts: c ? c.timeScale : null,
        userPaused: rp && rp.userPaused !== undefined ? !!rp.userPaused : null,
        metaLen: rp && rp.shotMeta ? rp.shotMeta.length : null,
        allLen: rp && rp.allShots ? rp.allShots.length : null,
        qLen: rp && rp.shots ? rp.shots.length : null,
        idx: rp && rp.currentShotIndex !== undefined ? rp.currentShotIndex : null,
        time: c && c.table ? +c.table.time.toFixed(0) : null,
        pos: cb ? { x: +cb.pos.x.toFixed(2), y: +cb.pos.y.toFixed(2) } : null,
      }
    }).catch(() => null)
    if (s) samples.push(s)
    await sleep(1000)
  }
  samples.forEach((s, i) => console.log(`t+${i}s ${JSON.stringify(s)}`))
  await page.screenshot({ path: `${OUT}/final.png` })
  fs.writeFileSync(`${OUT}/samples.json`, JSON.stringify(samples, null, 2))
  await browser.close()
}

main().catch((e) => { console.error("FATAL", e); process.exit(1) })
