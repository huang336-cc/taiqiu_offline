/** 中央柱二分定位：逐个隐藏嫌疑 mesh 渲染对比 */
const puppeteer = require("puppeteer-core")
const DIST = "/workspace/project/source/billiards-cn/dist"
const OUT = "/root/.codebuddy/artifact/render-v1389"

async function main() {
  const browser = await puppeteer.launch({
    executablePath: "/usr/bin/google-chrome",
    headless: "new",
    args: [
      "--no-sandbox",
      "--use-gl=angle",
      "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader",
      `--user-data-dir=/tmp/chrome-tg-${Date.now()}`,
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
  // nodialog：关掉欢迎弹窗，等相机收敛（与 render.js 同语义）
  for (let i = 0; i < 3; i++) {
    await page.evaluate(() => {
      for (const el of document.querySelectorAll("body *")) {
        const t = (el.textContent || "").trim()
        const w = el.offsetWidth
        if (
          /知道了|第\s*\d+\s*步|欢迎/.test(t) &&
          w > 100 &&
          w < window.innerWidth * 0.75
        )
          el.style.display = "none"
      }
    })
    await new Promise((r) => setTimeout(r, 1500))
  }
  await new Promise((r) => setTimeout(r, 3000))

  // 全场景 mesh 清单（先看清有什么）
  const list = await page.evaluate(() => {
    const names = []
    globalThis.__bc.container.view.scene.traverse((o) => {
      if (o.isMesh)
        names.push(
          `${o.name || "(anon)"} visible=${o.visible} parent=${o.parent?.name || "?"}`
        )
    })
    return names
  })
  console.log("=== scene meshes ===\n" + list.join("\n"))

  const variants = []
  // dump ScorerTable geometry
  const dump = await page.evaluate(() => {
    const out = []
    globalThis.__bc.container.view.scene.traverse((o) => {
      if (o.isMesh && o.name === "CourtProps") {
        o.geometry.computeBoundingBox()
        const bb = o.geometry.boundingBox
        const pa = o.geometry.attributes.position
        // 统计 |y|<1.2 且 z>1.5 的顶点（中央竖柱候选区）
        let central = 0, samples = []
        for (let i = 0; i < pa.count; i++) {
          const x = pa.getX(i), y = pa.getY(i), z = pa.getZ(i)
          if (Math.abs(y) < 1.2 && z > 1.5) {
            central++
            if (samples.length < 8) samples.push([+x.toFixed(2), +y.toFixed(2), +z.toFixed(2)])
          }
        }
        out.push({
          verts: pa.count,
          bb: { min: [bb.min.x, bb.min.y, bb.min.z].map(v=>+v.toFixed(2)),
                max: [bb.max.x, bb.max.y, bb.max.z].map(v=>+v.toFixed(2)) },
          centralVerts: central, samples,
        })
        return
      }
      if (o.isMesh && o.name === "ScorerTable") {
        o.geometry.computeBoundingBox()
        const bb = o.geometry.boundingBox
        const pa = o.geometry.attributes.position
        out.push({
          verts: pa.count,
          indexed: !!o.geometry.index,
          bb: {
            min: [bb.min.x, bb.min.y, bb.min.z].map((v) => +v.toFixed(3)),
            max: [bb.max.x, bb.max.y, bb.max.z].map((v) => +v.toFixed(3)),
          },
          first6: Array.from(pa.array.slice(0, 18)).map((v) => +v.toFixed(2)),
        })
      }
    })
    return out
  })
  console.log("ScorerTable geom:", JSON.stringify(dump))
  // 定点实验：藏/显 ScorerTable 各渲一帧
  for (const [tag, hideName] of [["withTable", null], ["hideTable", "ScorerTable"]]) {
    await page.evaluate((hideName) => {
      const view = globalThis.__bc.container.view
      view.scene.traverse((o) => {
        if (!o.isMesh) return
        const idPalette = {
          GymWalls: 0xff0000, GymAisle: 0x00ff00, Scoreboard: 0x0000ff,
          ScoreboardDigits: 0xffff00, WallDeco: 0xff00ff, ScorerTable: 0x00ffff,
          Crowd: 0x800000, CourtFloor: 0x008000, CourtLines: 0x000080,
          CourtPaint: 0x808000, CourtBalls: 0x800080, CourtProps: 0x008080,
          TeamBenches: 0xc0c0c0,
        }
        if (o.name in idPalette) {
          if (!o.userData.idMat)
            o.userData.idMat = new o.material.constructor({ color: idPalette[o.name] })
          o.material = o.userData.idMat
          if (hideName) o.visible = o.name !== hideName
        } else if (o.name) {
          if (!o.userData.dimMat) {
            o.userData.dimMat = new o.material.constructor()
            o.userData.dimMat.color = o.material.color.clone()
            o.userData.dimMat.opacity = 0.08
            o.userData.dimMat.transparent = true
          }
          o.material = o.userData.dimMat
        }
      })
      view.renderer.render(view.scene, view.camera.camera || view.camera)
    }, hideName)
    await new Promise((r) => setTimeout(r, 400))
    await page.screenshot({ path: `${OUT}/bisect_${tag}.png` })
    console.log("shot:", tag)
  }
  await browser.close()
  return
  for (const [tag, hide] of variants) {
    await page.evaluate((hide) => {
      const view = globalThis.__bc.container.view
      const THREE_ = globalThis.__bc.container.view.scene.constructor
      // 每个环境件唯一 ID 色（RGB 步进 36），游戏本体半透明灰
      const idPalette = {
        GymWalls: 0xff0000, GymAisle: 0x00ff00, Scoreboard: 0x0000ff,
        ScoreboardDigits: 0xffff00, WallDeco: 0xff00ff, ScorerTable: 0x00ffff,
        Crowd: 0x800000, CourtFloor: 0x008000, CourtLines: 0x000080,
        CourtPaint: 0x808000, CourtBalls: 0x800080, CourtProps: 0x008080,
        TeamBenches: 0xc0c0c0,
      }
      view.scene.traverse((o) => {
        if (!o.isMesh) return
        const idc = idPalette[o.name]
        if (idc !== undefined) {
          if (!o.userData.idMat)
            o.userData.idMat = new (o.material.constructor)({ color: idc })
          o.material = o.userData.idMat
        } else if (o.name) {
          if (!o.userData.dimMat) {
            o.userData.dimMat = new (o.material.constructor)()
            o.userData.dimMat.color = o.material.color.clone()
            o.userData.dimMat.opacity = 0.08
            o.userData.dimMat.transparent = true
          }
          o.material = o.userData.dimMat
        }
      })
      globalThis.__bc.container.view.renderer.render(
        globalThis.__bc.container.view.scene,
        globalThis.__bc.container.view.camera.camera ||
          globalThis.__bc.container.view.camera
      )
    }, hide)
    await new Promise((r) => setTimeout(r, 400))
    await page.screenshot({ path: `${OUT}/bisect_${tag}.png` })
    if (tag === "idmap") break
    console.log("shot:", tag)
  }
  await browser.close()
}
main().catch((e) => {
  console.error("FAIL", e.message)
  process.exit(1)
})
