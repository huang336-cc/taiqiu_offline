/**
 * v1.5.1 瞄准条方向 —— 判据修正后的取证探针。
 *
 * 上一版探针（probe-aim151.js）用「瞄准线远端点的屏幕绝对位移」当判据，
 * 但相机在 beginAimInteraction 后会跟随瞄准角转动，屏幕绝对位移里混进了
 * 相机自身的补偿，测出来的"反向"并不等于用户感知的反向（实测位移仅
 * 0.003~0.022 NDC，本就接近不可感知）。
 *
 * 用户真正感知的是：**瞄准方向在世界里朝屏幕的哪一侧偏**。
 * 这一阶量的判据就是 dot = 屏幕右方向 · unitAtAngle(a+90°)：
 *   · dot > 0：角度增大 = 瞄准方向朝屏幕右偏
 *   · dot < 0：角度增大 = 瞄准方向朝屏幕左偏
 * 「滑块右拖 = 瞄准朝右」要求 dot * Δangle > 0。
 *
 * 于是真正要验证的是两件事：
 *   A. 按下手指（beginAimInteraction）后，dot 会不会明显漂移甚至变号？
 *      会 → 拖动开始时锁定符号（v1.3.76 的做法）必然有错，改实时取值是必要的。
 *   B. 修复后，每次拖动的 dot_end * Δangle 是否恒 > 0（即始终跟手）。
 */
const puppeteer = require("puppeteer-core")
const fs = require("fs")
const OUT = "/tmp/v151"
const BASE = "http://127.0.0.1:8099"
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** 页面内：计算当前 dot（与 aimslider.viewSign 的一阶判据一致） */
const DOT_FN = `(() => {
  const c = window.container
  const cam = c.view.camera.camera
  cam.updateMatrixWorld()
  const e = cam.matrixWorld.elements
  const a = c.table.cue.aim.angle
  const t = a + Math.PI / 2
  const px = Math.cos(t), pz = -Math.sin(t)
  // proj：瞄准方向单位向量在「相机右方向」上的投影 —— 用户感知的"瞄准朝屏幕哪侧偏"
  // 的精确量（不是一阶近似）。相机固定时它只随角度变化，判据不受近似误差影响。
  const proj = Math.cos(a) * e[0] - Math.sin(a) * e[2]
  return { dot: +(e[0] * px + e[2] * pz).toFixed(5), angle: a, proj: +proj.toFixed(6) }
})()`

