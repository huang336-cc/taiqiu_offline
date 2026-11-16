/* v1.8.2 量测：写实中8桌「集球器 / 收集网 / 角袋口」的世界坐标范围，
 * 用来给「落袋球沿侧边通道滚到集球盘」的动画标定路径。 */
const puppeteer = require('/workspace/dev/source/billiards-cn/node_modules/puppeteer-core')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

;(async () => {
  const b = await puppeteer.launch({
    executablePath: '/usr/bin/google-chrome',
    headless: 'new',
    args: [
      '--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader', '--user-data-dir=/tmp/chrome-tray' + Date.now(),
      '--in-process-gpu', '--disable-gpu-sandbox', '--window-size=1280,720',
    ],
    defaultViewport: { width: 1280, height: 720 },
  })
  const p = await b.newPage()
  p.on('pageerror', (e) => console.log('ERR', e.message.slice(0, 120)))
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
  const out = await p.evaluate(() => {
    const v = globalThis.__bc.container.view
    const g = v.scene.getObjectByName('PoolTableReal')
    g.updateMatrixWorld(true)
    const meshes = []
    g.traverse((o) => {
      if (!o.isMesh) return
      o.geometry.computeBoundingBox()
      const bb = o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld)
      const m = Array.isArray(o.material) ? o.material[0] : o.material
      meshes.push({
        name: o.name, mat: m?.name,
        min: [bb.min.x, bb.min.y, bb.min.z].map((n) => +n.toFixed(3)),
        max: [bb.max.x, bb.max.y, bb.max.z].map((n) => +n.toFixed(3)),
        verts: o.geometry.attributes.position?.count,
      })
    })
    // 物理袋口中心
    const pockets = []
    const P = globalThis.__bc.container.table?.constructor
    return { group: g.name, childCount: g.children.length, meshes }
  })
  console.log(JSON.stringify(out, null, 1))
  await b.close()
})().catch((e) => { console.error('FATAL', e.message.slice(0, 250)); process.exit(1) })
