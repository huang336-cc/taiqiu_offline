/* v1.8.2 取证：从桌子侧下方看「收集网 / 集球器」的实际外观与位置 */
const puppeteer = require('/workspace/dev/source/billiards-cn/node_modules/puppeteer-core')
const fs = require('fs')
const OUT = '/root/.codebuddy/artifact/render/v182'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

;(async () => {
  fs.mkdirSync(OUT, { recursive: true })
  const b = await puppeteer.launch({
    executablePath: '/usr/bin/google-chrome', headless: 'new',
    args: [
      '--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader', '--user-data-dir=/tmp/chrome-v182-under' + Date.now(),
      '--in-process-gpu', '--disable-gpu-sandbox', '--window-size=1280,720',
    ],
    defaultViewport: { width: 1280, height: 720 },
  })
  const p = await b.newPage()
  p.on('pageerror', (e) => console.log('ERR', e.message.slice(0, 120)))
  await p.goto('http://127.0.0.1:8190/play.html?debug=1&bot=Professional', {
    waitUntil: 'load', timeout: 120000,
  })
  await p.waitForFunction(
    () => { const v = globalThis.__bc?.container?.view; return !!(v && v.renderer && v.assets) },
    { timeout: 90000 }
  )
  await p.evaluate(() => {
    setInterval(() => { const c = globalThis.__bc?.container; if (c) c.lastEventTime = performance.now() }, 300)
    document.querySelectorAll('[data-tut-ack="1"]').forEach((e) => e.click())
    document.querySelectorAll('.tutorial-banner').forEach((e) => (e.style.display = 'none'))
  })
  await sleep(8000)
  await p.evaluate(() => globalThis.__bc.container.view.applyScene('room'))
  await sleep(5000)
  await p.evaluate(() => {
    const cam = globalThis.__bc.container.view.camera
    cam.mode = () => {}
    cam.mainMode = () => {}
  })

  const cases = [
    { id: 'u1', pos: [0, -3.1, -0.42], look: [0, 0, -0.28], fov: 48 },
    { id: 'u2', pos: [-2.4, -2.0, -0.45], look: [-0.8, 0, -0.32], fov: 44 },
    { id: 'u3', pos: [2.6, -1.7, -0.30], look: [0, 0, -0.30], fov: 46 },
    { id: 'u4', pos: [2.35, -2.85, 1.92], look: [0, -0.05, -0.15], fov: 32.7 },
  ]
  for (const c of cases) {
    await p.evaluate((c) => {
      const cam = globalThis.__bc.container.view.camera.camera
      cam.fov = c.fov; cam.updateProjectionMatrix()
      cam.position.set(...c.pos); cam.up.set(0, 0, 1); cam.lookAt(...c.look)
      cam.updateMatrixWorld(true)
    }, c)
    await sleep(1800)
    await p.screenshot({ path: `${OUT}/under-${c.id}.png` })
    console.log('saved', c.id)
  }
  await b.close()
})().catch((e) => { console.error('FATAL', e); process.exit(1) })
