/* v1.8.1 精确射线量测：库边内表面位置（球心边界的真实视觉对应物） */
const puppeteer = require('/workspace/dev/source/billiards-cn/node_modules/puppeteer-core')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

;(async () => {
  const b = await puppeteer.launch({
    executablePath: '/usr/bin/google-chrome',
    headless: 'new',
    args: [
      '--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader', '--user-data-dir=/tmp/chrome-v181-ray',
      '--in-process-gpu', '--disable-gpu-sandbox', '--window-size=960,540',
    ],
    defaultViewport: { width: 960, height: 540 },
  })
  const p = await b.newPage()
  p.on('pageerror', (e) => console.log('PAGEERR', e.message))
  await p.goto('http://127.0.0.1:8190/play.html?debug=1&bot=Professional', {
    waitUntil: 'load', timeout: 120000,
  })
  await p.waitForFunction(
    () => { const v = globalThis.__bc?.container?.view; return !!(v && v.renderer && v.assets) },
    { timeout: 90000 }
  )
  await sleep(9000)

  const out = await p.evaluate(() => {
    const v = globalThis.__bc.container.view
    const table = v.scene.getObjectByName('PoolTableReal')
    table.updateMatrixWorld(true)

    // 收集世界坐标三角形
    const tris = []
    table.traverse((o) => {
      if (!o.isMesh) return
      const g = o.geometry
      const pos = g.attributes.position
      if (!pos) return
      const idx = g.index
      const total = idx ? idx.count : pos.count
      const m = o.matrixWorld
      const get = (i, arr) => {
        const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i)
        arr[0] = m.elements[0] * x + m.elements[4] * y + m.elements[8] * z + m.elements[12]
        arr[1] = m.elements[1] * x + m.elements[5] * y + m.elements[9] * z + m.elements[13]
        arr[2] = m.elements[2] * x + m.elements[6] * y + m.elements[10] * z + m.elements[14]
        return arr
      }
      for (let i = 0; i + 2 < total; i += 3) {
        const i0 = idx ? idx.getX(i) : i
        const i1 = idx ? idx.getX(i + 1) : i + 1
        const i2 = idx ? idx.getX(i + 2) : i + 2
        tris.push([get(i0, [0, 0, 0]).slice(), get(i1, [0, 0, 0]).slice(), get(i2, [0, 0, 0]).slice()])
      }
    })

    // Möller–Trumbore
    const hit = (o, d, maxT = 5) => {
      let best = Infinity
      for (const [a, bq, c] of tris) {
        const e1 = [bq[0] - a[0], bq[1] - a[1], bq[2] - a[2]]
        const e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]]
        const pv = [d[1] * e2[2] - d[2] * e2[1], d[2] * e2[0] - d[0] * e2[2], d[0] * e2[1] - d[1] * e2[0]]
        const det = e1[0] * pv[0] + e1[1] * pv[1] + e1[2] * pv[2]
        if (Math.abs(det) < 1e-12) continue
        const inv = 1 / det
        const tv = [o[0] - a[0], o[1] - a[1], o[2] - a[2]]
        const u = (tv[0] * pv[0] + tv[1] * pv[1] + tv[2] * pv[2]) * inv
        if (u < 0 || u > 1) continue
        const qv = [tv[1] * e1[2] - tv[2] * e1[1], tv[2] * e1[0] - tv[0] * e1[2], tv[0] * e1[1] - tv[1] * e1[0]]
        const vv = (d[0] * qv[0] + d[1] * qv[1] + d[2] * qv[2]) * inv
        if (vv < 0 || u + vv > 1) continue
        const t = (e2[0] * qv[0] + e2[1] * qv[1] + e2[2] * qv[2]) * inv
        if (t > 1e-6 && t < best) best = t
      }
      return best < maxT ? best : null
    }

    const R = 0.03275
    // 沿 +x 在若干高度上找第一面墙（避开中袋，取 y=0.30）
    const wallsX = []
    for (const z of [-R + 0.002, -R + 0.010, -0.015, 0.0, 0.006]) {
      const t = hit([1.10, 0.30, z], [1, 0, 0])
      wallsX.push({ z: +z.toFixed(4), x: t === null ? null : +(1.10 + t).toFixed(4) })
    }
    // 沿 +y（x=0.55，避袋口与角袋）
    const wallsY = []
    for (const z of [-R + 0.002, -R + 0.010, -0.015, 0.0, 0.006]) {
      const t = hit([0.55, 0.40, z], [0, 1, 0])
      wallsY.push({ z: +z.toFixed(4), y: t === null ? null : +(0.40 + t).toFixed(4) })
    }
    // 向下打射线求台呢面（y=0.30，x=0）
    const down = hit([0, 0.30, 0.5], [0, 0, -1])
    return {
      wallsX, wallsY,
      clothDownZ: down === null ? null : +(0.5 - down).toFixed(5),
      expect: { wallX: R * 43 + R, wallY: R * 21 + R, clothZ: -R },
      tableX: R * 43, tableY: R * 21,
    }
  })
  console.log(JSON.stringify(out, null, 1))
  await b.close()
})().catch((e) => { console.error(e); process.exit(1) })
