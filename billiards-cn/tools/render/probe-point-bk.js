/** basketball 特征物投影 + 遮挡实测（v1.3.88b 调试用） */
const puppeteer = require("puppeteer-core")
const DIST = "/workspace/project/source/billiards-cn/dist"

async function main() {
  const browser = await puppeteer.launch({
    executablePath: "/usr/bin/google-chrome",
    headless: "new",
    args: [
      "--no-sandbox",
      "--use-gl=angle",
      "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader",
      `--user-data-dir=/tmp/chrome-pr-${Date.now()}`,
      "--in-process-gpu",
      "--disable-gpu-sandbox",
      "--allow-file-access-from-files",
      "--window-size=1200,540",
    ],
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
    globalThis.__bc.container.view.applyScene("basketball")
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
      if (cw <= 1e-6) return { behind: true }
      const nx = (e[0] * x + e[4] * y + e[8] * z + e[12]) / cw
      const ny = (e[1] * x + e[5] * y + e[9] * z + e[13]) / cw
      return {
        px: Math.round(((nx + 1) / 2) * 1200),
        py: Math.round(((1 - ny) / 2) * 540),
        inView: Math.abs(nx) <= 1 && Math.abs(ny) <= 1,
      }
    }
    const C = cam.position.toArray()
    // 手写 slab 法：相机 → 目标线段是否与球桌 AABB 相交
    const tableAABB = { min: [-1.65, -0.93, -0.2], max: [1.65, 0.93, 0.85] }
    const occluded = (tx, ty, tz) => {
      const d = [tx - C[0], ty - C[1], tz - C[2]]
      let t0 = 0,
        t1 = 1
      for (let a = 0; a < 3; a++) {
        const o = [C[0], C[1], C[2]][a]
        if (Math.abs(d[a]) < 1e-9) {
          if (o < tableAABB.min[a] || o > tableAABB.max[a]) return false
          continue
        }
        let ta = (tableAABB.min[a] - o) / d[a]
        let tb = (tableAABB.max[a] - o) / d[a]
        if (ta > tb) [ta, tb] = [tb, ta]
        t0 = Math.max(t0, ta)
        t1 = Math.min(t1, tb)
        if (t0 > t1) return false
      }
      return true
    }
    const pts = {}
    const probe = (name, x, y, z) => {
      pts[name] = { ...proj(x, y, z), blocked: occluded(x, y, z) }
    }
    // 队席垫（y=±2.05）近沿/远沿
    probe("席垫N近上", 4.6, 2.05 - 0.8, 0.28)
    probe("席垫N远上", 4.6, 2.05 + 0.8, 0.28)
    probe("席垫S近上", 4.6, -2.05 + 0.8, 0.28)
    probe("席垫S远上", 4.6, -2.05 - 0.8, 0.28)
    // 三颗篮球
    probe("球1", 2.2, 1.9, 0.145)
    probe("球2", 3.4, -2.0, 0.145)
    probe("球3", 4.2, 1.95, 0.145)
    // 三秒区漆面内端/中心/外端（sgn=+1）
    probe("漆内端", 1.2, 1.35, 0.0)
    probe("漆中心", 0, 2.25, 0.0)
    probe("漆外端", 1.2, 3.1, 0.0)
    // 兜底对照：远处草地上一个假设点
    probe("对照远点", 4.6, 2.05, 0.9)
    return { camPos: C.map((v) => +v.toFixed(3)), pts }
  })
  console.log(JSON.stringify(out, null, 1))
  await browser.close()
}
main().catch((e) => {
  console.error("FAIL", e.message)
  process.exit(1)
})
