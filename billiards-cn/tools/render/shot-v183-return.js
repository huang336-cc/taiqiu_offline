/* v1.8.3 取证：从桌下/端部看回球过程（框架滚动 + 集球槽终态） */
const puppeteer = require('/workspace/dev/source/billiards-cn/node_modules/puppeteer-core')
const fs = require('fs')
const OUT = '/root/.codebuddy/artifact/render/v183'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

;(async () => {
  fs.mkdirSync(OUT, { recursive: true })
  const b = await puppeteer.launch({
    executablePath: '/usr/bin/google-chrome',
    headless: 'new',
    args: [
      '--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader', '--user-data-dir=/tmp/chrome-v183rs' + Date.now(),
      '--in-process-gpu', '--disable-gpu-sandbox', '--window-size=1280,900',
    ],
    defaultViewport: { width: 1280, height: 900 },
  })
  const p = await b.newPage()
  p.on('pageerror', (e) => console.log('ERR', String(e.message).slice(0, 140)))
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
    document.querySelectorAll('.tutorial-banner,.tutorial,.guide-banner,.modal-backdrop,.overlay')
      .forEach((e) => { e.style.display = 'none' })
    // 「犯规放置白球」提示是动态面板，按文本特征隐藏（限长避免误伤 body）
    const hideTips = () => {
      document.querySelectorAll('div').forEach((e) => {
        const t = (e.textContent || '').trim()
        if (t.length > 16 && t.length < 90 && t.includes('欢迎')) e.style.display = 'none'
      })
    }
    globalThis.__hideTips = hideTips
    hideTips()
    setInterval(hideTips, 300)
  })
  await sleep(6000)

  const box = await p.evaluate(() => {
    const r = globalThis.__bc.container.view.element.getBoundingClientRect()
    return { x: r.x, y: r.y, w: r.width, h: r.height }
  })
  await p.mouse.click(box.x + box.w * 0.62, box.y + box.h * 0.42)
  await sleep(400)
  await p.evaluate(() => document.getElementById('cueHit')?.click())
  await sleep(2000)
  await p.evaluate(() => globalThis.__bc.container.view.applyScene('room'))
  await sleep(3500)

  await p.evaluate(() => {
    const c = globalThis.__bc.container
    const t = c.table
    const spots = [
      [-1.461, 0.740], [0, 0.766], [1.461, 0.740],
      [-1.461, -0.740], [0, -0.766], [1.461, -0.740],
    ]
    t.balls.filter((x) => !x.isCue).slice(0, 6).forEach((ball, i) => {
      ball.pos.set(spots[i][0], spots[i][1], -0.16)
      ball.vel.set(0, 0, 0); ball.rvel.set(0, 0, 0)
      ball.pocket = undefined
      ball.state = 'InPocket'
    })
    c.ballReturn.update(0.001, t.balls, false)
    t.balls.filter((x) => !x.isCue).slice(0, 6).forEach((x) => { x.state = 'InPocket'; x.pocket = undefined })
    c.ballReturn.update(0.001, t.balls, false)
    globalThis.__savedFrame = c.frame
    c.frame = () => {}
    // 停掉 rAF 的常规渲染，避免覆盖我们的取证机位
    globalThis.__savedRender = c.view.render
    c.view.render = () => {}
  })

  const shots = [
    // 中段：沿框架滚动（近侧斜视）
    { tag: 'rail', steps: 30, pos: [1.9, -1.9, -0.62], look: [0.2, 0, -0.38] },
    { tag: 'rail-end', steps: 12, pos: [-2.1, -1.1, -0.66], look: [-1.1, 0, -0.40] },
    // 终态：集球槽
    { tag: 'tray', steps: 90, pos: [-2.3, -0.9, -0.70], look: [-1.40, 0, -0.42] },
    { tag: 'tray-low', steps: 0, pos: [-2.35, -1.15, -0.80], look: [-1.42, 0, -0.42], up: [0, 0, 1] },
  ]

  for (const s of shots) {
    await p.evaluate((cfg) => {
      const c = globalThis.__bc.container
      const v = c.view
      if (cfg.steps) {
        for (let i = 0; i < cfg.steps; i++) c.ballReturn.update(0.05, c.table.balls, false)
      }
      const cam = v.camera.camera
      cam.up.set(...(cfg.up || [0, 0, 1]))
      cam.position.set(...cfg.pos)
      cam.fov = 46
      cam.updateProjectionMatrix()
      cam.lookAt(...cfg.look)
      cam.updateMatrixWorld(true)
      v.renderer.render(v.scene, cam)
    }, s)
    await sleep(500)
    await p.evaluate(() => globalThis.__hideTips && globalThis.__hideTips())
    await sleep(120)
    await p.screenshot({ path: `${OUT}/v183-${s.tag}.png` })
    console.log('shot', s.tag)
  }

  await p.evaluate(() => {
    const c = globalThis.__bc.container
    c.view.render = globalThis.__savedRender
    c.frame = globalThis.__savedFrame
  })
  await b.close()
})().catch((e) => { console.error('FATAL', e.message.slice(0, 300)); process.exit(1) })
