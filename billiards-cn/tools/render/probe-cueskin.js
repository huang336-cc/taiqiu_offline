/**
 * 球杆皮肤生效性验证（v1.3.85）。
 *
 * 背景：`cueTheme === "auto"`（默认）时，旧版从**台呢色**派生球杆色，
 * 把 `skin` 选的皮肤整个覆盖 → 五个皮肤全部失效。
 *
 * 本探针做两件事：
 *   ① 逐皮肤读取 cueShaft / cueButt 的**实际材质颜色**，打印成表
 *   ② 断言五个皮肤的颜色**两两不同**（旧版会全部相同）
 *
 * 用法：DISPLAY=:99 node tools/render/probe-cueskin.js
 */
const path = require("path")
const puppeteer = require("puppeteer-core")

const DIST = path.resolve(__dirname, "../../dist")
const URL = `file://${DIST}/play.html?debug=1&bot=Professional`
const SHOTS = "/root/.codebuddy/artifact/render/shots"

const SKINS = ["classic", "emerald", "crimson", "sapphire", "golden"]

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
      "--user-data-dir=/tmp/chrome-probe-skin",
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
  await new Promise((r) => setTimeout(r, 9000))

  const rows = []
  for (const skin of SKINS) {
    const info = await page.evaluate((sk) => {
      const view = globalThis.__bc.container.view
      const cue = view.table.cue
      const out = { skin: sk, meshes: {} }
      // 模拟设置面板切换：改皮肤后重新套用主题
      const s = globalThis.__bc.container.settings || null
      // 直接走公开路径：设置 + 重新应用
      try {
        // Settings 通过模块单例持有，页面侧从 container 拿不到，
        // 改用 localStorage 写入后重载太慢 —— 这里走 applySkin API
        if (cue.applySkin) cue.applySkin(sk)
      } catch (e) {
        out.err = String(e)
      }
      cue.mesh.traverse((o) => {
        if (!o.isMesh) return
        if (o.name !== "cueShaft" && o.name !== "cueButt") return
        const m = Array.isArray(o.material) ? o.material[0] : o.material
        out.meshes[o.name] = {
          color: m && m.color ? m.color.getHexString() : null,
          hasMap: !!(m && m.map),
          shininess: m ? m.shininess : null,
        }
      })
      return out
    }, skin)
    rows.push(info)
  }

  console.log("=".repeat(72))
  console.log("  球杆皮肤实际颜色（cueTheme = auto 默认档）")
  console.log("=".repeat(72))
  console.log(
    "  " +
      "skin".padEnd(12) +
      "cueShaft".padEnd(12) +
      "cueButt".padEnd(12) +
      "map?"
  )
  const seenShaft = new Set()
  for (const r of rows) {
    const sh = r.meshes.cueShaft || {}
    const bu = r.meshes.cueButt || {}
    console.log(
      "  " +
        String(r.skin).padEnd(12) +
        String(sh.color).padEnd(12) +
        String(bu.color).padEnd(12) +
        (sh.hasMap ? "yes" : "no") +
        (r.err ? "  ERR:" + r.err : "")
    )
    if (sh.color) seenShaft.add(sh.color)
  }
  console.log()
  console.log(`  不同杆身色数量 = ${seenShaft.size} / ${SKINS.length}`)
  if (seenShaft.size === SKINS.length) {
    console.log("  ✅ 五个皮肤互不相同 —— skin 设置真正生效")
  } else if (seenShaft.size === 1) {
    console.log("  ❌ 全部相同 —— skin 被覆盖（旧版行为）")
  } else {
    console.log("  ⚠️  部分重复，请核查")
  }

  await browser.close()
  process.exit(seenShaft.size === SKINS.length ? 0 : 1)
})().catch((e) => {
  console.error(e)
  process.exit(1)
})
