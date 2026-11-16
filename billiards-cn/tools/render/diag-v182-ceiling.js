/**
 * 诊断：全桌机位旋转到某些角度时画面整片米色。
 * 逐角度记录 three camera 位置、CeilingGroup / 房间外墙的包围盒与可见性，
 * 并试验「临时隐藏天花板/墙」后画面是否恢复（像素统计）。
 */
const puppeteer = require('/workspace/dev/source/billiards-cn/node_modules/puppeteer-core')
const OUT = '/root/.codebuddy/artifact/render/v182'
const BASE = process.env.BASE || 'http://127.0.0.1:3000'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

;(async () => {
  const b = await puppeteer.launch({
    executablePath: '/usr/bin/google-chrome', headless: 'new',
    args: ['--no-sandbox', '--hide-scrollbars', '--use-gl=angle', '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader', '--user-data-dir=/tmp/chrome-v182-diag-' + Date.now(),
      '--in-process-gpu', '--disable-gpu-sandbox', '--window-size=1280,720'],
    defaultViewport: { width: 1280, height: 720 },
  })
  const p = await b.newPage()
  await p.goto(`${BASE}/play.html?debug=1&bot=Professional`, { waitUntil: 'load', timeout: 120000 })
  await p.waitForFunction(() => { const v = globalThis.__bc?.container?.view; return !!(v && v.renderer && v.assets) }, { timeout: 90000 })
  await p.evaluate(() => setInterval(() => { const c = globalThis.__bc?.container; if (c) c.lastEventTime = performance.now() }, 300))
  await sleep(3000)
  const box = await p.evaluate(() => { const r = globalThis.__bc.container.view.element.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height } })
  await p.mouse.click(box.x + box.w * 0.62, box.y + box.h * 0.42)
  await sleep(500)
  await p.evaluate(() => document.getElementById('cueHit')?.click())
  await sleep(2500)
  await p.evaluate(() => globalThis.__bc.container.view.applyScene('room'))
  await p.waitForFunction(() => { const e = globalThis.__bc.container.view.sceneEnv; const r = e && (e.name === 'Room' ? e : e.getObjectByName('Room')); return !!(r && r.children.length > 0) }, { timeout: 60000 }).catch(() => {})
  await sleep(2500)
  await p.evaluate(() => document.getElementById('camera')?.click()); await sleep(6000)
  await p.evaluate(() => document.getElementById('camera')?.click()); await sleep(6000)

  // 列出场景里所有「大面积米色嫌疑对象」：名字 / 世界包围盒 / 可见性
  const objs = await p.evaluate(() => {
    const v = globalThis.__bc.container.view
    const THREE = v.scene.children[0]?.constructor
    const out = []
    v.scene.traverse((o) => {
      if (!o.isMesh && !o.isGroup) return
      const n = (o.name || '')
      if (!/ceil|wall|room|floor|plane|ground|背景|墙|顶|天花/i.test(n)) return
      let bb = null
      try {
        if (o.geometry) {
          o.geometry.computeBoundingBox()
          bb = o.geometry.boundingBox
        }
      } catch (e) {}
      out.push({
        name: n || '(无名)', type: o.type, visible: o.visible,
        parent: o.parent?.name || '',
        bb: bb ? { min: [bb.min.x, bb.min.y, bb.min.z].map(x => +x.toFixed(2)), max: [bb.max.x, bb.max.y, bb.max.z].map(x => +x.toFixed(2)) } : null,
      })
    })
    return { count: out.length, list: out.slice(0, 40), ceilingRef: !!v.ceiling, ceilingVisible: v.ceiling?.visible ?? null }
  })
  console.log('=== 场景嫌疑对象 ===')
  console.log(JSON.stringify(objs, null, 1).slice(0, 4000))

  const angles = [
    { name: 'ok-default', yaw: -0.8726, pitch: 0.5153, dist: 4.2009 },
    { name: 'bad-right', yaw: -1.30, pitch: 0.44, dist: 4.2009 },
    { name: 'bad-zoom', yaw: -0.8726, pitch: 0.42, dist: 4.75 },
    { name: 'bad-farorbit', yaw: -1.4726, pitch: 0.3053, dist: 4.2009 },
  ]
  for (const a of angles) {
    const info = await p.evaluate((cfg) => {
      const c = globalThis.__bc.container
      const cam = c.view.camera
      Object.assign(cam.farCam, { yaw: cfg.yaw, pitch: cfg.pitch, dist: cfg.dist })
      for (let i = 0; i < 12; i++) cam.farView({})
      c.view.render()
      // 天花板相关对象当前可见性
      const ceils = []
      c.view.scene.traverse((o) => { if (/ceil/i.test(o.name || '')) ceils.push({ name: o.name, visible: o.visible }) })
      return {
        pos: [cam.camera.position.x, cam.camera.position.y, cam.camera.position.z].map(n => +n.toFixed(3)),
        dir: (() => { const d = { x: cam.farCam.target.x - cam.camera.position.x, y: cam.farCam.target.y - cam.camera.position.y, z: cam.farCam.target.z - cam.camera.position.z }; const L = Math.hypot(d.x, d.y, d.z); return [d.x/L, d.y/L, d.z/L].map(n => +n.toFixed(3)) })(),
        ceils, ceilingRefVisible: c.view.ceiling?.visible ?? null,
        bg: c.view.scene.background?.getHexString?.() ?? null,
      }
    }, a)
    console.log(`[${a.name}] ${JSON.stringify(info)}`)
  }

  // 试验：在 bad-farorbit 机位把 CeilingGroup 及所有大墙面隐藏，看画面是否恢复
  await p.evaluate(() => {
    const c = globalThis.__bc.container
    const cam = c.view.camera
    Object.assign(cam.farCam, { yaw: -1.4726, pitch: 0.3053, dist: 4.2009 })
    for (let i = 0; i < 12; i++) cam.farView({})
    c.view.scene.traverse((o) => {
      if (/ceil|wall|天花板|墙/i.test(o.name || '')) o.visible = false
    })
    c.view.render()
  })
  await sleep(1200)
  await p.screenshot({ path: `${OUT}/diag-hide-ceiling.png` })
  console.log('[diag] 已输出 diag-hide-ceiling.png')

  await b.close()
})().catch((e) => { console.error('FATAL', e); process.exit(2) })
