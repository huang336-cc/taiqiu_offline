/**
 * 3D 美化基线/验收截图工具（v1.6.0 美化工程）。
 *
 * 对当前 dist 构建截取三组标准机位：
 *   A. aim 视角（玩家默认第一视角）
 *   B. top 俯视
 *   C. 低角度侧视（看库边截面/桌腿/环境纵深）
 *
 * 用法：node tools/render/shot-beautify.js [outPrefix]
 * 输出：/root/.codebuddy/artifact/render/beautify/<prefix>-{aim,top,side}.png
 */
const path = require("path")
const fs = require("fs")
const puppeteer = require("puppeteer-core")

const DIST = path.resolve(__dirname, "../../dist")
const URL = `file://${DIST}/play.html?debug=1&bot=Professional`
const OUT = "/root/.codebuddy/artifact/render/beautify"
const prefix = process.argv[2] || "baseline"
const SCENE = process.env.SCENE || ""

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
      `--user-data-dir=/tmp/chrome-beautify-${prefix}`,
      "--in-process-gpu",
      "--disable-gpu-sandbox",
      "--allow-file-access-from-files",
      "--window-size=960,540",
    ],
    defaultViewport: { width: 960, height: 540 },
  })
  const page = await browser.newPage()
  page.on("pageerror", (e) => console.error("PAGEERROR:", e.message))
  await page.goto(URL, { waitUntil: "load", timeout: 120000 })
  const ready = await page
    .waitForFunction(
      () => {
        const bc = globalThis.__bc
        const view = bc && bc.container && bc.container.view
        const r = view && view.renderer
        return !!(view && view.scene && view.camera && r && r.getContext())
      },
      { timeout: 90000 }
    )
    .then(() => true)
    .catch(() => false)
  if (!ready) {
    console.error("容器未就绪")
    await browser.close()
    process.exit(2)
  }
  if (SCENE) {
    await page.evaluate((s) => {
      try {
        globalThis.__bc.container.view.applyScene?.(s)
      } catch (e) {
        console.error("applyScene failed", e)
      }
    }, SCENE)
    await new Promise((r) => setTimeout(r, 1500))
  }
  // 等瞄准就绪 + 环境稳定
  await new Promise((r) => setTimeout(r, 9000))

  // 落球：开局是 PlaceBall 阶段（俯视 + 白楔），点击台面一处放白球，
  // 再点确认进 Aim —— 否则 aim 视角截图只是摆球俯视，看不到球杆。
  const box = await page.evaluate(() => {
    const el = globalThis.__bc.container.view.element
    const r = el.getBoundingClientRect()
    return { x: r.x, y: r.y, w: r.width, h: r.height }
  })
  await page.mouse.click(box.x + box.w * 0.5, box.y + box.h * 0.52)
  await new Promise((r) => setTimeout(r, 500))
  await page.evaluate(() => document.getElementById("cueHit")?.click())
  await new Promise((r) => setTimeout(r, 2500))
  // 关掉教程横幅：它正好压在球堆上方，挡住核对球色的视线
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll("button, .hud-button, div"))
    const b = btns.find((el) => /知道了/.test(el.textContent || ""))
    if (b) b.click()
  })
  await new Promise((r) => setTimeout(r, 600))

  const shot = async (name, fn) => {
    await page.evaluate(fn)
    await new Promise((r) => setTimeout(r, 700))
    await page.screenshot({ path: `${OUT}/${prefix}-${name}.png` })
    console.log(`saved ${prefix}-${name}.png`)
  }

  // A. aim 视角（落球后默认即第一人称瞄准）
  await shot("aim", () => {
    const view = globalThis.__bc.container.view
    view.camera.suggestMode?.(view.camera.aimView)
  })

  if (process.env.DIAG) {
    const diag = await page.evaluate(() => {
      const view = globalThis.__bc.container.view
      const lights = []
      view.scene.traverse((o) => {
        if (o.isLight) {
          lights.push({
            type: o.type,
            intensity: o.intensity,
            visible: o.visible,
            castShadow: !!o.castShadow,
            pos: [o.position.x.toFixed(2), o.position.y.toFixed(2), o.position.z.toFixed(2)],
          })
        }
      })
      // 球色核对：读每颗球的材质 color（label 1 应为 #d9a800）
      const ballColors = view.table.balls.map((b) => {
        const bm = b.ballmesh
        const m = bm && bm.mesh ? (Array.isArray(bm.mesh.material) ? bm.mesh.material[0] : bm.mesh.material) : null
        return {
          label: b.label,
          hex: m && m.color ? m.color.getHexString() : null,
          hasMap: !!(m && m.map),
          appearance: bm && bm.appearance ? bm.appearance : (b.appearance || null),
        }
      })
      const lamp = view.scene.getObjectByName("billiardLamp")
      const env = view.scene.environment
      return {
        lights,
        hasLamp: !!lamp,
        lampVisible: lamp ? lamp.visible : null,
        lampParentVisible: lamp && lamp.parent ? lamp.parent.visible : null,
        envIntensity: view.scene.environmentIntensity,
        hasEnv: !!env,
        toneMapping: view.renderer.toneMapping,
        exposure: view.renderer.toneMappingExposure,
        shadowType: view.renderer.shadowMap.type,
        ballColors,
      }
    })
    console.log("DIAG=" + JSON.stringify(diag, null, 1))
  }
  // B. 俯视
  await shot("top", () => {
    const view = globalThis.__bc.container.view
    view.camera.forceMode?.(view.camera.topView)
  })
  // C. 低角度侧视（冻结相机后手工摆位，看库边截面/环境纵深）
  await shot("side", () => {
    const view = globalThis.__bc.container.view
    const cam = view.camera.camera
    // 冻结：mode 置为永不匹配的占位，update 不再改写相机
    view.camera.mode = null
    view.camera.mainMode = null
    cam.position.set(2.6, -2.2, 1.1)
    cam.up.set(0, 0, 1)
    cam.lookAt(0, 0.3, -0.1)
    cam.updateProjectionMatrix()
    view.renderCamera?.(view.camera)
  })

  // D. 房间广角（看家具：沙发/落地灯/边几/挂画/踢脚线）
  await shot("room", () => {
    const view = globalThis.__bc.container.view
    const cam = view.camera.camera
    view.camera.mode = null
    view.camera.mainMode = null
    cam.position.set(-0.6, -2.6, 1.7)
    cam.up.set(0, 0, 1)
    cam.lookAt(5.4, -0.6, 0.25)
    cam.updateProjectionMatrix()
    view.renderCamera?.(view.camera)
  })

  // D2. 房间反打（另一侧墙 + 落地灯特写）
  await shot("room2", () => {
    const view = globalThis.__bc.container.view
    const cam = view.camera.camera
    view.camera.mode = null
    view.camera.mainMode = null
    cam.position.set(2.2, 0.9, 1.35)
    cam.up.set(0, 0, 1)
    cam.lookAt(-5.3, -3.2, 0.7)
    cam.updateProjectionMatrix()
    view.renderCamera?.(view.camera)
  })

  // D3. 台面近景（核对球色：1 号黄球是否与白球/橙球可区分）
  if (process.env.RACKSHOT) {
    await shot("rack", () => {
      const view = globalThis.__bc.container.view
      const cam = view.camera.camera
      view.camera.mode = null
      view.camera.mainMode = null
      // 按台面实际球位取景：质心 + 斜上方近距离（避免手写坐标猜偏）
      const balls = view.table.balls.filter((b) => b.onTable())
      const c = balls.reduce(
        (a, b) => ({ x: a.x + b.pos.x / balls.length, y: a.y + b.pos.y / balls.length }),
        { x: 0, y: 0 }
      )
      window.__rackCenter = c
      cam.position.set(c.x - 0.05, c.y + 0.42, 0.42)
      cam.up.set(0, 0, 1)
      cam.lookAt(c.x, c.y, 0.035)
      cam.updateProjectionMatrix()
      view.renderCamera?.(view.camera)
    })
  }

  // E. ENVTEST=0：运行时关掉 P1 三项（环境贴图 / ACES / 吊灯聚光灯），
  // 用 aim 机位拍「改造前」对照图 —— 同视角同几何，只差新管线，色偏可直接比。
  // 必须放在所有正式截图**之后**，否则会污染前面几张。
  if (process.env.ENVTEST === "0") {
    await page.evaluate(() => {
      const view = globalThis.__bc.container.view
      view.scene.environment = null
      view.scene.environmentIntensity = 0
      view.renderer.toneMapping = 0 // NoToneMapping
      view.renderer.toneMappingExposure = 1
      view.scene.traverse((o) => {
        if (o.isLight && o.type === "SpotLight") o.visible = false
      })
      view.camera.forceMode(view.camera.aimView)
    })
    await new Promise((r) => setTimeout(r, 1200))
    await page.screenshot({ path: `${OUT}/${prefix}-aim-pre.png` })
    console.log(`saved ${prefix}-aim-pre.png`)
  }

  // F. 帧率采样（rAF 连续 3s，报平均/最差帧时长与 draw call 数）
  if (process.env.FPS) {
    // 统一机位：前一步可能停在手工冻结的广角，必须回到 aim 视角再测，
    // 否则两次测量看到的是不同的场景规模，数字没有可比性。
    await page.evaluate(() => {
      const view = globalThis.__bc.container.view
      view.camera.forceMode(view.camera.aimView)
    })
    await new Promise((r) => setTimeout(r, 900))
    const fps = await page.evaluate(async () => {
      const view = globalThis.__bc.container.view
      const r = view.renderer
      const times = []
      await new Promise((resolve) => {
        let last = performance.now()
        let n = 0
        const tick = () => {
          const now = performance.now()
          times.push(now - last)
          last = now
          if (++n < 180) requestAnimationFrame(tick)
          else resolve()
        }
        requestAnimationFrame(tick)
      })
      const avg = times.reduce((a, b) => a + b, 0) / times.length
      const sorted = [...times].sort((a, b) => a - b)
      return {
        frames: times.length,
        avgMs: +avg.toFixed(2),
        p95Ms: +sorted[Math.floor(sorted.length * 0.95)].toFixed(2),
        maxMs: +sorted[sorted.length - 1].toFixed(2),
        drawCalls: r.info.render.calls,
        triangles: r.info.render.triangles,
        programs: r.info.programs ? r.info.programs.length : -1,
        textures: r.info.memory.textures,
        geometries: r.info.memory.geometries,
      }
    })
    console.log("FPS=" + JSON.stringify(fps))
  }

  await browser.close()
  console.log("DONE")
})().catch((e) => {
  console.error(e)
  process.exit(1)
})
