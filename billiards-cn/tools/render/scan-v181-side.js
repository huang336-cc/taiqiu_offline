/* v1.8.1 侧后方跟随机位扫描：在「母球后方」基础上加侧移，露出桌腿与房间 */
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
      '--enable-unsafe-swiftshader', '--user-data-dir=/tmp/chrome-v181-scan3',
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
    const cam = globalThis.__bc.container.view.camera
    cam.mode = () => {}
    cam.mainMode = () => {}
  })

  // side: 垂直击球方向的侧移；d: 后退距离；h: 高度；lift: 注视抬升；fov
  const cases = [
    { id: 's1', d: R * 34, h: R * 20, lift: R * 8, side: R * 12, fov: 48 },
    { id: 's2', d: R * 38, h: R * 24, lift: R * 9, side: R * 16, fov: 50 },
    { id: 's3', d: R * 42, h: R * 28, lift: R * 10, side: R * 20, fov: 52 },
    { id: 's4', d: R * 44, h: R * 30, lift: R * 10, side: R * 24, fov: 54 },
  ]

  for (const c of cases) {
    await p.evaluate((c) => {
      const cam = globalThis.__bc.container.view.camera
      const c3 = cam.camera
      const t = globalThis.__bc.container.table
      const cue = t?.cueball
      const p0 = cue ? cue.pos : { x: 0, y: -0.3 }
      const ang = t?.cue?.aim?.angle ?? 0
      // 击球方向单位向量 (sin, cos)（与 camera.ts 的 unitAtAngle 一致）
      const fx = Math.sin(ang), fy = Math.cos(ang)
      // 垂直方向
      const px = fy, py = -fx
      c3.fov = c.fov
      c3.updateProjectionMatrix()
      c3.position.set(
        p0.x - fx * c.d + px * c.side,
        p0.y - fy * c.d + py * c.side,
        c.h
      )
      c3.up.set(0, 0, 1)
      c3.lookAt(p0.x, p0.y, c.lift)
      c3.updateMatrixWorld(true)
    }, c)
    await sleep(1500)
    await p.screenshot({ path: `${OUT}/side-${c.id}.png` })
    console.log('saved', c.id, `d=${(c.d * 100).toFixed(0)}cm h=${(c.h * 100).toFixed(0)}cm side=${(c.side * 100).toFixed(0)}cm fov=${c.fov}`)
  }
  await b.close()
})().catch((e) => { console.error(e); process.exit(1) })
