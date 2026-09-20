/**
 * 母球 / 瞄准管 实物探针（v1.3.85）。
 *
 * 前一版探针读 `view.table.balls[].mesh` 全为 null，因为球网格挂在
 * `table` 的 scene group 上、且 `Ball` 实例上的字段名不是 `mesh`。
 * 这里改为**遍历场景按名字找**（球网格 name === "ball"），最可靠。
 *
 * 用法：DISPLAY=:99 node tools/render/probe-cueball.js
 */
const path = require("path")
const puppeteer = require("puppeteer-core")

const DIST = path.resolve(__dirname, "../../dist")
const URL = `file://${DIST}/play.html?debug=1&bot=Professional`

;(async () => {
  const browser = await puppeteer.launch({
    executablePath: "/usr/bin/google-chrome",
    headless: "new",
    args: [
      "--no-sandbox",
      "--hide-scrollbars",
      "--use-gl=angle",
      "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader",
      "--user-data-dir=/tmp/chrome-probe-cb",
      "--in-process-gpu",
      "--disable-gpu-sandbox",
      "--allow-file-access-from-files",
      "--window-size=540,960",
    ],
    defaultViewport: { width: 540, height: 960 },
  })
  const page = await browser.newPage()
  page.on("pageerror", (e) => console.error("PAGEERROR:", e.message))
  await page.goto(URL, { waitUntil: "load", timeout: 120000 })
  const ready = await page
    .waitForFunction(
      () => {
        const bc = globalThis.__bc
        const view = bc && bc.container && bc.container.view
        const r = view && view.renderer
        return !!(view && view.scene && view.camera && r && r.getContext())
      },
      { timeout: 90000 }
    )
    .then(() => true)
    .catch(() => false)
  if (!ready) {
    console.error("容器未就绪")
    await browser.close()
    process.exit(2)
  }
  await new Promise((r) => setTimeout(r, 10000))

  const info = await page.evaluate(() => {
    const view = globalThis.__bc.container.view
    const out = { balls: [], helpers: [] }

    view.scene.traverse((o) => {
      if (!o.isMesh) return
      if (o.name === "ball") {
        const g = o.geometry
        const m = Array.isArray(o.material) ? o.material[0] : o.material
        const col = g.attributes.color
        const hist = new Map()
        if (col) {
          for (let i = 0; i < col.count; i++) {
            const k = [col.getX(i), col.getY(i), col.getZ(i)]
              .map((v) => Math.round(v * 255))
              .join(",")
            hist.set(k, (hist.get(k) || 0) + 1)
          }
        }
        out.balls.push({
          worldPos: [
            +o.getWorldPosition(o.position.clone()).x.toFixed(3),
            +o.getWorldPosition(o.position.clone()).y.toFixed(3),
            +o.getWorldPosition(o.position.clone()).z.toFixed(3),
          ],
          matType: m ? m.type : null,
          vertexColors: m ? m.vertexColors : null,
          matColor: m && m.color ? m.color.getHexString() : null,
          hasMap: !!(m && m.map),
          mapType: m && m.map ? m.map.constructor.name : null,
          verts: g.attributes.position.count,
          geoUUID: g.uuid.slice(0, 8),
          distinctColors: hist.size,
          topColors: [...hist.entries()]
            .sort((a, b) => b[1] - a[1])
            .slice(0, 6)
            .map(([k, v]) => `rgb(${k}) x${v}`),
        })
      }
    })

    // 找所有 ShaderMaterial 的圆柱（瞄准管候选）
    view.scene.traverse((o) => {
      if (!o.isMesh) return
      const m = Array.isArray(o.material) ? o.material[0] : o.material
      if (m && m.type === "ShaderMaterial" && m.fragmentShader) {
        out.helpers.push({
          name: o.name || "(unnamed)",
          visible: o.visible,
          geoType: o.geometry.type,
          renderOrder: o.renderOrder,
          depthTest: m.depthTest,
          transparent: m.transparent,
          fragAlphaExpr: (m.fragmentShader.match(
            /gl_FragColor\s*=\s*vec4\([^;]*\)/
          ) || [])[0],
          hasNewFade: m.fragmentShader.includes("1.0 - clamp(vUv.y"),
          scale: [o.scale.x, o.scale.y, o.scale.z],
        })
      }
    })
    return out
  })

  console.log("BALLS:", JSON.stringify(info.balls, null, 1))
  console.log("HELPERS:", JSON.stringify(info.helpers, null, 1))
  await browser.close()
})().catch((e) => {
  console.error(e)
  process.exit(1)
})
