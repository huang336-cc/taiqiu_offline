/**
 * #71 修复验证探针（v2 —— 确定性打桩版） —— 跳球出界「另一个白球」。
 *
 * v1 教训：setInterval(4ms) 采样在 SwiftShader 渲染阻塞下实际间隔 300ms+，
 * 错过了持续 <300ms 的 offTable 窗口（白球 0.5s 内就被判出界 + 结算 + 重摆）；
 * 且闭包捕获的 ball 引用在对局流程推进后可能失效。采样法对这种瞬时窗口
 * 原理上就不可靠。
 *
 * v2 方法：出杆前直接给白球打桩 ——
 *   K1  patch offTable setter：记录每次 true 置位（时间/位置/当时可见性）
 *       —— 证明「出界判定确实发生」
 *   K2  patch ballmesh.updateAll：凡调用后 ball.offTable === true 的，
 *       mesh.visible 与 shadow.visible 必须为 false（#71 修复的核心断言：
 *       出界球不再渲染，库边不再出现「幽灵白球」）。container 每帧
 *       advance() 后同步调 updateBallMesh，出界帧必然产生 K2 记录。
 *   K3  结算进入 PlaceBall/Aim 后：白球 off=false 且 mesh 恢复可见
 *   K4  全程无 pageerror
 */
const puppeteer = require("puppeteer-core")
const fs = require("fs")
const OUT = "/tmp/v154-t71v2"
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
      "--enable-unsafe-swiftshader", "--user-data-dir=/tmp/chrome-t71v2",
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
  page.on("pageerror", (e) => errs.push("pageerror: " + String(e).slice(0, 200)))

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

  await waitFor(page, () => {
    const c = window.container
    const cue = c && c.table && c.table.cue
    return !!(cue && cue.aimInputs && !cue.aimInputs.isDisabled())
  }, 150000)
  if ((await page.evaluate(() => window.container.controller?.name)) === "PlaceBall") {
    await page.evaluate(() => document.getElementById("cueHit")?.click())
    if ((await waitFor(page, () => window.container.controller?.name === "Aim", 30000)) < 0) {
      throw new Error("放球后未进入瞄准")
    }
  }
  await sleep(600)
  if ((await page.evaluate(() => window.container.controller?.name)) !== "Aim") {
    throw new Error("开局流程异常")
  }

  // ── 打桩（出杆前）─────────────────────────────────────────────
  await page.evaluate(() => {
    const cb = window.container.table.cueball
    const bm = cb.ballmesh
    window.__k1 = []   // offTable true 置位事件
    window.__k2 = []   // updateAll 后置检查（offTable 球的渲染状态）
    let off = !!cb.offTable
    Object.defineProperty(cb, "offTable", {
      configurable: true,
      get: () => off,
      set: (v) => {
        if (v && !off) {
          window.__k1.push({
            t: performance.now(),
            pos: { x: +cb.pos.x.toFixed(3), y: +cb.pos.y.toFixed(3), z: +cb.pos.z.toFixed(3) },
            visibleAtStrike: bm.mesh.visible,
          })
        }
        off = v
      },
    })
    const origUpdateAll = bm.updateAll
    bm.updateAll = function (ball, t) {
      origUpdateAll.call(this, ball, t)
      if (ball.offTable) {
        window.__k2.push({
          t: performance.now(),
          meshVisible: this.mesh.visible,
          shadowVisible: this.shadow.visible,
          pos: { x: +ball.pos.x.toFixed(3), y: +ball.pos.y.toFixed(3) },
        })
      }
    }
  })

  // ── 扎杆出界 ─────────────────────────────────────────────────
  // 关键参数教训：
  //   · cueHit 点击瞬间 hit 处理器用力度条 UI 值覆盖了 aim.power ——
  //     出杆前必须重新显式 setPower，否则只有 UI 默认力度（~0.35，
  //     vz ≈ 1.4 m/s）飞不过库边 —— v1 探针 J1「未出界」的根因之一。
  //   · 0.95 × maxPower ≈ 4.98 m/s、elev 0.9 → vz ≈ 3.9 m/s（远超
  //     airborneThreshold 0.05），滞空 0.8s、射程 2.46 m，物理上必然出界。
  //   · 出杆用 playShot() 赋回 controller（纯 cueHit click 在 headless
  //     帧饥饿下 SpaceUp 永不被消费；纯 playShot 直调返回值被丢弃、
  //     犯规链中断）。
  await page.evaluate(() => {
    const c = window.container
    const cue = c.table.cue
    const cb = c.table.cueball
    const TX = 1.02
    const TY = 0.51
    const cands = [
      { x: TX, y: cb.pos.y }, { x: -TX, y: cb.pos.y },
      { x: cb.pos.x, y: TY }, { x: cb.pos.x, y: -TY },
    ]
    let best = cands[0]
    let bd = Infinity
    for (const p of cands) {
      const d = Math.hypot(p.x - cb.pos.x, p.y - cb.pos.y)
      if (d < bd) { bd = d; best = p }
    }
    cue.setAimAngle(Math.atan2(best.y - cb.pos.y, best.x - cb.pos.x), c.table)
    cue.setElevation(0.9)
    cue.setPower(0.95)
    c.controller = c.controller.playShot()
  })
  const settleMs = await waitFor(page, () => {
    const n = window.container.controller?.name
    return n === "PlaceBall" || n === "WatchShot" || n === "WatchAim" || n === "Aim"
  }, 60000)

  // ── 收桩 + 等 AI 自由球流程走完 ───────────────────────────────
  const k1 = await page.evaluate(() => window.__k1)
  const k2 = await page.evaluate(() => window.__k2)
  const backMs = await waitFor(page, () => {
    const c = window.container
    const cue = c && c.table && c.table.cue
    return !!(cue && cue.aimInputs && !cue.aimInputs.isDisabled() &&
      (c.controller?.name === "Aim" || c.controller?.name === "PlaceBall"))
  }, 150000)
  await sleep(800)
  const finalState = await page.evaluate(() => {
    const cb = window.container.table.cueball
    return {
      off: !!cb.offTable,
      meshVisible: cb.ballmesh ? cb.ballmesh.mesh.visible : null,
      pos: { x: +cb.pos.x.toFixed(3), y: +cb.pos.y.toFixed(3) },
      ctrl: window.container.controller?.name,
    }
  })
  await page.screenshot({ path: `${OUT}/final.png` })

  // ── 断言 ─────────────────────────────────────────────────────
  ok("K1_出界判定发生", k1.length > 0, {
    事件数: k1.length,
    首次: k1[0] ?? null,
    settleMs,
  })

  ok("K2_出界球渲染隐藏", k2.length > 0 && k2.every((x) => !x.meshVisible && !x.shadowVisible), {
    后置检查数: k2.length,
    违规: k2.filter((x) => x.meshVisible || x.shadowVisible).slice(0, 2),
    首条: k2[0] ?? null,
  })

  ok("K3_结算后白球恢复可见", finalState.off === false && finalState.meshVisible === true, {
    ...finalState,
    backMs,
  })

  ok("K4_无页面错误", errs.length === 0, errs.slice(0, 3))

  fs.writeFileSync(`${OUT}/result.json`, JSON.stringify({ ...R, k1, k2 }, null, 2))
  const fails = R.checks.filter((c) => !c.pass).length
  console.log(`\n==== ${R.checks.length - fails}/${R.checks.length} PASS ====`)
  await browser.close()
  if (fails > 0) process.exit(2)
}

main().catch((e) => {
  console.error("FATAL", e)
  process.exit(1)
})
