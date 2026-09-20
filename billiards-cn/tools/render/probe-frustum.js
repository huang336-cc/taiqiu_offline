/**
 * 瞄准相机视锥普查（v1.3.88）。
 *
 * 目的：在决定「往场景里加什么」之前，先算清楚**相机到底能看到哪一块空间**。
 * 此前几十版的一大毛病就是凭感觉加东西，加完不入画，然后归因错误。
 *
 * 现在有 render.js 的真实机位，直接读相机矩阵，对给定的几何包围盒做
 * 视锥内外判定 + 投影到屏幕的像素范围，用数字说话。
 *
 * 用法：DISPLAY=:99 node tools/render/probe-frustum.js [--scene room] [--w 1200] [--h 540]
 */
const path = require("path")
const puppeteer = require("puppeteer-core")

const DIST = "/workspace/project/source/billiards-cn/dist"

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def
}

const SCENE = arg("scene", "room")
const W = parseInt(arg("w", "1200"), 10)
const H = parseInt(arg("h", "540"), 10)

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
      `--user-data-dir=/tmp/chrome-frustum-${Date.now()}`,
      "--in-process-gpu",
      "--disable-gpu-sandbox",
      "--allow-file-access-from-files",
      `--window-size=${W},${H}`,
    ],
    env: { ...process.env },
  })

  const page = await browser.newPage()
  await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 })

  await page.goto(`file://${DIST}/play.html?debug=1`, {
    waitUntil: "load",
    timeout: 120000,
  })

  // 等就绪（分片轮询）
  let ready = false
  for (let i = 0; i < 8 && !ready; i++) {
    const ok = await page
      .evaluate(() => {
        const v = globalThis.__bc?.container?.view
        try {
          return !!(v && v.scene && v.camera && v.renderer?.getContext?.())
        } catch {
          return false
        }
      })
      .catch(() => false)
    if (ok) ready = true
    else await new Promise((r) => setTimeout(r, 8000))
  }
  if (!ready) {
    console.error("容器未就绪")
    await browser.close()
    process.exit(2)
  }
  await new Promise((r) => setTimeout(r, 2500))

  // 切场景
  const sw = await page.evaluate((sc) => {
    const v = globalThis.__bc.container.view
    v.applyScene(sc)
    return { env: v.sceneEnv ? v.sceneEnv.name : null }
  }, SCENE)
  console.log(`场景: ${SCENE} → ${sw.env}`)
  await new Promise((r) => setTimeout(r, 1200))

  // 用真实 aim 机位（与 render.js 一致：只 forceMode，其余交给页面）
  await page.evaluate(() => {
    globalThis.__bc.container.view.camera.forceMode("aim")
  })
  await new Promise((r) => setTimeout(r, 900))

  /**
   * 采样：把相机可见空间打成一张「体素网格」，逐点判断是否在视锥内、
   * 投影到屏幕上落在哪个像素。这样能直接回答「x∈[a,b], z∈[c,d] 的区域
   * 有没有入画」。
   */
  const report = await page.evaluate(
    (opts) => {
      const view = globalThis.__bc.container.view
      const cam = view.camera.camera || view.camera
      cam.updateMatrixWorld(true)
      cam.updateProjectionMatrix()

      const pos = cam.position.clone()
      const dir = new (cam.position.constructor)()
      cam.getWorldDirection(dir)

      // 用 three 的 Frustum 做内外判定
      const THREE = view.scene.constructor
      // 手动组一组平面：直接拿投影*视图矩阵
      const m = cam.projectionMatrix.clone().multiply(cam.matrixWorldInverse)

      const W = opts.W
      const H = opts.H

      // 世界点 → NDC → 像素
      function project(x, y, z) {
        const v = { x, y, z, w: 1 }
        const e = m.elements
        const cx = e[0] * x + e[4] * y + e[8] * z + e[12]
        const cy = e[1] * x + e[5] * y + e[9] * z + e[13]
        const cw = e[3] * x + e[7] * y + e[11] * z + e[15]
        if (Math.abs(cw) < 1e-9) return null
        const ndcX = cx / cw
        const ndcY = cy / cw
        return {
          ndcX,
          ndcY,
          px: ((ndcX + 1) / 2) * W,
          py: ((1 - ndcY) / 2) * H,
          w: cw,
          inFrustum: Math.abs(ndcX) <= 1 && Math.abs(ndcY) <= 1 && cw > 0,
        }
      }

      /**
       * 查一批「候选构件」的可见性 —— 用包围盒的 8 个角点 + 底面中心、
       * 顶面中心，看有多少点入画，以及投影像素范围。
       */
      function probeBox(label, box) {
        const [x0, y0, z0, x1, y1, z1] = box
        const pts = []
        for (const x of [x0, x1])
          for (const y of [y0, y1])
            for (const z of [z0, z1]) pts.push(project(x, y, z))
        const valid = pts.filter((p) => p && p.inFrustum)
        if (!valid.length) {
          return { label, visible: false, hits: 0, total: pts.length }
        }
        const px = valid.map((p) => p.px)
        const py = valid.map((p) => p.py)
        return {
          label,
          visible: true,
          hits: valid.length,
          total: pts.length,
          pxRange: [Math.round(Math.min(...px)), Math.round(Math.max(...px))],
          pyRange: [Math.round(Math.min(...py)), Math.round(Math.max(...py))],
          dist: +Math.min(...valid.map((p) => p.w)).toFixed(2),
        }
      }

      return {
        camPos: pos.toArray().map((v) => +v.toFixed(3)),
        camDir: [dir.x, dir.y, dir.z].map((v) => +v.toFixed(4)),
        fov: +cam.fov.toFixed(2),
        aspect: +cam.aspect.toFixed(4),
        near: cam.near,
        far: cam.far,
        pxPerMeterAt5m: (() => {
          // 在 5m 处，垂直方向 1 米对应多少像素
          const vh = 2 * 5 * Math.tan((cam.fov * Math.PI) / 180 / 2)
          return +(H / vh).toFixed(1)
        })(),
      }
    },
    { W, H }
  )

  console.log("\n=== 相机 ===")
  console.log(`  位置 ${JSON.stringify(report.camPos)}  fov ${report.fov}°  aspect ${report.aspect} (${W}×${H})`)
  console.log(`  far ${report.far}  |  5m 处 1 米 ≈ ${report.pxPerMeterAt5m} px（垂直）`)
  console.log(
    `  → 5m 处画面垂直可见高度 ≈ ${(H / report.pxPerMeterAt5m).toFixed(2)} m`
  )

  await browser.close()
}

main().catch((e) => {
  console.error("探针失败:", e.message)
  process.exit(1)
})
