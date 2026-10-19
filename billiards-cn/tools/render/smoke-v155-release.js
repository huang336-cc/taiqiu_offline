/**
 * v1.5.5 发版冒烟探针 —— 升号 + changelog + 游戏健康三连检。
 *
 *   S1 menu.html 运行时版本串 __BILLIARDS_VERSION__ === 1.5.5-26092915
 *   S2 #versionCell 可见文本含 1.5.5
 *   S3 点「变更履历」→ #changelogBody 渲染 v1.5.5 标题 + #73~#77 五条目 + v1.5.4 历史仍在
 *   S4 进 8球人机对战 → canvas 渲染 + 瞄准就绪（自动关 Tutorial）+ 3s 零 pageerror
 *   截图：changelog.png / play.png
 */
const puppeteer = require("puppeteer-core")
const fs = require("fs")
const OUT = "/tmp/v155-release"
const BASE = process.env.BASE || "http://127.0.0.1:8160/dist"
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function tmo(p, ms, label) {
  return Promise.race([
    p,
    new Promise((_, rej) => setTimeout(() => rej(new Error(`TMO(${label})`)), ms)),
  ])
}
async function waitFor(page, fn, timeout = 30000, every = 200) {
  const t0 = Date.now()
  let r
  while ((r = await page.evaluate(fn).catch(() => false)) === false) {
    if (Date.now() - t0 > timeout) return -1
    await sleep(every)
  }
  return Date.now() - t0
}
async function launch() {
  return puppeteer.launch({
    executablePath: "/usr/bin/google-chrome",
    headless: true,
    protocolTimeout: 45000,
    args: [
      "--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu",
      "--user-data-dir=/tmp/chrome-relv", "--window-size=393,851",
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
  const ok = (name, pass, detail) => console.log(`${pass ? "PASS" : "FAIL"}  ${name}  ${JSON.stringify(detail).slice(0, 240)}`)

  // ---------- [1] menu 版本 ----------
  console.log("[1] 开菜单页验版本…")
  await page.goto(`${BASE}/menu.html`, { waitUntil: "domcontentloaded", timeout: 60000 })
  await sleep(1500)
  const ver = await page.evaluate(() => ({
    raw: window.__BILLIARDS_VERSION__,
    cell: document.getElementById("versionCell")?.textContent?.trim() || "",
  }))
  ok("S1_运行时版本串", ver.raw === "1.5.5-26092915", ver)
  ok("S2_版本显示单元格", ver.cell.includes("1.5.5"), { cell: ver.cell.slice(0, 60) })

  // ---------- [2] 变更履历渲染 ----------
  console.log("[2] 点变更履历…")
  await page.evaluate(() => document.getElementById("btnChangelog")?.click())
  const cl = await waitFor(page, () => {
    const b = document.getElementById("changelogBody")
    return !!(b && b.textContent.includes("v1.5.5") && b.textContent.includes("#77"))
  }, 15000)
  const clBody = await page.evaluate(() => {
    const b = document.getElementById("changelogBody")
    return {
      v155: b?.querySelector("h3")?.textContent || "",
      items: ["#73", "#74", "#75", "#76", "#77"].filter((t) => b?.textContent.includes(t)),
      v154kept: b?.textContent.includes("v1.5.4"),
    }
  })
  ok("S3_履历v1.5.5条目渲染", cl > 0 && clBody.v155.includes("v1.5.5") && clBody.items.length === 5 && clBody.v154kept, clBody)
  await page.screenshot({ path: `${OUT}/changelog.png` })

  // ---------- [3] 游戏健康 ----------
  console.log("[3] 进 8球人机对战…")
  await page.goto(`${BASE}/play.html?ruletype=eightball&bot=ClawBreak`, { waitUntil: "domcontentloaded", timeout: 120000 })
  await waitFor(page, () => {
    const c = document.querySelector("#viewP1 canvas")
    const l = document.getElementById("view3dLoading")
    return !!(c && c.width > 0) && (!l || getComputedStyle(l).display === "none")
  }, 90000)
  const ready = await waitFor(page, () => {
    const c = window.container
    const cue = c && c.table && c.table.cue
    if (!c || !cue || !cue.aimInputs) return false
    const ack = document.querySelector('[data-tut-ack="1"]')
    if (ack) { ack.click(); return false }
    const n = c.controller && c.controller.name
    if (n === "PlaceBall") { document.getElementById("cueHit")?.click(); return false }
    return !cue.aimInputs.isDisabled()
  }, 150000)
  await sleep(3000)
  const diag = await page.evaluate(() => ({
    ctrl: window.container?.controller?.name,
    rule: window.container?.rules?.rulename,
  }))
  ok("S4_游戏健康瞄准就绪", ready >= 0 && errs.length === 0, { ready_ms: ready, ...diag, pageErr: errs })
  await page.screenshot({ path: `${OUT}/play.png` })

  await browser.close()
  console.log("合计：发版冒烟", (ver.raw === "1.5.5-26092915" && ver.cell.includes("1.5.5") && cl > 0 && ready >= 0 && errs.length === 0) ? "PASS" : "FAIL")
}
main().catch((e) => { console.error("FATAL", e); process.exit(1) })
