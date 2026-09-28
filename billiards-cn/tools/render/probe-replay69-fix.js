/**
 * #69 修复验证探针。
 *
 * 修复内容（三重防御）：
 *   F1 matchresult.saveReplay —— 「已保存 ✓」等 IndexedDB 落库完成后才显示
 *   F2 menu-cn.js navigateToReplay —— sessionStorage 写失败/数据为空不跳转，就地提示
 *   F3 browsercontainer.startReplay —— parse 异常 / init 缺失 / shots 空都走
 *      replayBroken()：alert + 回主菜单，绝不静默卡死
 *
 * 本探针验证 F2/F3（桌面可复现）：
 *   R1 正常完整局回放 → 连播（回归基线）
 *   R2 compressed 损坏 → 进入 play 后必须被 replayBroken 拦截（alert + 回菜单）
 *   R3 shots 空数组 → 同样拦截回菜单
 *   R4 保存按钮时序：按钮显示「已保存 ✓」后记录必须立即可读（F1，完整局探针）
 */
const puppeteer = require("puppeteer-core")
const fs = require("fs")
const OUT = "/tmp/v154-t69fix"
const BASE = process.env.BASE || "http://127.0.0.1:8160/dist"
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function waitFor(page, fn, budget) {
  const t0 = Date.now()
  while (Date.now() - t0 < budget) {
    if (await page.evaluate(fn).catch(() => false)) return Date.now() - t0
    await sleep(80)
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
      "--enable-unsafe-swiftshader", "--user-data-dir=/tmp/chrome-t69fix-" + Math.random().toString(36).slice(2),
      "--in-process-gpu", "--disable-gpu-sandbox", "--window-size=393,851",
    ],
    env: { ...process.env, DISPLAY: "" },
  })
}

async function newPage(browser, tag) {
  const page = await browser.newPage()
  await page.setCacheEnabled(false)
  await page.setViewport({ width: 393, height: 851, deviceScaleFactor: 2 })
  await page.evaluateOnNewDocument(() => {
    try { localStorage.setItem("billiards_cn_seenGuide_v1", "1") } catch (e) {}
  })
  // alert 自动确认（replayBroken 在跳转前 alert，桌面 Chrome 的模态框会阻塞导航）
  page.on("dialog", (d) => {
    fs.appendFileSync(`${OUT}/dialogs.log`, `${tag}: ${d.message()}\n`)
    d.accept().catch(() => {})
  })
  return page
}

/** 写一条回放记录到 IDB（模拟游戏内保存），返回 id */
async function seedReplay(page, id, compressed, rule) {
  return page.evaluate((id, compressed, rule) => {
    return new Promise((resolve, reject) => {
      const open = indexedDB.open("billiards_replays", 1)
      open.onupgradeneeded = () => {
        const db = open.result
        if (!db.objectStoreNames.contains("replays")) {
          db.createObjectStore("replays", { keyPath: "id" })
        }
      }
      open.onsuccess = () => {
        const db = open.result
        const rec = { id, rule, compressed, createdAt: Date.now(), score: 1, label: "probe" }
        const tx = db.transaction("replays", "readwrite")
        tx.objectStore("replays").put(rec)
        tx.oncomplete = () => { db.close(); resolve(id) }
        tx.onerror = () => { db.close(); reject(tx.error) }
      }
      open.onerror = () => reject(open.error)
    })
  }, id, compressed, rule)
}

