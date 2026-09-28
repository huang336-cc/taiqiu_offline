/**
 * #72 修复验证探针 —— 力度跨回合复位（v1.5.4）。
 *
 * 预期（修复后）：
 *   P1 首杆开球：保留默认 0.65（探针设 0.9 → 出杆仍 0.9）——isFirstShot 跳过复位
 *   P2 开球后的第一个新回合：起点力度 = 0.35（复位生效），UI 同步
 *   P3 再拉 0.9 出杆，下一个新回合：又复位 0.35
 *   P4 打点/仰角仍复位（回归 v1.4.0 行为）
 */
const puppeteer = require("puppeteer-core")
const fs = require("fs")
const OUT = "/tmp/v154-t72v"
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
      "--enable-unsafe-swiftshader", "--user-data-dir=/tmp/chrome-t72v",
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
  page.on("pageerror", (e) => errs.push("pageerror: " + String(e).slice(0, 160)))

  const R = { checks: [] }
  const ok = (name, pass, detail) => {
    R.checks.push({ name, pass, detail })
    console.log(`${pass ? "PASS" : "FAIL"}  ${name}  ${JSON.stringify(detail)}`)
  }

  await page.goto(`${BASE}/menu.html`, { waitUntil: "domcontentloaded", timeout: 120000 })
  await waitFor(page, () => {
    const e = document.getElementById("btnStart")
    return !!e && e.getBoundingClientRect().width > 0
  }, 60000)
  await sleep(800)
  await page.evaluate(() => document.getElementById("btnStart")?.click())
  await waitFor(page, () => {
    const c = document.querySelector("#viewP1 canvas")
    const l = document.getElementById("view3dLoading")
    return !!(c && c.width > 0) && (!l || getComputedStyle(l).display === "none")
  }, 90000)
  await sleep(2000)

  const read = () =>
    page.evaluate(() => {
      const c = window.container
      const cue = c.table.cue
      const el = document.getElementById("cuePower")
      const tip = document.getElementById("cueTip")
      const ball = document.getElementById("cueBall")
      let tipRel = null
      if (tip && ball) {
        const tr = tip.getBoundingClientRect()
        const br = ball.getBoundingClientRect()
        if (br.width > 0 && tr.width > 0) {
          tipRel = {
            x: +((tr.left + tr.width / 2 - br.left) / br.width).toFixed(2),
            y: +((tr.top + tr.height / 2 - br.top) / br.height).toFixed(2),
          }
        }
      }
      return {
        power: +(cue.aim.power / (160 * 0.032745)).toFixed(3), // maxPower=160R, R≈0.032745
        uiPower: el ? +(+el.value).toFixed(3) : null,
        offX: +cue.aim.offset.x.toFixed(4),
        offY: +cue.aim.offset.y.toFixed(4),
        elev: +cue.aim.elevation.toFixed(4),
        tipUI: tipRel,
        ctrl: (c.controller && c.controller.name) || "?",
        disabled: !!(cue.aimInputs && cue.aimInputs.isDisabled()),
      }
    })

  // 等玩家可出杆的瞄准状态（Aim 控制器 + enabled）
  const waitAim = async (budget = 150000) => {
    const ms = await waitFor(page, () => {
      const c = window.container
      const cue = c && c.table && c.table.cue
      return !!(
        cue &&
        cue.aimInputs &&
        !cue.aimInputs.isDisabled() &&
        c.controller &&
        c.controller.name === "Aim"
      )
    }, budget)
    if (ms >= 0) await sleep(700)
    return ms
  }

  const shoot = async () => {
    await page.evaluate(() => document.getElementById("cueHit")?.click())
    // 等真正进入出杆动画（PlayShot）确认点击生效
    const ms = await waitFor(page, () => {
      const c = window.container
      return !!(c.controller && (c.controller.name === "PlayShot" || c.controller.name === "Replay"))
    }, 10000)
    return ms
  }

  // ---------- P1 开球 ----------
  // 人机八球开局先进 PlaceBall（开球线摆球），点「摆球」按钮放球后才进 Aim。
  let ms = await waitFor(
    page,
    () => {
      const c = window.container
      const cue = c && c.table && c.table.cue
      return !!(cue && cue.aimInputs && !cue.aimInputs.isDisabled())
    },
    150000
  )
  if (ms < 0) throw new Error("等开局控件超时")
  const c0 = await read()
  if (c0.ctrl === "PlaceBall") {
    await page.evaluate(() => document.getElementById("cueHit")?.click())
    await waitAim(30000)
  }
  await page.evaluate(() => window.container.table.cue.setPower(0.9))
  const p1 = await read()
  await shoot()
  ok("P1_首杆开球保留大力", p1.power > 0.8 && p1.uiPower > 0.8, p1)

  // ---------- P2 开球后第一个新回合 ----------
  ms = await waitAim(150000)
  if (ms < 0) throw new Error("等新回合超时")
  await sleep(500)
  const p2 = await read()
  await page.screenshot({ path: `${OUT}/p2-first-new-turn.png` })
  ok(
    "P2_新回合力度复位0.35",
    Math.abs(p2.power - 0.35) < 0.01 && Math.abs(p2.uiPower - 0.35) < 0.01,
    p2
  )
  ok("P2b_打点/仰角仍复位", p2.offX === 0 && p2.offY === 0 && p2.elev === 0, {
    offX: p2.offX, offY: p2.offY, elev: p2.elev, tipUI: p2.tipUI,
  })

  // ---------- P3 再拉大力出杆 → 下一回合又复位 ----------
  await page.evaluate(() => window.container.table.cue.setPower(0.9))
  await shoot()
  ms = await waitAim(150000)
  if (ms < 0) throw new Error("等第二个新回合超时")
  await sleep(500)
  const p3 = await read()
  ok(
    "P3_再次复位0.35",
    Math.abs(p3.power - 0.35) < 0.01 && Math.abs(p3.uiPower - 0.35) < 0.01,
    p3
  )
  ok("P3b_打点/仰角复位", p3.offX === 0 && p3.offY === 0 && p3.elev === 0, {
    offX: p3.offX, offY: p3.offY, elev: p3.elev,
  })

  R.errors = errs
  fs.writeFileSync(`${OUT}/result.json`, JSON.stringify(R, null, 2))
  const fails = R.checks.filter((c) => !c.pass).length
  console.log(`\n==== ${R.checks.length - fails}/${R.checks.length} PASS ====`)
  await browser.close()
  if (fails > 0) process.exit(2)
}

main().catch((e) => {
  console.error("FATAL", e)
  process.exit(1)
})
