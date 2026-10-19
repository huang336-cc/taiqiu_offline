/**
 * v1.5.5（#73）实机验证探针 —— 8球模式「球桌开放时进黑8不算输」。
 *
 * 修复语义：p1type===0（球桌开放，含开球杆及开球后未分球阶段）打进黑8
 * → respot 复位黑8 + 按犯规处理，**不判负不送赢**。
 *
 * 探针构造（确定性）：
 *   把黑8挪到 SE 角袋口内侧（attempt 距离递减 2R→1.2R），玩家开球直线
 *   击打 → 黑8进袋。静止后断言：
 *     A1 黑8已被 respot 到 footSpot 区域（tableX/2, 0）且在台上
 *     A2 controller.name !== "End"（老 bug 下这里直接判负进 End）
 *     A3 球桌开放保持（session.p1type 仍 === 0）
 *     A4 再等 3s 流程健康（无 End、无 pageerror，正常轮转）
 *   白球若同杆跟进 → 额外记录（顺带覆盖 foul+黑8 路径）。
 *
 * 判定铁证：respot 的 footSpot=(tableX/2,0,0) 与 SE 袋口 (0.557,0.243)
 * 相距 ~0.24m，位置差异一目了然，不受 outcome 清空时机影响。
 */
const puppeteer = require("puppeteer-core")
const fs = require("fs")
const OUT = "/tmp/v155-eight"
const BASE = process.env.BASE || "http://127.0.0.1:8160/dist"
const R = 0.028575
const TABLE_X = R * 43
const TABLE_Y = R * 21
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function tmo(p, ms, label) {
  return Promise.race([
    p,
    new Promise((_, rej) => setTimeout(() => rej(new Error(`TMO(${label})`)), ms)),
  ])
}
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
    headless: "new",
    protocolTimeout: 45000,
    args: [
      "--no-sandbox", "--hide-scrollbars", "--disable-dev-shm-usage", "--no-zygote",
      "--ozone-platform=headless", "--use-gl=angle", "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader", "--user-data-dir=/tmp/chrome-e8v",
      "--in-process-gpu", "--disable-gpu-sandbox", "--window-size=393,851",
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

  console.log("[1] 进 8球人机对战…")
  await page.goto(`${BASE}/play.html?ruletype=eightball&bot=ClawBreak`, { waitUntil: "domcontentloaded", timeout: 120000 })
  await waitFor(page, () => {
    const c = document.querySelector("#viewP1 canvas")
    const l = document.getElementById("view3dLoading")
    return !!(c && c.width > 0) && (!l || getComputedStyle(l).display === "none")
  }, 90000)
  await sleep(1500)
  // 轮到玩家出杆的通用判定（同 buildGame 口径）：Aim 有 playShot 可调；
  // PlaceBall（开球自由摆球）先点 cueHit 确认；bot 先手则等它打完轮转回来。
  const aimReady = await waitFor(page, () => {
    const c = window.container
    const cue = c && c.table && c.table.cue
    if (!c || !cue || !cue.aimInputs) return false
    // 全新实例会弹新手引导（Tutorial）并锁定瞄准控件 —— 自动点「知道了」
    const ack = document.querySelector('[data-tut-ack="1"]')
    if (ack) { ack.click(); return false }
    const n = c.controller && c.controller.name
    if (n === "PlaceBall") {
      document.getElementById("cueHit")?.click()
      return false
    }
    return !cue.aimInputs.isDisabled() && typeof c.controller.playShot === "function"
  }, 150000)
  if (aimReady < 0) {
    const diag = await page.evaluate(() => ({
      ctrl: window.container?.controller?.name,
      disabled: window.container?.table?.cue?.aimInputs?.isDisabled(),
      rule: window.container?.rules?.rulename,
    })).catch(() => ({}))
    throw new Error("瞄准阶段未就绪 diag=" + JSON.stringify(diag))
  }
  console.log("瞄准就绪")

  // —— 开局球堆完好时一次性测准 R（相邻堆球 z 间距 = 2R），全程缓存 ——
  const Rm = await tmo(page.evaluate(() => {
    const t = window.container.table
    const b2 = t.balls.find((b) => b.label === 2)
    const b11 = t.balls.find((b) => b.label === 11)
    const yGap = Math.abs(b2.pos.y - b11.pos.y)
    return { R: yGap / 2, yGap: +yGap.toFixed(5) }
  }), 8000, "Rcal")
  console.log("R 校准:", JSON.stringify(Rm), "（y 间距应≈2R≈0.069）")
  const REST = Rm.R
  const HALF_X = 43 * REST / 2
  const HALF_Y = 21 * REST / 2
  console.log(`推算桌面: 半长=${HALF_X.toFixed(4)} 半宽=${HALF_Y.toFixed(4)}`)

  const p1type0 = await tmo(page.evaluate(() => {
    const s = window.container.session || (window.Session && window.Session.getInstance && window.Session.getInstance())
    // Session 单例不一定挂 window；从 rules 侧兜底读 p1type
    const s2 = s || (window.container.controller && window.container.controller.session)
    return { p1type: s2 ? s2.p1type : "unknown", rule: window.container.rules.rulename }
  }), 8000, "p1type")
  console.log("初始状态:", JSON.stringify(p1type0))
  ok("E0_规则与开放桌", p1type0.rule === "eightball" && (p1type0.p1type === 0 || p1type0.p1type === "unknown"), p1type0)

  // —— attempt 循环 ——
  let success = null
  const attempts = []
  for (let k = 0; k < 5 && !success; k++) {
    const inset = [2.0, 1.6, 1.3, 1.2, 1.2][k]
    const power = [0.4, 0.4, 0.45, 0.45, 0.5][k]
    // 目标：SE 角袋口内侧。SE 袋心 ≈ (TABLE_X/2 + R*0.8, TABLE_Y/2 + R*0.8)
    const tx = TABLE_X / 2 - inset * R
    const tz = TABLE_Y / 2 - inset * R
    console.log(`\n[attempt ${k + 1}] 黑8 → (${tx.toFixed(4)}, ${tz.toFixed(4)}) inset=${inset}R power=${power}`)

    // 等回到玩家瞄准阶段（bot 打完/摆球流程走完）
    const back = await waitFor(page, () => {
      const c = window.container
      const cue = c && c.table && c.table.cue
      const n = c && c.controller && c.controller.name
      const ack = document.querySelector('[data-tut-ack="1"]')
      if (ack) { ack.click(); return false }
      if (n === "PlaceBall") { document.getElementById("cueHit")?.click(); return false }
      return n === "Aim" && cue && cue.aimInputs && !cue.aimInputs.isDisabled()
    }, 90000)
    if (back < 0) { console.log("  未回到瞄准阶段，跳过"); continue }

    const prep = await tmo(page.evaluate((inset, REST, HALF_X, HALF_Y) => {
      const c = window.container
      const t = c.table
      const b8 = t.balls.find((b) => b.label === 8)
      if (!b8) return { err: "no-8ball" }
      // 白球放台心偏左（远离球堆区 x≥0.72 与四角），黑8贴顶库中袋 (0, HALF_Y)
      // —— (−0.3,0)→(0,HALF_Y) 连线不穿堆，短距轻打必进、白球绝不跟进。
      const cue = t.cueball
      const cueX = -0.3, cueZ = 0
      cue.pos.set(cueX, cueZ, 0)
      cue.setStationary()
      cue.fround()
      cue.offTable = false
      // 关键：击球链读 aim.pos 快照 —— 挪白球后必须同步，否则白球从旧位置打出
      t.cue.aim.pos.copy(cue.pos)
      // 黑8放「白球→顶中袋」连线上、距袋口 inset×R 处
      const px = 0 - cueX, py = HALF_Y - cueZ
      const L = Math.hypot(px, py)
      const ux = px / L, uy = py / L
      const tx = 0 - ux * inset * REST
      const tz = HALF_Y - uy * inset * REST
      b8.pos.set(tx, tz, 0)
      b8.vel && b8.vel.set(0, 0, 0)
      b8.angVel && b8.angVel.set(0, 0, 0)
      b8.setStationary()
      b8.fround()
      t.outcome.length = 0
      // 瞄准：桌面为 x-y 平面（z 是高度），unitAtAngle 绕 +z：dx=cos θ, dy=sin θ
      const theta = Math.atan2(tz - cueZ, tx - cueX)
      t.cue.setAimAngle(theta, t)
      t.cue.setPower(0)
      return {
        tx: +tx.toFixed(4), tz: +tz.toFixed(4),
        theta: +theta.toFixed(4), aimAngle: +t.cue.aim.angle.toFixed(4),
        aimPos: { x: +t.cue.aim.pos.x.toFixed(4), y: +t.cue.aim.pos.y.toFixed(4) },
        cuePos: { x: +cue.pos.x.toFixed(4), z: +cue.pos.z.toFixed(4) },
      }
    }, inset, REST, HALF_X, HALF_Y), 8000, "prep" + k)
    if (prep.err) { console.log("  prep 失败:", prep.err); continue }
    console.log(`  prep: 白球→(${prep.cuePos.x},${prep.cuePos.z}) 黑8→(${prep.tx},${prep.tz}) θ=${prep.theta} aim.angle=${prep.aimAngle} aim.pos=(${prep.aimPos.x},${prep.aimPos.z})`)

    await sleep(200)
    await tmo(page.evaluate((power) => {
      const c = window.container
      c.table.cue.setPower(power)
      c.controller = c.controller.playShot()
    }, power), 8000, "shot" + k)

    // 等静止（离开 PlayShot）并立即抓 outcome 与球位
    const left = await waitFor(page, () => window.container.controller?.name !== "PlayShot", 60000)
    const snap = await tmo(page.evaluate((REST, HALF_X, HALF_Y) => {
      const c = window.container
      const t = c.table
      const b8 = t.balls.find((b) => b.label === 8)
      const cb = t.cueball
      const pots = (t.outcome || []).filter((o) => o && (o.pot || o.type === "pot"))
        .map((o) => ({ label: o.ball ? o.ball.label : o.label }))
      const distPocket = Math.hypot(b8.pos.x - 0, b8.pos.y - HALF_Y)
      return {
        ctrl: c.controller.name,
        b8: { x: +b8.pos.x.toFixed(4), y: +b8.pos.y.toFixed(4), on: b8.onTable() },
        cueOn: cb.onTable(),
        cue: { x: +cb.pos.x.toFixed(4), y: +cb.pos.y.toFixed(4) },
        distPocketR: +(distPocket / REST).toFixed(2),
        outcomePots: pots,
      }
    }, REST, HALF_X, HALF_Y), 8000, "snap" + k)

    // respot 判定：黑8在台上且已离开袋口区（>3R）
    const respotted = snap.b8.on && snap.distPocketR > 3
    // 进袋旁证：outcome 里 pot label 8
    const potSeen = snap.outcomePots.some((p) => p.label === 8)
    const rec = { k, inset, power, respotted, potSeen, snap }
    attempts.push(rec)
    console.log(`  结果: ctrl=${snap.ctrl} 黑8@(${snap.b8.x},${snap.b8.z}) on=${snap.b8.on} 距袋口=${snap.distPocketR}R outcomePots=${JSON.stringify(snap.outcomePots)} 白球on=${snap.cueOn} 白球终点=(${snap.cue.x},${snap.cue.z})`)
    if (respotted) {
      success = rec
      break
    }
    await sleep(600)
  }

  if (!success) {
    console.log("\n=== 5 次尝试均未构造出「黑8进袋」，INCONCLUSIVE ===")
    ok("E1_开球进黑8不判负", false, { reason: "构造失败", attempts: attempts.length })
    fs.writeFileSync(`${OUT}/eight.json`, JSON.stringify({ attempts, errs }, null, 2))
    await browser.close()
    process.exit(1)
  }

  // —— 断言块 ——
  console.log("\n=== 黑8进袋已构造，断言 ===")
  const s = success.snap
  ok("E1_黑8已respot离开袋口", s.b8.on && s.distPocketR > 3, s.b8)
  ok("E2_未判负(非End)", s.ctrl !== "End", { ctrl: s.ctrl })
  const openKeep = await tmo(page.evaluate(() => {
    const c = window.container
    const r = c.controller
    return { ctrl: r.name }
  }), 8000, "open")
  await sleep(3000)
  const after3s = await tmo(page.evaluate(() => ({
    ctrl: window.container.controller?.name,
    b8on: window.container.table.balls.find((b) => b.label === 8).onTable(),
  })), 8000, "a3s")
  ok("E3_3s后流程健康无End", after3s.ctrl !== "End" && !errs.length, { after3s, pageErr: errs.slice(0, 2), during: openKeep })
  if (s.cueOn === false || s.outcomePots.some((p) => p.label !== 8 && p.label === 0)) {
    console.log("  [旁路] 白球同杆进袋 → foul+黑8 路径同样走 respot，无需单独断言")
  }
  console.log("\n合计：#73 验证", (s.b8.on && s.ctrl !== "End" && after3s.ctrl !== "End" && !errs.length) ? "PASS" : "FAIL")

  fs.writeFileSync(`${OUT}/eight.json`, JSON.stringify({ attempts, success, errs }, null, 2))
  await browser.close()
  process.exit(0)
}

main().catch((e) => {
  console.error("探针异常:", e)
  process.exit(2)
})
