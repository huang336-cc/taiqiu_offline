/* v1.8.3 取证 v2：直接 renderer.render 摆机位，看清模型自带金色轨道/集球盘的真实形状与走向 */
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
      '--enable-unsafe-swiftshader', '--user-data-dir=/tmp/chrome-v183rail2' + Date.now(),
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
    setInterval(() => { const c = globalThis.__bc?.container; if (c) c.lastEventTime = performance.now() }, 400)
    document.querySelectorAll('[data-tut-ack="1"]').forEach((e) => e.click())
    document.querySelectorAll('.tutorial-banner,.tutorial,.guide-banner,.modal-backdrop,.overlay')
      .forEach((e) => { e.style.display = 'none' })
  })
  await sleep(9000)

  const shots = [
    // 正下方投影：看清轨道在 xy 平面的走向（up 用 +x 防退化）
    { name: 'plan-only-005', hide: ['Cn9ft_Albedo', '材质.002'], pos: [0, 0, -1.4], look: [0, 0, -0.2], up: [0, 1, 0] },
    { name: 'plan-only-002', hide: ['Cn9ft_Albedo', '材质.005'], pos: [0, 0, -1.4], look: [0, 0, -0.2], up: [0, 1, 0] },
    { name: 'plan-both', hide: ['Cn9ft_Albedo'], pos: [0, 0, -1.4], look: [0, 0, -0.2], up: [0, 1, 0] },
    // 斜下 30°：看清高度层次（网兜下垂 → 导轨 → 盘）
    { name: 'iso-both', hide: ['Cn9ft_Albedo'], pos: [2.2, -2.4, -1.15], look: [0, 0, -0.45], up: [0, 0, 1] },
    { name: 'iso-005', hide: ['Cn9ft_Albedo', '材质.002'], pos: [2.2, -2.4, -1.15], look: [0, 0, -0.45], up: [0, 0, 1] },
    { name: 'iso-002', hide: ['Cn9ft_Albedo', '材质.005'], pos: [2.2, -2.4, -1.15], look: [0, 0, -0.45], up: [0, 0, 1] },
    // 端部特写：集球盘在哪一端
    { name: 'end-negx', hide: ['Cn9ft_Albedo'], pos: [-2.0, -0.6, -0.95], look: [-1.2, 0, -0.4], up: [0, 0, 1] },
    { name: 'end-posx', hide: ['Cn9ft_Albedo'], pos: [2.0, -0.6, -0.95], look: [1.2, 0, -0.4], up: [0, 0, 1] },
  ]

  for (const s of shots) {
    await p.evaluate((cfg) => {
      const v = globalThis.__bc.container.view
      const g = v.scene.getObjectByName('PoolTableReal')
      g.traverse((o) => {
        if (!o.isMesh) return
        o.visible = cfg.hide.indexOf(o.name) < 0
        if (o.visible) {
          const m = Array.isArray(o.material) ? o.material[0] : o.material
          if (m) { m.emissive = m.emissive || null }
        }
      })
      // 暗背景，突出金属结构
      v.scene.background = null
      v.renderer.setClearColor(0x101418, 1)
      const cam = v.camera.camera
      cam.up.set(cfg.up[0], cfg.up[1], cfg.up[2])
      cam.position.set(cfg.pos[0], cfg.pos[1], cfg.pos[2])
      cam.fov = 45
      cam.updateProjectionMatrix()
      cam.lookAt(cfg.look[0], cfg.look[1], cfg.look[2])
      cam.updateMatrixWorld(true)
      v.renderer.render(v.scene, cam)
      v.viewRendered = true
    }, s)
    await sleep(700)
    await p.screenshot({ path: `${OUT}/${s.name}.png` })
    console.log('shot', s.name)
  }

  await b.close()
})().catch((e) => { console.error('FATAL', e.message.slice(0, 300)); process.exit(1) })
