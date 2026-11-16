/* v1.8.3 精确量测：金色框架(材质.002)沿长边的高度曲线、端部集球底座位置、
 * 六个网兜(材质.005)的下垂最低点。用于给回球路径定标。 */
const puppeteer = require('/workspace/dev/source/billiards-cn/node_modules/puppeteer-core')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

;(async () => {
  const b = await puppeteer.launch({
    executablePath: '/usr/bin/google-chrome',
    headless: 'new',
    args: [
      '--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader', '--user-data-dir=/tmp/chrome-v183m' + Date.now(),
      '--in-process-gpu', '--disable-gpu-sandbox', '--window-size=900,700',
    ],
    defaultViewport: { width: 900, height: 700 },
  })
  const p = await b.newPage()
  p.on('pageerror', (e) => console.log('ERR', String(e.message).slice(0, 120)))
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

  const data = await p.evaluate(() => {
    const v = globalThis.__bc.container.view
    const g = v.scene.getObjectByName('PoolTableReal')
    g.updateMatrixWorld(true)

    function worldVerts(o) {
      const pos = o.geometry.attributes.position
      const e = o.matrixWorld.elements
      const out = []
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i)
        out.push([
          e[0] * x + e[4] * y + e[8] * z + e[12],
          e[1] * x + e[5] * y + e[9] * z + e[13],
          e[2] * x + e[6] * y + e[10] * z + e[14],
        ])
      }
      return out
    }

    const meshes = {}
    g.traverse((o) => { if (o.isMesh) meshes[o.name] = o })

    const rail = worldVerts(meshes['材质.002'])
    const net = worldVerts(meshes['材质.005'])

    // 1) 长边框架：|y|>0.72 的顶点，按 x 每 0.1m 分桶
    const bins = new Map()
    for (const [x, y, z] of rail) {
      if (Math.abs(y) < 0.72) continue
      const k = (Math.round(x / 0.1) * 0.1).toFixed(1)
      const b = bins.get(k) || { zmin: 9, zmax: -9, n: 0, ymin: 9, ymax: -9 }
      b.zmin = Math.min(b.zmin, z)
      b.zmax = Math.max(b.zmax, z)
      b.ymin = Math.min(b.ymin, y)
      b.ymax = Math.max(b.ymax, y)
      b.n++
      bins.set(k, b)
    }
    const railProfile = [...bins.entries()].sort((a, c) => +a[0] - +c[0])
      .map(([x, b]) => ({ x: +x, z: +b.zmin.toFixed(3), zTop: +b.zmax.toFixed(3), y: [+b.ymin.toFixed(3), +b.ymax.toFixed(3)], n: b.n }))

    // 2) -x 端区域（x < -1.2）：找集球底座
    const end = rail.filter(([x]) => x < -1.2)
    const endBox = {
      x: [Math.min(...end.map((a) => a[0])), Math.max(...end.map((a) => a[0]))].map((n) => +n.toFixed(3)),
      y: [Math.min(...end.map((a) => a[1])), Math.max(...end.map((a) => a[1]))].map((n) => +n.toFixed(3)),
      z: [Math.min(...end.map((a) => a[2])), Math.max(...end.map((a) => a[2]))].map((n) => +n.toFixed(3)),
      n: end.length,
    }
    // 端部按 y 分桶，看是否有独立小板
    const endY = new Map()
    for (const [x, y, z] of end) {
      const k = (Math.round(y / 0.05) * 0.05).toFixed(2)
      const c = endY.get(k) || { n: 0, zmin: 9, zmax: -9, xmin: 9, xmax: -9 }
      c.n++; c.zmin = Math.min(c.zmin, z); c.zmax = Math.max(c.zmax, z)
      c.xmin = Math.min(c.xmin, x); c.xmax = Math.max(c.xmax, x)
      endY.set(k, c)
    }
    const endProfile = [...endY.entries()].sort((a, c) => +a[0] - +c[0])
      .map(([y, c]) => ({ y: +y, n: c.n, z: [+c.zmin.toFixed(3), +c.zmax.toFixed(3)], x: [+c.xmin.toFixed(3), +c.xmax.toFixed(3)] }))

    // 3) 网兜：按 x/y 聚类找 6 个袋口的下垂范围
    const netCl = []
    const used = new Set()
    for (let i = 0; i < net.length; i++) {
      if (used.has(i)) continue
      const seed = net[i]
      const cl = []
      for (let j = i; j < net.length; j++) {
        if (used.has(j)) continue
        const q = net[j]
        if (Math.hypot(q[0] - seed[0], q[1] - seed[1]) < 0.22) { used.add(j); cl.push(q) }
      }
      if (cl.length > 20) {
        netCl.push({
          n: cl.length,
          x: [Math.min(...cl.map((a) => a[0])), Math.max(...cl.map((a) => a[0]))].map((n) => +n.toFixed(3)),
          y: [Math.min(...cl.map((a) => a[1])), Math.max(...cl.map((a) => a[1]))].map((n) => +n.toFixed(3)),
          z: [Math.min(...cl.map((a) => a[2])), Math.max(...cl.map((a) => a[2]))].map((n) => +n.toFixed(3)),
        })
      }
    }

    return { railProfile, endBox, endProfile, netClusters: netCl }
  })

  console.log('=== 长边框架高度曲线 (x, zBottom, zTop, yRange) ===')
  for (const r of data.railProfile) console.log(JSON.stringify(r))
  console.log('=== -x 端区域 ===')
  console.log(JSON.stringify(data.endBox))
  console.log('=== 端部按 y 剖面 ===')
  for (const r of data.endProfile) console.log(JSON.stringify(r))
  console.log('=== 网兜聚类 ===')
  for (const c of data.netClusters) console.log(JSON.stringify(c))

  await b.close()
})().catch((e) => { console.error('FATAL', e.message.slice(0, 300)); process.exit(1) })
