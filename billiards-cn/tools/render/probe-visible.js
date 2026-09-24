/**
 * 瞄准机位可见性实测（v1.3.88）。
 *
 * 回答一个问题：「距离 d 米处，高度 z 的物体入不入画？」
 * 此前加特征物全靠感觉，加完不入画再归因错误。现在直接用真实相机矩阵
 * 把测试点投影到屏幕，用数字说话。
 *
 * 用法：DISPLAY=:99 node tools/render/probe-visible.js --scene office
 */
const puppeteer = require("puppeteer-core")

const DIST = "/workspace/dev/source/billiards-cn/dist"

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def
}
const SCENE = arg("scene", "room")

async function main() {
  if (!process.env.DISPLAY) {
    console.error("需要 DISPLAY")
    process.exit(1)
  }
  const browser = await puppeteer.launch({
    executablePath: "/usr/bin/google-chrome",
    headless: "new",
    args: [
      "--no-sandbox",
      "--hide-scrollbars",
      "--use-gl=angle",
      "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader",
      `--user-data-dir=/tmp/chrome-vis-${Date.now()}`,
      "--in-process-gpu",
      "--disable-gpu-sandbox",
      "--allow-file-access-from-files",
      "--window-size=1200,540",
    ],
    env: { ...process.env },
  })
  const page = await browser.newPage()
  await page.setViewport({ width: 1200, height: 540, deviceScaleFactor: 1 })
  // ⚠️ 必须带 bot：bot 模式才有 aiming 态，页面才会自己把相机收敛到 aim 机位
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
  if (!ready) {
    console.error("容器未就绪")
    await browser.close()
    process.exit(2)
  }
  await new Promise((r) => setTimeout(r, 2500))
  await page.evaluate((sc) => {
    globalThis.__bc.container.view.applyScene(sc)
    globalThis.__bc.container.view.camera.forceMode("aim")
  }, SCENE)
  await new Promise((r) => setTimeout(r, 2000))
  // 摆到稳态（页面自己收敛 aim 机位）
  await page.evaluate(() => {
    globalThis.__bc.container.view.renderer?.render(
      globalThis.__bc.container.view.scene,
      globalThis.__bc.container.view.camera.camera
    )
  })

  /**
   * 实测：相机沿 -X 看（审计图证实白球在下、球堆在上，相机在 -X 侧）。
   * 对每「横距 d ∈ {2,3,4,5,6,7,8,10}」×「高度 z ∈ 0~2.4 步进 0.1」，
   * 在相机正前方（y=0 线）投影，输出最高入画高度 + 屏幕位置。
   * 侧向（y=±2.5/±3.5）也测一组，覆盖球桌两侧的家具区。
   */
  const grid = await page.evaluate(() => {
    const view = globalThis.__bc.container.view
    const cam = view.camera.camera || view.camera
    cam.updateMatrixWorld(true)
    const m = cam.projectionMatrix.clone().multiply(cam.matrixWorldInverse)
    const W = 1200
    const H = 540
    const proj = (x, y, z) => {
      const e = m.elements
      const cw = e[3] * x + e[7] * y + e[11] * z + e[15]
      if (cw <= 1e-6) return null
      const nx = (e[0] * x + e[4] * y + e[8] * z + e[12]) / cw
      const ny = (e[1] * x + e[5] * y + e[9] * z + e[13]) / cw
      return {
        in: Math.abs(nx) <= 1 && Math.abs(ny) <= 1,
        py: ((1 - ny) / 2) * H,
        px: ((nx + 1) / 2) * W,
      }
    }
    const cp = cam.position
    const res = { camPos: [cp.x, cp.y, cp.z].map((v) => +v.toFixed(3)), rows: [] }
    // 相机朝向
    const dir = new (cp.constructor)()
    cam.getWorldDirection(dir)
    res.camDir = [dir.x, dir.y, dir.z].map((v) => +v.toFixed(3))
    for (const [dy, tag] of [
      [0, "正前"],
      [2.5, "侧2.5"],
      [-2.5, "侧-2.5"],
      [3.5, "侧3.5"],
    ]) {
      const row = { tag, cells: [] }
      for (const d of [2, 3, 4, 5, 6, 7, 8, 10]) {
        // 沿相机视线方向走 d 米（水平投影），再加侧偏 dy
        const hx = cp.x + dir.x * d
        const hy = cp.y + dir.y * d + dy
        let top = null
        let topPy = null
        for (let z = 2.6; z >= -0.3; z -= 0.02) {
          const p = proj(hx, hy, z)
          if (p && p.in) {
            top = z
            topPy = Math.round(p.py)
            break
          }
        }
        row.cells.push({ d, topZ: top === null ? null : +top.toFixed(2), topPy })
      }
      res.rows.push(row)
    }
    return res
  })

  console.log(
    `相机 pos=${JSON.stringify(grid.camPos)} dir=${JSON.stringify(grid.camDir)}`
  )
  for (const row of grid.rows) {
    const parts = row.cells.map(
      (c) =>
        `d=${c.d}:${c.topZ === null ? "✗" : `${c.topZ}m@y${c.topPy}`}`
    )
    console.log(`[${row.tag}] ${parts.join("  ")}`)
  }
  await browser.close()
}

main().catch((e) => {
  console.error("探针失败:", e.message)
  process.exit(1)
})
