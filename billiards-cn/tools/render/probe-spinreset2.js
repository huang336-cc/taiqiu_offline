/**
 * #72 取证探针 2 —— 补三个基础探针没覆盖的场景：
 *   A. 仰角滑杆（跳球抬杆）跨回合：setElevation(0.5) + 高杆打点 → 出杆 → 下一回合
 *      读数据 elevation/offset 与 UI（cueTilt 红点、打点红点）。
 *   B. 打点弹窗全程打开跨回合（用户习惯：调好打点直接点球按钮出杆，弹窗不关）。
 *   C. 每次启用瞬间同时抓 UI（弹窗强行打开再读），区分「数据残留」与「UI 残留」。
 */
const puppeteer = require("puppeteer-core")
const fs = require("fs")
const OUT = "/tmp/v154-t72b"
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

async function main() {
  fs.mkdirSync(OUT, { recursive: true })
  const browser = await puppeteer.launch({
    executablePath: "/usr/bin/google-chrome",
    headless: "new",
    args: [
      "--no-sandbox", "--hide-scrollbars", "--disable-dev-shm-usage", "--no-zygote",
      "--ozone-platform=headless", "--use-gl=angle", "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader", "--user-data-dir=/tmp/chrome-t72b",
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

  const R = { scenes: [] }
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

  // 读状态：数据 + UI（弹窗会临时打开，读完关掉）
  const snap = async (tag) => {
    // 强制打开弹窗读 UI
    await page.evaluate(() => {
      const p = document.getElementById("cueballPopup")
      if (p && p.hidden) document.getElementById("cueBallTrigger")?.click()
    })
    await sleep(250)
    const s = await page.evaluate(() => {
      const c = window.container
      const cue = c.table.cue
      const tip = document.getElementById("cueTip")
      const ball = document.getElementById("cueBall")
      const tilt = document.getElementById("cueTilt")
      let tipRel = null
      if (tip && ball) {
        const tr = tip.getBoundingClientRect()
        const br = ball.getBoundingClientRect()
        if (br.width > 0 && tr.width > 0) {
          tipRel = {
            x: +((tr.left + tr.width / 2 - br.left) / br.width).toFixed(3),
            y: +((tr.top + tr.height / 2 - br.top) / br.height).toFixed(3),
          }
        }
      }
      return {
        offX: +cue.aim.offset.x.toFixed(4),
        offY: +cue.aim.offset.y.toFixed(4),
        elev: +cue.aim.elevation.toFixed(4),
        tipUI: tipRel,
        tiltValue: tilt ? +(tilt.elevation ?? tilt.value ?? -999).toFixed(4) : null,
        disabled: !!(cue.aimInputs && cue.aimInputs.isDisabled()),
        ctrl: (c.controller && c.controller.name) || "?",
      }
    })
    await page.screenshot({ path: `${OUT}/${tag}.png` })
    // 关弹窗
    await page.evaluate(() => {
      const p = document.getElementById("cueballPopup")
      if (p && !p.hidden) document.getElementById("cueBallTrigger")?.click()
    })
    await sleep(200)
    return s
  }

  const waitPlayerTurn = async (budget = 120000) => {
    const ms = await waitFor(page, () => {
      const c = window.container
      return !!(c && c.table && c.table.cue.aimInputs && !c.table.cue.aimInputs.isDisabled())
    }, budget)
    if (ms >= 0) await sleep(600)
    return ms
  }

  const shoot = async () => {
    await page.evaluate(() => document.getElementById("cueHit")?.click())
    await sleep(400)
  }

  // ---------- 场景 A：仰角 0.5 + 高杆打点，跨回合 ----------
  let ms = await waitPlayerTurn()
  if (ms < 0) throw new Error("等玩家回合超时 A")
  let s0 = await snap("A0-start")
  // 打开弹窗拖打点右上 + 设仰角
  await page.evaluate(() => {
    const p = document.getElementById("cueballPopup")
    if (p && p.hidden) document.getElementById("cueBallTrigger")?.click()
  })
  await sleep(250)
  const box = await page.evaluate(() => {
    const r = document.getElementById("cueBall").getBoundingClientRect()
    return { x: r.left, y: r.top, w: r.width, h: r.height }
  })
  await page.mouse.move(box.x + box.w / 2, box.y + box.h / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.w * 0.5, box.y + box.h * 0.2, { steps: 6 })
  await page.mouse.up()
  await page.evaluate(() => window.container.table.cue.setElevation(0.5))
  await sleep(200)
  const sA1 = await snap("A1-set")
  await shoot()
  ms = await waitPlayerTurn()
  const sA2 = await snap("A2-next-turn")
  R.scenes.push({ scene: "A_仰角+高杆跨回合", 设定后: sA1, 下一回合: sA2, waitMs: ms })

  // ---------- 场景 B：弹窗全程打开跨回合 ----------
  ms = await waitPlayerTurn()
  if (ms < 0) throw new Error("等玩家回合超时 B")
  // 打开弹窗，拖打点，不关弹窗直接出杆
  await page.evaluate(() => {
    const p = document.getElementById("cueballPopup")
    if (p && p.hidden) document.getElementById("cueBallTrigger")?.click()
  })
  await sleep(250)
  const box2 = await page.evaluate(() => {
    const r = document.getElementById("cueBall").getBoundingClientRect()
    return { x: r.left, y: r.top, w: r.width, h: r.height }
  })
  await page.mouse.move(box2.x + box2.w / 2, box2.y + box2.h / 2)
  await page.mouse.down()
  await page.mouse.move(box2.x + box2.w * 0.78, box2.y + box2.h * 0.5, { steps: 6 })
  await page.mouse.up()
  const sB1 = await snap("B1-set-popup-open")
  await shoot() // 弹窗保持打开状态出杆
  ms = await waitPlayerTurn()
  const sB2 = await snap("B2-next-turn-popup-still-open")
  const popupOpen = await page.evaluate(() => {
    const p = document.getElementById("cueballPopup")
    return !!p && !p.hidden
  })
  R.scenes.push({ scene: "B_弹窗全程打开跨回合", 设定后: sB1, 下一回合: sB2, waitMs: ms, 弹窗仍开着: popupOpen })

  // ---------- 场景 C：连续两次只看不改，验证第二回合起点 ----------
  ms = await waitPlayerTurn()
  if (ms >= 0) {
    const sC = await snap("C1-clean-turn")
    R.scenes.push({ scene: "C_不动打点观察回合", 起点: sC, waitMs: ms })
  }

  R.errors = errs
  fs.writeFileSync(`${OUT}/result.json`, JSON.stringify(R, null, 2))
  console.log(JSON.stringify(R, null, 2))
  await browser.close()
}

main().catch((e) => {
  console.error("FATAL", e)
  process.exit(1)
})
