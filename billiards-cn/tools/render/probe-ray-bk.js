/** basketball 中央柱定位：从相机向指定屏点打射线，报告命中 mesh 链 */
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
      `--user-data-dir=/tmp/chrome-ray-${Date.now()}`,
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
    const scene = view.scene
    cam.updateMatrixWorld(true)
    const hits = {}
    // 屏点 → NDC → unproject 反推射线
    const castPx = (name, px, py) => {
      const ndcX = (px / 1200) * 2 - 1
      const ndcY = 1 - (py / 540) * 2
      const v = new (globalThis.__three?.Vector3 ||
        cam.position.constructor)(ndcX, ndcY, 0.5)
      v.unproject(cam)
      const dir = v.sub(cam.position).normalize()
      const rc = { ray: { origin: cam.position.clone(), direction: dir } }
      // 用 three 的 Raycaster（页面全局 three 不可得时手写兜底：这里直接
      // 借 renderer 内部 —— 简化：手写 ray-AABB 遍历 mesh）
      const res = []
      scene.traverse((o) => {
        if (!o.isMesh || !o.geometry?.attributes?.position) return
        o.updateMatrixWorld(true)
        const inv = o.matrixWorld.clone().invert()
        const ro = rc.ray.origin.clone().applyMatrix4(inv)
        const rd = rc.ray.direction
          .clone()
          .transformDirection(inv)
          .normalize()
        o.geometry.computeBoundingBox()
        const bb = o.geometry.boundingBox
        let t0 = -Infinity,
          t1 = Infinity
        let ok = true
        for (const a of ["x", "y", "z"]) {
          const d = rd[a]
          if (Math.abs(d) < 1e-9) {
            if (ro[a] < bb.min[a] || ro[a] > bb.max[a]) {
              ok = false
              break
            }
            continue
          }
          let ta = (bb.min[a] - ro[a]) / d
          let tb = (bb.max[a] - ro[a]) / d
          if (ta > tb) [ta, tb] = [tb, ta]
          t0 = Math.max(t0, ta)
          t1 = Math.min(t1, tb)
          if (t0 > t1) {
            ok = false
            break
          }
        }
        if (ok && t1 > 0) {
          const tHit = Math.max(t0, 0)
          const pLocal = ro.clone().addScaledVector(rd, tHit)
          const pWorld = pLocal.clone().applyMatrix4(o.matrixWorld)
          res.push({
            name: o.name || "(anon)",
            dist: +cam.position.distanceTo(pWorld).toFixed(2),
            world: [
              +pWorld.x.toFixed(2),
              +pWorld.y.toFixed(2),
              +pWorld.z.toFixed(2),
            ],
          })
        }
      })
      res.sort((a, b) => a.dist - b.dist)
      hits[`${name}(${px},${py})`] = res.slice(0, 6)
    }
    // 中央柱上/中/下三点 + 记分牌屏区对照
    castPx("柱上", 600, 30)
    castPx("柱中", 600, 70)
    castPx("柱下", 600, 120)
    castPx("屏左", 510, 45)
    castPx("屏右", 690, 45)
    castPx("观众带", 300, 120)
    return { camPos: cam.position.toArray().map((v) => +v.toFixed(3)), hits }
  })
  console.log(JSON.stringify(out, null, 1))
  await browser.close()
}
main().catch((e) => {
  console.error("FAIL", e.message)
  process.exit(1)
})
