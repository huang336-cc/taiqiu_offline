/* v1.8.1 A/B 取证：v1.8.0(8161) vs v1.8.1(8190) 同机位同场景对比 */
const puppeteer = require('/workspace/dev/source/billiards-cn/node_modules/puppeteer-core')
const fs = require('fs')
const OUT = '/root/.codebuddy/artifact/render/ab181'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const build = async (base, tag) => {
  const b = await puppeteer.launch({
    executablePath: '/usr/bin/google-chrome',
    headless: 'new',
    args: [
      '--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader', `--user-data-dir=/tmp/chrome-ab181-${tag}`,
      '--in-process-gpu', '--disable-gpu-sandbox', '--window-size=1280,720',
    ],
    defaultViewport: { width: 1280, height: 720 },
  })
  const p = await b.newPage()
  p.on('pageerror', (e) => console.log(tag, 'ERR', e.message.slice(0, 120)))
  await p.goto(`${base}/play.html?debug=1&bot=Professional`, { waitUntil: 'load', timeout: 120000 })
  await p.waitForFunction(
    () => { const v = globalThis.__bc?.container?.view; return !!(v && v.renderer && v.assets) },
    { timeout: 90000 }
  )
  await p.evaluate(() => {
    setInterval(() => { const c = globalThis.__bc?.container; if (c) c.lastEventTime = performance.now() }, 400)
    document.querySelectorAll('[data-tut-ack="1"]').forEach((e) => e.click())
  })
  await sleep(1500)
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
  await p.evaluate(() => globalThis.__bc.container.view.applyScene('room'))
  await sleep(6000)

  const ver = await p.evaluate(() => window.__BILLIARDS_VERSION__)
  console.log(tag, 'ver', ver)

  // 1) 瞄准机位（玩家日常看到的画面）
  await p.screenshot({ path: `${OUT}/aim-${tag}.png` })

  // 2) 全桌机位（v1.8.0 没有，点两下相机按钮即可到达，两版同样点法便于对比）
  await p.evaluate(() => document.getElementById('camera')?.click())
  await sleep(7000)
  await p.screenshot({ path: `${OUT}/cam2-${tag}.png` })
  const m2 = await p.evaluate(() => String(globalThis.__bc.container.view.camera.mode?.name || ''))
  await p.evaluate(() => document.getElementById('camera')?.click())
  await sleep(6500)
  await p.screenshot({ path: `${OUT}/cam3-${tag}.png` })
  const m3 = await p.evaluate(() => String(globalThis.__bc.container.view.camera.mode?.name || ''))
  console.log(tag, 'modes', m2, m3)

  // 3) 贴库球近景：母球放到球心可达边界上，俯视 + 斜看
  await p.evaluate(() => {
    const cam = globalThis.__bc.container.view.camera
    cam.mode = () => {}
    cam.mainMode = () => {}
    const c = cam.camera
    c.fov = 20; c.updateProjectionMatrix()
    c.position.set(0, 0, 5.36); c.up.set(0, 0, 1); c.lookAt(0, 0, 0)
    c.updateMatrixWorld(true)
  })
  const spots = [['x', 1.40825, 0], ['corner', 1.40825, 0.68775]]
  for (const [id, x, y] of spots) {
    await p.evaluate(({ x, y }) => {
      const t = globalThis.__bc.container.table
      t.balls.forEach((b) => {
        b.pos.set(0, 9, 0); b.vel.set(0, 0, 0)
        if (b.ballmesh?.group) b.ballmesh.group.visible = false
      })
      const cue = t.cueball
      cue.pos.set(x, y, 0); cue.vel.set(0, 0, 0)
      if (cue.ballmesh?.group) cue.ballmesh.group.visible = true
      t.updateBallMesh(0)
    }, { x, y })
    await sleep(1200)
    await p.evaluate(({ x, y }) => {
      const c = globalThis.__bc.container.view.camera.camera
      c.fov = 30; c.updateProjectionMatrix()
      const ox = x * 0.86, oy = y === 0 ? -0.30 : y * 0.86
      c.position.set(ox, oy, 0.26); c.up.set(0, 0, 1); c.lookAt(x, y, 0)
      c.updateMatrixWorld(true)
    }, { x, y })
    await sleep(1200)
    await p.screenshot({ path: `${OUT}/edge-${id}-${tag}.png` })
  }
  await b.close()
}

;(async () => {
  fs.mkdirSync(OUT, { recursive: true })
  await build('http://127.0.0.1:8161', 'v180')
  await build('http://127.0.0.1:8190', 'v181')
})().catch((e) => { console.error('FATAL', e); process.exit(1) })
