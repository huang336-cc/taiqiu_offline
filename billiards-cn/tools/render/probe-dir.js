/** 实测 aim 相机朝向（v1.3.88b 调试用） */
const puppeteer = require("puppeteer-core")
const DIST = "/workspace/project/source/billiards-cn/dist"

async function main() {
  const browser = await puppeteer.launch({
    executablePath: "/usr/bin/google-chrome",
    headless: "new",
    args: [
      "--no-sandbox",
      "--use-gl=angle",
      "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader",
      "--user-data-dir=/tmp/chrome-pr-dir",
      "--in-process-gpu",
      "--allow-file-access-from-files",
      "--window-size=1200,540",
    ],
  })
  const page = await browser.newPage()
  await page.setViewport({ width: 1200, height: 540 })
  await page.goto(`file://${DIST}/play.html?debug=1&bot=Professional`, {
    waitUntil: "load",
    timeout: 120000,
  })
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
  await new Promise((r) => setTimeout(r, 2000))
  await page.evaluate(() => {
    globalThis.__bc.container.view.applyScene("basketball")
    globalThis.__bc.container.view.camera.forceMode("aim")
  })
  await new Promise((r) => setTimeout(r, 2000))
  const out = await page.evaluate(() => {
    const view = globalThis.__bc.container.view
    const cam = view.camera.camera || view.camera
    cam.updateMatrixWorld(true)
    const V3 = cam.position.constructor
    const dir = cam.getWorldDirection(new V3())
    const up = new V3().setFromMatrixColumn(cam.matrixWorld, 1)
    const wrap = view.camera
    return {
      pos: cam.position.toArray().map((v) => +v.toFixed(3)),
      dir: dir.toArray().map((v) => +v.toFixed(3)),
      up: up.toArray().map((v) => +v.toFixed(3)),
      fov: cam.fov,
      aspect: +cam.aspect.toFixed(3),
      mode: wrap.mode,
      mainMode: wrap.mainMode,
      // 白球与杆方向
      cue: (() => {
        const balls = (view.table && view.table.balls) || []
        const cue = balls.find((b) => b && b.label === 0) || balls[0]
        return cue && cue.pos ? cue.pos.toArray().map((v) => +v.toFixed(3)) : null
      })(),
    }
  })
  console.log(JSON.stringify(out))
  await browser.close()
}
main().catch((e) => {
  console.error("FAIL", e.message)
  process.exit(1)
})
