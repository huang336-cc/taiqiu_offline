/** 查特定世界点在屏幕上的投影位置（v1.3.88 调试用） */
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
      if (cw <= 1e-6) return { behind: true }
      const nx = (e[0] * x + e[4] * y + e[8] * z + e[12]) / cw
      const ny = (e[1] * x + e[5] * y + e[9] * z + e[13]) / cw
      return {
        px: Math.round(((nx + 1) / 2) * 1200),
        py: Math.round(((1 - ny) / 2) * 540),
        inView: Math.abs(nx) <= 1 && Math.abs(ny) <= 1,
      }
    }
    // 显示器四角（2.9, 2.72 桌）与白板中心
    const pts = {
      屏左下: proj(2.9 - 0.22, 2.72, 0.85),
      屏右下: proj(2.9 + 0.22, 2.72, 0.85),
      屏左上: proj(2.9 - 0.22, 2.72, 1.14),
      屏右上: proj(2.9 + 0.22, 2.72, 1.14),
      桌前沿中: proj(2.9, 2.19, 0.78),
      桌后沿中: proj(2.9, 2.91, 0.78),
      椅子: proj(2.9, 1.8, 0.5),
      白板: proj(5.93, -1.2, 1.0),
    }
    // 检查 OfficeProps mesh 是否真的含有显示器几何（按包围盒）
    let propInfo = null
    view.sceneEnv.traverse((o) => {
      if (o.name === "OfficeProps" && o.geometry) {
        o.geometry.computeBoundingBox()
        const b = o.geometry.boundingBox
        propInfo = {
          min: [b.min.x, b.min.y, b.min.z].map((v) => +v.toFixed(2)),
          max: [b.max.x, b.max.y, b.max.z].map((v) => +v.toFixed(2)),
          tris: Math.round(
            (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3
          ),
        }
      }
    })
    return { camPos: cam.position.toArray().map((v) => +v.toFixed(2)), pts, propInfo }
  })
  console.log(JSON.stringify(out, null, 1))
  await browser.close()
}
main().catch((e) => {
  console.error("FAIL", e.message)
  process.exit(1)
})
