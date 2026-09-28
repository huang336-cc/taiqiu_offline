/**
 * #69 复现探针 v3：用户路径 1:1 复刻。
 *
 * 1. play.html?bot=ClawBreak 真实打完整局（随机出杆，等 AI 回合轮流），
 *    直到结算面板出现（Game Over 通知带「保存回放」按钮）
 * 2. 真实点击「保存回放」按钮（matchresult buildSaveReplayHandler）
 * 3. 立刻真实点击「返回主菜单」（结算面板按钮 → __showExitConfirm 弹窗）
 *    → 立刻点击弹窗里的「返回主菜单」确认按钮 → location.replace(menu.html)
 * 4. menu.html：读 IndexedDB 最新记录 → sessionStorage 写 bcr → play.html?replayId
 * 5. 深度采样 15s：controller / paused / timeScale / shots 队列 / table.time
 */
const puppeteer = require("puppeteer-core")
const fs = require("fs")
const OUT = "/tmp/v154-t69v3"
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

async function main() {
  fs.mkdirSync(OUT, { recursive: true })
  const browser = await puppeteer.launch({
    executablePath: "/usr/bin/google-chrome",
    headless: "new",
    args: [
      "--no-sandbox", "--hide-scrollbars", "--disable-dev-shm-usage", "--no-zygote",
      "--ozone-platform=headless", "--use-gl=angle", "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader", "--user-data-dir=/tmp/chrome-t69v3",
      "--in-process-gpu", "--disable-gpu-sandbox", "--window-size=393,851",
    ],
    env: { ...process.env, DISPLAY: "" },
  })
  const page = await browser.newPage()
  await page.setCacheEnabled(false)
  await page.setViewport({ width: 393, height: 851, deviceScaleFactor: 2 })
  await page.evaluateOnNewDocument(() => {
    try { localStorage.setItem("billiards_cn_seenGuide_v1", "1") } catch (e) {}
  })
  const errs = []
  page.on("pageerror", (e) => errs.push("pageerror: " + String(e).slice(0, 200)))

  // ── 1. 开局 ──
  await page.goto(`${BASE}/play.html?bot=ClawBreak`, { waitUntil: "domcontentloaded", timeout: 120000 })
  await waitFor(page, () => {
    const c = document.querySelector("#viewP1 canvas")
    const l = document.getElementById("view3dLoading")
    return !!(c && c.width > 0) && (!l || getComputedStyle(l).display === "none")
  }, 90000)
  await sleep(1500)

  // ── 2. 轮流出杆直到结算面板 ──
  let shots = 0
  const panelMs = await (async () => {
    const t0 = Date.now()
    while (Date.now() - t0 < 480000 && shots < 60) {
      // 结算面板出现？
      const hasPanel = await page.evaluate(() =>
        !!document.querySelector('[data-notification-action="saveReplay"]')
      ).catch(() => false)
      if (hasPanel) return Date.now() - t0
      // 轮到玩家就出杆
      const my = await page.evaluate(() => {
        const c = window.container
        const cue = c && c.table && c.table.cue
        const n = c && c.controller && c.controller.name
        if (n === "PlaceBall" && cue && cue.aimInputs && !cue.aimInputs.isDisabled()) return "place"
        if (n === "Aim" && cue && cue.aimInputs && !cue.aimInputs.isDisabled()) return "aim"
        return null
      }).catch(() => null)
      if (my === "place") {
        await page.evaluate(() => document.getElementById("cueHit")?.click())
        await sleep(400)
        continue
      }
      if (my === "aim") {
        await page.evaluate(() => {
          const c = window.container
          const cue = c.table.cue
          cue.setAimAngle(Math.random() * Math.PI * 2, c.table)
          cue.setPower(0.45 + Math.random() * 0.35)
          c.controller = c.controller.playShot()
        })
        shots++
        await sleep(2500)
        continue
      }
      await sleep(600)
    }
    return -1
  })()
  console.log("对局结束:", panelMs >= 0 ? `结算面板出现（共 ${shots} 杆）` : "超时未结算")
  if (panelMs < 0) { await browser.close(); process.exit(1) }

  // ── 3. 真实点击「保存回放」→ 立刻点「返回主菜单」→ 确认 ──
  await page.evaluate(() => {
    const btn = document.querySelector('[data-notification-action="saveReplay"]')
    btn && btn.click()
  })
  const tSave = Date.now()
  await page.evaluate(() => {
    const btn = document.querySelector('[data-notification-action="menu"]')
    btn && btn.click()
  })
  await sleep(250) // 弹窗渲染
  await page.screenshot({ path: `${OUT}/confirm.png` })
  await page.evaluate(() => {
    const btn = document.querySelector("#back-confirm-cn-backdrop .bcbtn.danger")
    btn && btn.click()
  })
  console.log("保存→退出间隔(ms):", Date.now() - tSave)

  // ── 4. menu 选最新回放 ──
  await waitFor(page, () => !!document.getElementById("btnStart"), 60000)
  await sleep(1500)
  const pick = await page.evaluate(() => {
    return new Promise((resolve) => {
      const open = indexedDB.open("billiards_replays", 1)
      open.onsuccess = () => {
        const db = open.result
        const tx = db.transaction("replays", "readonly")
        const req = tx.objectStore("replays").getAll()
        req.onsuccess = () => {
          db.close()
          const list = (req.result || []).sort((a, b) => b.createdAt - a.createdAt)
          if (list.length === 0) { resolve({ none: true }); return }
          const r = list[0]
          let ok = true
          try { sessionStorage.setItem("bcr:" + r.id, r.compressed) } catch (e) { ok = false }
          resolve({
            id: r.id, rule: r.rule, len: (r.compressed || "").length,
            compressedNull: r.compressed == null, ssOk: ok, total: list.length,
          })
        }
        req.onerror = () => { db.close(); resolve({ listErr: String(req.error) }) }
      }
      open.onerror = () => resolve({ openErr: String(open.error) })
    })
  })
  console.log("菜单选取:", JSON.stringify(pick))
  if (!pick || !pick.id) { await browser.close(); process.exit(2) }

  await page.evaluate((id, rule) => {
    globalThis.location.href = `play.html?replayId=${encodeURIComponent(id)}&ruletype=${encodeURIComponent(rule || "nineball")}`
  }, pick.id, pick.rule)
  await waitFor(page, () => {
    const c = document.querySelector("#viewP1 canvas")
    const l = document.getElementById("view3dLoading")
    return !!(c && c.width > 0) && (!l || getComputedStyle(l).display === "none")
  }, 90000)
  await sleep(2000)

  // ── 5. 深度采样 ──
  const samples = []
  for (let i = 0; i < 15; i++) {
    const s = await page.evaluate(() => {
      const c = window.container
      const rp = c && c.controller
      const cb = c && c.table && c.table.cueball
      return {
        ctrl: rp && rp.name,
        paused: !!(c && c.replayPaused),
        userPaused: rp && rp.userPaused !== undefined ? !!rp.userPaused : null,
        metaLen: rp && rp.shotMeta ? rp.shotMeta.length : null,
        allLen: rp && rp.allShots ? rp.allShots.length : null,
        qLen: rp && rp.shots ? rp.shots.length : null,
        time: c && c.table ? +c.table.time.toFixed(0) : null,
      }
    }).catch(() => null)
    if (s) samples.push(s)
    await sleep(1000)
  }
  samples.forEach((s, i) => console.log(`t+${i}s ${JSON.stringify(s)}`))
  await page.screenshot({ path: `${OUT}/final.png` })
  fs.writeFileSync(`${OUT}/samples.json`, JSON.stringify({ errs, samples }, null, 2))
  await browser.close()
}

main().catch((e) => { console.error("FATAL", e); process.exit(1) })
