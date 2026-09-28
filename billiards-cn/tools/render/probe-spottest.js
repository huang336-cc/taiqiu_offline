/**
 * 【v1.4.4 P3 终局】用自制「只有三个大圆」的贴图验证覆盖层 u/v 映射。
 *
 * 现象：同一张贴图里，纵贯的开球线（u=0.25）在画面上清晰可见，但三个
 * 置球点（u=0.5 / 0.75）在同一张画面上一个都找不到。贴图 dump 确认点画了、
 * 几何也铺满台面、关掉 mipmap 也没用。唯一没验证的就是「u/v → 屏幕」的
 * 映射本身是否如我以为的那样。
 *
 * 这里绕开所有像素判据：换上一张只在 (0.25/0.5/0.75, 0.5) 处画半径 60px
 * 纯白圆的透明贴图，再截图看圆出现在屏幕哪里 —— 圆出现的位置就是映射结果。
 *
 * 用法：node tools/render/probe-spottest.js [--skin classic]
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
const outDir = arg("out", "/tmp/spottest")
fs.mkdirSync(outDir, { recursive: true })

;(async () => {
  const browser = await puppeteer.launch({
    executablePath: "/usr/bin/google-chrome",
    headless: "new",
    args: [
      "--no-sandbox", "--hide-scrollbars", "--disable-dev-shm-usage",
      "--no-zygote", "--ozone-platform=headless", "--use-gl=angle",
      "--use-angle=swiftshader", "--enable-unsafe-swiftshader",
      "--user-data-dir=/tmp/chrome-spottest-profile", "--in-process-gpu",
      "--disable-gpu-sandbox", "--allow-file-access-from-files",
      "--window-size=1280,720",
    ],
    env: { ...process.env, DISPLAY: "" },
  })
  const page = await browser.newPage()
  await page.setViewport({ width: 1280, height: 720 })
  await page.goto(`file://${DIST}/play.html?debug=1&bot=Professional`, { waitUntil: "load", timeout: 120000 })
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
      const v = globalThis.__bc && globalThis.__bc.container && globalThis.__bc.container.view
      return !!(v && v.scene && v.camera && v.renderer)
    }).catch(() => false)
    if (st) ready = true
    else await new Promise((r) => setTimeout(r, 15000))
  }
  if (!ready) { console.error("未就绪"); await browser.close(); process.exit(2) }
  await new Promise((r) => setTimeout(r, 3000))

  await page.evaluate(() => {
    const camWrap = globalThis.__bc.container.view.camera
    camWrap.forceMode("top")
    camWrap.update = function () { camWrap.topView(null) }
    for (let i = 0; i < 120; i++) camWrap.update(16, null)
  })
  await new Promise((r) => setTimeout(r, 1500))

  // 隐藏球 + 瞄准辅助（ghost ball / 瞄准线），消除动态噪声
  const hid = await page.evaluate(() => {
    const view = globalThis.__bc.container.view
    let n = 0
    const hide = (o) => { if (o && o.visible) { o.visible = false; n++ } }
    for (const b of (view.table && view.table.balls) || []) if (b && b.mesh) hide(b.mesh)
    view.scene.traverse((o) => {
      if (!o.isMesh && !o.isLine && !o.isSprite) return
      const nm = (o.name || "").toLowerCase()
      const mn = (Array.isArray(o.material) ? o.material[0] : o.material)
      const mm = ((mn && mn.name) || "").toLowerCase()
      const t = (o.type || "").toLowerCase()
      if (nm.includes("ball") || mm.includes("ball") ||
          nm.includes("ghost") || nm.includes("aim") || nm.includes("line") ||
          t.includes("line") || t.includes("sprite")) hide(o)
    })
    return n
  })
  console.log("隐藏球/瞄准辅助:", hid)
  await new Promise((r) => setTimeout(r, 1200))
  await page.screenshot({ path: path.join(outDir, "base.png") })

  await page.evaluate(() => {
    const view = globalThis.__bc.container.view
    const m = view.scene.getObjectByName("ClothMarks")
    if (!m) return
    const cv = document.createElement("canvas")
    cv.width = 2048; cv.height = 1024
    const cx = cv.getContext("2d")
    for (const u of [0.25, 0.5, 0.75]) {
      cx.fillStyle = "rgba(255,255,255,1)"
      cx.beginPath()
      cx.arc(u * cv.width, 0.5 * cv.height, 60, 0, Math.PI * 2)
      cx.fill()
    }
    const tex = new (m.material.map.constructor)(cv)
    tex.generateMipmaps = false
    tex.minFilter = 1 // LinearFilter
    tex.magFilter = 1
    tex.needsUpdate = true
    const mat = Array.isArray(m.material) ? m.material[0] : m.material
    mat.map = tex
    mat.color.setHex(0xffffff)
    mat.emissive.setHex(0xffffff)
    mat.emissiveMap = tex
    mat.emissiveIntensity = 1
    mat.opacity = 1
    mat.needsUpdate = true
    m.visible = true
  })
  await new Promise((r) => setTimeout(r, 1500))
  await page.screenshot({ path: path.join(outDir, "dots.png") })
  console.log("已输出", outDir)
  await browser.close()
})().catch((e) => { console.error(e); process.exit(1) })
