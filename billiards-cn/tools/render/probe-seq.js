/**
 * 复刻 render.js 的完整时序，逐步核对 sceneEnv（v1.3.88）。
 *
 * 目的：render.js 拍出来的图是雪山，但探针证明「切完 sceneEnv=Room 且不会
 * 被人改回去」。两者矛盾，说明问题出在 render.js 的某个**中间步骤**。
 * 这里逐步骤回读 sceneEnv，定位是哪一步把它弄丢的。
 *
 * 用法：DISPLAY=:99 node tools/render/probe-seq.js --scene room
 */
const puppeteer = require("puppeteer-core")

const DIST = "/workspace/project/source/billiards-cn/dist"

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def
}
const SCENE = arg("scene", "room")

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
      `--user-data-dir=/tmp/chrome-seq-${Date.now()}`,
      "--in-process-gpu",
      "--disable-gpu-sandbox",
      "--allow-file-access-from-files",
      "--window-size=1200,540",
    ],
    env: { ...process.env },
  })

  const page = await browser.newPage()
  await page.setViewport({ width: 1200, height: 540, deviceScaleFactor: 1 })

  const snap = async (tag) => {
    const st = await page
      .evaluate(() => {
        const v = globalThis.__bc?.container?.view
        if (!v) return { none: true }
        const env = v.sceneEnv
        // 也数一下 scene 里挂了哪些 children，看雪山是不是以别的形式还在
        const names =
          v.scene && v.scene.children
            ? v.scene.children.map((c) => c.name || c.type).slice(0, 14)
            : []
        return {
          sceneEnvName: env ? env.name : null,
          envChildren: env ? env.children.length : null,
          sceneChildNames: names,
        }
      })
      .catch((e) => ({ err: e.message }))
    console.log(`[${tag}] ${JSON.stringify(st)}`)
    return st
  }

  const URL = `file://${DIST}/play.html?debug=1&bot=Professional`
  await page.goto(URL, { waitUntil: "load", timeout: 120000 })

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
  console.log("ready:", ready)
  if (!ready) {
    await browser.close()
    process.exit(2)
  }

  await snap("刚就绪")

  await new Promise((r) => setTimeout(r, 2500))
  await snap("settle 2.5s 后")

  // 步骤 1：applyScene
  const sw = await page.evaluate((sc) => {
    const v = globalThis.__bc.container.view
    v.applyScene(sc)
    const e = v.sceneEnv
    return { envName: e ? e.name : null }
  }, SCENE)
  console.log(`步骤1 applyScene("${SCENE}") 返回 sceneEnv=${sw.envName}`)

  await new Promise((r) => setTimeout(r, 900))
  await snap("等 900ms 后")

  // 步骤 2：forceMode aim
  await page.evaluate(() => {
    globalThis.__bc.container.view.camera.forceMode("aim")
  })
  await snap("步骤2 forceMode(aim) 后")

  await new Promise((r) => setTimeout(r, 700))
  await snap("等 700ms 后")

  // 步骤 3：截图
  await page.screenshot({ path: `/tmp/probe-seq-${SCENE}.png` })
  await snap("截图后")
  console.log(`截图: /tmp/probe-seq-${SCENE}.png`)

  await browser.close()
}

main().catch((e) => {
  console.error("探针失败:", e.message)
  process.exit(1)
})
