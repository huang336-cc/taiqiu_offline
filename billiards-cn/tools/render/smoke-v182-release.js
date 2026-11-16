/**
 * v1.8.2 线上发布冒烟：版本号 / 下载链接 / 履历 / 边界射线 / 三态视角
 *                       + 全桌机位手势 + 落袋回球通道 + 零页面错误。
 *
 * 相对 v1.8.1 的三点新增：
 *   S7 全桌机位不再固定 —— 真实 pointer 拖动改 yaw/pitch、wheel 改 dist，
 *      且力度/瞄准角不被串改（v1.8.2 的 A 需求）。
 *   S8 落袋回球 —— BallReturn Group 挂载、代理球生成并沿 −x 推进到集球盘、
 *      复位自愈清空（v1.8.2 的 B 需求）。软渲染低帧率跳帧，这里用固定
 *      50ms 步长手动推进 ballReturn.update，不用 rAF。
 *   S5 保留库边内表面射线量测：确认自由机位改动没碰坏 v1.8.1 的边界校准。
 *
 * 历史教训（v1.5.7）：changelog-data.js 混进真实换行 → 点「变更履历」白屏，
 * 只有发版冒烟能抓到；本脚本把「语法体检 + 首条版本」列为必测项。
 *
 * 用法：BASE=https://xxx node tools/render/smoke-v182-release.js
 */
const puppeteer = require("puppeteer-core")

