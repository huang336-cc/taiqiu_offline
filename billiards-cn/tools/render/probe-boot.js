/**
 * 页面启动探针（v1.3.88）。
 *
 * 目的：render.js 报「容器未就绪」退出码 2 时，我们需要知道**卡在哪一步**。
 * 只打印页面 console 是不够的 —— 关键信息在 `__bc` 的内部状态里。
 *
 * 用法：DISPLAY=:99 node tools/render/probe-boot.js
 */
const path = require("path")
const puppeteer = require("puppeteer-core")

const DIST = "/workspace/project/source/billiards-cn/dist"

async function main() {
  if (!process.env.DISPLAY) {
    console.error("需要 DISPLAY")
    process.exit(1)
  }
  const browser = await puppeteer.launch({
    executablePath: "/usr/bin/google-chrome",
    headless: "new",
    args: [
      "--no-sandbox",
      "--hide-scrollbars",
      "--use-gl=angle",
      "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader",
      "--user-data-dir=/tmp/chrome-probe-profile",
      "--in-process-gpu",
      "--disable-gpu-sandbox",
      "--allow-file-access-from-files",
      "--window-size=1200,540",
    ],
    env: { ...process.env },
  })

  const page = await browser.newPage()
  await page.setViewport({ width: 1200, height: 540, deviceScaleFactor: 1 })

  const logs = []
  page.on("console", (m) => logs.push(`[${m.type()}] ${m.text()}`))
  page.on("pageerror", (e) => logs.push(`[pageerror] ${e.message}\n${e.stack}`))
  page.on("requestfailed", (r) =>
    logs.push(`[reqfail] ${r.url()} :: ${r.failure()?.errorText}`)
  )

  // 不挂 bot 参数，尽量贴近最小启动路径；debug=1 才挂 __bc
  await page.goto(`file://${DIST}/play.html?debug=1`, {
    waitUntil: "load",
    timeout: 120000,
  })

  // 分阶段采样 60 秒，每次打印 __bc 内部状态
  for (let i = 1; i <= 12; i++) {
    await new Promise((r) => setTimeout(r, 5000))
    const st = await page.evaluate(() => {
      const bc = globalThis.__bc
      if (!bc) return { hasBc: false }
      const c = bc.container
      const v = c && c.view
      const r = v && v.renderer
      let gl = null
      try {
        gl = r && r.getContext ? r.getContext() : null
      } catch (e) {
        gl = "ERR:" + e.message
      }
      const canvas = document.getElementById("viewP1")
      return {
        hasBc: true,
        hasContainer: !!c,
        hasView: !!v,
        hasScene: !!(v && v.scene),
        hasCamera: !!(v && v.camera),
        hasRenderer: !!r,
        hasGl: !!gl && gl !== null && typeof gl === "object",
        glType: gl ? String(gl).slice(0, 40) : null,
        hasTable: !!(c && c.table),
        hasAssets: !!bc.assets,
        canvasW: canvas ? canvas.width : null,
        canvasH: canvas ? canvas.height : null,
        sceneEnv: v && v.sceneEnv ? v.sceneEnv.name : null,
        childCount: v && v.scene ? v.scene.children.length : null,
      }
    })
    console.log(`[t=${i * 5}s]`, JSON.stringify(st))
    if (st.hasGl) {
      console.log("   ✅ 渲染器已就绪")
      break
    }
  }

  console.log("\n=== 页面日志（后 40 条）===")
  console.log(logs.slice(-40).join("\n"))

  await browser.close()
}

main().catch((e) => {
  console.error("探针失败:", e.message)
  process.exit(1)
})
