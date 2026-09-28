/**
 * 【v1.4.4 P3 决定性测试】覆盖层 u→屏幕 x 映射实测。
 *
 * 症状：同一份代码画的三个点，center（u=0.5）在画面上看得见，foot
 * （u=0.75）却完全看不见 —— 且 foot 半径还更大。贴图 dump 确认三点都画了。
 * 这种「位置相关的系统性缺失」只能有一种解释：u→屏幕 的映射不是我以为
 * 的线性关系。
 *
 * 做法：临时把覆盖层贴图换成一张 16 等分彩色竖带（每带一个可区分的色相），
 * 截图后统计每条带在屏幕上的实际 x 区间。映射关系一眼可见。
 *
 * 用法：node tools/render/probe-uvmap.js [--skin classic]
 */
const path = require("path")
const fs = require("fs")
const puppeteer = require("puppeteer-core")
const DIST = path.join("/workspace/dev/source/billiards-cn", "dist")

function arg(n, d = null) {
  const i = process.argv.indexOf(`--${n}`)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d
}
const skin = arg("skin", "classic")
const outDir = arg("out", "/tmp/uvmap")
fs.mkdirSync(outDir, { recursive: true })

;(async () => {
  const browser = await puppeteer.launch({
    executablePath: "/usr/bin/google-chrome",
    headless: "new",
    args: [
      "--no-sandbox", "--hide-scrollbars", "--disable-dev-shm-usage",
      "--no-zygote", "--ozone-platform=headless", "--use-gl=angle",
      "--use-angle=swiftshader", "--enable-unsafe-swiftshader",
      "--user-data-dir=/tmp/chrome-uvmap-profile", "--in-process-gpu",
      "--disable-gpu-sandbox", "--allow-file-access-from-files",
      "--window-size=1280,720",
    ],
    env: { ...process.env, DISPLAY: "" },
  })
  const page = await browser.newPage()
  await page.setViewport({ width: 1280, height: 720 })
  await page.goto(`file://${DIST}/play.html?debug=1&bot=Professional`, {
    waitUntil: "load", timeout: 120000,
  })
  await page.evaluate((sk) => {
    const KEY = "billiards_cn_settings_v1"
    let s = {}
    try { s = JSON.parse(localStorage.getItem(KEY) || "{}") } catch {}
    s.tableSkin = sk
    localStorage.setItem(KEY, JSON.stringify(s))
  }, skin)
  await page.reload({ waitUntil: "load", timeout: 120000 })

  let ready = false
  for (let i = 0; i < 6 && !ready; i++) {
    const st = await page.evaluate(() => {
      const bc = globalThis.__bc
      const v = bc && bc.container && bc.container.view
      return !!(v && v.scene && v.camera && v.renderer)
    }).catch(() => false)
    if (st) ready = true
    else await new Promise((r) => setTimeout(r, 15000))
  }
  if (!ready) { console.error("容器未就绪"); await browser.close(); process.exit(2) }
  await new Promise((r) => setTimeout(r, 3000))

  // 俯视 + 换成 16 色竖带贴图（不透明，避免任何 alpha 干扰）
  await page.evaluate(() => {
    const view = globalThis.__bc.container.view
    const camWrap = view.camera
    camWrap.forceMode("top")
    camWrap.update = function () { camWrap.topView(null) }
    camWrap.update(0, null)

    const m = view.scene.getObjectByName("ClothMarks")
    if (!m) return
    const N = 16
    const cv = document.createElement("canvas")
    cv.width = 1024; cv.height = 512
    const cx = cv.getContext("2d")
    for (let i = 0; i < N; i++) {
      // 用亮度的 16 级灰阶：不透明、易分辨、不受色相混合干扰
      const v = Math.round(40 + i * 13)
      cx.fillStyle = `rgb(${v},${v},${v})`
      cx.fillRect((i * cv.width) / N, 0, cv.width / N + 1, cv.height)
    }
    const tex = new (m.material.map.constructor)(cv)
    tex.needsUpdate = true
    const mat = Array.isArray(m.material) ? m.material[0] : m.material
    mat.map = tex
    mat.color.setHex(0xffffff)
    mat.emissive.setHex(0xffffff)
    mat.emissiveMap = tex
    mat.emissiveIntensity = 1.0
    mat.opacity = 1
    mat.transparent = false
    mat.needsUpdate = true
    m.visible = true
  })
  await new Promise((r) => setTimeout(r, 1500))
  await page.screenshot({ path: path.join(outDir, "uvmap.png") })
  await page.evaluate(() => {
    const view = globalThis.__bc.container.view
    const m = view.scene.getObjectByName("ClothMarks")
    if (m) m.visible = false
  })
  await new Promise((r) => setTimeout(r, 1200))
  await page.screenshot({ path: path.join(outDir, "uvmap-off.png") })
  console.log("已输出", outDir)
  await browser.close()
})().catch((e) => { console.error(e); process.exit(1) })
