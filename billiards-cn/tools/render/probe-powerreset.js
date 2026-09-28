/**
 * #72 取证探针 3 —— 验证「力度（aim.power）跨回合残留」假设。
 *
 * 背景：resetSpinForNewTurn 与 Aim 构造函数都只清 offset/elevation，
 *      aim.power 无任何路径清零。若残留：上一杆大力 → 新回合力度条仍在
 *      大力位 → 玩家直接出杆 → 白球高速跟目标球进袋（用户描述的
 *      「白球一起进袋」的力学解释）。
 *
 * 步骤：
 *   回合 1：力度拉到 ~90% → 出杆 → 记录出杆时 power
 *   回合 2：**不动任何控件** → 读 aim.power 与力度条 UI 值
 *   回合 3：轻拉力度 20% → 出杆 → 下一回合再读（双向验证）
 */
const puppeteer = require("puppeteer-core")
const fs = require("fs")
const OUT = "/tmp/v154-t72c"
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
      "--enable-unsafe-swiftshader", "--user-data-dir=/tmp/chrome-t72c",
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

  const readPower = () =>
    page.evaluate(() => {
      const c = window.container
      const cue = c.table.cue
      const el = document.getElementById("cuePower")
      return {
        aimPower: +cue.aim.power.toFixed(4),
        powerRatio: +(cue.aim.power / 3).toFixed(4), // maxPower=3?
        uiValue: el ? +(+el.value).toFixed(4) : null,
        disabled: !!(cue.aimInputs && cue.aimInputs.isDisabled()),
        ctrl: (c.controller && c.controller.name) || "?",
      }
    })

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

  // ---------- 回合 1：拉大力出杆 ----------
  let ms = await waitPlayerTurn()
  if (ms < 0) throw new Error("回合1超时")
  const s0 = await readPower()
  await page.evaluate(() => window.container.table.cue.setPower(0.9))
  const s1 = await readPower()
  await shoot()
  R.scenes.push({ scene: "回合1_拉大力", 回合开始: s0, 设力后: s1 })

  // ---------- 回合 2：什么都不动，直接读 ----------
  ms = await waitPlayerTurn()
  const s2 = await readPower()
  await page.screenshot({ path: `${OUT}/turn2-ui.png` })
  R.scenes.push({ scene: "回合2_不动控件直接读", waitMs: ms, 状态: s2 })

  // 回合 2 出杆（用残留力度）
  await shoot()
  const hits = await page.evaluate(() => {
    const cue = window.container.table.cue
    return { aimPowerAfterShotClick: +cue.aim.power.toFixed(4) }
  })
  R.scenes.push({ scene: "回合2_直接出杆", 出杆瞬间力度: hits })

  // ---------- 回合 3：再验证 ----------
  ms = await waitPlayerTurn()
  const s3 = await readPower()
  R.scenes.push({ scene: "回合3_起点", waitMs: ms, 状态: s3 })

  R.errors = errs
  fs.writeFileSync(`${OUT}/result.json`, JSON.stringify(R, null, 2))
  console.log(JSON.stringify(R, null, 2))
  await browser.close()
}

main().catch((e) => {
  console.error("FATAL", e)
  process.exit(1)
})