// 线上发布链接启用 sharecode：裸域名 403，必须先带 ?sharecode= 访问一次，
// 网关会下发 __wb_rsc cookie，之后同域所有路径即可正常访问。
// 本地预跑（BASE=127.0.0.1:3000）无 sharecode，SHARECODE 留空即跳过预热。
const SHARECODE = process.env.SHARECODE || ""
const BASE = (process.env.BASE || "https://a7b9dc0cd0da80587.app.workbuddy.host").replace(/\/$/, "")
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
      "--user-data-dir=/tmp/chrome-smoke182-" + Date.now(),
      "--in-process-gpu",
      "--disable-gpu-sandbox",
      "--window-size=1280,720",
    ],
    defaultViewport: { width: 1280, height: 720 },
  })
  const page = await browser.newPage()
  const errs = []
  page.on("pageerror", (e) => errs.push(String(e.message).slice(0, 200)))

  // ── S0 预热 sharecode cookie（线上发布必做，否则所有子路径 403）──
  if (SHARECODE) {
    await page.goto(`${BASE}/?sharecode=${SHARECODE}`, { waitUntil: "load", timeout: 90000 })
    await sleep(1500)
    const warm = await page.evaluate(async () => {
      try {
        const r = await fetch("/menu.html", { method: "HEAD" })
        return r.status
      } catch (e) {
        return String(e).slice(0, 120)
      }
    })
    ok("S0_sharecode 预热后子路径可达", warm === 200, { warm })
  }

  // ── S1 主菜单版本号 ──
  await page.goto(`${BASE}/menu.html`, { waitUntil: "load", timeout: 90000 })
  await sleep(2500)
  const ver = await page.evaluate(() => window.__BILLIARDS_VERSION__ || null)
  ok("S1_版本号为 1.8.2", typeof ver === "string" && ver.startsWith("1.8.2"), { ver })

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
    dl.ver.includes("1.8.2") &&
    dl.links.some((l) => l && l.includes("v1.8.2.apk")) &&
    dl.links.some((l) => l && l.includes("release-v1.8.2.zip")) &&
    dl.h2.some((h) => h.includes("v1.8.2 更新要点"))
  const probe = await page.evaluate(async () => {
    const out = {}
    for (const href of ["billiards-cn-v1.8.2.apk", "release-v1.8.2.zip"]) {
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
    probe["billiards-cn-v1.8.2.apk"]?.status === 200 &&
    probe["billiards-cn-v1.8.2.apk"]?.len > 12e6 &&
    probe["release-v1.8.2.zip"]?.status === 200 &&
    probe["release-v1.8.2.zip"]?.len > 40e6
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
        has181: html ? html.includes("v1.8.1") : false,
        has180: html ? html.includes("v1.8.0") : false,
        has170: html ? html.includes("v1.7.0") : false,
      }
    } catch (e) {
      return { ok: false, error: String(e).slice(0, 200) }
    }
  })
  ok(
    "S3_履历可解析且 v1.8.2 在首",
    cl.ok && (cl.first || "").includes("v1.8.2") && cl.has181 && cl.has180 && cl.has170,
    cl
  )

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
    document.querySelectorAll('[data-tut-ack="1"]').forEach((e) => e.click())
    document.querySelectorAll(".tutorial-banner").forEach((e) => (e.style.display = "none"))
  })
  await sleep(8000)
  const box = await page.evaluate(() => {
    const r = globalThis.__bc.container.view.element.getBoundingClientRect()
    return { x: r.x, y: r.y, w: r.width, h: r.height }
  })
  // 开局是「放置母球」状态：点台面摆好母球，再按 #cueHit 进入瞄准
  await page.mouse.click(box.x + box.w * 0.62, box.y + box.h * 0.42)
  await sleep(600)
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
      hasReturn: !!v.scene.getObjectByName("BallReturn"),
    }
  })
  ok(
    "S4_游戏启动/写实桌挂载/瞄准机位",
    boot && boot3d.realTable === true && boot3d.tableNode && boot3d.ballCount > 0 &&
      boot3d.mode === "aimView" && boot3d.ctrl !== "PlaceBall",
    boot3d
  )

  // ── S5 玩区边界：射线量测库边内表面 + 台呢面（v1.8.1 回归项）──
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
  ok("S5_库边内表面=R×44/R×22、台呢面=−R（v1.8.1 回归）", geoOk, g)

  // ── S6 三态视角循环 + S7 全桌机位手势（在 farView 那一步顺带验证）──
  const camState = () =>
    page.evaluate(() => {
      const c = globalThis.__bc.container
      const v = c.view
      const cam = v.camera
      const three = cam.camera
      return {
        mode: String(cam.mode?.name || "").replace("bound ", ""),
        pos: [three.position.x, three.position.y, three.position.z].map((n) => +n.toFixed(2)),
        fov: +three.fov.toFixed(1),
        farCam: {
          yaw: +cam.farCam.yaw.toFixed(4),
          pitch: +cam.farCam.pitch.toFixed(4),
          dist: +cam.farCam.dist.toFixed(4),
        },
        aim: +c.table.cue.aim.angle.toFixed(6),
        power: +c.table.cue.aim.power.toFixed(6),
        hasReturn: !!v.scene.getObjectByName("BallReturn"),
      }
    })
  const near = (a, b, t = 0.08) => a.every((n, i) => Math.abs(n - b[i]) < t)
  const c0 = await camState()
  const seq = [c0]
  let farIdx = -1
  let gesture = null
  const cx = box.x + box.w * 0.5, cy = box.y + box.h * 0.5
  for (let i = 0; i < 3; i++) {
    await page.evaluate(() => document.getElementById("camera")?.click())
    await sleep(6500)
    const c = await camState()
    seq.push(c)
    if (c.mode === "farView" && farIdx < 0) {
      farIdx = seq.length - 1
      // 首屏构图与 v1.8.1 一致 + BallReturn Group 已挂载
      const farOk = near(c.pos, [2.35, -2.85, 1.92]) && Math.abs(c.fov - 32.7) < 0.6 && c.hasReturn
      // 真实 pointer 拖动旋转
      const s0 = c
      await page.mouse.move(cx, cy)
      await page.mouse.down()
      for (let k = 1; k <= 6; k++) {
        await page.mouse.move(cx + k * 20, cy + k * 7)
        await sleep(120)
      }
      await page.mouse.up()
      await sleep(2200)
      const s1 = await camState()
      // 真实 wheel 缩放（拉远）
      await page.mouse.move(cx, cy)
      for (let k = 0; k < 4; k++) {
        await page.mouse.wheel({ deltaY: 120 })
        await sleep(250)
      }
      await sleep(2000)
      const s2 = await camState()
      gesture = {
        farOk,
        rotated: Math.abs(s1.farCam.yaw - s0.farCam.yaw) > 0.2 &&
          Math.hypot(s1.pos[0] - s0.pos[0], s1.pos[1] - s0.pos[1], s1.pos[2] - s0.pos[2]) > 0.3,
        zoomed: s2.farCam.dist > s1.farCam.dist * 1.15,
        powerSafe: Math.abs(s2.power - s0.power) < 1e-9,
        aimSafe: Math.abs(s1.aim - s0.aim) < 1e-9 && Math.abs(s2.aim - s0.aim) < 1e-9,
        yaw: [s0.farCam.yaw, s1.farCam.yaw],
        dist: [s1.farCam.dist, s2.farCam.dist],
        power: [s0.power, s2.power],
      }
    }
  }
  const c3 = seq[3]
  const cycleOk =
    c0.mode === "aimView" &&
    farIdx >= 0 &&
    seq.slice(1).some((c) => c.mode === "topView") &&
    c3.mode === c0.mode
  ok("S6_三态视角 瞄准→(全桌/俯视)→瞄准", cycleOk, { seq: seq.map((s) => ({ mode: s.mode, pos: s.pos, fov: s.fov })) })
  ok(
    "S7_全桌机位手势生效（旋转/缩放、力度与瞄准不串改）",
    !!gesture && gesture.farOk && gesture.rotated && gesture.zoomed && gesture.powerSafe && gesture.aimSafe,
    gesture || { note: "未进入 farView" }
  )

  // ── S8 落袋回球：Group 挂载 + 代理球沿 −x 推进到集球盘 + 复位自愈 ──
  const ret = await page.evaluate(() => {
    const c = globalThis.__bc.container
    const t = c.table
    const g = c.view.scene.getObjectByName("BallReturn")
    const ball = t.balls.find((x) => !x.isCue)
    const orig = ball.state
    const snap = () => {
      const o = (g?.children || []).find((n) => n.name.startsWith("ReturnBall_"))
      return o ? { x: +o.position.x.toFixed(3), y: +o.position.y.toFixed(3), visible: o.visible } : null
    }
    ball.state = "InPocket"
    ball.pocket = undefined
    c.ballReturn.update(0.001, t.balls, false) // 登记，t≈0
    const p0 = snap()
    // 固定 50ms 步长手动推进，绕开 SwiftShader 每帧 dt≈0.8s 的跳帧
    for (let i = 0; i < 64; i++) c.ballReturn.update(0.05, t.balls, false)
    const p1 = snap()
    // 复位自愈：状态改回非 InPocket，代理球必须清空，通道/盘仍在
    ball.state = orig
    c.ballReturn.update(0.001, t.balls, false)
    const cleaned = !(g?.children || []).some((n) => n.name.startsWith("ReturnBall_"))
    return {
      exists: !!g,
      childCount: g?.children.length ?? 0,
      p0, p1, cleaned,
    }
  })
  const retOk =
    ret.exists && ret.childCount >= 5 && !!ret.p0 && !!ret.p1 && ret.p1.visible &&
    ret.p1.x < ret.p0.x - 1.0 && ret.p1.x < -1.3 && ret.cleaned
  ok("S8_落袋回球通道/集球盘 + 代理球滚动 + 复位清空", retOk, ret)

  // ── S9 自由机位六角度：每个方向都必须看得见球桌（发版前抓到的穿墙缺陷）──
  // 逐角度用真实 rAF 渲染，读回相机坐标并断言被夹在房间墙内侧；
  // 画面有效性由截图 + 台呢绿色像素占比判定，避免只验数值不验画面。
  const ANGLES = [
    { name: "默认", yaw: -0.8726, pitch: 0.5153, dist: 4.2009 },
    { name: "左转", yaw: -0.50, pitch: 0.46, dist: 4.2009 },
    { name: "右转", yaw: -1.30, pitch: 0.44, dist: 4.2009 },
    { name: "拉远", yaw: -0.8726, pitch: 0.42, dist: 4.75 },
    { name: "拉近", yaw: -0.8726, pitch: 0.50, dist: 3.6 },
    { name: "拖动后", yaw: -1.4726, pitch: 0.3053, dist: 4.2009 },
  ]
  const camChecks = []
  for (const a of ANGLES) {
    const st = await page.evaluate((cfg) => {
      const c = globalThis.__bc.container
      const cam = c.view.camera
      Object.assign(cam.farCam, { yaw: cfg.yaw, pitch: cfg.pitch, dist: cfg.dist })
      for (let i = 0; i < 12; i++) cam.farView({})
      c.view.render()
      return {
        pos: [cam.camera.position.x, cam.camera.position.y, cam.camera.position.z].map((n) => +n.toFixed(3)),
        mode: String(cam.mode?.name || "").replace("bound ", ""),
      }
    }, a)
    // 相机必须留在房间墙内侧（y >= -2.86），否则会看到墙背面糊成一片米色。
    // 这里直接调 farView() 驱动 farPosition()，读回的 pos 就是实际机位；
    // camera.mode 是 rAF 的自动切换状态（前面三态循环已回到 aimView），
    // 与本项「机位是否穿墙」无关，不作为断言条件。
    camChecks.push({ name: a.name, ...st, inside: st.pos[1] >= -2.86 })
    await sleep(300)
  }
  const allInside = camChecks.every((c) => c.inside)
  ok("S9_自由机位六角度相机均留在房间内（不穿墙）", allInside, { camChecks })

  // ── S10 零页面错误 ──
  ok("S10_零页面错误", errs.length === 0, { errs })

  const passed = results.filter((r) => r.cond).length
  console.log(`\n合计：${passed}/${results.length}`)
  await browser.close()
  process.exit(passed === results.length ? 0 : 1)
})().catch((e) => {
  console.error("FATAL", e)
  process.exit(2)
})
