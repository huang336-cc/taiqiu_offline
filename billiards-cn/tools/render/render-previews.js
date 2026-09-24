/**
 * v1.4.0 缩略图构建期预渲染（render-previews）。
 *
 * 【背景】用户反馈：「你自行在后台渲染一次缩略图，然后各自截图用于缩略图
 * 展示，不要每次打开软件渲染了，太慢了」。此前菜单的 3D 缩略图（球杆主题 /
 * 球桌外观 / 场景）是**运行时**由 SkinPreview3D 离屏 WebGL 渲染 —— 每次打开
 * 软件都要重新渲染一遍（v1.3.104 已做预热 + 空闲队列优化，但仍是运行时开销）。
 *
 * 【方案】构建期用 headless chrome 打开 dist/preview-render.html（与运行时
 * 完全同一条渲染管线：three.standalone + skin-factory + cue-texture-factory +
 * skin-preview-3d），逐个皮肤调用 SkinPreview3D.renderThumb，把 dataURL 落盘
 * 为 dist/previews/<kind>-<id>.jpg。menu-cn.js 改为「静态图优先、运行时渲染
 * 兜底」—— 正常路径 0 渲染开销，仅当静态图缺失（未来新增皮肤未预渲染）时
 * 才回退到运行时渲染。
 *
 * 皮肤清单来源：直接打开 dist/menu.html 抓卡片属性（data-cuetheme /
 * data-tableskin / data-scene，有 data-photo 的场景跳过）—— 单一事实来源，
 * 与菜单 UI 永远同步，无需在脚本里维护第二份清单。
 *
 * 用法：
 *   xvfb-run -a node tools/render/render-previews.js            # 全量渲染（缺的才渲染）
 *   xvfb-run -a node tools/render/render-previews.js --force    # 忽略已有文件强制重渲
 *
 * 【必须用 xvfb 有头模式】Chrome 132+ 移除了 headless 模式的 SwiftShader
 * WebGL 回退，无头模式下 getContext('webgl') 恒为 null；有头模式
 * （xvfb 虚拟显示）+ --use-angle=swiftshader 仍可拿到软渲染 WebGL。
 */
const path = require("path")
const fs = require("fs")
const { chromium } = require("playwright-core")

const DIST = path.resolve(__dirname, "../../dist")
const OUT_DIR = path.join(DIST, "previews")
const FORCE = process.argv.includes("--force")
const MENU_URL = `file://${DIST}/menu.html`
const RENDER_URL = `file://${DIST}/preview-render.html`

;(async () => {
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true })

  const browser = await chromium.launch({
    headless: false, // 见文件头注：headless 下无 SwiftShader WebGL
    args: [
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--enable-unsafe-swiftshader",
      "--use-gl=angle",
      "--use-angle=swiftshader",
      "--hide-scrollbars",
      "--allow-file-access-from-files",
    ],
  })

  try {
    // ---- 第 1 步：从 menu.html 收集皮肤清单（单一事实来源）----
    const menuPage = await browser.newPage()
    menuPage.on("pageerror", (e) => console.error("MENU PAGEERROR:", e.message))
    await menuPage.goto(MENU_URL, { waitUntil: "load", timeout: 60000 })
    const jobs = await menuPage.evaluate(() => {
      function collect(sel, attr, kind) {
        const out = []
        document.querySelectorAll(sel).forEach((card) => {
          const id = card.getAttribute(attr)
          if (!id) return
          if (kind === "scene" && card.getAttribute("data-photo")) return
          out.push({ kind, id })
        })
        return out
      }
      const jobs = [
        ...collect("#cueThemeCards .skin-card", "data-cuetheme", "cue"),
        ...collect("#tableSkinCards .skin-card", "data-tableskin", "table"),
        ...collect("#sceneCards .skin-card", "data-scene", "scene"),
      ]
      return jobs
    })
    await menuPage.close()
    console.log(`清单：${jobs.length} 张（cue/table/scene）`)
    const byKind = {}
    for (const j of jobs) byKind[j.kind] = (byKind[j.kind] || 0) + 1
    console.log("  ", JSON.stringify(byKind))

    // ---- 第 2 步：打开渲染页，逐个渲染 ----
    const page = await browser.newPage()
    page.on("pageerror", (e) => console.error("RENDER PAGEERROR:", e.message))
    await page.goto(RENDER_URL, { timeout: 60000 })
    const ready = await page
      .waitForFunction(
        () =>
          window.__ready === true &&
          window.SkinPreview3D &&
          window.SkinPreview3D.isAvailable(),
        { timeout: 60000 }
      )
      .then(() => true)
      .catch(() => false)
    if (!ready) {
      console.error("SkinPreview3D 不可用（WebGL 初始化失败）")
      await browser.close()
      process.exit(2)
    }

    let ok = 0
    let skip = 0
    let fail = 0
    for (const job of jobs) {
      const file = path.join(OUT_DIR, `${job.kind}-${job.id}.jpg`)
      if (!FORCE && fs.existsSync(file)) {
        skip++
        continue
      }
      const dataUrl = await page.evaluate((j) => {
        return window.__renderOne(j.kind, j.id)
      }, job)
      if (!dataUrl || dataUrl.indexOf("data:image/jpeg;base64,") !== 0) {
        console.error(`  ✗ ${job.kind}:${job.id} 渲染失败`)
        fail++
        continue
      }
      const b64 = dataUrl.slice("data:image/jpeg;base64,".length)
      fs.writeFileSync(file, Buffer.from(b64, "base64"))
      ok++
      console.log(`  ✓ ${job.kind}-${job.id}.jpg`)
    }
    console.log(`\n完成：新增 ${ok} 张，已存在跳过 ${skip} 张，失败 ${fail} 张`)
    await browser.close()
    if (fail > 0) process.exit(3)
  } catch (e) {
    console.error(e)
    await browser.close()
    process.exit(1)
  }
})()
