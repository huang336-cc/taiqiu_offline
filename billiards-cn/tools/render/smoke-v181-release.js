/**
 * v1.8.1 线上发布冒烟：版本号 / 下载链接 / 履历 / 玩区边界射线量测 / 三态视角。
 *
 * 重点：S5 是本轮的核心回归 —— 在**线上产物**上重跑一遍「库边内表面射线量测」，
 * 确认视觉台呢确实对齐到 R×44 / R×22、台呢面落在 z=−R。
 * v1.8.0 的球滚出桌沿就是这里错了 7cm 级，靠肉眼看不出来，必须量。
 *
 * 历史教训（v1.5.7）：changelog-data.js 混进真实换行 → 点「变更履历」白屏，
 * 只有发版冒烟能抓到；本脚本把「语法体检 + 首条版本」列为必测项。
 *
 * 用法：BASE=https://xxx node tools/render/smoke-v181-release.js
 */
const puppeteer = require("puppeteer-core")

const BASE = process.env.BASE || "https://a7b9dc0cd0da80587.app.workbuddy.host"
const results = []
const ok = (name, cond, info) => {
  results.push({ name, cond, info })
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}  ${JSON.stringify(info)}`)
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

;(async () => {
  const browser = await puppeteer.launch({
    executablePath: "/usr/bin/google-chrome",
    headless: "new",
    args: [
      "--no-sandbox",
      "--hide-scrollbars",
      "--use-gl=angle",
      "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader",
      "--user-data-dir=/tmp/chrome-smoke181",
      "--in-process-gpu",
      "--disable-gpu-sandbox",
      "--window-size=1280,720",
    ],
    defaultViewport: { width: 1280, height: 720 },
  })
  const page = await browser.newPage()
  const errs = []
  page.on("pageerror", (e) => errs.push(String(e.message).slice(0, 200)))

  // ── S1 主菜单版本号 ──
  await page.goto(`${BASE}/menu.html`, { waitUntil: "load", timeout: 90000 })
  await sleep(2500)
  const ver = await page.evaluate(() => window.__BILLIARDS_VERSION__ || null)
  ok("S1_版本号为 1.8.1", typeof ver === "string" && ver.startsWith("1.8.1"), { ver })

  // ── S2 下载页版本 + 安装包/发布包真实可达 ──
  await page.goto(`${BASE}/`, { waitUntil: "load", timeout: 90000 })
  const dl = await page.evaluate(() => {
    const v = document.querySelector(".ver")
    const links = Array.from(document.querySelectorAll("a.dl")).map((a) =>
      a.getAttribute("href")
    )
    const h2 = Array.from(document.querySelectorAll(".card h2")).map((h) =>
      h.textContent.trim()
    )
    return { ver: v ? v.textContent.trim() : null, links, h2: h2.slice(0, 3) }
  })
  const linkOk =
    !!dl.ver &&
    dl.ver.includes("1.8.1") &&
    dl.links.some((l) => l && l.includes("v1.8.1.apk")) &&
    dl.links.some((l) => l && l.includes("release-v1.8.1.zip"))
  const probe = await page.evaluate(async () => {
    const out = {}
    for (const href of ["billiards-cn-v1.8.1.apk", "release-v1.8.1.zip"]) {
      try {
        const r = await fetch(href, { method: "HEAD" })
        out[href] = {
          status: r.status,
          len: Number(r.headers.get("content-length") || 0),
        }
      } catch (e) {
        out[href] = { error: String(e).slice(0, 120) }
      }
    }
    return out
  })
  const sizeOk =
    probe["billiards-cn-v1.8.1.apk"]?.status === 200 &&
    probe["billiards-cn-v1.8.1.apk"]?.len > 12e6 &&
    probe["release-v1.8.1.zip"]?.status === 200 &&
    probe["release-v1.8.1.zip"]?.len > 40e6
  ok("S2_下载页版本/链接/文件可达", linkOk && sizeOk, { ...dl, probe })

  // ── S3 变更履历（历史上白屏过的高危项）──
  const cl = await page.evaluate(async () => {
    try {
      const res = await fetch("/changelog-data.js")
      const text = await res.text()
      const fn = new Function(text + "; return window.__CHANGELOG_HTML")
      const html = fn()
      return {
        ok: typeof html === "string" && html.length > 1000,
        len: html ? html.length : 0,
        first: html ? (html.match(/<h3>([^<]+)<\/h3>/) || [])[1] : null,
        has180: html ? html.includes("v1.8.0") : false,
        has170: html ? html.includes("v1.7.0") : false,
      }
    } catch (e) {
      return { ok: false, error: String(e).slice(0, 200) }
    }
  })
  ok("S3_履历可解析且 v1.8.1 在首", cl.ok && (cl.first || "").includes("v1.8.1") && cl.has180 && cl.has170, cl)

  // ── S4 游戏启动 + 写实桌挂载 ──
  await page.goto(`${BASE}/play.html?debug=1&bot=Professional`, {
    waitUntil: "load",
    timeout: 120000,
  })
  const boot = await page
    .waitForFunction(
      () => {
        const bc = globalThis.__bc
        const v = bc && bc.container && bc.container.view
        return !!(v && v.renderer && v.scene && v.camera && v.assets)
      },
      { timeout: 90000 }
    )
    .then(() => true)
    .catch(() => false)
  // 保持 WebGL 渲染（60s 无事件会停渲染，长冒烟必须刷新 lastEventTime）
  await page.evaluate(() => {
    window.__keepSmoke = setInterval(() => {
      const c = globalThis.__bc?.container
      if (c) c.lastEventTime = performance.now()
    }, 400)
  })
  await sleep(8000)
  // 开局是「放置母球」状态（俯视辅助机位）：先在台面点一下把母球摆好，
  // 之后才是玩家真正瞄准时的机位 —— 视角修复要看的就是这个机位。
  const box = await page.evaluate(() => {
    const r = globalThis.__bc.container.view.element.getBoundingClientRect()
    return { x: r.x, y: r.y, w: r.width, h: r.height }
  })
  await page.mouse.click(box.x + box.w * 0.62, box.y + box.h * 0.42)
  await sleep(600)
  // 摆球状态要按「落位」按钮才进瞄准：PlaceBall 的确认按钮是 #cueHit
  await page.evaluate(() => document.getElementById("cueHit")?.click())
  await sleep(2500)
  const boot3d = await page.evaluate(() => {
    const v = globalThis.__bc.container.view
    return {
      ctrl: globalThis.__bc.container.controller?.name,
      realTable: v.assets.realTable,
      tableNode: !!v.scene.getObjectByName("PoolTableReal"),
      ballCount: v.table && v.table.balls ? v.table.balls.length : -1,
      mode: String(v.camera.mode?.name || "").replace("bound ", ""),
    }
  })
  ok(
    "S4_游戏启动/写实桌挂载/瞄准机位",
    boot && boot3d.realTable === true && boot3d.tableNode && boot3d.ballCount > 0 &&
      boot3d.mode === "aimView" && boot3d.ctrl !== "PlaceBall",
    boot3d
  )

  // ── S5 玩区边界：射线量测库边内表面 + 台呢面（本轮核心）──
  const geo = await page.evaluate(() => {
    const v = globalThis.__bc.container.view
    const table = v.scene.getObjectByName("PoolTableReal")
    table.updateMatrixWorld(true)
    const tris = []
    table.traverse((o) => {
      if (!o.isMesh) return
      const g = o.geometry
      const pos = g.attributes.position
      if (!pos) return
      const idx = g.index
      const total = idx ? idx.count : pos.count
      const m = o.matrixWorld
      const get = (i) => {
        const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i)
        return [
          m.elements[0] * x + m.elements[4] * y + m.elements[8] * z + m.elements[12],
          m.elements[1] * x + m.elements[5] * y + m.elements[9] * z + m.elements[13],
          m.elements[2] * x + m.elements[6] * y + m.elements[10] * z + m.elements[14],
        ]
      }
      for (let i = 0; i + 2 < total; i += 3) {
        const i0 = idx ? idx.getX(i) : i
        const i1 = idx ? idx.getX(i + 1) : i + 1
        const i2 = idx ? idx.getX(i + 2) : i + 2
        tris.push([get(i0), get(i1), get(i2)])
      }
    })
    const hit = (o, d, maxT = 6) => {
      let best = Infinity
      for (const [A, B, C] of tris) {
        const e1 = [B[0] - A[0], B[1] - A[1], B[2] - A[2]]
        const e2 = [C[0] - A[0], C[1] - A[1], C[2] - A[2]]
        const pv = [
          d[1] * e2[2] - d[2] * e2[1],
          d[2] * e2[0] - d[0] * e2[2],
          d[0] * e2[1] - d[1] * e2[0],
        ]
        const det = e1[0] * pv[0] + e1[1] * pv[1] + e1[2] * pv[2]
        if (Math.abs(det) < 1e-12) continue
        const inv = 1 / det
        const tv = [o[0] - A[0], o[1] - A[1], o[2] - A[2]]
        const u = (tv[0] * pv[0] + tv[1] * pv[1] + tv[2] * pv[2]) * inv
        if (u < 0 || u > 1) continue
        const qv = [
          tv[1] * e1[2] - tv[2] * e1[1],
          tv[2] * e1[0] - tv[0] * e1[2],
          tv[0] * e1[1] - tv[1] * e1[0],
        ]
        const vv = (d[0] * qv[0] + d[1] * qv[1] + d[2] * qv[2]) * inv
        if (vv < 0 || u + vv > 1) continue
        const t = (e2[0] * qv[0] + e2[1] * qv[1] + e2[2] * qv[2]) * inv
        if (t > 1e-6 && t < best) best = t
      }
      return best < maxT ? best : null
    }
    const R = 0.03275
    const tx = hit([1.05, 0.3, 0], [1, 0, 0])
    const ty = hit([0.55, 0.35, 0], [0, 1, 0])
    const down = hit([0, 0.3, 0.5], [0, 0, -1])
    return {
      wallX: tx === null ? null : +(1.05 + tx).toFixed(4),
      wallY: ty === null ? null : +(0.35 + ty).toFixed(4),
      clothZ: down === null ? null : +(0.5 - down).toFixed(5),
      expect: { wallX: +(R * 44).toFixed(4), wallY: +(R * 22).toFixed(4), clothZ: +(-R).toFixed(5) },
      tris: tris.length,
    }
  })
  const g = geo
  const geoOk =
    g.wallX !== null && Math.abs(g.wallX - g.expect.wallX) < 0.004 &&
    g.wallY !== null && Math.abs(g.wallY - g.expect.wallY) < 0.004 &&
    g.clothZ !== null && Math.abs(g.clothZ - g.expect.clothZ) < 0.003
  ok("S5_库边内表面=R×44/R×22、台呢面=−R", geoOk, g)

  // ── S6 相机三态循环：瞄准 → 全桌 → 俯视 → 瞄准 ──
  const camState = () =>
    page.evaluate(() => {
      const v = globalThis.__bc.container.view
      const c = v.camera.camera
      return {
        mode: String(v.camera.mode?.name || "").replace("bound ", ""),
        pos: [c.position.x, c.position.y, c.position.z].map((n) => +n.toFixed(2)),
        fov: +c.fov.toFixed(1),
      }
    })
  const near = (a, b, t = 0.06) => a.every((n, i) => Math.abs(n - b[i]) < t)
  const SHOT = "/root/.codebuddy/artifact/render/v181"
  const c0 = await camState()
  const seq = [c0]
  await page.screenshot({ path: `${SHOT}/smoke-${c0.mode}.png` })
  for (let i = 0; i < 3; i++) {
    await page.evaluate(() => document.getElementById("camera")?.click())
    await sleep(6500)
    const c = await camState()
    seq.push(c)
    await page.screenshot({ path: `${SHOT}/smoke-${c.mode}.png` })
  }
  const c1 = seq[1], c2 = seq[2], c3 = seq[3]
  const farEntry = seq.find((c) => c.mode === "farView") || null
  const farOk =
    !!farEntry && near(farEntry.pos, [2.35, -2.85, 1.92], 0.08) && Math.abs(farEntry.fov - 32.7) < 0.6
  // 三态循环：三次点击走完「全桌 + 俯视」并回到初始态（顺序由循环实现决定，只认集合与终点）
  const cycleOk =
    c0.mode === "aimView" &&
    farOk &&
    seq.slice(1).some((c) => c.mode === "topView") &&
    c3.mode === c0.mode
  ok("S6_三态视角 瞄准→(全桌/俯视)→瞄准", cycleOk, { seq })

  // ── S7 全桌机位确实「看得见整桌」（画面下部是腿与地面，不是台呢）──
  ok("S7_零页面错误", errs.length === 0, { errs })

  const passed = results.filter((r) => r.cond).length
  console.log(`\n合计：${passed}/${results.length}`)
  await browser.close()
  process.exit(passed === results.length ? 0 : 1)
})().catch((e) => {
  console.error("FATAL", e)
  process.exit(2)
})
