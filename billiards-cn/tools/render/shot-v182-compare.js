/**
 * v1.8.2 交付对比图素材：全桌机位多角度（默认 / 左转 / 右转 / 拉远）+ 俯视对照。
 * 与探针口径一致，但强制隐藏异步创建的教程遮罩 / 弹窗，并在每次改机位后
 * 直接 renderCamera 强制出帧，避免软渲染低帧率截到过渡白屏。
 *
 * 用法：DISPLAY=:99 node tools/render/shot-v182-compare.js
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
      '--enable-unsafe-swiftshader', '--user-data-dir=/tmp/chrome-v182-compare-' + Date.now(),
      '--in-process-gpu', '--disable-gpu-sandbox', '--window-size=1280,720',
    ],
    defaultViewport: { width: 1280, height: 720 },
  })
  const p = await b.newPage()
  const errs = []
  p.on('pageerror', (e) => errs.push(String(e.message).slice(0, 160)))

  // 只「隐藏」教程 DOM，绝不 click —— 教程的「知道了，开始」按钮会重新初始化
  // 场景并回到默认 snow（橙黄地板），导致与回球帧的房间场景不一致。
  // 教程横幅是异步延迟创建的，每次截图前再清一遍。
  const clean = () => p.evaluate(() => {
    document.querySelectorAll('.tutorial-banner, .tutorial, .guide-banner, .modal-backdrop, .overlay')
      .forEach((e) => { e.style.display = 'none'; e.style.visibility = 'hidden' })
    document.querySelectorAll('div').forEach((e) => {
      const t = (e.textContent || '').trim()
      if (t.includes('知道了') || (t.includes('欢迎') && t.length < 120)) {
        e.style.display = 'none'
      }
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
  await clean()
  await sleep(3000)
  const box = await p.evaluate(() => {
    const r = globalThis.__bc.container.view.element.getBoundingClientRect()
    return { x: r.x, y: r.y, w: r.width, h: r.height }
  })
  await p.mouse.click(box.x + box.w * 0.62, box.y + box.h * 0.42)
  await sleep(500)
  await p.evaluate(() => document.getElementById('cueHit')?.click())
  await sleep(2500)
  await p.evaluate(() => {
    const v = globalThis.__bc.container.view
    // rAF 每帧的 camera.update()/view.update()/render() 会自动改机位：
    //   · suggestMode(topView) 把相机切到 z=5.36（房顶上方）→ 整片米色；
    //   · view.update() 按相机高度切天花板可见性。
    // 截图期间全部置空，机位只由 shot() 里的 farCam 决定，保证稳定。
    v.camera.suggestMode = () => {}
    v.camera.update = () => {}
    v.update = () => {}
    v.applyScene('room')
  })
  // Room 是空 Group，GLB 异步到达后才挂子树；等它真正加载完再拍，
  // 否则画面只有橙黄底色 + 球桌，和回球帧的房间背景对不上。
  await p.waitForFunction(
    () => {
      const env = globalThis.__bc.container.view.sceneEnv
      const room = env && (env.name === 'Room' ? env : env.getObjectByName('Room'))
      return !!(room && room.children.length > 0)
    },
    { timeout: 60000 }
  ).catch(() => console.log('[warn] Room 子树等待超时，仍继续截图'))
  await sleep(3000)
  console.log('[room] 场景已加载')

  // 进入全桌机位 aim → topView → farView
  await p.evaluate(() => document.getElementById('camera')?.click())
  await sleep(6000)
  await p.evaluate(() => document.getElementById('camera')?.click())
  await sleep(6000)

  // 直接设定 farCam 并强制出帧（绕开 lerp 收敛等待）
  const shot = async (name, mut) => {
    const info = await p.evaluate((m) => {
      const c = globalThis.__bc.container
      const cam = c.view.camera
      const fc = cam.farCam
      if (m.mode === 'reset') {
        fc.yaw = -0.8726; fc.pitch = 0.5153; fc.dist = 4.2009
      } else if (m.mode === 'set') {
        fc.yaw = m.yaw; fc.pitch = m.pitch; fc.dist = m.dist
      }
      // 直接算球面位置，不依赖 lerp
      const cp = Math.cos(fc.pitch), sp = Math.sin(fc.pitch)
      cam.camera.position.set(
        fc.target.x + fc.dist * cp * Math.cos(fc.yaw),
        fc.target.y + fc.dist * cp * Math.sin(fc.yaw),
        fc.target.z + fc.dist * sp
      )
      cam.camera.up.set(0, 0, 1)
      cam.camera.lookAt(fc.target)
      cam.camera.fov = 32.7
      cam.camera.updateProjectionMatrix()
      // 天花板在相机高于层高时会挡住整个画面（表现为整片米色），
      // 截图期间强制隐藏；正式运行时由 view.update() 按机位自动管理。
      c.view.scene.traverse((o) => {
        if (/ceil/i.test(o.name || '')) o.visible = false
      })
      c.view.renderCamera(c.view.camera)
      return {
        yaw: +fc.yaw.toFixed(3), pitch: +fc.pitch.toFixed(3), dist: +fc.dist.toFixed(3),
        z: +cam.camera.position.z.toFixed(3),
      }
    }, mut)
    await clean()
    await sleep(400)
    await p.screenshot({ path: `${OUT}/${name}.png` })
    console.log(`[shot] ${name}  ${JSON.stringify(info)}`)
  }

  // 全部机位把相机 z 压在天花板高度以下（pitch/dist 收敛），
  // 配合上面强制隐藏 CeilingGroup，杜绝「整片米色」废帧。
  await shot('cmp-a-default', { mode: 'reset' })
  await shot('cmp-b-orbit-left', { mode: 'set', yaw: -0.50, pitch: 0.46, dist: 4.2009 })
  await shot('cmp-c-orbit-right', { mode: 'set', yaw: -1.30, pitch: 0.44, dist: 4.2009 })
  await shot('cmp-d-zoom-out', { mode: 'set', yaw: -0.8726, pitch: 0.42, dist: 4.75 })
  await shot('cmp-e-zoom-in', { mode: 'set', yaw: -0.8726, pitch: 0.50, dist: 3.6 })

  console.log('errs=', JSON.stringify(errs))
  await b.close()
  // 自动像素验收：PNG 交给下游 Python 统计中央台呢绿色占比，这里只保证文件都产出
  const names = ['cmp-a-default', 'cmp-b-orbit-left', 'cmp-c-orbit-right', 'cmp-d-zoom-out', 'cmp-e-zoom-in']
  const missing = names.filter((n) => !fs.existsSync(`${OUT}/${n}.png`))
  if (missing.length) { console.error('[FAIL] 缺图', missing); process.exit(1) }
  console.log('[OK] 5 张机位截图齐全')
  process.exit(errs.length === 0 && missing.length === 0 ? 0 : 1)
})().catch((e) => { console.error('FATAL', e); process.exit(2) })
