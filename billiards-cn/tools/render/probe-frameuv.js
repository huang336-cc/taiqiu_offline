/**
 * 【v1.4.4 P4/P5】桌框 / 库边 UV 与几何测绘。
 *
 * 桌框贴图是三平面投影生成的（fixFrameUVs）：顶面 u=(x-minX)/scale、
 * v=(y-minY)/scale，侧面 v 只占 厚度/scale 的一条窄带。不实测根本不知道
 * 贴图哪块区域真的出现在画面上 —— 装饰画错地方就等于没画。
 *
 * 这里直接把 mesh 的世界 bbox、scale、以及**顶面顶点**的 (u,v) 分布读出来，
 * 换算成 1024×256 贴图上的像素矩形，供 buildFrameCanvas 定位装饰。
 *
 * 用法：node tools/render/probe-frameuv.js [--skin classic]
 */
const path = require("path")
const puppeteer = require("puppeteer-core")
const DIST = path.join("/workspace/dev/source/billiards-cn", "dist")

function arg(n, d = null) {
  const i = process.argv.indexOf(`--${n}`)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d
}

;(async () => {
  const browser = await puppeteer.launch({
    executablePath: "/usr/bin/google-chrome",
    headless: "new",
    args: [
      "--no-sandbox",
      "--hide-scrollbars",
      "--disable-dev-shm-usage",
      "--no-zygote",
      "--ozone-platform=headless",
      "--use-gl=angle",
      "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader",
      "--user-data-dir=/tmp/chrome-frameuv-profile",
      "--in-process-gpu",
      "--disable-gpu-sandbox",
      "--allow-file-access-from-files",
      "--window-size=800,600",
    ],
    env: { ...process.env, DISPLAY: "" },
  })
  const page = await browser.newPage()
  await page.setViewport({ width: 800, height: 600 })
  await page.goto(`file://${DIST}/play.html?debug=1&bot=Professional`, {
    waitUntil: "load",
    timeout: 120000,
  })
  let ready = false
  for (let i = 0; i < 6 && !ready; i++) {
    const st = await page
      .evaluate(() => {
        const bc = globalThis.__bc
        const v = bc && bc.container && bc.container.view
        return !!(v && v.scene && v.camera && v.renderer)
      })
      .catch(() => false)
    if (st) ready = true
    else await new Promise((r) => setTimeout(r, 15000))
  }
  if (!ready) {
    console.error("容器未就绪")
    await browser.close()
    process.exit(2)
  }
  await new Promise((r) => setTimeout(r, 3000))

  const out = await page.evaluate(() => {
    const view = globalThis.__bc.container.view
    const scene = view.scene
    scene.updateMatrixWorld(true)
    const res = []
    scene.traverse((o) => {
      if (!o.isMesh || !o.geometry) return
      const mats = Array.isArray(o.material) ? o.material : [o.material]
      const names = mats.map((m) => (m && m.name) || "(无名)").join("|")
      const ln = (o.name + " " + names).toLowerCase()
      const kind = ln.includes("frame") || ln.includes("wood")
        ? "frame"
        : ln.includes("cushion")
        ? "cushion"
        : ln.includes("cloth")
        ? "cloth"
        : null
      if (!kind) return

      const geo = o.geometry
      if (!geo.boundingBox) geo.computeBoundingBox()
      const bb = geo.boundingBox
      const e = o.matrixWorld.elements
      // 世界 bbox（8 角）
      let X0 = Infinity, X1 = -Infinity, Y0 = Infinity, Y1 = -Infinity, Z0 = Infinity, Z1 = -Infinity
      for (const cx of [bb.min.x, bb.max.x])
        for (const cy of [bb.min.y, bb.max.y])
          for (const cz of [bb.min.z, bb.max.z]) {
            const wx = e[0] * cx + e[4] * cy + e[8] * cz + e[12]
            const wy = e[1] * cx + e[5] * cy + e[9] * cz + e[13]
            const wz = e[2] * cx + e[6] * cy + e[10] * cz + e[14]
            X0 = Math.min(X0, wx); X1 = Math.max(X1, wx)
            Y0 = Math.min(Y0, wy); Y1 = Math.max(Y1, wy)
            Z0 = Math.min(Z0, wz); Z1 = Math.max(Z1, wz)
          }

      // UV 统计（按法线主导轴分组）
      const uv = geo.attributes.uv
      const nor = geo.attributes.normal
      const pos = geo.attributes.position
      const grp = { top: [], side: [] }
      if (uv && nor && pos) {
        for (let i = 0; i < pos.count; i += Math.max(1, Math.floor(pos.count / 4000))) {
          const nx = Math.abs(nor.getX(i)), ny = Math.abs(nor.getY(i)), nz = Math.abs(nor.getZ(i))
          const key = nz >= nx && nz >= ny ? "top" : "side"
          grp[key].push([uv.getX(i), uv.getY(i)])
        }
      }
      const stat = (arr) => {
        if (!arr.length) return null
        let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity
        for (const [u, v] of arr) {
          u0 = Math.min(u0, u); u1 = Math.max(u1, u)
          v0 = Math.min(v0, v); v1 = Math.max(v1, v)
        }
        return { n: arr.length, u: [+u0.toFixed(4), +u1.toFixed(4)], v: [+v0.toFixed(4), +v1.toFixed(4)] }
      }
      const tex = (Array.isArray(o.material) ? o.material[0] : o.material)
      res.push({
        kind,
        name: o.name,
        mat: names,
        worldBox: {
          x: [+X0.toFixed(4), +X1.toFixed(4)],
          y: [+Y0.toFixed(4), +Y1.toFixed(4)],
          z: [+Z0.toFixed(4), +Z1.toFixed(4)],
        },
        worldSize: [+(X1 - X0).toFixed(4), +(Y1 - Y0).toFixed(4), +(Z1 - Z0).toFixed(4)],
        uvTop: stat(grp.top),
        uvSide: stat(grp.side),
        texRepeat: tex && tex.map && tex.map.repeat
          ? [tex.map.repeat.x, tex.map.repeat.y]
          : null,
        texSize: tex && tex.map && tex.map.image
          ? [tex.map.image.width, tex.map.image.height]
          : null,
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
