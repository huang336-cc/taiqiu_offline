/**
 * #72 取证探针 —— 「轮到玩家回合时，白球击球点（aim.offset）是否残留上一杆的值」。
 *
 * 方法（不靠推理，全部实测）：
 *   1. wrap aimInputs.setDisabled —— 每次调用记录 (to, 调用瞬间的 offset/elevation,
 *      当前控制器名)。resetSpinForNewTurn 在 setDisabled 内部执行，所以 wrapper
 *      读到的是「重置前」的数据，能直接判定进回合时数据层是否残留。
 *   2. wrap cue.hit —— 出杆瞬间记录 offset（本次击球实际用的打点）。
 *   3. 跑 6 个回合：等玩家 enabled → 记录残留 → 真实拖动打点到偏心 → 出杆 → 下一回合。
 *   4. 同时抓 UI 红点位置，区分「数据残留」与「UI 残留」。
 *
 * 判定：
 *   - enabled 时 offset 非零（wrapper 记录）→ 数据残留复现
 *   - enabled 时 UI 红点不在中心 → UI 残留复现
 *   - 出杆时 offset 与拖动写入不一致 → 中途被改写（另案）
 */
const puppeteer = require("puppeteer-core")
const fs = require("fs")
const OUT = "/tmp/v154-t72"
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
      "--enable-unsafe-swiftshader", "--user-data-dir=/tmp/chrome-t72",
      "--in-process-gpu", "--disable-gpu-sandbox", "--window-size=393,851",
    ],
    env: { ...process.env, DISPLAY: "" },
  })
  const page = await browser.newPage()
  await page.setCacheEnabled(false)
  await page.setViewport({ width: 393, height: 851, deviceScaleFactor: 2 })
  // 跳过新手引导
  await page.evaluateOnNewDocument(() => {
    try {
      localStorage.setItem("billiards_cn_seenGuide_v1", "1")
    } catch (e) {}
  })
  const errs = []
  page.on("pageerror", (e) => errs.push("pageerror: " + String(e).slice(0, 160)))

  const R = { turns: [], wrapperLog: [] }

  await page.goto(`${BASE}/menu.html`, { waitUntil: "domcontentloaded", timeout: 120000 })
  await waitFor(page, () => {
    const e = document.getElementById("btnStart")
    return !!e && e.getBoundingClientRect().width > 0
  }, 60000)
  await sleep(800)
  await page.evaluate(() => document.getElementById("btnStart")?.click())
  const enterMs = await waitFor(page, () => {
    const c = document.querySelector("#viewP1 canvas")
    const l = document.getElementById("view3dLoading")
    return !!(c && c.width > 0) && (!l || getComputedStyle(l).display === "none")
  }, 90000)
  R["进入场景耗时ms"] = enterMs
  await sleep(2000)

  // ---------- 安装探针钩子 ----------
  await page.evaluate(() => {
    const c = window.container
    const ai = c.table.cue.aimInputs
    const cue = c.table.cue
    window.__t72 = { log: [], hits: [] }
    const origDisabled = ai.setDisabled.bind(ai)
    ai.setDisabled = function (d) {
      try {
        window.__t72.log.push({
          to: !!d,
          offX: +cue.aim.offset.x.toFixed(4),
          offY: +cue.aim.offset.y.toFixed(4),
          elev: +cue.aim.elevation.toFixed(4),
          ctrl: (c.controller && c.controller.name) || "?",
          t: Date.now(),
        })
      } catch (e) {}
      return origDisabled(d)
    }
    const origHit = cue.hit.bind(cue)
    cue.hit = function (ball) {
      try {
        window.__t72.hits.push({
          offX: +cue.aim.offset.x.toFixed(4),
          offY: +cue.aim.offset.y.toFixed(4),
          elev: +cue.aim.elevation.toFixed(4),
          t: Date.now(),
        })
      } catch (e) {}
      return origHit(ball)
    }
  })

  // ---------- 回合循环 ----------
  const snapEnabled = () =>
    page.evaluate(() => {
      const c = window.container
      const cue = c.table.cue
      const tip = document.getElementById("cueTip")
      const ball = document.getElementById("cueBall")
      let tipRel = null
      if (tip && ball) {
        const tr = tip.getBoundingClientRect()
        const br = ball.getBoundingClientRect()
        if (br.width > 0) {
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
        ctrl: (c.controller && c.controller.name) || "?",
        tipRel,
        disabled: !!(cue.aimInputs && cue.aimInputs.isDisabled()),
      }
    })

  for (let turn = 1; turn <= 6; turn++) {
    // 等玩家回合（控件启用）
    const waitMs = await waitFor(
      page,
      () => {
        const c = window.container
        return !!(c && c.table && c.table.cue.aimInputs && !c.table.cue.aimInputs.isDisabled())
      },
      120000
    )
    if (waitMs < 0) {
      R.turns.push({ turn, error: "等待玩家回合超时" })
      break
    }
    await sleep(600) // 等 UI 稳定
    const start = await snapEnabled()

    // 真实拖动打点到右上（高杆+右塞）
    await page.evaluate(() => document.getElementById("cueBallTrigger")?.click())
    const opened = await waitFor(page, () => {
      const p = document.getElementById("cueballPopup")
      return !!p && !p.hidden
    }, 8000)
    let dragged = null
    if (opened) {
      const box = await page.evaluate(() => {
        const r = document.getElementById("cueBall").getBoundingClientRect()
        return { x: r.left, y: r.top, w: r.width, h: r.height }
      })
      if (box.w > 0) {
        await page.mouse.move(box.x + box.w / 2, box.y + box.h / 2)
        await page.mouse.down()
        await page.mouse.move(box.x + box.w * 0.75, box.y + box.h * 0.25, { steps: 8 })
        await page.mouse.up()
        await sleep(300)
        dragged = await page.evaluate(() => {
          const cue = window.container.table.cue
          return {
            offX: +cue.aim.offset.x.toFixed(4),
            offY: +cue.aim.offset.y.toFixed(4),
          }
        })
      }
      // 关闭弹窗（点弹窗外）
      await page.mouse.move(200, 300)
      await page.mouse.down()
      await page.mouse.up()
      await sleep(300)
    }

    // 出杆
    const beforeShot = await snapEnabled()
    await page.evaluate(() => document.getElementById("cueHit")?.click())
    await sleep(400)
    const afterShot = await snapEnabled()

    R.turns.push({
      turn,
      waitMs,
      回合开始_offset: { x: start.offX, y: start.offY, elev: start.elev },
      回合开始_ctrl: start.ctrl,
      回合开始_tipUI: start.tipRel,
      回合开始_disabled: start.disabled,
      拖动写入: dragged,
      出杆前_offset: { x: beforeShot.offX, y: beforeShot.offY, elev: beforeShot.elev },
      出杆后_disabled: afterShot.disabled,
    })
    await page.screenshot({ path: `${OUT}/turn${turn}.png` })
  }

  R.wrapperLog = await page.evaluate(() => window.__t72.log)
  R.hits = await page.evaluate(() => window.__t72.hits)
  R.errors = errs

  fs.writeFileSync(`${OUT}/result.json`, JSON.stringify(R, null, 2))
  console.log(JSON.stringify(R, null, 2))
  await browser.close()
}

main().catch((e) => {
  console.error("FATAL", e)
  process.exit(1)
})
