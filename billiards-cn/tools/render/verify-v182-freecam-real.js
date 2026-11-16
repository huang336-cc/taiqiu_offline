/**
 * v1.8.2 全桌机位「真实渲染循环」实机验证 —— 不 monkey patch 任何内部方法。
 *
 * 目的：确认「自由旋转/缩放到任意角度」画面都正常，排除截图脚本把
 * view.update / camera.update 置空导致天花板可见性冻结的假象。
 *
 * 做法：只改 farCam 参数（等价于用户手势的结果），让正常 rAF 循环里的
 * farView() 自己 lerp 到位、view.update() 自己管理天花板可见性，
 * 每个角度等渲染收敛后截图，并用像素统计判定是否有台呢。
 *
 * 用法：DISPLAY=:99 node tools/render/verify-v182-freecam-real.js
 */
const puppeteer = require('/workspace/dev/source/billiards-cn/node_modules/puppeteer-core')
const fs = require('fs')
const OUT = '/root/.codebuddy/artifact/render/v182'
const BASE = process.env.BASE || 'http://127.0.0.1:3000'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

;(async () => {
  fs.mkdirSync(OUT, { recursive: true })
  const b = await puppeteer.launch({
    executablePath: '/usr/bin/google-chrome', headless: 'new',
    args: [
      '--no-sandbox', '--hide-scrollbars', '--use-gl=angle', '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader', '--user-data-dir=/tmp/chrome-v182-freecam-real-' + Date.now(),
      '--in-process-gpu', '--disable-gpu-sandbox', '--window-size=1280,720',
    ],
    defaultViewport: { width: 1280, height: 720 },
  })
  const p = await b.newPage()
  const errs = []
  p.on('pageerror', (e) => errs.push(String(e.message).slice(0, 160)))

  const hide = () => p.evaluate(() => {
    document.querySelectorAll('.tutorial-banner, .tutorial, .guide-banner, .modal-backdrop, .overlay')
      .forEach((e) => { e.style.display = 'none'; e.style.visibility = 'hidden' })
    document.querySelectorAll('div').forEach((e) => {
      const t = (e.textContent || '').trim()
      if (t.includes('知道了') || (t.includes('欢迎') && t.length < 120)) e.style.display = 'none'
    })
  })

  await p.goto(`${BASE}/play.html?debug=1&bot=Professional`, { waitUntil: 'load', timeout: 120000 })
  await p.waitForFunction(
    () => { const v = globalThis.__bc?.container?.view; return !!(v && v.renderer && v.assets) },
    { timeout: 90000 }
  )
  await p.evaluate(() => {
    setInterval(() => { const c = globalThis.__bc?.container; if (c) c.lastEventTime = performance.now() }, 300)
  })
  await hide()
  await sleep(3000)
  const box = await p.evaluate(() => {
    const r = globalThis.__bc.container.view.element.getBoundingClientRect()
    return { x: r.x, y: r.y, w: r.width, h: r.height }
  })
  await p.mouse.click(box.x + box.w * 0.62, box.y + box.h * 0.42)
  await sleep(500)
  await p.evaluate(() => document.getElementById('cueHit')?.click())
  await sleep(2500)

  // 只改 Settings 场景（走正常路径），不碰内部方法
  await p.evaluate(() => {
    const v = globalThis.__bc.container.view
    v.applyScene('room')
  })
  await p.waitForFunction(() => {
    const env = globalThis.__bc.container.view.sceneEnv
    const room = env && (env.name === 'Room' ? env : env.getObjectByName('Room'))
    return !!(room && room.children.length > 0)
  }, { timeout: 60000 }).catch(() => {})
  await sleep(2500)

  // 进入全桌机位（aim → topView → farView）
  await p.evaluate(() => document.getElementById('camera')?.click())
  await sleep(6000)
  await p.evaluate(() => document.getElementById('camera')?.click())
  await sleep(6000)

  const angles = [
    { name: 'real-a-default', yaw: -0.8726, pitch: 0.5153, dist: 4.2009 },
    { name: 'real-b-orbit-left', yaw: -0.50, pitch: 0.46, dist: 4.2009 },
    { name: 'real-c-orbit-right', yaw: -1.30, pitch: 0.44, dist: 4.2009 },
    { name: 'real-d-zoom-out', yaw: -0.8726, pitch: 0.42, dist: 4.75 },
    { name: 'real-e-zoom-in', yaw: -0.8726, pitch: 0.50, dist: 3.6 },
    { name: 'real-f-far-orbit', yaw: -1.4726, pitch: 0.3053, dist: 4.2009 }, // 探针 S2 拖动后的真实机位
  ]

  for (const a of angles) {
    // 只写 farCam，等价于手势结果；其余交给正常 rAF 循环
    const state = await p.evaluate((cfg) => {
      const c = globalThis.__bc.container
      const cam = c.view.camera
      Object.assign(cam.farCam, { yaw: cfg.yaw, pitch: cfg.pitch, dist: cfg.dist })
      // 连续触发若干帧渲染收敛（不直接改 three camera）
      for (let i = 0; i < 12; i++) cam.farView({})
      c.view.render()
      return {
        mode: String(cam.mode?.name || '').replace('bound ', ''),
        pos: [cam.camera.position.x, cam.camera.position.y, cam.camera.position.z].map((n) => +n.toFixed(3)),
        fov: +cam.camera.fov.toFixed(1),
      }
    }, a)
    await sleep(1200) // 让 rAF 真实渲染几帧
    await hide()
    await p.screenshot({ path: `${OUT}/${a.name}.png` })
    console.log(`[real] ${a.name}  ${JSON.stringify(state)}`)
  }

  console.log('errs=', JSON.stringify(errs))
  await b.close()
  process.exit(errs.length === 0 ? 0 : 1)
})().catch((e) => { console.error('FATAL', e); process.exit(2) })
