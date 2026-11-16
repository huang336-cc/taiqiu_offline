/**
 * v1.8.0 实机取证：写实中式八球桌 + 三个新环境场景。
 *
 * 用法：BASE=http://127.0.0.1:8190 xvfb-run -a node tools/render/shot-v180-poolenv.js
 *
 * 覆盖：容器启动 → 落球进 Aim → 写实桌坐标校准 → 13 皮肤分区重着色 →
 * room / tea / cell / seed 四场景 aim+top 截图 → 俯视顶棚分组 → 控制台错误。
 */
const fs = require("fs")
const puppeteer = require("puppeteer-core")

const BASE = process.env.BASE || "http://127.0.0.1:8190"
const OUT = "/root/.codebuddy/artifact/render/v180"
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const results = []
const ok = (name, cond, info) => {
  results.push({ name, cond, info })
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}  ${JSON.stringify(info)}`)
}

;(async () => {
  fs.mkdirSync(OUT, { recursive: true })
  const browser = await puppeteer.launch({
    executablePath: "/usr/bin/google-chrome",
    headless: "new",
    args: [
      "--no-sandbox",
      "--hide-scrollbars",
      "--use-gl=angle",
      "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader",
      "--user-data-dir=/tmp/chrome-v180-poolenv",
      "--in-process-gpu",
      "--disable-gpu-sandbox",
      "--window-size=960,540",
    ],
    defaultViewport: { width: 960, height: 540 },
  })
  const page = await browser.newPage()
  const errs = []
  page.on("pageerror", (e) => errs.push("pageerror: " + String(e.message).slice(0, 220)))
  page.on("console", (m) => {
    if (m.type() === "error") errs.push("console: " + m.text().slice(0, 220))
  })
  page.on("requestfailed", (r) =>
    errs.push("req: " + r.url().split("/").pop() + " " + (r.failure()?.errorText || ""))
  )

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
  ok("O1_容器就绪", boot, {})
  if (!boot) {
    await browser.close()
    process.exit(2)
  }
  /**
   * 游戏有「60s 无事件且球全静止就停渲染」的省电逻辑（container.animate
   * 的 needsRender）。本探针跑四个场景 × 三轮截图会超过 60s，canvas 会
   * 冻结在上一帧、只有 DOM 继续更新 —— 截图于是看起来「场景滞后一个」。
   * 这里持续刷新 lastEventTime，保证整个取证过程 WebGL 每帧都在画。
   */
  await page.evaluate(() => {
    window.__keepRender180 = setInterval(() => {
      const c = globalThis.__bc?.container
      if (c) c.lastEventTime = performance.now()
    }, 400)
  })
  await sleep(7000)

  // 开局是 PlaceBall：点台面放白球，再确认进 Aim（坐标沿用已验证路径）
  const box = await page.evaluate(() => {
    const el = globalThis.__bc.container.view.element
    const r = el.getBoundingClientRect()
    return { x: r.x, y: r.y, w: r.width, h: r.height }
  })
  await page.mouse.click(box.x + box.w * 0.62, box.y + box.h * 0.42)
  await sleep(500)
  await page.evaluate(() => document.getElementById("cueHit")?.click())
  await sleep(2500)
  const ctrl = await page.evaluate(
    () =>
      globalThis.__bc.container.controller?.name ||
      globalThis.__bc.container.controller?.constructor?.name
  )
  ok("O2_进入 Aim", ctrl === "Aim", { ctrl })
  // 关掉首局引导横幅（分步引导会连着弹两步），否则台面中部被遮住
  const hideTutorial = () =>
    page.evaluate(() => {
      document.querySelectorAll('[data-tut-ack="1"]').forEach((e) => e.click())
      document
        .querySelectorAll(".tutorial-banner")
        .forEach((e) => (e.style.display = "none"))
    })
  await hideTutorial()
  await sleep(700)
  await hideTutorial()

  // ── 写实桌：坐标校准 + 材质 ──
  const tableDiag = await page.evaluate(() => {
    const view = globalThis.__bc.container.view
    const g = view.scene.getObjectByName("PoolTableReal")
    if (!g) return { found: false }
    let meshCount = 0
    let albedo = null
    const mats = []
    g.traverse((o) => {
      if (!o.isMesh) return
      meshCount++
      o.geometry.computeBoundingBox()
      const bb = o.geometry.boundingBox
      const m = Array.isArray(o.material) ? o.material[0] : o.material
      mats.push(m?.name || "?")
      if (m?.name === "Cn9ft_Albedo") {
        albedo = {
          maxZ: bb.max.z,
          minZ: bb.min.z,
          minX: bb.min.x,
          maxX: bb.max.x,
          minY: bb.min.y,
          maxY: bb.max.y,
          hasMap: !!m.map,
          mapType: m.map?.type,
          flipY: m.map?.flipY,
          imageTag: m.map?.image?.tagName || m.map?.image?.constructor?.name,
          transparent: m.transparent,
          depthWrite: m.depthWrite,
        }
      }
    })
    return {
      found: true,
      meshCount,
      mats,
      albedo,
      realTable: view.assets.realTable,
      poolTable: view.assets.poolTable,
    }
  })
  ok("O3_写实桌已挂载", tableDiag.found && tableDiag.realTable === true, tableDiag)
  const R = 0.03275
  ok(
    "O4_台呢顶面落在 z=-R（球不被切半球）",
    !!tableDiag.albedo && Math.abs(tableDiag.albedo.maxZ + R) < 0.012,
    tableDiag.albedo
  )
  ok(
    "O5_玩区 X 对齐 R×43",
    !!tableDiag.albedo && Math.abs(tableDiag.albedo.maxX - R * 43) < 0.05,
    { maxX: tableDiag.albedo?.maxX, expect: R * 43 }
  )

  // ── 换肤：分区重着色 ──
  const before = await page.evaluate(() => {
    const g = globalThis.__bc.container.view.scene.getObjectByName("PoolTableReal")
    let m = null
    g?.traverse((o) => {
      if (o.isMesh && !m) {
        const mm = Array.isArray(o.material) ? o.material[0] : o.material
        if (mm?.name === "Cn9ft_Albedo") m = mm
      }
    })
    return { uuid: m?.map?.uuid, tag: m?.map?.image?.tagName || "bitmap" }
  })
  await page.evaluate(() => {
    const v = globalThis.__bc.container.view
    v.assets.recolorTable(v.assets.table, undefined, "crimson")
  })
  await sleep(1500)
  const after = await page.evaluate(() => {
    const g = globalThis.__bc.container.view.scene.getObjectByName("PoolTableReal")
    let m = null
    g?.traverse((o) => {
      if (o.isMesh && !m) {
        const mm = Array.isArray(o.material) ? o.material[0] : o.material
        if (mm?.name === "Cn9ft_Albedo") m = mm
      }
    })
    return {
      uuid: m?.map?.uuid,
      tag: m?.map?.image?.tagName || m?.map?.image?.constructor?.name,
      flipY: m?.map?.flipY,
      colorSpace: m?.map?.colorSpace,
    }
  })
  ok("O6_换肤生成分区重着色贴图", after.tag === "CANVAS" && after.uuid !== before.uuid, {
    before,
    after,
  })
  await page.evaluate(() => {
    const v = globalThis.__bc.container.view
    v.camera.forceMode?.(v.camera.aimView)
  })
  await sleep(1800)
  await page.screenshot({ path: `${OUT}/v180-skin-crimson-aim.png` })
  await page.evaluate(() => {
    const v = globalThis.__bc.container.view
    v.assets.recolorTable(v.assets.table, undefined, "classic")
  })
  await sleep(900)

  // ── 四个环境：aim + top 双机位 ──
  for (const s of ["room", "tea", "cell", "seed"]) {
    await page.evaluate((id) => globalThis.__bc.container.view.applyScene(id), s)
    await sleep(4500)
    await hideTutorial()
    /**
     * 上一轮 env 广角把相机冻结在 9m 外，相机是每帧 lerp 0.9 收敛的：
     * 软件渲染下单帧可达 300ms，2.3s 只走 7 帧，会拍到「从远处往台面
     * 飞」的中间态（看起来像换错了场景）。这里先把相机瞬移回 aim 附近，
     * 让 forceMode 的收敛距离缩到几厘米，截图才是真实游戏机位。
     */
    await page.evaluate(() => {
      const v = globalThis.__bc.container.view
      const c = v.camera.camera
      c.position.set(0, -0.85, 0.32)
      c.up.set(0, 0, 1)
      c.fov = 36
      c.lookAt(0, 0, 0)
      c.updateProjectionMatrix()
      v.camera.forceMode?.(v.camera.aimView)
    })
    await sleep(2800)
    const d = await page.evaluate(() => {
      const v = globalThis.__bc.container.view
      const env = v.sceneEnv
      let meshCount = 0
      let ceiling = null
      let hasPoolEnv = false
      env?.traverse((o) => {
        if (o.isMesh) meshCount++
        if (o.name === "CeilingGroup")
          ceiling = { children: o.children.length, visible: o.visible }
        if (String(o.name || "").startsWith("PoolEnv_")) hasPoolEnv = true
      })
      return {
        envName: env?.name,
        meshCount,
        ceiling,
        hasPoolEnv,
        exposure: v.renderer.toneMappingExposure,
        toneMapping: v.renderer.toneMapping,
        bg: v.scene.background?.getHexString?.(),
        envMap: !!v.scene.environment,
      }
    })
    ok(`S_${s}_环境已挂载`, d.meshCount > 0 && !!d.ceiling, d)

    // forceMode 而非 suggestMode：上一轮 forceMode(topView) 会把 mainMode
    // 也改成 topView，suggestMode(aimView) 的分支不再命中，相机会卡在俯视。
    await page.evaluate(() => {
      const v = globalThis.__bc.container.view
      v.camera.forceMode?.(v.camera.aimView)
    })
    await sleep(2300)
    await page.screenshot({ path: `${OUT}/v180-${s}-aim.png` })

    await page.evaluate(() => {
      const v = globalThis.__bc.container.view
      v.camera.forceMode?.(v.camera.topView)
    })
    await sleep(2300)
    await page.screenshot({ path: `${OUT}/v180-${s}-top.png` })

    // 环境广角：aim 机位可见仰角仅 ~7°，看不到环境全貌；用固定机位
    // 复核场景模型确实挂载、装饰物没有穿进台面。
    await page.evaluate(() => {
      const v = globalThis.__bc.container.view
      const c = v.camera.camera
      // 用空函数冻结相机（不能置 null：animate loop 每帧 this.mode(...)，
      // 置 null 会抛 "this.mode is not a function" 污染控制台）
      v.camera.mode = () => {}
      v.camera.mainMode = () => {}
      // 拉远到房间尺度（约 9m）+ 放宽 fov，才能看到环境全貌；
      // 贴台机位下球桌占满画面，验证不了场景模型。
      // z 压到 2.4（低于 INDOOR_CEIL_Z），CeilingGroup 保持可见，
      // 才能复核灯笼 / 细胞器这些高位装饰确实在游戏里。
      c.position.set(6.2, -6.0, 2.4)
      c.up.set(0, 0, 1)
      c.fov = 55
      c.lookAt(0, 0, 0.2)
      c.updateProjectionMatrix()
      v.renderCamera?.(v.camera)
    })
    await sleep(2300)
    await page.screenshot({ path: `${OUT}/v180-${s}-env.png` })
    console.log(`saved ${s}-aim.png / ${s}-top.png / ${s}-env.png`)
  }

  // ── 控制台 ──
  const realErrs = errs.filter(
    (e) => !/favicon|net::ERR_ABORTED|404 \(Not Found\)/i.test(e)
  )
  ok("O7_无页面/资源错误", realErrs.length === 0, { errs: realErrs.slice(0, 12) })

  fs.writeFileSync(
    "/tmp/v180-diag.json",
    JSON.stringify({ tableDiag, before, after, results }, null, 2)
  )
  const failed = results.filter((r) => !r.cond)
  console.log(`\n=== 汇总 ${results.length - failed.length}/${results.length} PASS ===`)
  if (failed.length) console.log("FAILED:", failed.map((f) => f.name).join(", "))
  await browser.close()
  process.exit(failed.length ? 1 : 0)
})().catch((e) => {
  console.error("FATAL", e)
  process.exit(3)
})
