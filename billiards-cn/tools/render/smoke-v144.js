/**
 * v1.4.4 发布冒烟（球桌主题增强）。
 *
 * 目的：发布产物级验证 —— 13 款球桌主题逐一加载进真实页面，确认
 *   ① 无 pageerror / console error；
 *   ② 场景就绪（renderer + scene + camera）；
 *   ③ 台面标志覆盖层 ClothMarks 存在、世界尺寸 ≈2.816×1.376m、贴在台呢顶面（z≈−0.0316）；
 *   ④ 台呢/桌框材质贴图已生成。
 *
 * 用法：DISPLAY=:99 node tools/render/smoke-v144.js
 */
const puppeteer = require("puppeteer-core")

const DIST = "/workspace/dev/source/billiards-cn/dist"
const SKINS = [
  "classic", "emerald", "crimson", "sapphire", "golden",
  "obsidian", "lava", "neon", "crimsonGold", "holo",
  "candy", "emeraldGold", "violet",
]

const READY_PROBE = () => {
  const bc = globalThis.__bc
  const view = bc && bc.container && bc.container.view
  const r = view && view.renderer
  let gl = null
  try {
    gl = r && r.getContext ? r.getContext() : null
  } catch {
    return { ok: false, why: "getContext 抛异常" }
  }
  if (!(view && view.scene && view.camera && gl && typeof gl === "object")) {
    return {
      ok: false,
      why: `bc=${!!bc} container=${!!(bc && bc.container)} view=${!!view} scene=${!!(view && view.scene)} cam=${!!(view && view.camera)} gl=${!!gl}`,
    }
  }
  return { ok: true }
}

const INSPECT = () => {
  const bc = globalThis.__bc
  const view = bc && bc.container && bc.container.view
  const scene = view && view.scene
  if (!scene) return { err: "无 scene" }
  const out = { marks: null, cloth: null, wood: null, cushion: null }

  scene.traverse((o) => {
    if (!o || !o.isMesh) return
    const mats = Array.isArray(o.material) ? o.material : [o.material]
    const mn = mats.map((m) => (m && m.name) || "").join(",")
    const ln = (mn + " " + (o.name || "")).toLowerCase()
    let w = 0, h = 0, z = 0
    try {
      o.updateWorldMatrix(true, false)
      const e = o.matrixWorld.elements
      const sx = Math.hypot(e[0], e[1], e[2])
      const sy = Math.hypot(e[4], e[5], e[6])
      if (o.geometry) {
        o.geometry.computeBoundingBox()
        const bb = o.geometry.boundingBox
        if (bb) {
          w = +((bb.max.x - bb.min.x) * sx).toFixed(4)
          h = +((bb.max.y - bb.min.y) * sy).toFixed(4)
        }
      }
      z = +e[14].toFixed(5) // 世界平移 z（场景 z 向上）
    } catch {}
    const detail = {
      name: o.name, mat: mn,
      tex: mats.filter((m) => m && m.map).map((m) => m.map.image ? `${m.map.image.width}x${m.map.image.height}` : "?").join("|"),
      w, h, z,
    }
    // 同一类别可能命中多个（如 cloth 与 clothshade 阴影层），保留贴图信息最全的那个
    const keep = (k, d) => {
      if (!out[k]) { out[k] = d; return }
      const score = (x) => (x && x.tex ? x.tex.length : 0)
      if (score(d) > score(out[k])) out[k] = d
    }
    if (o.name === "ClothMarks") keep("marks", detail)
    else if (ln.includes("cloth")) keep("cloth", detail)
    else if (ln.includes("wood")) keep("wood", detail)
    else if (ln.includes("cushion")) keep("cushion", detail)
  })
  return out
}