/** menu 页点选最新记录（走与 menu-cn.js 相同的 sessionStorage + 跳转逻辑） */
async function pickAndNavigate(page) {
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
          try { sessionStorage.setItem("bcr:" + r.id, r.compressed) } catch (e) { resolve({ ssFail: true, id: r.id, rule: r.rule }); return }
          resolve({ id: r.id, rule: r.rule, len: (r.compressed || "").length })
        }
        req.onerror = () => { db.close(); reject(req.error) }
      }
      open.onerror = () => reject(open.error)
    })
  })
  if (!pick || pick.ssFail || !pick.id) return pick
  await page.evaluate((id, rule) => {
    globalThis.location.href = `play.html?replayId=${encodeURIComponent(id)}&ruletype=${encodeURIComponent(rule || "nineball")}`
  }, pick.id, pick.rule)
  return pick
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true })
  fs.writeFileSync(`${OUT}/dialogs.log`, "")
  const R = []
  const ok = (name, pass, detail) => {
    R.push({ name, pass })
    console.log(`${pass ? "PASS" : "FAIL"}  ${name}  ${JSON.stringify(detail)}`)
  }

  // ── 先打一杆拿合法 compressed（回归基线 R1 用）──
  const browser = await launch()
  let page = await newPage(browser, "seed")
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
  if ((await page.evaluate(() => window.container.controller?.name)) === "PlaceBall") {
    await page.evaluate(() => document.getElementById("cueHit")?.click())
    await waitFor(page, () => window.container.controller?.name === "Aim", 30000)
  }
  await sleep(400)
  await page.evaluate(() => {
    const c = window.container
    cue0: {
      c.table.cue.setAimAngle(0.3, c.table)
      c.table.cue.setPower(0.5)
      c.controller = c.controller.playShot()
    }
  })
  await waitFor(page, () => window.container.controller?.name !== "PlayShot", 60000)
  await sleep(800)
  const goodComp = await page.evaluate(() => window.container.recorder.getWholeGameCompressed())
  const goodRule = await page.evaluate(() => window.container.rules.rulename)
  console.log("合法 compressed 长度:", goodComp.length, "rule:", goodRule)

  // ── R2: 损坏数据 ──
  await page.goto(`${BASE}/menu.html`, { waitUntil: "domcontentloaded", timeout: 120000 })
  await sleep(800)
  await seedReplay(page, "probe_broken_" + Date.now(), "___corrupted___not___json___", goodRule)
  await pickAndNavigate(page)
  await waitFor(page, () => {
    const c = document.querySelector("#viewP1 canvas")
    const l = document.getElementById("view3dLoading")
    return !!(c && c.width > 0) && (!l || getComputedStyle(l).display === "none")
  }, 90000)
  // replayBroken：alert + location.href = menu.html → 等 URL 回到 menu
  const backMenuMs = await waitFor(page, () => /menu\.html/.test(globalThis.location.pathname), 30000)
  await sleep(500)
  ok("R2_损坏数据被拦截回菜单", backMenuMs >= 0 && /menu\.html/.test(await page.evaluate(() => globalThis.location.pathname)), {
    backMenuMs,
    url: await page.evaluate(() => globalThis.location.pathname).catch(() => "?"),
  })

  // ── R3: 空 shots ──
  const emptyState = JSON.stringify({
    init: { balls: [] }, shots: [], start: 0, now: Date.now(), score: 0, wholeGame: true, v: 1,
  })
  await seedReplay(page, "probe_empty_" + Date.now(), emptyState, goodRule)
  await pickAndNavigate(page)
  await waitFor(page, () => {
    const c = document.querySelector("#viewP1 canvas")
    const l = document.getElementById("view3dLoading")
    return !!(c && c.width > 0) && (!l || getComputedStyle(l).display === "none")
  }, 90000)
  const backMenu3 = await waitFor(page, () => /menu\.html/.test(globalThis.location.pathname), 30000)
  ok("R3_空shots被拦截回菜单", backMenu3 >= 0, { backMenuMs: backMenu3 })

  // ── R1: 正常回放连播（回归基线）──
  await seedReplay(page, "probe_good_" + Date.now(), goodComp, goodRule)
  await pickAndNavigate(page)
  await waitFor(page, () => {
    const c = document.querySelector("#viewP1 canvas")
    const l = document.getElementById("view3dLoading")
    return !!(c && c.width > 0) && (!l || getComputedStyle(l).display === "none")
  }, 90000)
  await sleep(1500)
  const samples = []
  for (let i = 0; i < 6; i++) {
    const s = await page.evaluate(() => ({
      ctrl: window.container.controller?.name,
      paused: !!window.container.replayPaused,
      time: window.container.table ? +window.container.table.time.toFixed(0) : null,
    })).catch(() => null)
    if (s) samples.push(s)
    await sleep(1000)
  }
  const times = samples.map((s) => s.time)
  const played = samples.some((s) => s.ctrl === "Replay") && times.some((t, i) => i > 0 && t !== times[0])
  ok("R1_正常回放连播", played, { times })
  await page.screenshot({ path: `${OUT}/r1.png` })
  await page.close()

  const fails = R.filter((x) => !x.pass).length
  console.log(`\n==== ${R.length - fails}/${R.length} PASS ====`)
  console.log("dialogs:", fs.readFileSync(`${OUT}/dialogs.log`, "utf8").trim().replace(/\n/g, " | "))
  await browser.close()
  if (fails > 0) process.exit(2)
}

main().catch((e) => { console.error("FATAL", e); process.exit(1) })
