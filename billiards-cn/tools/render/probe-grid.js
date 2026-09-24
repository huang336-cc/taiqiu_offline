/**
 * 批量投影普查（v1.3.88）：把候选摆放位置一次性投影到画面，
 * 找出「落在画面中带（py 250~450）」的位置 —— 特征物摆放的依据。
 */
const puppeteer = require("puppeteer-core")
const DIST = "/workspace/dev/source/billiards-cn/dist"

async function main() {
  const browser = await puppeteer.launch({
    executablePath: "/usr/bin/google-chrome",
    headless: "new",
    args: [
      "--no-sandbox",
      "--use-gl=angle",
      "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader",
      `--user-data-dir=/tmp/chrome-grid-${Date.now()}`,
      "--in-process-gpu",
      "--disable-gpu-sandbox",
      "--allow-file-access-from-files",
      "--window-size=1200,540",
    ],
    env: { ...process.env },
  })
  const page = await browser.newPage()
  await page.setViewport({ width: 1200, height: 540 })
  await page.goto(`file://${DIST}/play.html?debug=1&bot=Professional`, {
    waitUntil: "load",
    timeout: 120000,
  })
  let ready = false
  for (let i = 0; i < 8 && !ready; i++) {
    ready = await page
      .evaluate(() => {
        const v = globalThis.__bc?.container?.view
        try {
          return !!(v && v.scene && v.camera && v.renderer?.getContext?.())
        } catch {
          return false
        }
      })
      .catch(() => false)
    if (!ready) await new Promise((r) => setTimeout(r, 8000))
  }
  await new Promise((r) => setTimeout(r, 2000))
  await page.evaluate(() => {
    globalThis.__bc.container.view.applyScene("office")
    globalThis.__bc.container.view.camera.forceMode("aim")
  })
  await new Promise((r) => setTimeout(r, 2000))

  const out = await page.evaluate(() => {
    const view = globalThis.__bc.container.view
    const cam = view.camera.camera || view.camera
    cam.updateMatrixWorld(true)
    const m = cam.projectionMatrix.clone().multiply(cam.matrixWorldInverse)
    const proj = (x, y, z) => {
      const e = m.elements
      const cw = e[3] * x + e[7] * y + e[11] * z + e[15]
      if (cw <= 1e-6) return null
      const nx = (e[0] * x + e[4] * y + e[8] * z + e[12]) / cw
      const ny = (e[1] * x + e[5] * y + e[9] * z + e[13]) / cw
      if (Math.abs(nx) > 1 || Math.abs(ny) > 1) return null
      return { px: Math.round(((nx + 1) / 2) * 1200), py: Math.round(((1 - ny) / 2) * 540) }
    }
    const cp = cam.position
    const rows = []
    // 网格：x ∈ 2~6 步 0.5（正前方向），y ∈ -1.5~1.5 步 0.5，z=0 底 / z=0.5 / z=1.0 顶
    for (const z of [0, 0.5, 1.0]) {
      const cells = []
      for (let x = 2; x <= 6.001; x += 0.5) {
        for (let y = -1.5; y <= 1.501; y += 0.5) {
          const p = proj(x, y, z)
          // 只报「画面中带」的格子（py 240~470）
          if (p && p.py >= 240 && p.py <= 470) {
            cells.push(`(${x},${y})→${p.px},${p.py}`)
          }
        }
      }
      rows.push({ z, hits: cells })
    }
    return { camPos: cp.toArray().map((v) => +v.toFixed(2)), fov: cam.fov, rows }
  })
  console.log(`相机 ${JSON.stringify(out.camPos)} fov=${out.fov}`)
  for (const r of out.rows) {
    console.log(`\n== z=${r.z} 落在画面中带(py240~470)的格子 ==`)
    console.log(r.hits.join("  ") || "（无）")
  }
  await browser.close()
}
main().catch((e) => {
  console.error("FAIL", e.message)
  process.exit(1)
})
