/**
 * v1.5.1 问题「细微瞄准条右滑 → 瞄准反向」取证探针。
 *
 * 思路（不靠推理，只测数据）：
 *   A. 静态扫描：把 aim.angle 从 0° 扫到 355°，逐个记录
 *      · dot = 相机右向量 · unitAtAngle(angle+90°)   （viewSign 的判据）
 *      · 瞄准线末端在屏幕上的 NDC x
 *      看 dot 是否会在某些角度穿越 0（符号翻转区），以及 |dot| 是否长期贴近 0。
 *   B. 真实拖动：用真实触摸在 #aim-angle-track 上按下并逐步右移，
 *      每一步记录「手指位移 dx」与「瞄准线末端屏幕位移 dScreenX」，
 *      统计两者同号的比例 —— 这就是用户感知的「跟手 / 反向」。
 * 产出：/tmp/v151/aim-*.json + 截图
 */
const puppeteer = require("puppeteer-core")
const fs = require("fs")
const OUT = "/tmp/v151"
const BASE = "http://127.0.0.1:8099"
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function main() {
  fs.mkdirSync(OUT, { recursive: true })
  const browser = await puppeteer.launch({
    executablePath: "/usr/bin/google-chrome",
    headless: "new",
    args: [
      "--no-sandbox", "--hide-scrollbars", "--disable-dev-shm-usage", "--no-zygote",
      "--ozone-platform=headless", "--use-gl=angle", "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader", "--user-data-dir=/tmp/chrome-aim151",
      "--in-process-gpu", "--disable-gpu-sandbox",
      "--window-size=1422,640",
    ],
    env: { ...process.env, DISPLAY: "" },
  })
  const page = await browser.newPage()
  await page.setCacheEnabled(false)
  // 用户视频为横屏 1422x640，按同一形态测
  await page.setViewport({ width: 1422, height: 640, hasTouch: true, isMobile: true, deviceScaleFactor: 1 })
  const errs = []
  page.on("pageerror", (e) => errs.push(e.message))
  page.on("console", (m) => { if (m.type() === "error") errs.push("console: " + m.text()) })

  await page.goto(BASE + "/menu.html", { waitUntil: "networkidle2", timeout: 60000 })
  await sleep(1000)
  // 点主「开始游戏」进入练习对局（与真机同一条路径）
  const el = await page.$("#btnStart")
  if (el) {
    const box = await el.boundingBox()
    await page.touchscreen.touchStart(box.x + box.width / 2, box.y + box.height / 2)
    await page.touchscreen.touchEnd()
  }
  await sleep(9000)

  const ready = await page.evaluate(() => {
    const c = window.container
    const track = document.getElementById("aim-angle-track")
    return {
      hasContainer: !!c,
      hasTrack: !!track,
      trackRect: track ? track.getBoundingClientRect().toJSON() : null,
      disabled: c ? !!(c.table.cue.aimInputs && c.table.cue.aimInputs.isDisabled()) : null,
      angle: c ? c.table.cue.aim.angle : null,
    }
  })
  console.log("进入状态:", JSON.stringify(ready))
  if (!ready.hasContainer) { console.log("!! 未拿到 container"); await browser.close(); return }
  await page.screenshot({ path: OUT + "/aim-00-enter.png" })

  // ---------- A. 静态扫描 dot ----------
  const scan = await page.evaluate(async () => {
    const c = window.container
    const cue = c.table.cue
    const cam = c.view.camera.camera
    const V = cam.position.constructor
    const nextFrame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
    const rows = []
    for (let deg = 0; deg < 360; deg += 5) {
      const a = (deg * Math.PI) / 180
      cue.setAimAngle(a, c.table)
      await nextFrame()
      cam.updateMatrixWorld()
      const e = cam.matrixWorld.elements
      const rx = e[0], ry = e[1], rz = e[2]
      // unitAtAngle(a + 90°) ：(1,0,0) 绕 Y 轴转 (a+90°)
      const t = a + Math.PI / 2
      const px = Math.cos(t), pz = -Math.sin(t)
      const dot = rx * px + ry * 0 + rz * pz
      // 瞄准线末端屏幕位置
      const b = (c.table.balls && c.table.balls[0]) || { pos: cue.mesh.position }
      const p = new V(b.pos.x, b.pos.y, b.pos.z)
      const u = new V(Math.cos(a), 0, -Math.sin(a))
      const P = p.clone().add(u.multiplyScalar(2.0))
      const ndc = P.project(cam)
      rows.push({ deg, dot: +dot.toFixed(4), sign: dot >= 0 ? 1 : -1, ndcx: +ndc.x.toFixed(4) })
    }
    return rows
  })
  fs.writeFileSync(OUT + "/aim-scan.json", JSON.stringify(scan, null, 1))
  const near0 = scan.filter((r) => Math.abs(r.dot) < 0.15)
  const flips = []
  for (let i = 1; i < scan.length; i++) if (scan[i].sign !== scan[i - 1].sign) flips.push(scan[i].deg)
  console.log("扫描：|dot|<0.15 的角度数 =", near0.length, "/", scan.length)
  console.log("  |dot| 最小值 =", Math.min(...scan.map((r) => Math.abs(r.dot))).toFixed(4))
  console.log("  符号翻转发生在 deg =", flips.join(", ") || "(无)")
  console.log("  前 8 行:", JSON.stringify(scan.slice(0, 8)))

  // ---------- B. 真实拖动 ----------
  const trackRect = ready.trackRect
  const results = []
  // 基准角刻意覆盖 dot 的奇异区（0° / 180° 附近）与常规区
  const bases = [0, 3, 90, 177, 180, 183, 270]
  const HALF_TRACK = Math.floor(trackRect.width / 2) - 4 // 拖到接近轨道端部
  for (const baseDeg of bases) {
    for (const dir of [+1, -1]) {
      await page.evaluate((d) => {
        const c = window.container
        c.table.cue.setAimAngle((d * Math.PI) / 180, c.table)
      }, baseDeg)
      await sleep(350)
      const cx = trackRect.x + trackRect.width / 2
      const cy = trackRect.y + trackRect.height / 2
      await page.touchscreen.touchStart(cx, cy)
      await sleep(120)
      const start = await page.evaluate(() => {
        const c = window.container
        const cue = c.table.cue
        const cam = c.view.camera.camera
        const V = cam.position.constructor
        cam.updateMatrixWorld()
        const a = cue.aim.angle
        const b = (c.table.balls && c.table.balls[0]) || { pos: cue.mesh.position }
        const p = new V(b.pos.x, b.pos.y, b.pos.z)
        const u = new V(Math.cos(a), 0, -Math.sin(a))
        const ndc = p.clone().add(u.multiplyScalar(2.0)).project(cam)
        return { angle: a, ndcx: ndc.x }
      })
      // 分 6 步移动，逐步采样，用于检测「抽搐」（角度方向反复横跳）
      const steps = []
      for (let k = 1; k <= 6; k++) {
        await page.touchscreen.touchMove(cx + (dir * HALF_TRACK * k) / 6, cy)
        await sleep(130)
        steps.push(
          await page.evaluate(() => {
            const c = window.container
            const cue = c.table.cue
            const cam = c.view.camera.camera
            const V = cam.position.constructor
            cam.updateMatrixWorld()
            const a = cue.aim.angle
            const b = (c.table.balls && c.table.balls[0]) || { pos: cue.mesh.position }
            const p = new V(b.pos.x, b.pos.y, b.pos.z)
            const u = new V(Math.cos(a), 0, -Math.sin(a))
            const ndc = p.clone().add(u.multiplyScalar(2.0)).project(cam)
            return { angle: a, ndcx: ndc.x }
          })
        )
      }
      const end = await page.evaluate(() => {
        const c = window.container
        const cue = c.table.cue
        const cam = c.view.camera.camera
        const V = cam.position.constructor
        cam.updateMatrixWorld()
        const a = cue.aim.angle
        const b = (c.table.balls && c.table.balls[0]) || { pos: cue.mesh.position }
        const p = new V(b.pos.x, b.pos.y, b.pos.z)
        const u = new V(Math.cos(a), 0, -Math.sin(a))
        const ndc = p.clone().add(u.multiplyScalar(2.0)).project(cam)
        return { angle: a, ndcx: ndc.x }
      })
      await page.touchscreen.touchEnd()
      await sleep(260)
      const dScreen = end.ndcx - start.ndcx
      const fingerRight = dir > 0
      const screenRight = dScreen > 0
      results.push({
        baseDeg,
        dir: dir > 0 ? "右拖" : "左拖",
        fingerPx: dir * HALF_TRACK,
        dAngleDeg: +(((end.angle - start.angle) * 180) / Math.PI).toFixed(3),
        dScreenX: +dScreen.toFixed(4),
        ok: fingerRight === screenRight,
        // 抽搐判据：相邻两步的角度增量出现反向
        jitters: (() => {
          let j = 0
          for (let k = 1; k < steps.length; k++) {
            const d1 = steps[k].angle - steps[k - 1].angle
            const d0 = k > 1 ? steps[k - 1].angle - steps[k - 2].angle : d1
            if (d1 * d0 < -1e-9) j++
          }
          return j
        })(),
      })
    }
  }
  fs.writeFileSync(OUT + "/aim-drag.json", JSON.stringify(results, null, 1))
  console.log("真实拖动（拖到轨道端部，测量瞄准线 2m 处的屏幕位移）:")
  let bad = 0
  for (const r of results) {
    if (!r.ok) bad++
    console.log(
      `  基准${String(r.baseDeg).padStart(3)}° ${r.dir} ${String(r.fingerPx).padStart(4)}px → 角度${String(r.dAngleDeg).padStart(7)}°, 屏幕位移 ${String(r.dScreenX).padStart(8)} → ${r.ok ? "跟手✓" : "反向✗"}  抽搐${r.jitters}次`
    )
  }
  console.log(`反向次数: ${bad} / ${results.length}`)
  console.log("页面错误:", errs.length ? errs.slice(0, 5) : "无")
  await browser.close()
}
main().catch((e) => { console.error("FATAL", e); process.exit(1) })
