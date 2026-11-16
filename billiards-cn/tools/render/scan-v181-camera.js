/* v1.8.1 视角参数扫描：找到「能看到桌腿 + 场景背景」的机位 */
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
      '--enable-unsafe-swiftshader', '--user-data-dir=/tmp/chrome-v181-scan',
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
  await sleep(9000)

  // 关引导、点球桌进 Aim、切室内场景
  await p.evaluate(() => document.querySelectorAll('[data-tut-ack="1"]').forEach((e) => e.click()))
  await sleep(400)
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

  // 保持渲染（只刷 lastEventTime，不再自己调 render —— SwiftShader 下会卡死截图）
  await p.evaluate(() => {
    globalThis.__keepAlive = setInterval(() => {
      const c = globalThis.__bc?.container
      if (c) c.lastEventTime = performance.now()
    }, 400)
  })

  const cases = [
    { id: 'cur', h: R * 9, d: R * 24, lift: R * 6, fov: 40 },
    { id: 'a', h: R * 14, d: R * 34, lift: R * 10, fov: 42 },
    { id: 'b', h: R * 16, d: R * 44, lift: R * 12, fov: 52 },
    { id: 'c', h: R * 14, d: R * 40, lift: R * 10, fov: 62 },
    { id: 'd', h: R * 18, d: R * 46, lift: R * 12, fov: 62 },
  ]

  // 冻结相机模式，后续手动摆位（否则每帧被 camera.update 覆盖）
  await p.evaluate(() => {
    const cam = globalThis.__bc.container.view.camera
    cam.mode = () => {}
    cam.mainMode = () => {}
  })

  for (const c of cases) {
    await p.evaluate((c) => {
      const cam = globalThis.__bc.container.view.camera
      const c3 = cam.camera
      const t = globalThis.__bc.container.table
      const cue = t?.cueball
      const p0 = cue ? cue.pos.clone() : { x: 0, y: -0.3 }
      const angle = t?.cue?.aim?.angle ?? 0
      c3.fov = c.fov
      c3.updateProjectionMatrix()
      const dx = Math.sin(angle), dy = Math.cos(angle)
      c3.position.set(p0.x - dx * c.d, p0.y - dy * c.d, c.h)
      c3.up.set(0, 0, 1)
      c3.lookAt(p0.x, p0.y, c.lift)
      c3.updateMatrixWorld(true)
    }, c)
    await sleep(1600)
    await p.screenshot({ path: `${OUT}/cam-${c.id}.png` })
    console.log('saved', c.id, JSON.stringify({ h: +(c.h * 1000).toFixed(0) + 'mm', d: +(c.d * 1000).toFixed(0) + 'mm', lift: +(c.lift * 1000).toFixed(0) + 'mm', fov: c.fov }))
  }
  console.log('ERRS=' + JSON.stringify(errs.slice(0, 4)))
  await b.close()
})().catch((e) => { console.error(e); process.exit(1) })
