/**
 * v1.5.6（#83）取证探针 —— 开局后能否设置白球摆球位置。
 *
 *   P1 开局是否进入 PlaceBall 控制器（若直接 Aim 则玩家根本没机会摆球）
 *   P2 若进入 PlaceBall：点击球桌另一处，白球位置是否随之改变
 *   P3 零页面错误
 */
const puppeteer = require("puppeteer-core")
const fs = require("fs")
const OUT = "/tmp/v156-place"
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
    headless: true,
    protocolTimeout: 45000,
    args: [
      "--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu",
      "--user-data-dir=/tmp/chrome-pb156", "--window-size=393,851",
    ],
    env: { ...process.env, DISPLAY: "" },
  })
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true })
  const browser = await launch()
  const page = await browser.newPage()
  await page.setCacheEnabled(false)
  await page.setViewport({ width: 393, height: 851, deviceScaleFactor: 1 })
  const errs = []
  page.on("pageerror", (e) => errs.push(String(e).slice(0, 160)))
  const ok = (n, p, d) => console.log(`${p ? "PASS" : "FAIL"}  ${n}  ${JSON.stringify(d).slice(0, 300)}`)

  console.log("[1] 进 8球人机对战…")
  await page.goto(`${BASE}/play.html?ruletype=eightball&bot=ClawBreak`, { waitUntil: "domcontentloaded", timeout: 120000 })
  await waitFor(page, () => {
    const c = document.querySelector("#viewP1 canvas")
    const l = document.getElementById("view3dLoading")
    return !!(c && c.width > 0) && (!l || getComputedStyle(l).display === "none")
  }, 90000)
  await sleep(1200)

  // 记录开局 controller 序列（前 6 秒每 150ms 采样一次）
  await page.evaluate(() => {
    window.__ctrlSeq = []
    window.__seqTimer = setInterval(() => {
      const n = window.container?.controller?.name
      if (n && window.__ctrlSeq[window.__ctrlSeq.length - 1] !== n) window.__ctrlSeq.push(n)
      const ack = document.querySelector('[data-tut-ack="1"]')
      if (ack) ack.click()
    }, 150)
  })
  await sleep(6000)
  const seq = await page.evaluate(() => { clearInterval(window.__seqTimer); return window.__ctrlSeq })
  console.log("开局 controller 序列:", JSON.stringify(seq))

  const st = await page.evaluate(() => {
    const c = window.container
    return {
      ctrl: c?.controller?.name,
      ballPos: { x: +c.table.cueball.pos.x.toFixed(4), y: +c.table.cueball.pos.y.toFixed(4) },
      allowsPlaceBall: c.rules?.allowsPlaceBall?.(),
      botMode: !!c.isSinglePlayer ? "single" : "bot?",
    }
  })
  console.log("当前状态:", JSON.stringify(st))

  const inPlaceBall = st.ctrl === "PlaceBall"
  ok("P1_开局进入PlaceBall", inPlaceBall, { ctrl: st.ctrl, seq })

  if (inPlaceBall) {
    // 尝试点击球桌另一处
    // PlaceBall 的点击监听挂在 container.view.element 上，探针必须用同一个元素
    const box = await page.evaluate(() => {
      const el = window.container?.view?.element || document.querySelector("#viewP1 canvas")
      if (!el) return null
      const r = el.getBoundingClientRect()
      return { x: r.x, y: r.y, w: r.width, h: r.height, tag: el.tagName, id: el.id }
    })
    if (!box) throw new Error("找不到 view element（无法模拟点击）")
    console.log("  view element:", JSON.stringify(box))
    const before = st.ballPos
    await page.mouse.click(box.x + box.w * 0.62, box.y + box.h * 0.42)
    await sleep(600)
    const after = await page.evaluate(() => {
      const c = window.container
      return { x: +c.table.cueball.pos.x.toFixed(4), y: +c.table.cueball.pos.y.toFixed(4) }
    })
    const moved = Math.hypot(after.x - before.x, after.y - before.y) > 0.01
    ok("P2_点击球桌可移动白球", moved, { before, after })

    // P4：确认摆球后必须正常进 Aim（v1.3.85 曾卡死在 PlaceBall：白楔常驻、球杆不可见）
    await page.evaluate(() => document.getElementById("cueHit")?.click())
    await sleep(1500)
    const afterConfirm = await page.evaluate(() => ({
      ctrl: window.container?.controller?.name,
      pos: { x: +window.container.table.cueball.pos.x.toFixed(4), y: +window.container.table.cueball.pos.y.toFixed(4) },
    }))
    ok("P4_确认摆球后进入Aim(不卡死)", afterConfirm.ctrl === "Aim", afterConfirm)

    // P5：摆好的位置开打后，bot 能正常接管（整局不卡）
    await page.evaluate(() => {
      const c = window.container
      c.table.cue.setAimAngle(0.1, c.table)
      c.table.cue.setPower(0.6)
      c.controller = c.controller.playShot()
    })
    const shotDone = await waitFor(page, () => window.container.controller?.name !== "PlayShot", 60000)
    await sleep(3000)
    const seq2 = await page.evaluate(() => window.container?.controller?.name)
    ok("P5_开球后流程推进", shotDone >= 0 && seq2 !== "PlaceBall", { shotDone, ctrlAfter: seq2 })
  } else {
    console.log("跳过 P2：未进入 PlaceBall（人机模式跳过交互式摆球）")
  }
  ok("P3_零页面错误", errs.length === 0, { errs: errs.slice(0, 3) })
  await page.screenshot({ path: `${OUT}/placeball.png` })
  await browser.close()
}
main().catch((e) => { console.error("FATAL", e); process.exit(1) })
