/**
 * 【v1.4.4 P3】置球点屏幕坐标精算（不依赖截图）。
 *
 * 反复 A/B 都显示 foot spot（u=0.75）在画面上没有差异，而 center（u=0.5）
 * 有。与其继续猜，不如直接算：取覆盖层 mesh 上 (u,v) 对应的局部点 → 世界
 * 坐标 → 用当前相机投影到 NDC → 屏幕像素。这一步不经过任何像素判据，
 * 所以是决定性的。
 *
 * 用法：node tools/render/probe-spotpos.js [--skin classic]
 */
const path = require("path")
const puppeteer = require("puppeteer-core")
const DIST = path.join("/workspace/dev/source/billiards-cn", "dist")
function arg(n, d = null) {
  const i = process.argv.indexOf(`--${n}`)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d
}
const skin = arg("skin", "classic")
;(async () => {
  const browser = await puppeteer.launch({
    executablePath: "/usr/bin/google-chrome",
    headless: "new",
    args: [
      "--no-sandbox", "--hide-scrollbars", "--disable-dev-shm-usage",
      "--no-zygote", "--ozone-platform=headless", "--use-gl=angle",
      "--use-angle=swiftshader", "--enable-unsafe-swiftshader",
      "--user-data-dir=/tmp/chrome-spotpos-profile", "--in-process-gpu",
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

  // 先让相机收敛：topView 内部是 lerp 插值，只调一次会停在半路上，
  // 投影出来的坐标就是错的（第一次跑正是栽在这里）。
  await page.evaluate(() => {
    const camWrap = globalThis.__bc.container.view.camera
    camWrap.forceMode("top")
    camWrap.update = function () { camWrap.topView(null) }
    for (let i = 0; i < 120; i++) camWrap.update(16, null)
  })
  await new Promise((r) => setTimeout(r, 2500))

  const out = await page.evaluate(() => {
    const view = globalThis.__bc.container.view
    const camWrap = view.camera
    camWrap.update(16, null)
    view.scene.updateMatrixWorld(true)
    const cam = camWrap.camera || camWrap
    cam.updateMatrixWorld(true)

    const m = view.scene.getObjectByName("ClothMarks")
    if (!m) return { err: "no ClothMarks" }
    const geo = m.geometry
    if (!geo.boundingBox) geo.computeBoundingBox()
    const bb = geo.boundingBox
    const W = bb.max.x - bb.min.x
    const H = bb.max.y - bb.min.y

    const V = cam.position.constructor // Vector3
    const proj = (u, v) => {
      // 平面局部点（PlaneGeometry 的 uv：u 沿 +x，v 沿 +y）
      const lx = (u - 0.5) * W
      const ly = (v - 0.5) * H
      const p = new V(lx, ly, 0)
      m.localToWorld(p)
      const world = [p.x, p.y, p.z]
      p.project(cam)
      return {
        uv: [u, v],
        world: world.map((n) => +n.toFixed(4)),
        ndc: [+p.x.toFixed(4), +p.y.toFixed(4)],
        screen: [
          Math.round(((p.x + 1) / 2) * window.innerWidth),
          Math.round(((1 - p.y) / 2) * window.innerHeight),
        ],
      }
    }
    return {
      planeSize: [+W.toFixed(4), +H.toFixed(4)],
      viewport: [window.innerWidth, window.innerHeight],
      camPos: [+cam.position.x.toFixed(3), +cam.position.y.toFixed(3), +cam.position.z.toFixed(3)],
      spots: {
        foot: proj(0.75, 0.5),
        center: proj(0.5, 0.5),
        head: proj(0.25, 0.5),
        line: proj(0.25, 0.15),
        corner00: proj(0, 0),
        corner11: proj(1, 1),
      },
    }
  })
  console.log(JSON.stringify(out, null, 1))
  await browser.close()
})().catch((e) => { console.error(e); process.exit(1) })
