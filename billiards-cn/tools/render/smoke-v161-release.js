/**
 * v1.6.1 发布冒烟（线上产物）：版本号 / 履历 / 游戏启动 / 3D 管线四项。
 *
 * 历史教训（v1.5.7）：changelog-data.js 里混进真实换行 → 点「变更履历」
 * 白屏。该文件只在点击时才动态加载，回放/跳球探针都不碰它 —— 只有发版
 * 冒烟能抓到。本脚本因此把「加载履历并检查语法 + 版本条目」列为必测项。
 *
 * 用法：BASE=https://xxx node tools/render/smoke-v161-release.js
 */
const path = require("path")
const puppeteer = require("puppeteer-core")

const BASE = process.env.BASE || "https://a7b9dc0cd0da80587.app.workbuddy.host"
const results = []
const ok = (name, cond, info) => {
  results.push({ name, cond, info })
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}  ${JSON.stringify(info)}`)
}

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
      "--user-data-dir=/tmp/chrome-smoke161",
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
  await new Promise((r) => setTimeout(r, 2500))
  const ver = await page.evaluate(() => window.__BILLIARDS_VERSION__ || null)
  ok("S1_版本号为 1.6.1", typeof ver === "string" && ver.startsWith("1.6.1"), { ver })

  // ── S2 下载页版本单元格 ──
  await page.goto(`${BASE}/`, { waitUntil: "load", timeout: 90000 })
  const dl = await page.evaluate(() => {
    const v = document.querySelector(".ver")
    const links = Array.from(document.querySelectorAll("a.dl")).map((a) => a.getAttribute("href"))
    return { ver: v ? v.textContent.trim() : null, links }
  })
  ok(
    "S2_下载页版本与安装包链接",
    !!dl.ver && dl.ver.includes("1.6.1") && dl.links.some((l) => l && l.includes("v1.6.1")),
    dl
  )

  // ── S3 变更履历（历史上白屏过的高危项）──
  const cl = await page.evaluate(async () => {
    try {
      const res = await fetch("/changelog-data.js")
      const text = await res.text()
      // 只做语法体检：能构造函数并返回字符串即无「真实换行进字符串」问题
      const fn = new Function(text + "; return window.__CHANGELOG_HTML")
      const html = fn()
      return {
        ok: typeof html === "string" && html.length > 1000,
        len: html ? html.length : 0,
        first: html ? (html.match(/<h3>([^<]+)<\/h3>/) || [])[1] : null,
        has158: html ? html.includes("v1.5.8") : false,
        count: html ? (html.match(/<h3>/g) || []).length : 0,
      }
    } catch (e) {
      return { ok: false, error: String(e).slice(0, 200) }
    }
  })
  ok(
    "S3_履历可解析且 v1.6.1 在首",
    cl.ok && (cl.first || "").includes("v1.6.1") && cl.has158,
    cl
  )

  // ── S4 游戏启动 + 3D 管线实测 ──
  await page.goto(`${BASE}/play.html?debug=1&bot=Professional`, { waitUntil: "load", timeout: 120000 })
  const boot = await page
    .waitForFunction(
      () => {
        const bc = globalThis.__bc
        const view = bc && bc.container && bc.container.view
        return !!(view && view.renderer && view.scene && view.camera)
      },
      { timeout: 90000 }
    )
    .then(() => true)
    .catch(() => false)
  await new Promise((r) => setTimeout(r, 6000))
  const pipe = await page.evaluate(() => {
    const view = globalThis.__bc.container.view
    const ctrl = globalThis.__bc.container.controller
    let spot = null
    view.scene.traverse((o) => {
      if (o.isLight && o.type === "SpotLight") spot = { visible: o.visible, shadow: !!o.castShadow }
    })
    const seam = document.querySelector(".cb-area-desc")
    return {
      ctrl: ctrl && ctrl.name ? ctrl.name : typeof ctrl,
      seekEl: !!document.getElementById("replaySeek"),
      cueBallPlacer: !!document.querySelector(".snap-ai, .snap-player") || true,
      envIndoorHook: typeof view.scene.environmentIntensity,
      tone: view.renderer.toneMapping,
      spot,
      ballCount: view.table && view.table.balls ? view.table.balls.length : -1,
      seam: !!seam,
    }
  })
  ok("S4_游戏启动且 3D 管线挂载", boot && pipe.ballCount > 0, pipe)

  // ── S4b 线上 1 号球材质色（v1.6.1 的诉求本体）──
  const b1 = await page.evaluate(() => {
    const balls = globalThis.__bc.container.view.table.balls
    const one = balls.find((b) => b.label === 1)
    const bm = one && one.ballmesh
    const m = bm && bm.mesh ? (Array.isArray(bm.mesh.material) ? bm.mesh.material[0] : bm.mesh.material) : null
    return { found: !!one, hex: m && m.color ? m.color.getHexString() : null }
  })
  ok("S4b_1号球为加深色 #d9a800", b1.found && b1.hex === "d9a800", b1)

  ok("S5_零页面错误", errs.length === 0, { errs })

  const passed = results.filter((r) => r.cond).length
  console.log(`\n合计：${passed}/${results.length}`)
  await browser.close()
  process.exit(passed === results.length ? 0 : 1)
})().catch((e) => {
  console.error("FATAL", e)
  process.exit(2)
})
