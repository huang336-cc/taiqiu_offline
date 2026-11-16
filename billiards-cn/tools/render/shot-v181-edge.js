/* v1.8.1 边界实拍：把球放到物理边界极值处，看是否还越出台面 */
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
      '--enable-unsafe-swiftshader', '--user-data-dir=/tmp/chrome-v181-edge',
      '--in-process-gpu', '--disable-gpu-sandbox', '--window-size=1280,720',
    ],
    defaultViewport: { width: 1280, height: 720 },
  })
  const p = await b.newPage()
  p.on('pageerror', (e) => console.log('PAGEERR', e.message))
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
  await p.evaluate(() => {
    document.querySelectorAll('.tutorial-banner').forEach((e) => (e.style.display = 'none'))
  })

  // 俯视机位（正交感），方便判断球与台呢边界
  await p.evaluate(() => {
    const cam = globalThis.__bc.container.view.camera
    cam.mode = () => {}
    cam.mainMode = () => {}
    const c = cam.camera
    c.fov = 20
    c.updateProjectionMatrix()
    c.position.set(0, 0, 5.36)
    c.up.set(0, 0, 1)
    c.lookAt(0, 0, 0)
    c.updateMatrixWorld(true)
  })

  const spots = [
    ['x+', 1.40825, 0],
    ['y+', 0, 0.68775],
    ['corner', 1.40825, 0.68775],
  ]
  for (const [id, x, y] of spots) {
    await p.evaluate(({ x, y }) => {
      const t = globalThis.__bc.container.table
      // 其他球移到台外并隐藏，只留母球
      t.balls.forEach((b) => {
        b.pos.set(0, 9, 0); b.vel.set(0, 0, 0)
        if (b.ballmesh?.group) b.ballmesh.group.visible = false
      })
      const cue = t.cueball
      cue.pos.set(x, y, 0)
      cue.vel.set(0, 0, 0)
      if (cue.ballmesh?.group) cue.ballmesh.group.visible = true
      t.updateBallMesh(0)
    }, { x, y })
    await sleep(1000)
    // 侧上方近景：能同时看到球、台呢、库边与桌沿，判断球是否越界
    await p.evaluate(({ x, y }) => {
      const cam = globalThis.__bc.container.view.camera
      const c = cam.camera
      c.fov = 34
      c.updateProjectionMatrix()
      // 从球的内侧斜上方看
      const ox = x * 0.72, oy = y === 0 ? -0.42 : y * 0.72
      c.position.set(ox, oy, 0.30)
      c.up.set(0, 0, 1)
      c.lookAt(x, y, 0)
      c.updateMatrixWorld(true)
    }, { x, y })
    await sleep(1000)
    await p.screenshot({ path: `${OUT}/edge-${id}.png` })
    console.log('saved edge', id)
  }
  await b.close()
})().catch((e) => { console.error(e); process.exit(1) })
