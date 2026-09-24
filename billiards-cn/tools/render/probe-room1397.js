/**
 * v1.3.97 黑块/色偏排查探针：同一机位拍 4 张变体，二分定位来源。
 *   a_base  基线
 *   b_dir   关方向光（阴影+墙面明暗是否消失）
 *   c_hemi  关半球光
 *   d_fog   关雾
 */
const path = require("path")
const fs = require("fs")
const puppeteer = require("puppeteer-core")

const DIST = "/workspace/dev/source/billiards-cn/dist"
const OUT = "/root/.codebuddy/artifact/room-v1397-probe"

async function main() {
  fs.mkdirSync(OUT, { recursive: true })
  const browser = await puppeteer.launch({
    executablePath: "/usr/bin/google-chrome",
    headless: "new",
    args: [
      "--no-sandbox", "--hide-scrollbars", "--disable-dev-shm-usage", "--no-zygote",
      "--ozone-platform=headless", "--use-gl=angle", "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader", "--user-data-dir=/tmp/chrome-probe-profile",
      "--in-process-gpu", "--disable-gpu-sandbox", "--allow-file-access-from-files",
      "--window-size=1280,720",
    ],
    env: { ...process.env, DISPLAY: "" },
  })
  const page = await browser.newPage()
  await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 1 })
  const logs = []
  page.on("pageerror", (e) => logs.push(`[pageerror] ${e.message}`))
  await page.goto(`file://${DIST}/play.html?debug=1&bot=Professional`, {
    waitUntil: "load",
    timeout: 120000,
  })
  for (let i = 0; i < 6; i++) {
    const ok = await page
      .evaluate(() => {
        const bc = globalThis.__bc
        const v = bc && bc.container && bc.container.view
        return !!(v && v.scene && v.camera && v.renderer)
      })
      .catch(() => false)
    if (ok) break
    await new Promise((r) => setTimeout(r, 10000))
  }
  await new Promise((r) => setTimeout(r, 3000))
  const sw = await page.evaluate(() => {
    const v = globalThis.__bc.container.view
    v.applyScene("room")
    return v.sceneEnv ? v.sceneEnv.name : null
  })
  console.log("scene:", sw)
  await new Promise((r) => setTimeout(r, 900))

  // 劫持相机到参考图机位
  await page.evaluate(() => {
    const v = globalThis.__bc.container.view
    const camWrap = v.camera
    const c = camWrap.camera || camWrap
    camWrap.update = function () {
      c.position.set(0, 3.3, 1.75)
      c.lookAt(0, -0.4, 0.1)
      c.fov = 55
      c.updateProjectionMatrix()
    }
    camWrap.update(0, null)
  })
  await new Promise((r) => setTimeout(r, 700))
  // 关弹窗
  for (let round = 0; round < 3; round++) {
    await page.evaluate(() => {
      const re = /知道了|第\s*\d+\s*步|欢迎/
      for (const el of [...document.querySelectorAll("body *")]) {
        if (el.children.length === 0 && re.test(el.textContent || "")) {
          let n = el
          while (n && n !== document.body && n.getBoundingClientRect().width < 260) n = n.parentElement
          if (n && n !== document.body) n.style.display = "none"
        }
      }
    })
    await new Promise((r) => setTimeout(r, 250))
  }

  const variants = [
    ["a_base", () => {}],
    [
      "b_dir",
      () => {
        const v = globalThis.__bc.container.view
        v.indoorDir.visible = false
      },
    ],
    [
      "c_hemi",
      () => {
        const v = globalThis.__bc.container.view
        v.indoorHemi.visible = false
      },
    ],
    [
      "d_fog",
      () => {
        const v = globalThis.__bc.container.view
        v.scene.fog = null
      },
    ],
  ]
  for (const [name, fn] of variants) {
    await page.evaluate(fn)
    await new Promise((r) => setTimeout(r, 500))
    await page.screenshot({ path: path.join(OUT, `probe_${name}.png`) })
    console.log("shot:", name)
  }
  if (logs.length) console.log(logs.slice(-10).join("\n"))
  await browser.close()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
