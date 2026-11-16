/* 拍 aim / far / 全桌 三种机位做对比 */
const puppeteer = require('/workspace/dev/source/billiards-cn/node_modules/puppeteer-core')
const fs = require('fs')
const OUT = '/root/.codebuddy/artifact/render/v181'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const R = 0.03275

;(async () => {
  fs.mkdirSync(OUT, { recursive: true })
  const b = await puppeteer.launch({
    executablePath: '/usr/bin/google-chrome',
    headless: 'new',
    args: [
      '--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader', '--user-data-dir=/tmp/chrome-v181-scan2',
      '--in-process-gpu', '--disable-gpu-sandbox', '--window-size=1280,720',
    ],
    defaultViewport: { width: 1280, height: 720 },
  })
  const p = await b.newPage()
  await p.goto('http://127.0.0.1:8190/play.html?debug=1&bot=Professional', {
    waitUntil: 'load', timeout: 120000,
  })
  await p.waitForFunction(
    () => { const v = globalThis.__bc?.container?.view; return !!(v && v.renderer && v.assets) },
    { timeout: 90000 }
  )
  await sleep(9000)
  await p.evaluate(() => {
    globalThis.__ka = setInterval(() => {
      const c = globalThis.__bc?.container
      if (c) c.lastEventTime = performance.now()
    }, 400)
    document.querySelectorAll('[data-tut-ack="1"]').forEach((e) => e.click())
    // 隐藏底部/顶部 UI，看清画面本身
    document.querySelectorAll('.tutorial-banner,#hud,.hud,#bottom-bar,.bottom-bar,#controls,.controls,#toolbar,.toolbar,#topbar,.topbar').forEach((e) => (e.style.display = 'none'))
  })
  await sleep(600)
  const box = await p.evaluate(() => {
    const r = globalThis.__bc.container.view.element.getBoundingClientRect()
    return { x: r.x, y: r.y, w: r.width, h: r.height }
  })
  await p.mouse.click(box.x + box.w * 0.62, box.y + box.h * 0.42)
  await sleep(500)
  await p.evaluate(() => document.getElementById('cueHit')?.click())
  await sleep(2500)
  await p.evaluate(() => globalThis.__bc.container.view.applyScene('room'))
  await sleep(5000)
  await p.evaluate(() => {
    document.querySelectorAll('.tutorial-banner').forEach((e) => (e.style.display = 'none'))
  })

  await p.screenshot({ path: `${OUT}/view-aim.png` })
  console.log('saved aim')

  await p.evaluate(() => {
    const v = globalThis.__bc.container.view
    v.camera.mode = v.camera.farView.bind(v.camera)
  })
  await sleep(2500)
  await p.screenshot({ path: `${OUT}/view-far.png` })
  console.log('saved far')

  // 自定义「全桌」：从球台斜上方向下框住整桌
  await p.evaluate(() => {
    const v = globalThis.__bc.container.view
    const cam = v.camera
    cam.mode = () => {}
    const c = cam.camera
    c.fov = 44
    c.updateProjectionMatrix()
    c.position.set(1.95, -2.35, 1.62)
    c.up.set(0, 0, 1)
    c.lookAt(0, -0.1, -0.18)
    c.updateMatrixWorld(true)
  })
  await sleep(1600)
  await p.screenshot({ path: `${OUT}/view-full.png` })
  console.log('saved full')
  await b.close()
})().catch((e) => { console.error(e); process.exit(1) })