async function main() {
  fs.mkdirSync(OUT, { recursive: true })
  const browser = await puppeteer.launch({
    executablePath: "/usr/bin/google-chrome",
    headless: "new",
    args: [
      "--no-sandbox", "--hide-scrollbars", "--disable-dev-shm-usage", "--no-zygote",
      "--ozone-platform=headless", "--use-gl=angle", "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader", "--user-data-dir=/tmp/chrome-aimsign151",
      "--in-process-gpu", "--disable-gpu-sandbox", "--window-size=1422,640",
    ],
    env: { ...process.env, DISPLAY: "" },
  })
  const page = await browser.newPage()
  await page.setCacheEnabled(false)
  await page.setViewport({ width: 1422, height: 640, hasTouch: true, isMobile: true, deviceScaleFactor: 1 })
  const errs = []
  page.on("pageerror", (e) => errs.push(e.message))

  // 用户真实场景：人机对战（继续对战走的就是这条），而非练习模式
  await page.goto(BASE + "/play.html?bot=easy&ruletype=nineball", {
    waitUntil: "networkidle2",
    timeout: 60000,
  })
  await sleep(6000)
  // 电脑可能先开球：轮询等到轮到玩家（瞄准控件解禁）为止
  let readyState = null
  for (let i = 0; i < 40; i++) {
    readyState = await page.evaluate(() => {
      const c = window.container
      if (!c) return { ready: false, why: "no container" }
      const cue = c.table.cue
      const dis = !!(cue.aimInputs && cue.aimInputs.isDisabled())
      const cam = c.view && c.view.camera && c.view.camera.camera
      return {
        ready: !dis,
        disabled: dis,
        hasCam: !!cam,
        camPos: cam ? [+cam.position.x.toFixed(2), +cam.position.y.toFixed(2), +cam.position.z.toFixed(2)] : null,
        angle: +cue.aim.angle.toFixed(4),
      }
    })
    if (readyState.ready) break
    await sleep(1500)
  }
  console.log("进入状态（等待轮到玩家）:", JSON.stringify(readyState))
  if (!readyState.ready) { console.log("!! 始终未轮到玩家，放弃"); await browser.close(); return }
  await sleep(1500)

  const track = await page.evaluate(() => {
    const t = document.getElementById("aim-angle-track")
    return t ? t.getBoundingClientRect().toJSON() : null
  })
  console.log("轨道:", JSON.stringify(track))

  // ---------- A. 按下手指后 dot 是否漂移 ----------
  const cx = track.x + track.width / 2
  const cy = track.y + track.height / 2
  const before = await page.evaluate(DOT_FN)
  await page.touchscreen.touchStart(cx, cy)
  const series = []
  for (let i = 0; i < 10; i++) {
    await sleep(90)
    series.push(await page.evaluate(DOT_FN))
  }
  await page.touchscreen.touchEnd()
  await sleep(400)
  console.log("A. 按下手指前后 dot 序列（beginAimInteraction 触发相机跟随）:")
  console.log("   按下前 dot =", before.dot)
  console.log("   按下后 dot =", series.map((s) => s.dot).join(", "))
  const signBefore = Math.sign(before.dot)
  const signsAfter = series.map((s) => Math.sign(s.dot))
  const drift = Math.max(...series.map((s) => Math.abs(s.dot - before.dot)))
  const flipped = signsAfter.some((s) => s !== 0 && s !== signBefore)
  console.log("   dot 最大漂移 =", drift.toFixed(5), " 是否变号 =", flipped ? "是" : "否")
  console.log(
    "   → 锁定拖动开始时的符号",
    flipped || drift > 0.2 ? "不可靠（必须实时取值）✓" : "基本可靠"
  )

  // ---------- B. 修复后 dot_end * Δangle 是否恒 > 0 ----------
  console.log("B. 修复后跟手性（右拖/左拖 × 多个基准角）:")
  const bases = [0, 45, 90, 135, 180, 225, 270, 315]
  const HALF = Math.floor(track.width / 2) - 4
  let bad = 0
  let total = 0
  const rows = []
  for (const baseDeg of bases) {
    for (const dir of [+1, -1]) {
      await page.evaluate((d) => {
        window.container.table.cue.setAimAngle((d * Math.PI) / 180, window.container.table)
      }, baseDeg)
      await sleep(300)
      await page.touchscreen.touchStart(cx, cy)
      await sleep(150)
      const s0 = await page.evaluate(DOT_FN)
      for (let k = 1; k <= 5; k++) {
        await page.touchscreen.touchMove(cx + (dir * HALF * k) / 5, cy)
        await sleep(120)
      }
      const s1 = await page.evaluate(DOT_FN)
      await page.touchscreen.touchEnd()
      await sleep(300)
      const da = s1.angle - s0.angle
      const dproj = s1.proj - s0.proj
      // 跟手判据（精确）：手指右移(dir>0) → 瞄准方向在屏幕右方向上的投影应增大
      const ok = dproj * dir > 0
      total++
      if (!ok) bad++
      rows.push({
        baseDeg,
        dir: dir > 0 ? "右拖" : "左拖",
        daDeg: +((da * 180) / Math.PI).toFixed(3),
        dproj: +dproj.toFixed(5),
        ok,
      })
    }
  }
  for (const r of rows) {
    console.log(
      `   基准${String(r.baseDeg).padStart(3)}° ${r.dir} → 角度变化 ${String(r.daDeg).padStart(7)}°, 世界投影变化 ${String(r.dproj).padStart(9)} → ${r.ok ? "跟手✓" : "反向✗"}`
    )
  }
  console.log(`   反向次数: ${bad} / ${total}`)
  fs.writeFileSync(OUT + "/aim-sign.json", JSON.stringify(rows, null, 1))
  console.log("页面错误:", errs.length ? errs.slice(0, 3) : "无")
  await browser.close()
}
main().catch((e) => { console.error("FATAL", e); process.exit(1) })
