/**
 * v1.8.0 线上发布冒烟：版本号 / 履历 / 下载页 / 写实中8桌 / 三个新场景。
 *
 * 历史教训（v1.5.7）：changelog-data.js 混进真实换行 → 点「变更履历」白屏，
 * 只有发版冒烟能抓到；本脚本把「语法体检 + 首条版本」列为必测项。
 *
 * 用法：BASE=https://xxx node tools/render/smoke-v180-release.js
 */
const puppeteer = require("puppeteer-core")

const BASE = process.env.BASE || "https://a7b9dc0cd0da80587.app.workbuddy.host"
const results = []
const ok = (name, cond, info) => {
  results.push({ name, cond, info })
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}  ${JSON.stringify(info)}`)
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

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
      "--user-data-dir=/tmp/chrome-smoke180",
      "--in-process-gpu",
      "--disable-gpu-sandbox",
      "--window-size=960,540",
    ],
    defaultViewport: { width: 960, height: 540 },
  })
  const page = await browser.newPage()
  const errs = []
  page.on("pageerror", (e) => errs.push(String(e.message).slice(0, 200)))

  // ── S1 主菜单版本号 ──
  await page.goto(`${BASE}/menu.html`, { waitUntil: "load", timeout: 90000 })
  await sleep(2500)
  const ver = await page.evaluate(() => window.__BILLIARDS_VERSION__ || null)
  ok("S1_版本号为 1.8.0", typeof ver === "string" && ver.startsWith("1.8.0"), { ver })

  // ── S1b 场景菜单新增三项 ──
  const cards = await page.evaluate(() => {
    const ids = Array.from(
      document.querySelectorAll("#sceneCards .skin-card[data-scene]")
    ).map((c) => c.getAttribute("data-scene"))
    const names = Array.from(
      document.querySelectorAll("#sceneCards .skin-name")
    ).map((c) => c.textContent.trim())
    return { ids, names }
  })
  ok(
    "S1b_场景菜单含茶室/细胞舱/胚囊",
    ["room", "snow", "tea", "cell", "seed"].every((s) => cards.ids.includes(s)),
    cards
  )

  // ── S2 下载页版本与安装包链接 ──
  await page.goto(`${BASE}/`, { waitUntil: "load", timeout: 90000 })
  const dl = await page.evaluate(() => {
    const v = document.querySelector(".ver")
    const links = Array.from(document.querySelectorAll("a.dl")).map((a) =>
      a.getAttribute("href")
    )
    return { ver: v ? v.textContent.trim() : null, links }
  })
  ok(
    "S2_下载页版本与安装包链接",
    !!dl.ver && dl.ver.includes("1.8.0") &&
      dl.links.some((l) => l && l.includes("v1.8.0.apk")) &&
      dl.links.some((l) => l && l.includes("release-v1.8.0.zip")),
    dl
  )

  // ── S3 变更履历（历史上白屏过的高危项）──
  const cl = await page.evaluate(async () => {
    try {
      const res = await fetch("/changelog-data.js")
      const text = await res.text()
      const fn = new Function(text + "; return window.__CHANGELOG_HTML")
      const html = fn()
      return {
        ok: typeof html === "string" && html.length > 1000,
        len: html ? html.length : 0,
        first: html ? (html.match(/<h3>([^<]+)<\/h3>/) || [])[1] : null,
        has158: html ? html.includes("v1.5.8") : false,
        has170: html ? html.includes("v1.7.0") : false,
      }
    } catch (e) {
      return { ok: false, error: String(e).slice(0, 200) }
    }
  })
  ok("S3_履历可解析且 v1.8.0 在首", cl.ok && (cl.first || "").includes("v1.8.0") && cl.has158 && cl.has170, cl)

  // ── S4 游戏启动 + 3D 管线 ──
  await page.goto(`${BASE}/play.html?debug=1&bot=Professional`, {
    waitUntil: "load",
    timeout: 120000,
  })
  const boot = await page
    .waitForFunction(
      () => {
        const bc = globalThis.__bc
        const v = bc && bc.container && bc.container.view
        return !!(v && v.renderer && v.scene && v.camera && v.assets)
      },
      { timeout: 90000 }
    )
    .then(() => true)
    .catch(() => false)
  // 保持 WebGL 渲染（60s 无事件会停渲染，长冒烟必须刷新 lastEventTime）
  await page.evaluate(() => {
    window.__keepSmoke = setInterval(() => {
      const c = globalThis.__bc?.container
      if (c) c.lastEventTime = performance.now()
    }, 400)
  })
  await sleep(7000)
  const pipe = await page.evaluate(() => {
    const v = globalThis.__bc.container.view
    let spot = null
    v.scene.traverse((o) => {
      if (o.isLight && o.type === "SpotLight")
        spot = { visible: o.visible, shadow: !!o.castShadow }
    })
    return {
      ctrl: globalThis.__bc.container.controller?.name,
      tone: v.renderer.toneMapping,
      spot,
      ballCount: v.table && v.table.balls ? v.table.balls.length : -1,
      hasEnv: !!v.scene.environment,
    }
  })
  ok("S4_游戏启动且 3D 管线挂载", boot && pipe.ballCount > 0, pipe)

  // ── S4b 1 号球仍是资源包深金贴图（球贴图本版未改）──
  const b1 = await page.evaluate(() => {
    const balls = globalThis.__bc.container.view.table.balls
    const one = balls.find((b) => b.label === 1)
    const bm = one && one.ballmesh
    const m = bm && bm.mesh ? (Array.isArray(bm.mesh.material) ? bm.mesh.material[0] : bm.mesh.material) : null
    let tex = null
    if (m && m.map && m.map.image) {
      const img = m.map.image
      const c = document.createElement("canvas")
      c.width = img.width
      c.height = img.height
      const ctx = c.getContext("2d")
      ctx.drawImage(img, 0, 0)
      const px = ctx.getImageData(Math.floor(img.width * 0.5), Math.floor(img.height * 0.12), 1, 1).data
      tex = "#" + [px[0], px[1], px[2]].map((v) => v.toString(16).padStart(2, "0")).join("")
    }
    return { found: !!one, hasMap: !!(m && m.map), tex }
  })
  const texOk = !!b1.tex &&
    Math.abs(parseInt(b1.tex.slice(1, 3), 16) - 0xdd) < 24 &&
    Math.abs(parseInt(b1.tex.slice(3, 5), 16) - 0xab) < 24
  ok("S4b_1号球贴图为深金", b1.found && b1.hasMap && texOk, b1)

  // ── S5 写实中8桌真的挂上了 + 换肤贴图 ──
  const table = await page.evaluate(() => {
    const v = globalThis.__bc.container.view
    const g = v.scene.getObjectByName("PoolTableReal")
    let albedo = null
    const names = []
    g?.traverse((o) => {
      if (!o.isMesh) return
      names.push(o.name)
      const m = Array.isArray(o.material) ? o.material[0] : o.material
      if (m?.name === "Cn9ft_Albedo") {
        albedo = {
          mapTag: m.map?.image?.tagName || m.map?.image?.constructor?.name,
          emissiveIntensity: m.emissiveIntensity,
          envMapIntensity: m.envMapIntensity,
        }
        o.geometry.computeBoundingBox()
        albedo.maxZ = o.geometry.boundingBox.max.z
      }
    })
    return {
      found: !!g,
      realTable: v.assets.realTable,
      poolTable: v.assets.poolTable,
      names,
      albedo,
    }
  })
  ok(
    "S5_写实中8桌已挂载且台呢对齐 z=-R",
    table.found && table.realTable === true &&
      table.names.includes("Cn9ft_Albedo") &&
      !!table.albedo && Math.abs(table.albedo.maxZ + 0.03275) < 0.012,
    table
  )

  // ── S6 三个新环境在线上真实加载 ──
  for (const s of ["tea", "cell", "seed"]) {
    await page.evaluate((id) => globalThis.__bc.container.view.applyScene(id), s)
    await sleep(6500)
    const d = await page.evaluate(() => {
      const v = globalThis.__bc.container.view
      let meshCount = 0
      let hasCeiling = false
      let hasPoolEnv = false
      v.sceneEnv?.traverse((o) => {
        if (o.isMesh) meshCount++
        if (o.name === "CeilingGroup") hasCeiling = true
        if (String(o.name || "").startsWith("PoolEnv_")) hasPoolEnv = true
      })
      return { env: v.sceneEnv?.name, meshCount, hasCeiling, hasPoolEnv }
    })
    ok(`S6_${s}_新环境线上加载`, d.meshCount > 0 && d.hasCeiling && d.hasPoolEnv, d)
  }

  ok("S7_零页面错误", errs.length === 0, { errs })

  const passed = results.filter((r) => r.cond).length
  console.log(`\n合计：${passed}/${results.length}`)
  await browser.close()
  process.exit(passed === results.length ? 0 : 1)
})().catch((e) => {
  console.error("FATAL", e)
  process.exit(2)
})
