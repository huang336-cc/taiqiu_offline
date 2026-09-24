/**
 * v1.3.97 aim 机位长条物体定位：读实际 aim 相机参数，
 * 从长条屏幕点 (400,395)/540x960 → NDC(0.481,0.177) 反投影，列出命中对象。
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
      "--enable-unsafe-swiftshader", "--user-data-dir=/tmp/chrome-probe-aim",
      "--in-process-gpu", "--disable-gpu-sandbox", "--allow-file-access-from-files",
      "--window-size=540,960",
    ],
    env: { ...process.env, DISPLAY: "" },
  })
  const page = await browser.newPage()
  await page.setViewport({ width: 540, height: 960, deviceScaleFactor: 1 })
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
  await page.evaluate(() => globalThis.__bc.container.view.applyScene("room"))
  await new Promise((r) => setTimeout(r, 900))
  // 切 aim 视角（与 render.js 相同入口），随后强制一帧
  await page.evaluate(() => {
    const v = globalThis.__bc.container.view
    if (v.camera.forceMode) v.camera.forceMode("aim")
  })
  await new Promise((r) => setTimeout(r, 1200))

  const info = await page.evaluate(() => {
    const v = globalThis.__bc.container.view
    const cam = v.camera.camera || v.camera
    return {
      pos: cam.position.toArray().map((n) => +n.toFixed(2)),
      fov: cam.fov,
      aspect: cam.aspect,
      up: cam.up.toArray(),
      quat: cam.quaternion.toArray().map((n) => +n.toFixed(3)),
    }
  })
  console.log("aim 相机:", JSON.stringify(info))

  const hits = await page.evaluate(() => {
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
    // 用相机真实姿态（quaternion）构造射线，避免 up 假设错误
    const ndcX = 0.481, ndcY = 0.177
    const halfH = Math.tan((cam.fov * Math.PI) / 360)
    const halfW = halfH * cam.aspect
    const fwd = new V3(0, 0, -1).applyQuaternion(cam.quaternion)
    const right = new V3(1, 0, 0).applyQuaternion(cam.quaternion)
    const upv = new V3(0, 1, 0).applyQuaternion(cam.quaternion)
    const dir = new V3()
      .addScaledVector(fwd, 1)
      .addScaledVector(right, ndcX * halfW)
      .addScaledVector(upv, ndcY * halfH)
      .normalize()
    const o = cam.position
    const res = []
    scene.traverse((n) => {
      if (!n.isMesh) return
      if (n.visible === false) return
      const geo = n.geometry
      if (!geo) return
      if (!geo.boundingBox) geo.computeBoundingBox()
      const bb = geo.boundingBox.clone().applyMatrix4(n.matrixWorld)
      const t = rayAABB(o, dir, bb.min, bb.max)
      if (t !== null && t < 40) {
        const chain = []
        let p = n
        while (p && chain.length < 5) { chain.push(p.name || p.type); p = p.parent }
        const pt = new V3().copy(dir).multiplyScalar(t).add(o)
        res.push({ t: +t.toFixed(2), pt: [pt.x.toFixed(2), pt.y.toFixed(2), pt.z.toFixed(2)], chain: chain.join("<") })
      }
    })
    res.sort((a, b) => a.t - b.t)
    return res.slice(0, 14)
  })
  console.log("射线命中（近→远）：")
  for (const h of hits) console.log(`  t=${h.t} pt=(${h.pt}) ${h.chain}`)
  await browser.close()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