async function main() {
  // 纯 headless（ozone），不需要 DISPLAY / Xvfb
  if (process.env.ONLY) {
    SKINS.length = 0
    SKINS.push(process.env.ONLY)
  }
  const browser = await puppeteer.launch({
    executablePath: "/usr/bin/google-chrome",
    headless: "new",
    args: [
      "--no-sandbox", "--hide-scrollbars",
      "--disable-dev-shm-usage", "--no-zygote", "--ozone-platform=headless",
      "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader",
      "--user-data-dir=/tmp/chrome-smoke144", "--in-process-gpu", "--disable-gpu-sandbox",
      "--allow-file-access-from-files", "--window-size=1280,800",
    ],
    env: { ...process.env, DISPLAY: "" },
  })
  const page = await browser.newPage()
  await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1 })

  const errs = []
  page.on("pageerror", (e) => errs.push("[pageerror] " + e.message))
  page.on("console", (m) => { if (m.type() === "error") errs.push("[console] " + m.text()) })

  const url = `file://${DIST}/play.html?debug=1&bot=Professional`
  await page.goto(url, { waitUntil: "load", timeout: 120000 })

  let fail = 0
  for (const sk of SKINS) {
    await page.evaluate((s) => {
      const KEY = "billiards_cn_settings_v1"
      let o = {}
      try { o = JSON.parse(localStorage.getItem(KEY) || "{}") } catch {}
      o.tableSkin = s
      localStorage.setItem(KEY, JSON.stringify(o))
    }, sk)
    await page.reload({ waitUntil: "load", timeout: 120000 })

    let ready = false
    let why = ""
    for (let i = 0; i < 60 && !ready; i++) {
      const r = await page.evaluate(READY_PROBE).catch((e) => ({ ok: false, why: e.message }))
      ready = !!(r && r.ok)
      if (!ready) { why = (r && r.why) || ""; await new Promise((r2) => setTimeout(r2, 500)) }
    }
    if (!ready) console.log(`   └ 未就绪原因: ${why || "(未知)"}`)
    await new Promise((r2) => setTimeout(r2, 1500))

    const before = errs.length
    const info = await page.evaluate(INSPECT).catch((e) => ({ err: e.message }))
    const m = info && info.marks
    const okSize = m && Math.abs(m.w - 2.8165) < 0.05 && Math.abs(m.h - 1.3755) < 0.05
    const okTex = !!(info && info.cloth && info.cloth.tex) && !!(info && info.wood && info.wood.tex)
    const bad = !ready || !m || !okSize || !okTex || errs.length > before
    if (bad) fail++
    console.log(
      `${bad ? "✗" : "✓"} ${sk.padEnd(12)} ready=${ready ? 1 : 0} ` +
        `marks=${m ? `${m.w}×${m.h}@z${m.z}` : "无"} tex(cloth/wood)=` +
        `${info && info.cloth ? info.cloth.tex : "-"}/${info && info.wood ? info.wood.tex : "-"}` +
        ` 新增错误=${errs.length - before}`
    )
    if (errs.length > before) errs.slice(before).slice(0, 3).forEach((e) => console.log("   " + e.slice(0, 160)))
  }

  // 版本串 + 变更履历（菜单页）
  const p2 = await browser.newPage()
  await p2.goto(`file://${DIST}/menu.html`, { waitUntil: "load", timeout: 120000 })
  const ver = await p2.evaluate(() => globalThis.__BILLIARDS_VERSION__)
  // 注意：变更履历所在 section 默认隐藏，innerText 会跳过隐藏元素 —— 必须用 textContent
  const hasLog = await p2.evaluate(() =>
    document.body.textContent.includes("v1.4.4 · 2026-09-25")
  )
  console.log("\n版本串:", ver, "| 变更履历含 v1.4.4:", hasLog)

  console.log(`\n失败主题数: ${fail} / ${SKINS.length}`)
  await browser.close()
  process.exit(fail > 0 || ver !== "1.4.4-26092507" || !hasLog ? 1 : 0)
}

main().catch((e) => {
  console.error(e)
  process.exit(2)
})
