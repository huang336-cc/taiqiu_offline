/* v1.8.1 视角三态实测：相机按钮循环 aim → far → topview → aim，逐态截图 */
const puppeteer = require('/workspace/dev/source/billiards-cn/node_modules/puppeteer-core')
const fs = require('fs')
const OUT = '/root/.codebuddy/artifact/render/v181'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

;(async () => {
  fs.mkdirSync(OUT, { recursive: true })
  const b = await puppeteer.launch({
    executablePath: '/usr/bin/google-chrome',
    headless: 'new',
    args: [
      '--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader', '--user-data-dir=/tmp/chrome-v181-cyc',
      '--in-process-gpu', '--disable-gpu-sandbox', '--window-size=1280,720',
    ],
    defaultViewport: { width: 1280, height: 720 },
  })
  const p = await b.newPage()
  const errs = []
  p.on('pageerror', (e) => errs.push(e.message))
  await p.goto('http://127.0.0.1:8190/play.html?debug=1&bot=Professional', {
    waitUntil: 'load', timeout: 120000,
  })
  await p.waitForFunction(
    () => { const v = globalThis.__bc?.container?.view; return !!(v && v.renderer && v.assets) },
    { timeout: 90000 }
  )
  await sleep(8000)
  await p.evaluate(() => {
    globalThis.__ka = setInterval(() => {
      const c = globalThis.__bc?.container
      if (c) c.lastEventTime = performance.now()
    }, 300)
    document.querySelectorAll('[data-tut-ack="1"]').forEach((e) => e.click())
    document.querySelectorAll('.tutorial-banner').forEach((e) => (e.style.display = 'none'))
  })
  await sleep(500)
  const box = await p.evaluate(() => {
    const r = globalThis.__bc.container.view.element.getBoundingClientRect()
    return { x: r.x, y: r.y, w: r.width, h: r.height }
  })
  await p.mouse.click(box.x + box.w * 0.62, box.y + box.h * 0.42)
  await sleep(500)
  await p.evaluate(() => document.getElementById('cueHit')?.click())
  await sleep(2200)
  await p.evaluate(() => globalThis.__bc.container.view.applyScene('room'))
  await sleep(4500)
  await p.evaluate(() => {
    document.querySelectorAll('.tutorial-banner').forEach((e) => (e.style.display = 'none'))
  })

  const state = async (tag) => {
    const d = await p.evaluate(() => {
      const v = globalThis.__bc.container.view
      const c = v.camera.camera
      return {
        mode: String(v.camera.mode?.name || '').replace('bound ', ''),
        pos: [c.position.x, c.position.y, c.position.z].map((n) => +n.toFixed(2)),
        fov: +c.fov.toFixed(1),
        camClass: document.getElementById('camera')?.className || '',
      }
    })
    console.log(tag, JSON.stringify(d))
    return d
  }

  await state('S0_初始')
  await p.screenshot({ path: `${OUT}/cyc-1-aim.png` })

  for (let i = 2; i <= 4; i++) {
    await p.evaluate(() => document.getElementById('camera')?.click())
    // 等 lerp 收敛（软件渲染帧率低，多等）
    await sleep(i === 2 ? 9000 : 6000)
    const d = await state(`S${i - 1}_点击${i - 1}次`)
    await p.screenshot({ path: `${OUT}/cyc-${i}-${d.mode}.png` })
  }
  console.log('ERRS=' + JSON.stringify(errs.slice(0, 3)))
  await b.close()
})().catch((e) => { console.error(e); process.exit(1) })
