/**
 * #68 验证探针 —— 「调整击球点时显示白球和被击球的 3D 路线」。
 *
 * 断言：
 *   A. v1.5.3 圆盘辅助线已回退：#cueSpinGuide/.cue-guide-center 等不存在
 *   B. 打点盘按下拖动（不松手）→ 3D 瞄准线出现：
 *      solid（白球→接触点）、dashed（被击球→袋口）、cuePred（青色母球碰后预测）
 *   C. 高杆 vs 低杆：cuePred 顶点几何不同（预测路线随高低杆变化）
 *   D. 松手 → 线隐藏
 *   E. 回归：拖力度条（flashAim 路径）瞄准线仍正常
 */
const puppeteer = require("puppeteer-core")
const fs = require("fs")
const OUT = "/tmp/v154-t68"
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
      "--enable-unsafe-swiftshader", "--user-data-dir=/tmp/chrome-t68",
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

  // ---------- A. 圆盘辅助线已回退 ----------
  const a = await page.evaluate(() => {
    const ids = ["cueSpinGuide", "cueGuideCross", "cueGuideRadial"]
    return {
      残留id: ids.filter((i) => !!document.getElementById(i)),
      残留center: !!document.querySelector(".cue-guide-center"),
      残留css: !!document.querySelector(".cue-spin-guide"),
    }
  })
  ok("A_圆盘辅助线已回退", a.残留id.length === 0 && !a.残留center && !a.残留css, a)

  // ---------- 进入开球瞄准 ----------
  await waitFor(page, () => {
    const c = window.container
    const cue = c && c.table && c.table.cue
    return !!(cue && cue.aimInputs && !cue.aimInputs.isDisabled())
  }, 150000)
  const c0 = await page.evaluate(() => window.container.controller?.name)
  if (c0 === "PlaceBall") {
    await page.evaluate(() => document.getElementById("cueHit")?.click())
    await waitFor(page, () => {
      const c = window.container
      return !!(c.controller?.name === "Aim" && !c.table.cue.aimInputs.isDisabled())
    }, 30000)
  }
  await sleep(800)

  // 3D 线状态读取器
  const lineState = () =>
    page.evaluate(() => {
      const al = window.container.table.cue.aimLine
      if (!al) return { err: "aimLine 不存在" }
      const m = (ribbon) => {
        const mesh = ribbon.mesh
        const dr = mesh.geometry.drawRange
        const pos = mesh.geometry.attributes.position
        // 取第一个 quad 的前 3 个顶点坐标做几何指纹
        let head = null
        if (dr.count >= 3) {
          head = []
          for (let i = 0; i < 3; i++) {
            head.push([
              +pos.getX(i).toFixed(4),
              +pos.getY(i).toFixed(4),
            ])
          }
        }
        return {
          visible: mesh.visible,
          verts: dr.count,
          head,
        }
      }
      return { solid: m(al.solid), dashed: m(al.dashed), cuePred: m(al.cuePred) }
    })

  // 两帧稳定
  const settle = () =>
    page.evaluate(
      () =>
        new Promise((res) =>
          requestAnimationFrame(() => requestAnimationFrame(() => res(null)))
        )
    )

  // ---------- B. 打点盘按下拖动 → 3D 线出现 ----------
  await page.evaluate(() => document.getElementById("cueBallTrigger")?.click())
  await waitFor(page, () => {
    const p = document.getElementById("cueballPopup")
    return !!p && !p.hidden
  }, 8000)
  await sleep(400)

  const base = await lineState()
  ok("B0_未交互时线隐藏", !base.solid.visible && !base.dashed.visible && !base.cuePred.visible, base)

  const box = await page.evaluate(() => {
    const r = document.getElementById("cueBall").getBoundingClientRect()
    return { x: r.left, y: r.top, w: r.width, h: r.height }
  })
  // 按下拖到上方（高杆）不松手
  await page.mouse.move(box.x + box.w / 2, box.y + box.h / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.w * 0.5, box.y + box.h * 0.18, { steps: 8 })
  await settle()
  await settle()
  const top = await lineState()
  await page.screenshot({ path: `${OUT}/drag-top-spin.png` })
  ok(
    "B_拖打点时3D线出现",
    top.solid.visible && top.dashed.visible && top.cuePred.visible,
    { solid: top.solid.visible, dashed: top.dashed.visible, cuePred: top.cuePred.visible,
      verts: { s: top.solid.verts, d: top.dashed.verts, c: top.cuePred.verts } }
  )
  const topFingerprint = top.cuePred.head

  // 松手 → 线隐藏
  await page.mouse.up()
  await settle()
  await settle()
  const afterUp = await lineState()
  ok("D_松手后线隐藏", !afterUp.solid.visible && !afterUp.cuePred.visible, afterUp)

  // ---------- C. 低杆：预测路线几何不同 ----------
  await page.mouse.move(box.x + box.w / 2, box.y + box.h / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.w * 0.5, box.y + box.h * 0.82, { steps: 8 })
  await settle()
  await settle()
  const bottom = await lineState()
  await page.screenshot({ path: `${OUT}/drag-bottom-spin.png` })
  ok(
    "C1_低杆时线仍显示",
    bottom.solid.visible && bottom.cuePred.visible,
    { solid: bottom.solid.visible, cuePred: bottom.cuePred.visible }
  )
  const bottomFingerprint = bottom.cuePred.head
  await page.mouse.up()
  await settle()

  // 高低杆的母球预测线顶点几何应不同
  let differ = false
  if (topFingerprint && bottomFingerprint) {
    differ = JSON.stringify(topFingerprint) !== JSON.stringify(bottomFingerprint)
  }
  ok("C2_高低杆预测路线不同", differ, {
    top: topFingerprint,
    bottom: bottomFingerprint,
  })

  // ---------- E. 回归：拖力度条（flashAim 路径）线仍显示 ----------
  // 注意：dispatchEvent 合成事件不会让 Chromium 产帧，headless 下渲染循环
  // 不推进 → refreshTargetLine 不会跑 → 线永远 false（探针假失败）。必须用
  // page.mouse 真实输入驱动力度条容器（与真实用户同路径：容器 pointer
  // 事件 → applyPowerRatio/powerChanged → flashAim）。
  const pbox = await page.evaluate(() => {
    const r = document.getElementById("powerSliderContainer").getBoundingClientRect()
    return { x: r.left, y: r.top, w: r.width, h: r.height }
  })
  await page.mouse.move(pbox.x + pbox.w * 0.3, pbox.y + pbox.h / 2)
  await page.mouse.down()
  await page.mouse.move(pbox.x + pbox.w * 0.5, pbox.y + pbox.h / 2, { steps: 5 })
  await settle()
  await settle()
  const power = await lineState()
  ok("E_力度条交互线仍显示", power.solid.visible, power.solid)
  await page.mouse.up()
  await settle()

  // 关弹窗
  await page.mouse.move(200, 300)
  await page.mouse.down()
  await page.mouse.up()

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
