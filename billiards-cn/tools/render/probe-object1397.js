/**
 * v1.3.97 黑椭圆定位探针：从相机经屏幕点反投影射线，列出命中 mesh 及父链。
 * 黑椭圆出现在 free 机位画面 (≈637,200)/1280x720 → NDC(≈0, 0.444)。
 */
const path = require("path")
const fs = require("fs")
const puppeteer = require("puppeteer-core")

const DIST = "/workspace/dev/source/billiards-cn/dist"
const OUT = "/root/.codebuddy/artifact/room-v1397-probe"

async function main() {
  fs.mkdirSync(OUT, { recursive: true })
  const browser = await puppeteer.launch({
    executablePath: "/usr/bin/google-chrome",
    headless: "new",
    args: [
      "--no-sandbox", "--hide-scrollbars", "--disable-dev-shm-usage", "--no-zygote",
      "--ozone-platform=headless", "--use-gl=angle", "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader", "--user-data-dir=/tmp/chrome-probe-obj",
      "--in-process-gpu", "--disable-gpu-sandbox", "--allow-file-access-from-files",
      "--window-size=1280,720",
    ],
    env: { ...process.env, DISPLAY: "" },
  })
  const page = await browser.newPage()
  await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 1 })
  page.on("pageerror", (e) => console.log(`[pageerror] ${e.message}`))
  await page.goto(`file://${DIST}/play.html?debug=1&bot=Professional`, {
    waitUntil: "load",
    timeout: 120000,
  })
  for (let i = 0; i < 6; i++) {
    const ok = await page
      .evaluate(() => {
        const bc = globalThis.__bc
        const v = bc && bc.container && bc.container.view
        return !!(v && v.scene && v.camera && v.renderer)
      })
      .catch(() => false)
    if (ok) break
    await new Promise((r) => setTimeout(r, 10000))
  }
  await new Promise((r) => setTimeout(r, 3000))
  await page.evaluate(() => {
    globalThis.__bc.container.view.applyScene("room")
  })
  await new Promise((r) => setTimeout(r, 900))

  // 劫持相机到 free 机位
  await page.evaluate(() => {
    const v = globalThis.__bc.container.view
    const camWrap = v.camera
    const c = camWrap.camera || camWrap
    camWrap.update = function () {
      c.position.set(0, 3.3, 1.75)
      c.lookAt(0, -0.4, 0.1)
      c.fov = 55
      c.updateProjectionMatrix()
    }
    camWrap.update(0, null)
  })
  await new Promise((r) => setTimeout(r, 700))

  // 页面环境里 THREE 全局不一定暴露 → 自实现 ray-AABB（slab 法）定位命中对象
  const hits2 = await page.evaluate(() => {
    const v = globalThis.__bc.container.view
    const scene = v.scene
    const cam = v.camera.camera || v.camera
    const V3 = cam.position.constructor
    function rayAABB(o, d, min, max) {
      let tmin = -Infinity, tmax = Infinity
      for (const ax of ["x", "y", "z"]) {
        const inv = 1 / d[ax]
        let t1 = (min[ax] - o[ax]) * inv
        let t2 = (max[ax] - o[ax]) * inv
        if (t1 > t2) { const t = t1; t1 = t2; t2 = t }
        tmin = Math.max(tmin, t1)
        tmax = Math.min(tmax, t2)
        if (tmin > tmax) return null
      }
      return tmin >= 0 ? tmin : tmax >= 0 ? 0 : null
    }
    scene.updateMatrixWorld(true)
    const halfH = Math.tan((cam.fov * Math.PI) / 360)
    const halfW = halfH * cam.aspect
    const fwd = new V3(); cam.getWorldDirection(fwd)
    const worldUp = new V3(0, 0, 1)
    const right = new V3().crossVectors(fwd, worldUp).normalize()
    const upv = new V3().crossVectors(right, fwd).normalize()
    const ndcX = 0, ndcY = 0.444
    const dir = new V3()
      .addScaledVector(fwd, 1)
      .addScaledVector(right, ndcX * halfW)
      .addScaledVector(upv, ndcY * halfH)
      .normalize()
    const o = cam.position
    const res = []
    scene.traverse((n) => {
      if (!n.isMesh && !n.isPoints && !n.isLine) return
      if (n.visible === false) return
      const geo = n.geometry
      if (!geo || !geo.boundingBox) {
        if (geo) geo.computeBoundingBox()
        else return
      }
      const bb = geo.boundingBox.clone().applyMatrix4(n.matrixWorld)
      const t = rayAABB(o, dir, bb.min, bb.max)
      if (t !== null && t < 30) {
        const chain = []
        let p = n
        while (p && chain.length < 6) { chain.push(p.name || p.type); p = p.parent }
        const pt = new V3().copy(dir).multiplyScalar(t).add(o)
        res.push({ t: +t.toFixed(2), pt: [pt.x.toFixed(2), pt.y.toFixed(2), pt.z.toFixed(2)], chain: chain.join(" < ") })
      }
    })
    res.sort((a, b) => a.t - b.t)
    return res.slice(0, 12)
  })
  console.log("射线命中（近→远）：")
  for (const h of hits2) console.log(`  t=${h.t} pt=(${h.pt}) ${h.chain}`)

  await page.screenshot({ path: path.join(OUT, "probe_obj.png") })
  await browser.close()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
