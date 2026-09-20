/**
 * 球杆皮肤视觉对比渲染（v1.3.85）。
 *
 * 在同一场景、同一机位下，逐个皮肤切过去截图，证明 skin 设置真的
 * 改变了画面（旧版五个皮肤截图会完全一致）。
 *
 * 用法：DISPLAY=:99 node tools/render/render-cueskins.js
 */
const path = require("path")
const fs = require("fs")
const puppeteer = require("puppeteer-core")

const DIST = path.resolve(__dirname, "../../dist")
const URL = `file://${DIST}/play.html?debug=1&bot=Professional`
const SHOTS = "/root/.codebuddy/artifact/render/shots"
const SKINS = [
  ["classic", "经典原木"],
  ["emerald", "翡翠绿"],
  ["crimson", "赤焰红"],
  ["sapphire", "蓝宝石"],
  ["golden", "金辉"],
]

;(async () => {
  const browser = await puppeteer.launch({
    executablePath: "/usr/bin/google-chrome",
    headless: "new",
    args: [
      "--no-sandbox",
      "--hide-scrollbars",
      "--use-gl=angle",
      "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader",
      "--user-data-dir=/tmp/chrome-cueskins",
      "--in-process-gpu",
      "--disable-gpu-sandbox",
      "--allow-file-access-from-files",
      "--window-size=540,960",
    ],
    defaultViewport: { width: 540, height: 960 },
  })
  const page = await browser.newPage()
  page.on("pageerror", (e) => console.error("PAGEERROR:", e.message))
  await page.goto(URL, { waitUntil: "load", timeout: 120000 })
  const ready = await page
    .waitForFunction(
      () => {
        const bc = globalThis.__bc
        const view = bc && bc.container && bc.container.view
        const r = view && view.renderer
        return !!(view && view.scene && view.camera && r && r.getContext())
      },
      { timeout: 90000 }
    )
    .then(() => true)
    .catch(() => false)
  if (!ready) {
    console.error("容器未就绪")
    await browser.close()
    process.exit(2)
  }
  await new Promise((r) => setTimeout(r, 9000))

  // 切到室内 room 场景 + 原生瞄准机位
  await page.evaluate(() => {
    const view = globalThis.__bc.container.view
    view.applyScene("room")
  })
  await new Promise((r) => setTimeout(r, 2500))
  /**
   * ⚠️ 机位选择（v1.3.85 教训）。
   *
   * 一开始用 `forceMode("aim")`（贴地瞄准视角），结果**球杆几乎全在画面外**：
   *   cueTip    screen y≈592  ✅
   *   cueShaft  screen y≈1149 ❌（画布高 960）
   *   cueButt   screen y≈30   ❌
   * 于是五张皮肤截图**逐像素相同**，看起来像"皮肤没生效"，其实是
   * 被拍的东西根本不在画面里。画面里那根亮锥是**母球的高光**。
   *
   * 改用跟随视角（相机退到球桌外上方），球杆完整入画，才能真正比对皮肤。
   */
  await page.evaluate(() => {
    const view = globalThis.__bc.container.view
    // 斜俯视全景：相机退远，球杆整根入画
    const c = view.camera.camera
    const cam = view.camera
    cam.update = function () {
      c.position.set(0.85, -1.75, 1.05)
      c.lookAt(-0.55, 0.15, 0.05)
      c.updateProjectionMatrix()
    }
    cam.update(0, null)
  })
  await new Promise((r) => setTimeout(r, 1200))

  fs.mkdirSync(SHOTS, { recursive: true })
  const made = []
  for (const [id, name] of SKINS) {
    await page.evaluate((sk) => {
      const view = globalThis.__bc.container.view
      view.table.cue.applySkin(sk)
    }, id)
    await new Promise((r) => setTimeout(r, 700))
    const actual = await page.evaluate(() => {
      const cue = globalThis.__bc.container.view.table.cue
      const out = {}
      cue.mesh.traverse((o) => {
        if (!o.isMesh) return
        if (o.name !== 'cueShaft' && o.name !== 'cueButt') return
        const m = o.material
        out[o.name] = m && m.color ? m.color.getHexString() : null
      })
      // 球杆在当前机位下的屏幕占比（用包围盒投影估算）
      const c = globalThis.__bc.container.view.camera.camera
      return out
    })
    const f = `cueskin_${id}.png`
    await page.screenshot({ path: `${SHOTS}/${f}` })
    made.push([f, name, id, actual])
    console.error(`✅ ${f}  (${name})`)
  }
  console.error("DONE", JSON.stringify(made))
  await browser.close()
})().catch((e) => {
  console.error(e)
  process.exit(1)
})
