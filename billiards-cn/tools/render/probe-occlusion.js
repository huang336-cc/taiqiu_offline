/**
 * 带遮挡检测的落位普查 v2（v1.3.88）。
 *
 * three 打包后无全局类，Raycaster 拿不到 —— 改纯数学：
 *   ① 从 container.table.mesh 读球桌世界包围盒（Box3.expandByObject 也拿不到
 *      —— Box3 同样是打包内部类）→ 手写：traverse 收集顶点范围（或读几何 bbox
 *      并经 matrixWorld 变换 8 角）。
 *   ② 射线-AABB 用 slab 法手写。
 * 其余判定同 v1：入画 + 不被桌挡 + 分层输出。
 */
const puppeteer = require("puppeteer-core")
const DIST = "/workspace/project/source/billiards-cn/dist"

async function main() {
  const browser = await puppeteer.launch({
    executablePath: "/usr/bin/google-chrome",
    headless: "new",
    args: [
      "--no-sandbox",
      "--use-gl=angle",
      "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader",
      `--user-data-dir=/tmp/chrome-occ2-${Date.now()}`,
      "--in-process-gpu",
      "--disable-gpu-sandbox",
      "--allow-file-access-from-files",
      "--window-size=1200,540",
    ],
    env: { ...process.env },
  })
  const page = await browser.newPage()
  await page.setViewport({ width: 1200, height: 540 })
  await page.goto(`file://${DIST}/play.html?debug=1&bot=Professional`, {
    waitUntil: "load",
    timeout: 120000,
  })
  let ready = false
  for (let i = 0; i < 8 && !ready; i++) {
    ready = await page
      .evaluate(() => {
        const v = globalThis.__bc?.container?.view
        try {
          return !!(v && v.scene && v.camera && v.renderer?.getContext?.())
        } catch {
          return false
        }
      })
      .catch(() => false)
    if (!ready) await new Promise((r) => setTimeout(r, 8000))
  }
  await new Promise((r) => setTimeout(r, 2000))
  await page.evaluate(() => {
    globalThis.__bc.container.view.applyScene("office")
    globalThis.__bc.container.view.camera.forceMode("aim")
  })
  await new Promise((r) => setTimeout(r, 2000))

  const out = await page.evaluate(() => {
    const view = globalThis.__bc.container.view
    const cam = view.camera.camera || view.camera
    cam.updateMatrixWorld(true)
    const m = cam.projectionMatrix.clone().multiply(cam.matrixWorldInverse)
    const proj = (x, y, z) => {
      const e = m.elements
      const cw = e[3] * x + e[7] * y + e[11] * z + e[15]
      if (cw <= 1e-6) return null
      const nx = (e[0] * x + e[4] * y + e[8] * z + e[12]) / cw
      const ny = (e[1] * x + e[5] * y + e[9] * z + e[13]) / cw
      if (Math.abs(nx) > 1 || Math.abs(ny) > 1) return null
      return { px: Math.round(((nx + 1) / 2) * 1200), py: Math.round(((1 - ny) / 2) * 540) }
    }
    const cp = cam.position

    // ── 球桌世界 AABB：traverse 几何 bbox，8 角过 matrixWorld ──
    const tableRoot = globalThis.__bc.container.table?.mesh
    const bb = { min: [1e9, 1e9, 1e9], max: [-1e9, -1e9, -1e9] }
    if (tableRoot) {
      tableRoot.updateWorldMatrix(true, true)
      tableRoot.traverse((o) => {
        const g = o.geometry
        if (!g) return
        if (!g.boundingBox) g.computeBoundingBox()
        const b = g.boundingBox
        const mw = o.matrixWorld
        const e = mw.elements
        for (const cx of [b.min.x, b.max.x])
          for (const cy of [b.min.y, b.max.y])
            for (const cz of [b.min.z, b.max.z]) {
              const wx = e[0] * cx + e[4] * cy + e[8] * cz + e[12]
              const wy = e[1] * cx + e[5] * cy + e[9] * cz + e[13]
              const wz = e[2] * cx + e[6] * cy + e[10] * cz + e[14]
              bb.min = [Math.min(bb.min[0], wx), Math.min(bb.min[1], wy), Math.min(bb.min[2], wz)]
              bb.max = [Math.max(bb.max[0], wx), Math.max(bb.max[1], wy), Math.max(bb.max[2], wz)]
            }
      })
    }
    // ── slab 法射线-AABB ──
    const rayAABB = (o, d, min, max) => {
      let t0 = 0
      let t1 = Infinity
      for (const ax of [0, 1, 2]) {
        const inv = 1 / (ax === 0 ? d.x : ax === 1 ? d.y : d.z)
        let tn = ((ax === 0 ? min[0] : ax === 1 ? min[1] : min[2]) - (ax === 0 ? o.x : ax === 1 ? o.y : o.z)) * inv
        let tf = ((ax === 0 ? max[0] : ax === 1 ? max[1] : max[2]) - (ax === 0 ? o.x : ax === 1 ? o.y : o.z)) * inv
        if (tn > tf) [tn, tf] = [tf, tn]
        t0 = Math.max(t0, tn)
        t1 = Math.min(t1, tf)
        if (t0 > t1) return false
      }
      return true
    }

    const hits = []
    let tableCount = 0
    if (tableRoot) tableRoot.traverse((o) => { if (o.isMesh) tableCount++ })
    for (let x = 1.2; x <= 6.001; x += 0.4) {
      for (let y = -2.6; y <= 2.601; y += 0.4) {
        for (const z of [0.15, 0.45, 0.8]) {
          const p = proj(x, y, z)
          if (!p) continue
          const d = { x: x - cp.x, y: y - cp.y, z: z - cp.z }
          const len = Math.hypot(d.x, d.y, d.z)
          // 归一化不影响 slab（t 范围同比缩放），far 用 len 比较时注意：传原始 d，t1 与 len 比
          const blocked = rayAABB(cp, d, bb.min, bb.max)
          // slab 返回「与无限长线相交」，还要确认交点在点到目标之间：
          // t0*|d| <= len-0.05 即相交段进入目标前。简化：slab 相交 + 目标点在 AABB 外即可近似
          const insideTable =
            x >= bb.min[0] && x <= bb.max[0] &&
            y >= bb.min[1] && y <= bb.max[1] &&
            z >= bb.min[2] && z <= bb.max[2]
          if ((blocked && !insideTable) || insideTable) continue
          if (p.py >= 15 && p.py <= 470) hits.push({ x, y, z, px: p.px, py: p.py })
        }
      }
    }
    const bands = [
      ["上带(15~120)", 15, 120],
      ["中上(120~240)", 120, 240],
      ["中带(240~470)", 240, 470],
    ]
    const lines = []
    for (const [tag, lo, hi] of bands) {
      const sel = hits.filter((h) => h.py >= lo && h.py < hi)
      lines.push(
        `${tag}: ${sel.length} 格\n  ` +
          sel
            .slice(0, 80)
            .map((h) => `(${h.x},${h.y},${h.z})→${h.px},${h.py}`)
            .join(" ")
      )
    }
    return {
      tableCount,
      tableBB: {
        min: bb.min.map((v) => +v.toFixed(2)),
        max: bb.max.map((v) => +v.toFixed(2)),
      },
      lines,
    }
  })
  console.log(`球桌 mesh 数: ${out.tableCount}  AABB: ${JSON.stringify(out.tableBB)}`)
  if (out.lines) out.lines.forEach((l) => console.log("\n" + l))
  await browser.close()
}
main().catch((e) => {
  console.error("FAIL", e.message)
  process.exit(1)
})
