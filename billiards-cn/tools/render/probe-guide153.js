/**
 * v1.5.3 —— 击球点辅助线 + 杆法预设删除，实机取证探针。
 *
 * 要回答的 4 件事（全部要求 DOM/computed-style 实测，不靠推理）：
 *   A. 「杆法档位」整块是否真的从 DOM 里消失了？（斯登/跟进/缩杆/扎杆）
 *   B. 打点在正中时辅助线是否「不画」（画面干净）？
 *   C. 拖动到偏心点后，三条辅助线是否出现、是否与杆头严格对齐？
 *      —— 竖线 x 必须等于杆头 x，横线 y 必须等于杆头 y，半径线必须从球心
 *         指到杆头（长度 = 圆心到杆头像素距离，角度 = atan2）。
 *   D. 复位按钮能否让辅助线消失？
 *
 * 另外：全程收集 pageerror / console error / 网络失败。
 *
 * 踩过的坑（都写在这里，避免下次重犯）：
 *   ① setCacheEnabled(false) 必须加 —— 不加会读到缓存，验证会「假失败」。
 *   ② 旋转过的元素不能用 getBoundingClientRect().width 当长度 —— 那是旋转
 *      后的**轴对齐外接矩形**（= L·|cosθ| + h·|sinθ|）。半径线是 rotate 过的
 *      1.5px 细线，真实长度要读行内 style.width。
 *   ③ headless 下不主动产帧 → CSS transition 不推进 → getComputedStyle 读到
 *      旧值。测量前必须显式等两帧 animation frame（见 settle()）。
 *   ④ assets/wave.jpg 是**既有**的可选贴图缺失：assets.ts 里 TextureLoader
 *      的 error 回调明确「贴图缺失不影响皮肤配色，忽略」，不算本次回归。
 */
const puppeteer = require("puppeteer-core")
const fs = require("fs")
const OUT = "/tmp/v153"
const BASE = process.env.BASE || "http://127.0.0.1:8160/dist"
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function waitFor(page, fn, budget) {
  const t0 = Date.now()
  while (Date.now() - t0 < budget) {
    if (await page.evaluate(fn).catch(() => false)) return Date.now() - t0
    await sleep(50)
  }
  return -1
}

/**
 * 等状态稳定后再测量。
 *
 * 坑（本轮踩到第 3 次才修对）：辅助线的显隐是 CSS `opacity 0→1` 的 0.12s 过渡，
 * 而 headless 下**不主动产帧就不推进 timeline** —— 更坑的是 Chromium 把
 * transition 的 startTime 记在「样式变更后的第一帧」，于是：
 *   · 只 sleep()               → 一帧都没产，timeline 冻结，读到旧值 1.0
 *   · sleep + 2 帧             → 那一帧才刚开始计时，读到 0.83（过渡刚起步）
 * 正确做法：隔帧轮询到连续两次读数一致为止（最多 3 秒）。
 */
