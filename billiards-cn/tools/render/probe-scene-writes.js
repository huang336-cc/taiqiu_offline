/**
 * 「场景被谁改回去了」探针（v1.3.88）。
 *
 * ## 为什么需要这个探针
 *
 * render.js 已经能正确切场景（`sceneEnv.name` 读回来是对的），但**拍出来的
 * 图仍是雪山**。说明：`applyScene(目标)` 之后、截图之前，有别的代码路径
 * 又调了一次 `applyScene("snow")`（`Settings.get().scene` 的默认值）。
 *
 * 这里给 `view.applyScene` 打桩，记录**每一次**调用的入参 + 调用栈，
 * 时序一目了然。这比猜快得多。
 *
 * 用法：DISPLAY=:99 node tools/render/probe-scene-writes.js --scene room
 */
const path = require("path")
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
      `--user-data-dir=/tmp/chrome-sw-${Date.now()}`,
      "--in-process-gpu",
      "--disable-gpu-sandbox",
      "--allow-file-access-from-files",
      "--window-size=1200,540",
    ],
    env: { ...process.env },
  })

  const page = await browser.newPage()
  await page.setViewport({ width: 1200, height: 540, deviceScaleFactor: 1 })

  /**
   * ⚠️ 关键：必须在**页面脚本执行之前**注入打桩。
   * `evaluateOnNewDocument` 保证在 index.js 跑之前就把 setter 装上。
   * 但此时 view 还不存在 —— 所以这里改为：在 window 上先装一个「待绑定」
   * 的记录器，页面就绪后再把 view.applyScene 包住。
   */
  await page.evaluateOnNewDocument(() => {
    globalThis.__sceneLog = []
    globalThis.__wrapApplyScene = () => {
      const view = globalThis.__bc?.container?.view
      if (!view || view.__wrapped) return false
      const orig = view.applyScene.bind(view)
      view.applyScene = function (id) {
        globalThis.__sceneLog.push({
          id,
          t: Math.round(performance.now()),
          stack: (new Error().stack || "").split("\n").slice(1, 7).join("\n"),
        })
        return orig(id)
      }
      view.__wrapped = true
      return true
    }
  })

  await page.goto(`file://${DIST}/play.html?debug=1`, {
    waitUntil: "load",
    timeout: 120000,
  })

  // 等就绪
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
  if (!ready) {
    console.error("容器未就绪")
    await browser.close()
    process.exit(2)
  }
  await new Promise((r) => setTimeout(r, 2000))

  const wrapped = await page.evaluate(() => globalThis.__wrapApplyScene())
  console.log(`打桩 ${wrapped ? "成功" : "失败"}`)

  // 记录当前 Settings
  const before = await page.evaluate(() => {
    const v = globalThis.__bc.container.view
    return {
      sceneEnvNow: v.sceneEnv ? v.sceneEnv.name : null,
      logLen: globalThis.__sceneLog.length,
    }
  })
  console.log("打桩前:", JSON.stringify(before))

  // 手动切到目标场景
  await page.evaluate((sc) => {
    globalThis.__bc.container.view.applyScene(sc)
    globalThis.__sceneLog.push({ id: `>>>MANUAL:${sc}`, t: Math.round(performance.now()), stack: "(手动)" })
  }, SCENE)

  const afterSwitch = await page.evaluate(() => {
    const v = globalThis.__bc.container.view
    return { sceneEnvNow: v.sceneEnv ? v.sceneEnv.name : null }
  })
  console.log(`手动切到 ${SCENE} → sceneEnv=${afterSwitch.sceneEnvNow}`)

  // 观察 8 秒，看有没有人偷偷改回去
  for (let i = 1; i <= 4; i++) {
    await new Promise((r) => setTimeout(r, 2000))
    const st = await page.evaluate(() => {
      const v = globalThis.__bc.container.view
      return {
        sceneEnvNow: v.sceneEnv ? v.sceneEnv.name : null,
        logLen: globalThis.__sceneLog.length,
      }
    })
    console.log(`  [t+${i * 2}s] sceneEnv=${st.sceneEnvNow}  调用总数=${st.logLen}`)
  }

  const log = await page.evaluate(() => globalThis.__sceneLog)
  console.log("\n=== applyScene 调用时序 ===")
  log.forEach((e, i) => {
    console.log(`${i + 1}. [t=${e.t}ms] applyScene("${e.id}")`)
  })

  const last = log[log.length - 1]
  if (last && last.stack && last.stack !== "(手动)") {
    console.log("\n最后一次调用的调用栈：")
    console.log(last.stack)
  }

  await browser.close()
}

main().catch((e) => {
  console.error("探针失败:", e.message)
  process.exit(1)
})
