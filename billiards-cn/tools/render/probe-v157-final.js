/**
 * v1.5.7 发布前**综合实机验收**探针。
 *
 *   V1（#84）白球击球点面板下方那行提示「拖动白球设置位置，球桌上同步显示
 *      行进路线」已从 dist/play.html 删除 —— 断言面板里再也找不到它。
 *   V2（#87）多杆回合残留：每杆都故意设成「高杆 + 满力」出杆，逐个回合
 *      检查回到玩家时 aim.offset / elevation / power 是否已复位。
 *      （修复点在 Aim.playShot() 末尾：事件发出后立刻清零，不再只依赖
 *        setDisabled(false) 这一条路径。）
 *
 * 用法：BASE=http://127.0.0.1:8181 node tools/render/probe-v157-final.js
 */
const puppeteer = require("puppeteer-core")
const fs = require("fs")
const OUT = "/tmp/v157-final"
const BASE = process.env.BASE || "http://127.0.0.1:8181"
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

let pass = 0
let fail = 0
function ok(name, cond, detail) {
  if (cond) {
    pass++
    console.log(`PASS  ${name}  ${detail ? JSON.stringify(detail) : ""}`)
  } else {
    fail++
    console.log(`FAIL  ${name}  ${detail ? JSON.stringify(detail) : ""}`)
  }
}

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
      "--user-data-dir=/tmp/chrome-v157f",
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

/**
 * 可出杆判据：Aim 控制器且带 playShot。
 *
 * 不检查 controlsDisabled —— 开了 bot 的对局里开球权可能在 AI 手里，此时
 * 控件恒为 disabled，等 `!isDisabled()` 会永远等不到（实测 150s 超时）。
 * 与 tools/render/probe-replay156-real.js 的 buildGame 同款做法：直接判定
 * 控制器类型后出杆。PlaceBall（开局摆球）用点击「击球」按钮确认跳过。
 */
const PLAYER_READY = () => {
  const c = window.container
  if (!c) return false
  const ctrl = c.controller
  if (!ctrl) return false
  if (ctrl.name === "PlaceBall") {
    document.getElementById("cueHit")?.click()
    return false
  }
  return ctrl.name === "Aim" && typeof ctrl.playShot === "function"
}

/** #84：击球点面板里的叶子文本清单 */
const CB_PANEL = () => {
  const popup = document.getElementById("cueballPopup")
  if (!popup) return { found: false, texts: [] }
  const items = [...popup.querySelectorAll("*")].filter(
    (e) => e.children.length === 0 && (e.textContent || "").trim()
  )
  return {
    found: true,
    texts: items.map((e) => ({
      cls: String(e.className || ""),
      txt: (e.textContent || "").trim().slice(0, 40),
      vis: getComputedStyle(e).visibility,
    })),
  }
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
  const ready = await waitFor(page, PLAYER_READY, 150000)
  console.log(`    就绪耗时 ${ready}ms`)
  if (ready < 0) throw new Error("页面未就绪")

  // ── V1（#84）击球点提示已删除 ──
  console.log("\n[2] V1（#84）白球击球点面板文本清单…")
  const panel = await page.evaluate(CB_PANEL)
  console.log("    " + JSON.stringify(panel.texts))
  const stillThere = (panel.texts || []).filter((t) =>
    t.txt.includes("同步显示行进路线")
  )
  ok("V1_击球点提示已删除", stillThere.length === 0, {
    残留条数: stillThere.length,
    残留内容: stillThere.map((t) => t.txt),
  })
  const hasTitle = (panel.texts || []).some((t) => t.txt.includes("白球击球点"))
  ok("V1b_标题仍在", hasTitle, { hasTitle })

  // ── V2（#87）多杆回合击球点复位 ──
  console.log("\n[3] V2（#87）逐杆设高杆+满力，检查下一回合是否残留…")
  const rows = []
  for (let shot = 1; shot <= 5; shot++) {
    const waited = await waitFor(page, PLAYER_READY, 120000)
    if (waited < 0) {
      console.log(`  杆${shot}: 等不到玩家回合，结束`)
      break
    }
    const before = await page.evaluate(AIM)
    rows.push({ shot, before })
    console.log(
      `  杆${shot} 回合开始: offY=${before.offY.toFixed(4)} elev=${before.elev.toFixed(
        4
      )} power=${before.power.toFixed(3)}`
    )
    // 故意设成高杆 + 满力
    await page.evaluate(() => {
      const cue = window.container.table.cue
      cue.aim.offset.set(0, 0.42, 0)
      cue.aim.elevation = 0
      cue.aim.power = 0.9 * 160 * 0.03275
      cue.updateAimInput()
    })
    await page.evaluate(() => {
      const c = window.container
      c.controller = c.controller.playShot()
    })
    await waitFor(page, PLAYER_READY, 120000)
  }
  const dirty = rows.filter(
    (r) => r.before.offY !== 0 || r.before.offX !== 0 || r.before.elev !== 0
  )
  ok("V2_每回合击球点均已复位", dirty.length === 0, {
    总杆数: rows.length,
    残留杆: dirty.map((r) => ({ shot: r.shot, offY: r.before.offY, elev: r.before.elev })),
  })
  // 力度：首杆保留开球默认大力，之后每杆应回到 35% 基准（1.834）
  const BASEP = 0.35 * 160 * 0.03275
  const badPower = rows.slice(1).filter((r) => Math.abs(r.before.power - BASEP) > 0.02)
  ok("V2b_每回合力度回到 35% 基准", badPower.length === 0, {
    基准: +BASEP.toFixed(3),
    异常杆: badPower.map((r) => ({ shot: r.shot, power: +r.before.power.toFixed(3) })),
    各杆力度: rows.map((r) => +r.before.power.toFixed(3)),
  })

  await page.screenshot({ path: `${OUT}/play.png` })
  ok("V3_零页面错误", errs.length === 0, { errs: errs.slice(0, 4) })
  console.log(`\n  通过 ${pass} / 失败 ${fail}`)
  await browser.close()
  if (fail > 0) process.exitCode = 1
}

main().catch((e) => {
  console.error("FATAL", e)
  process.exit(1)
})
