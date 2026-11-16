/* v1.8.3 取证：写实桌三个合并网格分别是什么？金色通道 / 集球盘在哪、走向如何？
 * 分别单独显示 + 从桌下/正下方拍照，并输出顶点分布特征。 */
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
      '--enable-unsafe-swiftshader', '--user-data-dir=/tmp/chrome-v183rail' + Date.now(),
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
  })
  await sleep(9000)

  // 隐藏教程浮层
  await p.evaluate(() => {
    document.querySelectorAll('[data-tut-ack="1"]').forEach((e) => e.click())
    document.querySelectorAll('.tutorial-banner,.tutorial,.guide-banner,.modal-backdrop,.overlay')
      .forEach((e) => { e.style.display = 'none' })
  })

  // 顶点分布分析：按 2cm 网格统计，找轨道/盘的实际形状
  const stat = await p.evaluate(() => {
    const v = globalThis.__bc.container.view
    const g = v.scene.getObjectByName('PoolTableReal')
    g.updateMatrixWorld(true)
    const out = []
    g.traverse((o) => {
      if (!o.isMesh) return
      const pos = o.geometry.attributes.position
      const m = o.matrixWorld
      const xs = [], ys = [], zs = []
      const grid = new Map()
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i)
        // applyMatrix4 手工展开
        const e = m.elements
        const wx = e[0] * x + e[4] * y + e[8] * z + e[12]
        const wy = e[1] * x + e[5] * y + e[9] * z + e[13]
        const wz = e[2] * x + e[6] * y + e[10] * z + e[14]
        xs.push(wx); ys.push(wy); zs.push(wz)
        const k = `${Math.round(wx / 0.05)},${Math.round(wy / 0.05)}`
        const cell = grid.get(k) || { n: 0, zmin: 9, zmax: -9 }
        cell.n++
        cell.zmin = Math.min(cell.zmin, wz)
        cell.zmax = Math.max(cell.zmax, wz)
        grid.set(k, cell)
      }
      out.push({
        name: o.name,
        verts: pos.count,
        x: [Math.min(...xs), Math.max(...xs)].map((n) => +n.toFixed(3)),
        y: [Math.min(...ys), Math.max(...ys)].map((n) => +n.toFixed(3)),
        z: [Math.min(...zs), Math.max(...zs)].map((n) => +n.toFixed(3)),
        cells: grid.size,
      })
    })
    return out
  })
  console.log('=== 网格统计 ===')
  console.log(JSON.stringify(stat, null, 1))

  // 相机：桌下低角度 + 正下方
  const shots = [
    { name: 'iso-all', pos: [2.6, -2.9, -1.35], look: [0, 0, -0.55], hide: [] },
    { name: 'iso-only-005', pos: [2.6, -2.9, -1.35], look: [0, 0, -0.55], hide: ['Cn9ft_Albedo', '材质.002'] },
    { name: 'iso-only-002', pos: [2.6, -2.9, -1.35], look: [0, 0, -0.55], hide: ['Cn9ft_Albedo', '材质.005'] },
    { name: 'below-all', pos: [0.02, -0.02, -1.9], look: [0, 0, -0.35], hide: [] },
    { name: 'below-only-002', pos: [0.02, -0.02, -1.9], look: [0, 0, -0.35], hide: ['Cn9ft_Albedo', '材质.005'] },
    { name: 'below-only-005', pos: [0.02, -0.02, -1.9], look: [0, 0, -0.35], hide: ['Cn9ft_Albedo', '材质.002'] },
  ]

  for (const s of shots) {
    await p.evaluate((cfg) => {
      const c = globalThis.__bc.container
      const v = c.view
      const g = v.scene.getObjectByName('PoolTableReal')
      g.traverse((o) => {
        if (!o.isMesh) return
        o.visible = cfg.hide.indexOf(o.name) < 0
      })
      // 关掉相机自动跟随，手动摆位
      v.camera.suggestMode = () => {}
      const cam = v.camera.camera
      cam.up.set(0, 0, 1)
      cam.position.set(cfg.pos[0], cfg.pos[1], cfg.pos[2])
      cam.fov = 42
      cam.updateProjectionMatrix()
      cam.lookAt(cfg.look[0], cfg.look[1], cfg.look[2])
      v.renderCamera(v.camera)
    }, s)
    await sleep(600)
    await p.screenshot({ path: `${OUT}/${s.name}.png` })
    console.log('shot', s.name)
  }

  await b.close()
})().catch((e) => { console.error('FATAL', e.message.slice(0, 300)); process.exit(1) })
