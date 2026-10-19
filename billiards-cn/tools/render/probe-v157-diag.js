/**
 * v1.5.7 综合取证探针（#84 / #87）
 *
 *   D1 白球击球点面板里「击球点下面的提示」到底是哪个元素（文本 + class + rect）
 *   D2 #87 回合切换残留：上一杆设成高杆 + 大力，AI 打完后回到玩家回合时
 *      aim.offset / elevation / power 是否被复位
 */
const puppeteer = require("puppeteer-core")
const fs = require("fs")
const OUT = "/tmp/v157-diag"
const BASE = process.env.BASE || "http://127.0.0.1:8160/dev/source/billiards-cn/dist"
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
function tmo(p, ms, label) {
  return Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`TMO(${label})`)), ms))])
}
async function waitFor(page, fn, budget = 60000, every = 200) {
  const t0 = Date.now()
  while (Date.now() - t0 < budget) {
    if (await page.evaluate(fn).catch(() => false)) return Date.now() - t0
    await sleep(every)
  }
  return -1
}
async function launch() {
  return puppeteer.launch({
    executablePath: "/usr/bin/google-chrome",
    headless: true,
    protocolTimeout: 60000,
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu",
      "--user-data-dir=/tmp/chrome-v157", "--window-size=393,851"],
    env: { ...process.env, DISPLAY: "" },
  })
}
const AIMSTATE = () => {
  const c = window.container
  const a = c?.table?.cue?.aim
  if (!a) return null
  return {
    offX: +Number(a.offset?.x ?? 0).toFixed(4),
    offY: +Number(a.offset?.y ?? 0).toFixed(4),
    elev: +Number(a.elevation ?? 0).toFixed(4),
    power: +Number(a.power ?? 0).toFixed(4),
    ctrl: c.controller?.name,
  }
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true })
  const browser = await launch()
  const page = await browser.newPage()
  await page.setCacheEnabled(false)
  await page.setViewport({ width: 393, height: 851, deviceScaleFactor: 1 })
  const errs = []
  page.on("pageerror", (e) => errs.push(String(e).slice(0, 200)))

  console.log("[1] 进 8球人机对战…")
  await page.goto(`${BASE}/play.html?ruletype=eightball&bot=ClawBreak`, { waitUntil: "domcontentloaded", timeout: 120000 })
  await waitFor(page, () => {
    const c = document.querySelector("#viewP1 canvas")
    const l = document.getElementById("view3dLoading")
    return !!(c && c.width > 0) && (!l || getComputedStyle(l).display === "none")
  }, 90000)
  await waitFor(page, () => {
    const c = window.container
    const cue = c && c.table && c.table.cue
    if (!cue || !cue.aimInputs) return false
    const ack = document.querySelector('[data-tut-ack="1"]')
    if (ack) { ack.click(); return false }
    if (c.controller?.name === "PlaceBall") { document.getElementById("cueHit")?.click(); return false }
    return !cue.aimInputs.isDisabled()
  }, 150000)
  await sleep(1500)
  console.log("  Aim 就绪:", JSON.stringify(await page.evaluate(AIMSTATE)))

  // ---- D1 击球点面板提示 ----
  console.log("[2] 打开白球击球点面板…")
  await page.evaluate(() => window.container.table.cue.aimInputs.toggleCueBallPopup())
  await sleep(600)
  const d1 = await page.evaluate(() => {
    const popup = document.getElementById("cueballPopup")
    if (!popup) return { err: "no popup" }
    const texts = []
    popup.querySelectorAll("*").forEach((el) => {
      if (el.children.length === 0) {
        const t = (el.textContent || "").trim()
        if (!t) return
        const r = el.getBoundingClientRect()
        texts.push({
          cls: el.className || el.tagName,
          txt: t.slice(0, 60),
          rect: { x: +r.x.toFixed(0), y: +r.y.toFixed(0), w: +r.width.toFixed(0), h: +r.height.toFixed(0) },
          vis: r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== "hidden",
        })
      }
    })
    return { hidden: popup.hidden, texts }
  })
  console.log("  面板文本元素:", JSON.stringify(d1, null, 1).slice(0, 2200))
  await page.evaluate(() => window.container.table.cue.aimInputs.toggleCueBallPopup())
  await sleep(300)
  await page.screenshot({ path: `${OUT}/popup.png` })

  // ---- D2 #87 回合切换残留 ----
  console.log("[3] 设成高杆 + 大力出杆…")
  const before = await page.evaluate(() => {
    const c = window.container
    const cue = c.table.cue
    cue.aim.offset.set(0, 0.42, 0) // 高杆（正 offY）
    cue.setPower(0.9)
    cue.updateAimInput()
    const a = cue.aim
    return { offX: +a.offset.x.toFixed(4), offY: +a.offset.y.toFixed(4), elev: +a.elevation.toFixed(4), power: +a.power.toFixed(4) }
  })
  console.log("  出杆前:", JSON.stringify(before))
  await page.evaluate(() => {
    const c = window.container
    c.controller = c.controller.playShot()
  })
  await waitFor(page, () => window.container.controller?.name !== "PlayShot", 60000)
  await sleep(1000)
  // 等回到玩家回合（Aim 且控件启用）
  const back = await waitFor(page, () => {
    const c = window.container
    const cue = c.table.cue
    if (!cue || !cue.aimInputs) return false
    if (c.controller?.name === "PlaceBall") { document.getElementById("cueHit")?.click(); return false }
    const isAim = c.controller?.name === "Aim"
    return isAim && !cue.aimInputs.isDisabled()
  }, 120000)
  await sleep(800)
  const after = await page.evaluate(AIMSTATE)
  console.log("  回到玩家回合(", back, "ms ):", JSON.stringify(after))
  const residual = after && (Math.abs(after.offY) > 1e-6 || Math.abs(after.offX) > 1e-6 || Math.abs(after.elev) > 1e-6)
  console.log(residual ? "  >>> 残留：击球点/抬杆未复位（#87 复现）" : "  >>> 已复位（#87 未复现，需换个路径再试）")

  console.log("[4] pageerror:", JSON.stringify(errs.slice(0, 3)))
  await browser.close()
}
main().catch((e) => { console.error("FATAL", e && e.message); process.exit(1) })
