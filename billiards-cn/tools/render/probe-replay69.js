/**
 * #69 复现探针：保存回放后「快速」退回主菜单 → 从「我的回放」进入回放 → 回放不动。
 *
 * 端到端对照实验（同一脚本内先后跑两个场景）：
 *   A（快速）: 取 compressed → 发起 IndexedDB 保存（不等待完成，模拟 fire-and-forget）
 *             → 立刻 location.href="menu.html"（构造「快速点击退回主菜单」的竞争窗口）
 *   B（慢速）: 取 compressed → 保存并等待 oncomplete → 再等 1.5s → 跳 menu.html
 *   之后统一模拟「我的回放」点选：menu 页读 IndexedDB 最新记录 → sessionStorage
 *   写 "bcr:<id>" → play.html?replayId=... → 采样回放状态。
 *
 * 「回放不动」判据：进入 play 后 12s 内
 *   R1 controller.name 必须变成 Replay（BreakEvent 被 handleBreak 消费）
 *   R2 table.time / 白球位置 必须发生变化（物理在播）
 *   R3 replayPaused 必须为 false
 */
const puppeteer = require("puppeteer-core")
const fs = require("fs")
const OUT = "/tmp/v154-t69"
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
      "--enable-unsafe-swiftshader", "--user-data-dir=/tmp/chrome-t69-" + Math.random().toString(36).slice(2),
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

/** 打一杆并返回 compressed 回放串 */
async function playOneShotAndGetReplay(page) {
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
    if ((await waitFor(page, () => window.container.controller?.name === "Aim", 30000)) < 0) {
      throw new Error("放球后未进入瞄准")
    }
  }
  await sleep(500)
  // 平杆轻打一杆（不过度纠缠物理结果，recorder 只要有 AIM+SHOT 事件即可）
  await page.evaluate(() => {
    const c = window.container
    const cue = c.table.cue
    cue.setAimAngle(0.3, c.table)
    cue.setPower(0.5)
    c.controller = c.controller.playShot()
  })
  // 等本杆结算（回到 Aim / PlaceBall / Watch*）
  await waitFor(page, () => {
    const n = window.container.controller?.name
    return n !== "PlayShot" && n !== "Replay"
  }, 60000)
  await sleep(1200)
  return page.evaluate(() => {
    const comp = window.container.recorder.getWholeGameCompressed()
    const rule = window.container.rules.rulename
    // 模拟「保存回放」按钮的 IndexedDB 写入（同 replay-store.ts 的库/表）
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
        const rec = {
          id: "probe_" + Date.now(),
          rule,
          compressed: comp,
          createdAt: Date.now(),
          score: 1,
          label: "probe replay",
        }
        const tx = db.transaction("replays", "readwrite")
        tx.objectStore("replays").put(rec)
        tx.oncomplete = () => { db.close(); resolve({ id: rec.id, rule, len: comp.length }) }
        tx.onerror = () => { db.close(); resolve({ id: rec.id, rule, len: comp.length, putError: String(tx.error) }) }
      }
      open.onerror = () => resolve({ id: "openfail", rule, len: comp.length })
    })
  })
}

/** menu 页模拟「我的回放」点选最新记录并跳转 play */
async function pickReplayFromMenu(page) {
  await page.goto(`${BASE}/menu.html`, { waitUntil: "domcontentloaded", timeout: 120000 })
  await sleep(1200)
  return page.evaluate(() => {
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
          try {
            sessionStorage.setItem("bcr:" + r.id, r.compressed)
          } catch (e) { resolve({ pickError: "ss-fail:" + e }); return }
          resolve({ id: r.id, rule: r.rule, len: r.compressed.length })
        }
        req.onerror = () => { db.close(); reject(req.error) }
      }
      open.onerror = () => reject(open.error)
    })
  })
}

async function sampleReplay(page, seconds) {
  const samples = []
  for (let i = 0; i < seconds; i++) {
    const s = await page.evaluate(() => {
      const c = window.container
      const cb = c && c.table && c.table.cueball
      return {
        ctrl: c && c.controller && c.controller.name,
        replayMode: !!(c && c.replayMode),
        paused: !!(c && c.replayPaused),
        time: c && c.table ? +c.table.time.toFixed(1) : null,
        pos: cb ? { x: +cb.pos.x.toFixed(3), y: +cb.pos.y.toFixed(3) } : null,
        q: c && c.eventQueue ? c.eventQueue.length : null,
      }
    }).catch(() => null)
    if (s) samples.push(s)
    await sleep(1000)
  }
  return samples
}

async function runScenario(browser, tag, quickExit) {
  console.log(`\n──── 场景 ${tag}（${quickExit ? "保存后立刻退出" : "保存后等待 1.5s 退出"}）────`)
  // 1) play 页打一杆 + 保存
  let page = await newPage(browser)
  const saved = await playOneShotAndGetReplay(page)
  console.log("保存:", JSON.stringify(saved))
  // 2) 退出时机
  if (quickExit) {
    await page.evaluate(() => { globalThis.location.href = "menu.html" })
  } else {
    await sleep(1500)
    await page.evaluate(() => { globalThis.location.href = "menu.html" })
  }
  // 3) menu 页点选最新回放
  const pick = await pickReplayFromMenu(page)
  console.log("菜单选取:", JSON.stringify(pick))
  if (!pick || !pick.id) {
    console.log(`${tag} → 记录丢失（IndexedDB 写入没能在退出前完成）`)
    await page.close()
    return { tag, lost: true }
  }
  // 4) 跳 play 回放
  await page.evaluate((id, rule) => {
    globalThis.location.href = `play.html?replayId=${encodeURIComponent(id)}&ruletype=${encodeURIComponent(rule || "nineball")}`
  }, pick.id, pick.rule)
  await waitFor(page, () => {
    const c = document.querySelector("#viewP1 canvas")
    const l = document.getElementById("view3dLoading")
    return !!(c && c.width > 0) && (!l || getComputedStyle(l).display === "none")
  }, 90000)
  await sleep(2000)
  const samples = await sampleReplay(page, 10)
  console.log("回放采样:")
  samples.forEach((s, i) => console.log(`  t+${i}s  ${JSON.stringify(s)}`))
  await page.close()
  return { tag, lost: false, samples }
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true })
  const browser = await launch()
  const A = await runScenario(browser, "A", true)
  const B = await runScenario(browser, "B", false)
  await browser.close()
  const judge = (r) => {
    if (r.lost) return "记录丢失"
    const s = r.samples || []
    const gotReplay = s.some((x) => x.ctrl === "Replay")
    const times = s.map((x) => x.time)
    const moved = times.some((t, i) => i > 0 && t !== times[0])
    const paused = s.every((x) => x.paused)
    return `ctrl进入Replay=${gotReplay} 物理推进=${moved} 全程paused=${paused}`
  }
  console.log(`\n==== 结论 ====`)
  console.log(`A(快速退出): ${judge(A)}`)
  console.log(`B(慢速退出): ${judge(B)}`)
  fs.writeFileSync(`${OUT}/result.json`, JSON.stringify({ A, B }, null, 2))
}

main().catch((e) => { console.error("FATAL", e); process.exit(1) })
