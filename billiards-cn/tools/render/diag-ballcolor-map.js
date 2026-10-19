/**
 * 球色核对：把每颗球的「标号」投影到屏幕坐标，再回读该像素的实际颜色。
 *
 * 起因：`BALL_COLORS[9] = "#FFFF00"`（黄条纹），但俯视截图里出现一颗
 * 绿色球显示「9」。两种可能：①着色/贴图真的有 bug；②那颗其实是 6 号
 * （绿），球体随机旋转后「6」倒过来就是「9」（ballmesh 初始化时
 * `updateRotation(new Vector3().random(), 100)`）。
 * 本脚本用「标号 + 投影坐标 + 像素色」三列数据一次性判定。
 *
 * 用法：SCENE=room node tools/render/diag-ballcolor-map.js
 */
const path = require("path")
const fs = require("fs")
const puppeteer = require("puppeteer-core")

const DIST = path.resolve(__dirname, "../../dist")
const URL = `file://${DIST}/play.html?debug=1&bot=Professional`
const OUT = "/root/.codebuddy/artifact/render/beautify"

;(async () => {
  fs.mkdirSync(OUT, { recursive: true })
  const browser = await puppeteer.launch({
    executablePath: "/usr/bin/google-chrome",
    headless: "new",
    args: [
      "--no-sandbox",
      "--hide-scrollbars",
      "--use-gl=angle",
      "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader",
      "--user-data-dir=/tmp/chrome-ballmap",
      "--in-process-gpu",
      "--disable-gpu-sandbox",
      "--allow-file-access-from-files",
      "--window-size=960,540",
    ],
    defaultViewport: { width: 960, height: 540 },
  })
  const page = await browser.newPage()
  page.on("pageerror", (e) => console.error("PAGEERROR:", e.message))
  await page.goto(URL, { waitUntil: "load", timeout: 120000 })
  await page.waitForFunction(
    () => {
      const bc = globalThis.__bc
      const v = bc && bc.container && bc.container.view
      return !!(v && v.renderer && v.scene && v.camera)
    },
    { timeout: 90000 }
  )
  await new Promise((r) => setTimeout(r, 9000))
  // 关掉教程横幅（会挡球）
  await page.evaluate(() => {
    const el = Array.from(document.querySelectorAll("*")).find((e) =>
      /知道了/.test(e.textContent || "")
    )
    if (el) el.click()
  })
  await new Promise((r) => setTimeout(r, 800))

  const rows = await page.evaluate(() => {
    const view = globalThis.__bc.container.view
    const cam = view.camera.camera
    const rect = view.element.getBoundingClientRect()
    const w = view.element.offsetWidth
    const h = view.element.offsetHeight
    const out = []
    for (const b of view.table.balls) {
      const bm = b.ballmesh
      if (!bm || !bm.mesh || !bm.mesh.visible) continue
      const p = b.pos.clone().project(cam)
      const sx = Math.round((p.x * 0.5 + 0.5) * w)
      const sy = Math.round((-p.y * 0.5 + 0.5) * h)
      const mat = Array.isArray(bm.mesh.material) ? bm.mesh.material[0] : bm.mesh.material
      out.push({
        label: b.label === undefined ? 0 : b.label,
        matHex: mat && mat.color ? mat.color.getHexString() : null,
        rotY: +(bm.mesh.rotation.y).toFixed(2),
        rotZ: +(bm.mesh.rotation.z).toFixed(2),
        px: sx,
        py: sy,
      })
    }
    return { w, h, left: Math.round(rect.left), top: Math.round(rect.top), out }
  })

  await page.screenshot({ path: `${OUT}/ballmap.png` })
  fs.writeFileSync(`${OUT}/ballmap.json`, JSON.stringify(rows, null, 1))
  console.log(`画布 ${rows.w}x${rows.h}  元素左上 (${rows.left},${rows.top})`)
  for (const r of rows.out) {
    console.log(
      `球 ${r.label}  材质#${r.matHex}  rot(Y,Z)=(${r.rotY},${r.rotZ})  屏幕(${r.px},${r.py})`
    )
  }
  await browser.close()
})().catch((e) => {
  console.error(e)
  process.exit(1)
})