async function settle(page, sel = "#cueSpinGuide") {
  let prev = null
  for (let i = 0; i < 40; i++) {
    const v = await page
      .evaluate(
        (s) =>
          new Promise((res) => {
            requestAnimationFrame(() => requestAnimationFrame(() => {
              res(getComputedStyle(document.querySelector(s)).opacity)
            }))
          }),
        sel
      )
      .catch(() => null)
    if (v !== null && prev !== null && v === prev) return v
    prev = v
    await sleep(80)
  }
  return prev
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true })
  const browser = await puppeteer.launch({
    executablePath: "/usr/bin/google-chrome",
    headless: "new",
    args: [
      "--no-sandbox", "--hide-scrollbars", "--disable-dev-shm-usage", "--no-zygote",
      "--ozone-platform=headless", "--use-gl=angle", "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader", "--user-data-dir=/tmp/chrome-v153",
      "--in-process-gpu", "--disable-gpu-sandbox", "--window-size=393,851",
    ],
    env: { ...process.env, DISPLAY: "" },
  })
  const page = await browser.newPage()
  await page.setCacheEnabled(false) // 坑①
  await page.setViewport({ width: 393, height: 851, deviceScaleFactor: 2 })
  const errs = []
  page.on("pageerror", (e) => errs.push("pageerror: " + String(e).slice(0, 200)))
  page.on("console", (m) => {
    if (m.type() === "error") errs.push("console.error: " + m.text().slice(0, 200))
  })
  const netFail = []
  page.on("requestfailed", (r) => netFail.push(`${r.failure()?.errorText} ${r.url()}`))
  page.on("response", (r) => {
    if (r.status() >= 400) netFail.push(`HTTP ${r.status()} ${r.url()}`)
  })

  const R = {}

  // ---------- 进游戏 ----------
  await page.goto(`${BASE}/menu.html`, { waitUntil: "domcontentloaded", timeout: 120000 })
  await waitFor(page, () => {
    const e = document.getElementById("btnStart")
    return !!e && e.getBoundingClientRect().width > 0
  }, 60000)
  await sleep(1200)
  await page.evaluate(() => document.getElementById("btnStart")?.click())
  R["进入场景耗时ms"] = await waitFor(page, () => {
    const c = document.querySelector("#viewP1 canvas")
    const l = document.getElementById("view3dLoading")
    return !!(c && c.width > 0) && (!l || getComputedStyle(l).display === "none")
  }, 90000)
  await sleep(2500)

  // ---------- A. 杆法档位是否已删干净 ----------
  R.A = await page.evaluate(() => {
    const ids = ["spinStun", "spinFollow", "spinDraw", "spinJump"]
    const txt = document.getElementById("cueballPopup")?.innerText || ""
    return {
      残留按钮: ids.filter((i) => !!document.getElementById(i)),
      残留gear区域: !!document.querySelector(".cb-gear-area"),
      残留gear样式类数: document.querySelectorAll(".gear-btn").length,
      弹窗文本含斯登: txt.includes("斯登"),
      弹窗文本含杆法: txt.includes("杆法"),
      弹窗区域数: document.querySelectorAll("#cueballPopup .cb-area").length,
      新辅助线元素: {
        root: !!document.getElementById("cueSpinGuide"),
        cross: !!document.getElementById("cueGuideCross"),
        radial: !!document.getElementById("cueGuideRadial"),
        center: !!document.querySelector(".cue-guide-center"),
      },
    }
  })

  // ---------- 打开击球点面板 ----------
  await page.evaluate(() => document.getElementById("cueBallTrigger")?.click())
  await waitFor(page, () => {
    const p = document.getElementById("cueballPopup")
    return !!p && !p.hidden
  }, 10000)
  await settle(page)
  await page.screenshot({ path: `${OUT}/01-popup-open.png` })

  const probeGuide = () =>
    page.evaluate(() => {
      const ball = document.getElementById("cueBall")
      const tip = document.getElementById("cueTip")
      const root = document.getElementById("cueSpinGuide")
      const radial = document.getElementById("cueGuideRadial")
      const v = document.querySelector(".cue-guide-v")
      const h = document.querySelector(".cue-guide-h")
      const center = document.querySelector(".cue-guide-center")
      if (!ball || !tip || !root) return { err: "元素缺失" }
      const br = ball.getBoundingClientRect()
      const tr = tip.getBoundingClientRect()
      const vr = v?.getBoundingClientRect()
      const hr = h?.getBoundingClientRect()
      const rr = radial?.getBoundingClientRect()
      const cs = getComputedStyle(root)
      return {
        guideOpacity: cs.opacity,
        guideVisibleCls: root.classList.contains("is-visible"),
        guideActiveCls: root.classList.contains("is-active"),
        tipCenterX: +(tr.left + tr.width / 2).toFixed(2),
        tipCenterY: +(tr.top + tr.height / 2).toFixed(2),
        ballCenterX: +(br.left + br.width / 2).toFixed(2),
        ballCenterY: +(br.top + br.height / 2).toFixed(2),
        vLineX: vr ? +(vr.left + vr.width / 2).toFixed(2) : null,
        hLineY: hr ? +(hr.top + hr.height / 2).toFixed(2) : null,
        // 坑②：旋转元素的 rect.width 是外接矩形，真实长度只能读行内 style.width
        radialWidthPx: radial ? +parseFloat(radial.style.width || "0").toFixed(2) : null,
        radialAabbPx: rr ? +rr.width.toFixed(2) : null,
        radialRotate: radial ? radial.style.transform : null,
        centerOpacity: center ? getComputedStyle(center).opacity : null,
        cssTipX: cs.getPropertyValue("--tip-x").trim(),
        cssTipY: cs.getPropertyValue("--tip-y").trim(),
      }
    })

  const box = await page.evaluate(() => {
    const r = document.getElementById("cueBall").getBoundingClientRect()
    return { x: r.left, y: r.top, w: r.width, h: r.height }
  })
  const dragTo = async (fx, fy, tag) => {
    await page.mouse.move(box.x + box.w / 2, box.y + box.h / 2)
    await page.mouse.down()
    await page.mouse.move(box.x + box.w * fx, box.y + box.h * fy, { steps: 8 })
    const mid = await probeGuide()
    await page.screenshot({ path: `${OUT}/0x-${tag}-drag.png` })
    await page.mouse.up()
    await settle(page)
    const after = await probeGuide()
    await page.screenshot({ path: `${OUT}/0x-${tag}-release.png` })
    return { mid, after }
  }

  // ---------- B. 正中（还没动过）：辅助线不该显示 ----------
  await settle(page)
  R.B_正中 = await probeGuide()

  // ---------- C1. 右上象限（高杆 + 右塞）----------
  const c1 = await dragTo(0.8, 0.2, "upper-right")
  R.C_右上_拖动中 = c1.mid
  R.C_右上_松手后 = c1.after

  // ---------- C2. 左下象限 ----------
  const c2 = await dragTo(0.22, 0.78, "lower-left")
  R.C_左下_松手后 = c2.after

  // ---------- C3. 纯正上方（只有高低杆，无左右塞）----------
  const c3 = await dragTo(0.5, 0.16, "pure-top")
  R.C_正上方_松手后 = c3.after

  // ---------- D. 复位 ----------
  await page.evaluate(() => document.getElementById("resetSpin")?.click())
  await settle(page)
  R.D_复位后 = await probeGuide()
  await page.screenshot({ path: `${OUT}/06-after-reset.png` })

  // ---------- 面板整图（带偏心打点）----------
  await page.mouse.move(box.x + box.w / 2, box.y + box.h / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.w * 0.75, box.y + box.h * 0.3, { steps: 6 })
  await page.mouse.up()
  await settle(page)
  const pr = await page.evaluate(() => {
    const r = document.getElementById("cueballPopup").getBoundingClientRect()
    return {
      x: Math.max(0, r.left - 6),
      y: Math.max(0, r.top - 6),
      width: r.width + 12,
      height: r.height + 12,
    }
  })
  await page.screenshot({ path: `${OUT}/07-popup-crop.png`, clip: pr })
  R.弹窗尺寸 = pr

  console.log("══════════ v1.5.3 实机取证 ══════════\n")
  console.log(JSON.stringify(R, null, 2))

  // ---------- 判定 ----------
  const checks = []
  const push = (n, ok, d) => checks.push({ 项: n, 结果: ok ? "PASS" : "FAIL", 依据: d })
  const dist1 = (a, b) => Math.abs(a - b)
  /** 把 "rotate(-0.7854rad)" 与期望弧度做数值比对（归到 (-π,π]） */
  const rotDiff = (css, expect) => {
    const got = parseFloat((css || "").replace(/[^-\d.]/g, ""))
    if (Number.isNaN(got)) return 99
    const norm = (x) => {
      let v = x
      while (v > Math.PI) v -= 2 * Math.PI
      while (v <= -Math.PI) v += 2 * Math.PI
      return v
    }
    return Math.abs(norm(got) - norm(expect))
  }

  push("A1 四个杆法按钮已从 DOM 删除", R.A.残留按钮.length === 0, JSON.stringify(R.A.残留按钮))
  push("A2 .cb-gear-area 区域已删除", !R.A.残留gear区域, String(R.A.残留gear区域))
  push("A3 弹窗内再无「斯登 / 杆法」字样",
    !R.A.弹窗文本含斯登 && !R.A.弹窗文本含杆法,
    `斯登=${R.A.弹窗文本含斯登} 杆法=${R.A.弹窗文本含杆法}`)
  push("A4 弹窗只剩「击球点 + 抬杆」两块", R.A.弹窗区域数 === 2, String(R.A.弹窗区域数))
  push("A5 四个辅助线元素均已就位",
    Object.values(R.A.新辅助线元素).every(Boolean),
    JSON.stringify(R.A.新辅助线元素))

  push("B1 打点居中时辅助线不显示",
    R.B_正中.guideOpacity === "0" && !R.B_正中.guideVisibleCls,
    `opacity=${R.B_正中.guideOpacity} is-visible=${R.B_正中.guideVisibleCls}`)
  push("B2 静态中心十字常显（不随辅助线隐藏）",
    Number(R.B_正中.centerOpacity) > 0, `opacity=${R.B_正中.centerOpacity}`)

  const c = R.C_右上_拖动中
  push("C1 拖动中辅助线显示", c.guideOpacity === "1" && c.guideVisibleCls, `opacity=${c.guideOpacity}`)
  push("C2 拖动中整组加亮(is-active)", c.guideActiveCls, String(c.guideActiveCls))
  push("C3 竖线 x 对齐杆头 x", dist1(c.vLineX, c.tipCenterX) <= 1.5,
    `v=${c.vLineX} tip=${c.tipCenterX} Δ=${dist1(c.vLineX, c.tipCenterX).toFixed(2)}px`)
  push("C4 横线 y 对齐杆头 y", dist1(c.hLineY, c.tipCenterY) <= 1.5,
    `h=${c.hLineY} tip=${c.tipCenterY} Δ=${dist1(c.hLineY, c.tipCenterY).toFixed(2)}px`)
  const expC = Math.hypot(c.tipCenterX - c.ballCenterX, c.tipCenterY - c.ballCenterY)
  push("C5 半径线长度 = 球心到杆头距离", dist1(c.radialWidthPx, expC) <= 1.5,
    `实际=${c.radialWidthPx}px 应为=${expC.toFixed(2)}px`)
  push("C6 半径线确有长度（非 0）", c.radialWidthPx > 3, String(c.radialWidthPx))
  push("C7 半径线旋转角正确（数值比对，非正则）",
    rotDiff(c.radialRotate, Math.atan2(c.tipCenterY - c.ballCenterY, c.tipCenterX - c.ballCenterX)) <= 0.02,
    `CSS=${c.radialRotate} 应由 renderCOORD 推出=${Math.atan2(c.tipCenterY - c.ballCenterY, c.tipCenterX - c.ballCenterX).toFixed(4)}rad`)

  const a = R.C_右上_松手后
  push("C8 松手后辅助线保留可见", a.guideOpacity === "1", `opacity=${a.guideOpacity}`)
  push("C9 松手后取消加亮", !a.guideActiveCls, String(a.guideActiveCls))
  push("C10 松手后仍对齐杆头",
    dist1(a.vLineX, a.tipCenterX) <= 1.5 && dist1(a.hLineY, a.tipCenterY) <= 1.5,
    `Δx=${dist1(a.vLineX, a.tipCenterX).toFixed(2)} Δy=${dist1(a.hLineY, a.tipCenterY).toFixed(2)}`)

  const ll = R.C_左下_松手后
  push("C11 左下象限同样对齐",
    dist1(ll.vLineX, ll.tipCenterX) <= 1.5 && dist1(ll.hLineY, ll.tipCenterY) <= 1.5,
    `Δx=${dist1(ll.vLineX, ll.tipCenterX).toFixed(2)} Δy=${dist1(ll.hLineY, ll.tipCenterY).toFixed(2)}`)
  push("C12 左下象限半径线长度正确",
    dist1(ll.radialWidthPx, Math.hypot(ll.tipCenterX - ll.ballCenterX, ll.tipCenterY - ll.ballCenterY)) <= 1.5,
    `实际=${ll.radialWidthPx}px 应为=${Math.hypot(ll.tipCenterX - ll.ballCenterX, ll.tipCenterY - ll.ballCenterY).toFixed(2)}px`)

  const pt = R.C_正上方_松手后
  push("C13 纯高低杆时竖线压在球心（无左右塞）", dist1(pt.vLineX, pt.ballCenterX) <= 1.5,
    `v=${pt.vLineX} center=${pt.ballCenterX}`)
  push("C14 纯高低杆时半径线角度正确",
    rotDiff(pt.radialRotate, Math.atan2(pt.tipCenterY - pt.ballCenterY, pt.tipCenterX - pt.ballCenterX)) <= 0.02,
    `CSS=${pt.radialRotate} 应为=${Math.atan2(pt.tipCenterY - pt.ballCenterY, pt.tipCenterX - pt.ballCenterX).toFixed(4)}rad`)

  const d = R.D_复位后
  push("D1 复位后辅助线隐藏", d.guideOpacity === "0" && !d.guideVisibleCls,
    `opacity=${d.guideOpacity} is-visible=${d.guideVisibleCls}`)
  push("D2 复位后杆头回到球心",
    dist1(d.tipCenterX, d.ballCenterX) <= 1.5 && dist1(d.tipCenterY, d.ballCenterY) <= 1.5,
    `Δx=${dist1(d.tipCenterX, d.ballCenterX).toFixed(2)} Δy=${dist1(d.tipCenterY, d.ballCenterY).toFixed(2)}`)

  const jsErrs = errs.filter((e) => e.startsWith("pageerror"))
  push("E1 全程无 JS 异常（pageerror）", jsErrs.length === 0, jsErrs.join(" | ") || "无")
  const bad404 = netFail.filter((u) => !/favicon|apple-touch-icon|assets\/wave\.jpg/.test(u)) // 坑④
  push("E2 无非预期的资源缺失（wave.jpg 为既有可选项，已排除）",
    bad404.length === 0, bad404.join(" | ") || "无")
  R.网络失败全量 = netFail

  console.log("\n══════════ 判定 ══════════")
  for (const k of checks) console.log(`[${k.结果}] ${k.项}  —— ${k.依据}`)
  const fail = checks.filter((k) => k.结果 === "FAIL").length
  console.log(`\n合计 ${checks.length} 项，FAIL ${fail} 项`)

  fs.writeFileSync(`${OUT}/result.json`, JSON.stringify({ R, checks, errs, netFail }, null, 2))
  await browser.close()
  process.exit(fail === 0 ? 0 : 1)
}

main().catch((e) => {
  console.error("探针异常:", e)
  process.exit(2)
})
