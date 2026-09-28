/**
 * v1.4.5 发布冒烟（UI 修复 + 台面标志下线 + 库边 UV/贴图工厂）。
 *
 * 目的：发布产物级验证 —— 13 款球桌主题逐一加载进真实页面，确认
 *   ① 无 pageerror / console error；
 *   ② 场景就绪（renderer + scene + camera）；
 *   ③ 台面标志覆盖层 ClothMarks 【不存在】（v1.4.5 按玩家反馈下线，与 v1.4.4 相反）；
 *   ④ 库边 Cushion 有 uv attribute（P5 修复前 uvCount=0）且挂 1024×64 贴图；
 *   ⑤ 台呢/桌框材质贴图已生成。
 *
 * 用法：node tools/render/smoke-v145.js（纯 headless，无需 DISPLAY）
 */
const puppeteer = require("puppeteer-core")

const DIST = "/workspace/dev/source/billiards-cn/dist"
const EXPECT_VER = "1.4.5-26092514"
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
  const out = { marks: 0, cloth: null, wood: null, cushion: null }

  scene.traverse((o) => {
    if (o && o.name === "ClothMarks") out.marks++
    if (!o || !o.isMesh) return
    const mats = Array.isArray(o.material) ? o.material : [o.material]
    const mn = mats.map((m) => (m && m.name) || "").join(",")
    const ln = (mn + " " + (o.name || "")).toLowerCase()
    const detail = {
      name: o.name, mat: mn,
      tex: mats.filter((m) => m && m.map).map((m) => m.map.image ? `${m.map.image.width}x${m.map.image.height}` : "?").join("|"),
      uv: o.geometry && o.geometry.attributes && o.geometry.attributes.uv
        ? o.geometry.attributes.uv.count : 0,
    }
    const keep = (k, d) => {
      if (!out[k]) { out[k] = d; return }
      const score = (x) => (x && x.tex ? x.tex.length : 0) + (x && x.uv ? x.uv : 0)
      if (score(d) > score(out[k])) out[k] = d
    }
    if (ln.includes("cloth")) keep("cloth", detail)
    else if (ln.includes("wood")) keep("wood", detail)
    else if (ln.includes("cushion")) keep("cushion", detail)
  })
  return out
}

async function main() {
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
      "--user-data-dir=/tmp/chrome-smoke145", "--in-process-gpu", "--disable-gpu-sandbox",
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
    // v1.4.5 验收：ClothMarks 不存在；cushion 有 uv 且挂 1024×64 贴图；cloth/wood 有贴图
    const noMarks = info && info.marks === 0
    const okCushion = !!(info && info.cushion && info.cushion.uv > 0 && /1024x64/.test(info.cushion.tex || ""))
    const okTex = !!(info && info.cloth && info.cloth.tex) && !!(info && info.wood && info.wood.tex)
    const bad = !ready || !noMarks || !okCushion || !okTex || errs.length > before
    if (bad) fail++
    console.log(
      `${bad ? "✗" : "✓"} ${sk.padEnd(12)} ready=${ready ? 1 : 0} ` +
        `marks=${info && info.marks} cushion(uv,tex)=` +
        `${info && info.cushion ? info.cushion.uv : "-"},${info && info.cushion ? info.cushion.tex || "-" : "-"}` +
        ` tex(cloth/wood)=${info && info.cloth ? info.cloth.tex : "-"}/${info && info.wood ? info.wood.tex : "-"}` +
        ` 新增错误=${errs.length - before}`
    )
    if (errs.length > before) errs.slice(before).slice(0, 3).forEach((e) => console.log("   " + e.slice(0, 160)))
  }

  // 版本串 + 变更履历（菜单页）
  const p2 = await browser.newPage()
  await p2.goto(`file://${DIST}/menu.html`, { waitUntil: "load", timeout: 120000 })
  const ver = await p2.evaluate(() => globalThis.__BILLIARDS_VERSION__)
  // v1.5.0：履历正文已抽离为懒加载（changelog-data.js），首屏 body 里不再有履历文本。
  // 断言改为「打开设置 → 点变更履历 → 注入后应含 v1.4.5」，否则它会恒为 false 而失去意义。
  // 注意：履历 section 默认隐藏，innerText 会跳过隐藏元素 —— 必须用 textContent。
  await p2.evaluate(() => {
    const b = document.getElementById("btnSettings")
    if (b) b.click()
  })
  await new Promise((r) => setTimeout(r, 400))
  await p2.evaluate(() => {
    const b = document.getElementById("btnChangelog")
    if (b) b.click()
  })
  let hasLog = false
  for (let i = 0; i < 40 && !hasLog; i++) {
    hasLog = await p2.evaluate(() =>
      document.body.textContent.includes("v1.4.5 · 2026-09-25")
    )
    if (!hasLog) await new Promise((r) => setTimeout(r, 150))
  }
  console.log("\n版本串:", ver, "| 变更履历（懒加载后）含 v1.4.5:", hasLog)
  if (!hasLog) {
    console.log("   ✗ 变更履历懒加载失败：点击后未注入 v1.4.5 条目")
    fail++
  }

  console.log(`\n失败主题数: ${fail} / ${SKINS.length}`)
  await browser.close()
  process.exit(fail > 0 || ver !== EXPECT_VER || !hasLog ? 1 : 0)
}

main().catch((e) => {
  console.error(e)
  process.exit(2)
})
