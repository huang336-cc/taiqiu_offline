/**
 * 绿色实心锥来源定位（v1.3.85）。
 *
 * 已排除：瞄准辅助管 helpermaterial（新着色器 alpha 仅 0.055*edge*fade）。
 * 现在用「逐个隐藏 + 采样中轴像素」的方式，把画面里那根绿色锥体的
 * 归属对象钉死。
 *
 * 用法：DISPLAY=:99 node tools/render/probe-green.js
 */
const path = require("path")
const puppeteer = require("puppeteer-core")

const DIST = path.resolve(__dirname, "../../dist")
const URL = `file://${DIST}/play.html?debug=1&bot=Professional`
const SHOTS = "/root/.codebuddy/artifact/render/shots"

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
      "--user-data-dir=/tmp/chrome-probe-green",
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

  // 先列出「从球沿 -Y 方向」的所有候选 mesh，按到球的距离排序
  const cands = await page.evaluate(() => {
    const view = globalThis.__bc.container.view
    const out = []
    view.scene.updateMatrixWorld(true)
    const p = view.scene.children.find((o) => o.position).position.clone()
    view.scene.traverse((o) => {
      if (!o.isMesh && !o.isGroup) return
      o.getWorldPosition(p)
      const d = Math.hypot(p.x + 0.72, p.y, p.z)
      if (d > 2.5) return
      const m = Array.isArray(o.material) ? o.material[0] : o.material
      out.push({
        name: o.name || "(unnamed)",
        type: o.type,
        matType: m ? m.type : null,
        matColor: m && m.color ? m.color.getHexString() : null,
        visible: o.visible,
        worldPos: [
          +p.x.toFixed(3),
          +p.y.toFixed(3),
          +p.z.toFixed(3),
        ],
        distToCue: +d.toFixed(3),
      })
    })
    return out.sort((a, b) => a.distToCue - b.distToCue).slice(0, 25)
  })
  console.log("CANDIDATES:", JSON.stringify(cands, null, 1))

  // 逐个隐藏，采样中轴像素
  const sample = async () => {
    const buf = await page.screenshot({ encoding: "base64" })
    return buf
  }
  const fs = require("fs")
  const pixelAt = async (x, y) => {
    const buf = await page.screenshot({
      clip: { x, y, width: 1, height: 1 },
      encoding: "base64",
    })
    return buf
  }

  // 基准
  const base = await page.screenshot({ path: `${SHOTS}/green_base.png` })
  void base
  const targets = ["helper", "cueBody", "cueShaft"]
  for (const t of targets) {
    await page.evaluate((nm) => {
      const view = globalThis.__bc.container.view
      view.scene.traverse((o) => {
        if (nm === "helper") {
          const cue = view.table.cue
          if (cue && cue.helperMesh) cue.helperMesh.visible = false
        }
        if (o.name === nm) o.visible = false
      })
    }, t)
    await new Promise((r) => setTimeout(r, 500))
    await page.screenshot({ path: `${SHOTS}/green_hide_${t}.png` })
    // 恢复
    await page.evaluate((nm) => {
      const view = globalThis.__bc.container.view
      view.scene.traverse((o) => {
        if (nm === "helper") {
          const cue = view.table.cue
          if (cue && cue.helperMesh) cue.helperMesh.visible = true
        }
        if (o.name === nm) o.visible = true
      })
    }, t)
    await new Promise((r) => setTimeout(r, 300))
  }
  void sample
  void pixelAt
  console.error("DONE")
  await browser.close()
})().catch((e) => {
  console.error(e)
  process.exit(1)
})
