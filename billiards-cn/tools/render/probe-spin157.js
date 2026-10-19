/**
 * v1.5.7（#87）**多路径**回合残留取证探针。
 *
 * 用户反馈：「轮到我的回合，未调整白球击球点直接击球还是高杆进袋」。
 *
 * 上一轮只测了「出杆 → 等回玩家回合」这一条路径，结论是复位生效
 * （offY 0.42→0、power 4.716→1.834）。既然标准路径不复现，就必须把
 * **所有**回到玩家回合的路径都跑一遍：
 *   A 玩家出杆 → 不进球 → AI 打 → 回玩家
 *   B 玩家出杆 → 进球 → 玩家继续（连续回合，控件从未 disable→enable 之外）
 *   C 玩家犯规（白球摔袋）→ AI 自由球 → 回玩家
 *   D 开球首杆之后
 * 每条路径都记录「回合开始瞬间的 aim.offset / elevation / power」以及
 * 途中经过的控制器序列，找出到底哪条路径没复位。
 */
const puppeteer = require("puppeteer-core")
const fs = require("fs")
const OUT = "/tmp/v157-spin"
const BASE = process.env.BASE || "http://127.0.0.1:8181"
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function waitFor(page, fn, budget = 90000, every = 150) {
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
    protocolTimeout: 120000,
    args: [
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--use-gl=angle",
      "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader",
      "--user-data-dir=/tmp/chrome-spin157",
      "--window-size=393,851",
    ],
    env: { ...process.env, DISPLAY: "" },
  })
}

const AIM = () => {
  const c = window.container
  const a = c?.table?.cue?.aim
  if (!a) return null
  return {
    offX: Number(a.offset?.x ?? 0),
    offY: Number(a.offset?.y ?? 0),
    elev: Number(a.elevation ?? 0),
    power: Number(a.power ?? 0),
    ctrl: c.controller?.name ?? "?",
    disabled: !!c.table?.cue?.aimInputs?.controlsDisabled,
  }
}

/** 装一个控制器轨迹记录器 */
const INSTALL_TRACER = () => {
  window.__trace = []
  const c = window.container
  if (!c) return false
  let last = null
  window.__tracerTimer = setInterval(() => {
    const n = c.controller?.name
    if (n && n !== last) {
      last = n
      const a = c.table?.cue?.aim
      window.__trace.push({
        ctrl: n,
        offY: a ? Number(a.offset?.y ?? 0) : null,
        power: a ? Number(a.power ?? 0) : null,
        t: Date.now(),
      })
    }
  }, 50)
  return true
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true })
  const browser = await launch()
  const page = await browser.newPage()
  await page.setCacheEnabled(false)
  await page.setViewport({ width: 393, height: 851, deviceScaleFactor: 1 })
  const errs = []
  page.on("pageerror", (e) => errs.push(String(e).slice(0, 300)))

  console.log("[1] 进 8 球人机对战…")
  await page.goto(`${BASE}/play.html?ruletype=eightball&bot=ClawBreak`, {
    waitUntil: "domcontentloaded",
    timeout: 120000,
  })
  const ready = await waitFor(page, () => {
    const cv = document.querySelector("#viewP1 canvas")
    const l = document.getElementById("view3dLoading")
    const hidden = !l || getComputedStyle(l).display === "none" || l.style.display === "none"
    return !!cv && hidden && !!window.container?.table?.cue?.aim
  })
  console.log(`    就绪耗时 ${ready}ms`)
  if (ready < 0) throw new Error("页面未就绪")

  await waitFor(page, () => window.container?.controller?.name === "Aim", 60000)
  await page.evaluate(INSTALL_TRACER)
  console.log(`    初始: ${JSON.stringify(await page.evaluate(AIM))}`)

  // ── 逐杆跑：每杆都故意设成「高杆 + 大力」，看下一回合是否残留 ──
  for (let shot = 1; shot <= 6; shot++) {
    // 等到玩家可操作
    const ok = await waitFor(
      page,
      () =>
        window.container?.controller?.name === "Aim" &&
        !window.container?.table?.cue?.aimInputs?.controlsDisabled,
      90000
    )
    if (ok < 0) {
      console.log(`  杆${shot}: 等不到玩家回合，退出`)
      break
    }
    const before = await page.evaluate(AIM)
    console.log(
      `\n  杆${shot} 回合开始(未动任何控件): offY=${before.offY.toFixed(4)} elev=${before.elev.toFixed(
        4
      )} power=${before.power.toFixed(4)}  ${before.offY !== 0 || before.elev !== 0 ? "❌残留" : "✅已复位"}`
    )

    // 设成高杆 + 大力（这就是用户的操作）
    await page.evaluate(() => {
      const c = window.container
      const cue = c.table.cue
      cue.aim.offset.set(0, 0.42, 0)
      cue.aim.elevation = 0
      cue.aim.power = 0.9 * 160 * 0.03275
      cue.updateAimInput()
    })
    const seted = await page.evaluate(AIM)
    console.log(`        出杆前设定: offY=${seted.offY.toFixed(4)} power=${seted.power.toFixed(4)}`)

    // 出杆
    await page.evaluate(() => {
      window.container.controller.playShot()
    })
    // 等回到下一个玩家可操作回合
    const back = await waitFor(
      page,
      () =>
        window.container?.controller?.name === "Aim" &&
        !window.container?.table?.cue?.aimInputs?.controlsDisabled,
      120000
    )
    const trace = await page.evaluate(() => {
      const t = window.__trace.slice(-8)
      window.__trace = []
      return t
    })
    console.log(
      `        回玩家耗时 ${back}ms  控制器轨迹: ${trace.map((x) => x.ctrl).join(" → ")}`
    )
    const after = await page.evaluate(AIM)
    console.log(
      `        下一回合开始: offY=${after.offY.toFixed(4)} elev=${after.elev.toFixed(
        4
      )} power=${after.power.toFixed(4)}  ${
        after.offY !== 0 || after.elev !== 0 ? "❌残留" : "✅已复位"
      }`
    )
  }

  console.log(`\n  页面错误 ${errs.length} 条`)
  errs.slice(0, 5).forEach((e) => console.log("    " + e))
  await browser.close()
}

main().catch((e) => {
  console.error("FATAL", e)
  process.exit(1)
})
