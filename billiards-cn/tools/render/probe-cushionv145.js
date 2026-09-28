/**
 * 【v1.4.5 P5】库边 UV + 贴图接入验证。
 *
 * 验证三件事：
 *   ① CushionBlue mesh 补上了 uv 属性，范围 u∈[0,~4]（长边 3m/0.75m）、v∈[0,~1]；
 *   ② 库边材质挂上了 1024×64 绒面贴图；
 *   ③ 台面标志覆盖层 ClothMarks 已不存在（v1.4.5 删除）。
 *
 * 用法：node tools/render/probe-cushionv145.js
 */
const puppeteer = require("puppeteer-core")

;(async () => {
  const browser = await puppeteer.launch({
    executablePath: "/usr/bin/google-chrome",
    headless: "new",
    args: [
      "--no-sandbox", "--hide-scrollbars", "--disable-dev-shm-usage",
      "--no-zygote", "--ozone-platform=headless",
      "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader",
      "--user-data-dir=/tmp/chrome-cush145", "--in-process-gpu", "--disable-gpu-sandbox",
      "--allow-file-access-from-files", "--window-size=800,600",
    ],
    env: { ...process.env, DISPLAY: "" },
  })
  const page = await browser.newPage()
  await page.setViewport({ width: 800, height: 600 })
  await page.goto("file:///workspace/dev/source/billiards-cn/dist/play.html?debug=1&bot=Professional", {
    waitUntil: "load",
    timeout: 120000,
  })
  let ready = false
  for (let i = 0; i < 60 && !ready; i++) {
    ready = await page
      .evaluate(() => {
        const v = globalThis.__bc && globalThis.__bc.container && globalThis.__bc.container.view
        return !!(v && v.scene && v.camera && v.renderer)
      })
      .catch(() => false)
    if (!ready) await new Promise((r) => setTimeout(r, 1000))
  }
  if (!ready) {
    console.error("容器未就绪")
    await browser.close()
    process.exit(2)
  }
  await new Promise((r) => setTimeout(r, 2500))

  const out = await page.evaluate(() => {
    const scene = globalThis.__bc.container.view.scene
    scene.updateMatrixWorld(true)
    const res = { cushions: [], clothMarks: 0, marksMesh: null }
    scene.traverse((o) => {
      if (o.name === "ClothMarks") res.clothMarks++
      if (!o.isMesh || !o.geometry) return
      const mats = Array.isArray(o.material) ? o.material : [o.material]
      const matName = mats.map((m) => (m && m.name) || "").join("|")
      if (!(matName + " " + (o.name || "")).toLowerCase().includes("cushion")) return
      const uv = o.geometry.attributes.uv
      const m0 = mats[0]
      let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity
      if (uv) {
        for (let i = 0; i < uv.count; i++) {
          u0 = Math.min(u0, uv.getX(i)); u1 = Math.max(u1, uv.getX(i))
          v0 = Math.min(v0, uv.getY(i)); v1 = Math.max(v1, uv.getY(i))
        }
      }
      res.cushions.push({
        name: o.name,
        mat: matName,
        uvCount: uv ? uv.count : 0,
        u: uv ? [+u0.toFixed(3), +u1.toFixed(3)] : null,
        v: uv ? [+v0.toFixed(3), +v1.toFixed(3)] : null,
        map: m0 && m0.map ? `${m0.map.image.width}x${m0.map.image.height}` : null,
        wrapS: m0 && m0.map ? m0.map.wrapS : null,
      })
    })
    return res
  })
  console.log(JSON.stringify(out, null, 1))
  await browser.close()
})().catch((e) => {
  console.error(e)
  process.exit(1)
})
