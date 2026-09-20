/**
 * 瞄准辅助线几何探针（v1.3.85 调试用）。
 *
 * 目的：不靠"看截图猜"，直接读取页面上 AimLine 的顶点缓冲与 alpha 缓冲，
 * 打印出真实的四边形数量、每个四边形的包围盒、以及 alpha 分布。
 *
 * 用法：
 *   DISPLAY=:99 node tools/render/probe-aimline.js
 */
const path = require("path")
const puppeteer = require("puppeteer-core")

const DIST = path.resolve(__dirname, "../../dist")
const URL = `file://${DIST}/play.html?debug=1&bot=Professional`

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
      "--user-data-dir=/tmp/chrome-probe-profile",
      "--in-process-gpu",
      "--disable-gpu-sandbox",
      "--allow-file-access-from-files",
      "--window-size=540,960",
    ],
    defaultViewport: { width: 540, height: 960 },
  })
  const page = await browser.newPage()
  const logs = []
  page.on("console", (m) => logs.push(`[${m.type()}] ${m.text()}`))
  page.on("pageerror", (e) => logs.push(`[pageerror] ${e.message}`))
  await page.goto(URL, { waitUntil: "load", timeout: 120000 })
  // 等容器就绪（与 render.js 相同的判据）
  const ready = await page
    .waitForFunction(
      () => {
        const bc = globalThis.__bc
        const view = bc && bc.container && bc.container.view
        const r = view && view.renderer
        const gl = r && (r.getContext ? r.getContext() : null)
        return !!(view && view.scene && view.camera && gl)
      },
      { timeout: 90000 }
    )
    .then(() => true)
    .catch(() => false)
  if (!ready) {
    console.error("容器未就绪。页面日志：")
    console.error(logs.slice(-20).join("\n"))
    await browser.close()
    process.exit(2)
  }
  await new Promise((r) => setTimeout(r, 9000))

  /**
   * 强制进入瞄准态并让 AimLine 真正被构建。
   *
   * 路径：`view.cue` 是 `Cue`（cue.ts），`updateTargetLine(table)` 里读
   * `this.aim.angle` 和 `Settings.get().targetLineLength`。所以要：
   *   1. 确保 `aimLine` 开关打开、长度档位 > 0
   *   2. 直接调用 `cue.updateTargetLine(view.table)`（绕开 isAiming 时序）
   * 这样能稳定拿到已构建的几何，不依赖玩家输入事件。
   */
  const staged = await page.evaluate(() => {
    const view = globalThis.__bc.container.view
    const out = { tried: [] }
    // Cue 挂在 table 上：`src/model/table.ts:43 this.cue = new Cue()`
    const cue = view.table && view.table.cue
    if (!cue) {
      out.tableKeys = view.table ? Object.keys(view.table).slice(0, 40) : null
      return out
    }
    out.foundCue = true
    // 打桩：强制 isAiming 返回 true，并给一个确定的角度
    cue.isAiming = () => true
    if (!cue.aim) cue.aim = {}
    cue.aim.angle = Math.PI / 2
    const table = view.table
    try {
      cue.updateTargetLine(table)
      out.called = true
      out.quads = {
        solid: cue.aimLine.solid.quads,
        dashed: cue.aimLine.dashed.quads,
      }
    } catch (e) {
      out.err = String(e)
    }
    return out
  })
  console.error("STAGED:", JSON.stringify(staged))

  /**
   * 二分定位：把可疑对象逐个隐藏，看画面里那几片白楔是谁。
   * 每轮截一张图，用文件名标明隐藏了什么。
   */
  await page.evaluate(() => {
    const view = globalThis.__bc.container.view
    globalThis.__toggle = (name, vis) => {
      view.scene.traverse((o) => {
        if (o.name === name) o.visible = vis
      })
    }
    // 列出场景里所有可见的、名字非空的顶层对象，便于确认候选
    const names = []
    view.scene.traverse((o) => {
      if (o.name && o.visible && o.parent === view.scene) names.push(o.name)
    })
    globalThis.__names = names
  })
  const names = await page.evaluate(() => globalThis.__names)
  console.error("SCENE NAMES:", JSON.stringify(names))

  for (const n of names) {
    const f = `probe_hide_${n.replace(/[^A-Za-z0-9_]/g, "_")}.png`
    await page.evaluate((nm) => globalThis.__toggle(nm, false), n)
    await new Promise((r) => setTimeout(r, 400))
    await page.screenshot({
      path: `/root/.codebuddy/artifact/render/shots/${f}`,
    })
    await page.evaluate((nm) => globalThis.__toggle(nm, true), n)
    await new Promise((r) => setTimeout(r, 200))
  }
  console.error("SHOTS DONE")

  /**
   * 定位「白球旁边那几片白色尖楔」与「画面中央的大白盘」。
   *
   * 从隐藏实验得知：隐藏 AimLine / ball 后白楔仍在，说明另有对象。
   * 下面遍历**全场景所有可见 Mesh**，按屏幕投影包围盒排序输出，
   * 重点找：① 白色/高亮 ② 位于母球附近 ③ 尺寸异常。
   */
  const meshes = await page.evaluate(() => {
    const view = globalThis.__bc.container.view
    const out = []
    view.scene.updateMatrixWorld(true)
    // 复用场景里任一 Object3D 的 position（Vector3）来算临时点
    const probeObj = view.scene.children.find((o) => o.position)
    const p = probeObj.position.clone()
    view.scene.traverse((o) => {
      if (!o.isMesh || !o.visible) return
      const geo = o.geometry
      if (!geo || !geo.attributes || !geo.attributes.position) return
      geo.computeBoundingBox()
      const bb = geo.boundingBox
      if (!bb) return
      // 世界尺度：用世界矩阵变换 8 个角点后取包围盒
      const mn = [Infinity, Infinity, Infinity]
      const mx = [-Infinity, -Infinity, -Infinity]
      for (let i = 0; i < 8; i++) {
        p.set(
          i & 1 ? bb.max.x : bb.min.x,
          i & 2 ? bb.max.y : bb.min.y,
          i & 4 ? bb.max.z : bb.min.z
        )
        o.localToWorld(p)
        if (p.x < mn[0]) mn[0] = p.x
        if (p.y < mn[1]) mn[1] = p.y
        if (p.z < mn[2]) mn[2] = p.z
        if (p.x > mx[0]) mx[0] = p.x
        if (p.y > mx[1]) mx[1] = p.y
        if (p.z > mx[2]) mx[2] = p.z
      }
      const mat = o.material
      const mats = Array.isArray(mat) ? mat : [mat]
      const m0 = mats[0]
      out.push({
        name: o.name || "(unnamed)",
        type: m0 ? m0.type : null,
        color: m0 && m0.color ? m0.color.getHexString() : null,
        parent: o.parent ? o.parent.name || "(unnamed)" : null,
        center: [
          +((mn[0] + mx[0]) / 2).toFixed(3),
          +((mn[1] + mx[1]) / 2).toFixed(3),
          +((mn[2] + mx[2]) / 2).toFixed(3),
        ],
        size: [
          +(mx[0] - mn[0]).toFixed(3),
          +(mx[1] - mn[1]).toFixed(3),
          +(mx[2] - mn[2]).toFixed(3),
        ],
        verts: geo.attributes.position.count,
      })
    })
    return out
  })
  // 只打印体积大 / 颜色白 / 靠近母球 的可疑项
  const suspect = meshes.filter(
    (m) =>
      (m.color &&
        ["ffffff", "fefefe", "fdfdfd", "f0f0f0"].includes(m.color)) ||
      m.size[0] > 0.5 ||
      m.size[1] > 0.5
  )
  console.error(
    "SUSPECT MESHES:",
    JSON.stringify(suspect.slice(0, 40), null, 1)
  )

  /**
   * 验证「摆球指示器泄漏」假设。
   *
   * 场景里那 4 片白色尖楔 = `CueMesh.createPlacer()` 的 4 个 `ConeGeometry`
   * 金字塔，只在 `placeBallMode()` 里可见、`aimMode()` 里隐藏。
   * 若当前控制器仍停在 PlaceBall，就说明是**状态机没切回来**。
   */
  const placer = await page.evaluate(() => {
    const view = globalThis.__bc.container.view
    const cue = view.table.cue
    const pm = cue && cue.placerMesh
    const out = {
      placerExists: !!pm,
      placerVisible: pm ? pm.visible : null,
      placerChildren: pm ? pm.children.length : null,
      childVisible: pm
        ? pm.children.map((c) => ({ v: c.visible, type: c.type }))
        : null,
      cueMeshVisible: cue && cue.mesh ? cue.mesh.visible : null,
      helperVisible: cue && cue.helperMesh ? cue.helperMesh.visible : null,
      aimLineVisible:
        cue && cue.aimLine ? cue.aimLine.solid.mesh.visible : null,
    }
    try {
      out.controller = String(
        globalThis.__bc.container.controller &&
          globalThis.__bc.container.controller.constructor &&
          globalThis.__bc.container.controller.constructor.name
      )
    } catch (e) {
      out.controller = "err:" + e
    }
    return out
  })
  console.error("PLACER STATE:", JSON.stringify(placer, null, 1))

  const dump = await page.evaluate(() => {
    const view = globalThis.__bc?.container?.view
    if (!view) return { error: "no view" }
    const scene = view.scene
    let found = null
    scene.traverse((o) => {
      if (o.name === "AimLine") found = o
    })
    if (!found) return { error: "AimLine not in scene" }

    const out = { children: [], visible: found.visible }
    for (const m of found.children) {
      const g = m.geometry
      const pos = g.attributes.position
      const al = g.attributes.aAlpha
      const dr = g.drawRange
      const tri = Math.floor(dr.count / 3)
      // 收集顶点包围盒
      let minX = 1e9,
        maxX = -1e9,
        minY = 1e9,
        maxY = -1e9,
        minZ = 1e9,
        maxZ = -1e9
      const pts = []
      const alphas = []
      for (let i = 0; i < dr.count && i < pos.count; i++) {
        const x = pos.getX(i),
          y = pos.getY(i),
          z = pos.getZ(i)
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
        if (z < minZ) minZ = z
        if (z > maxZ) maxZ = z
        if (i < 40) pts.push([+x.toFixed(4), +y.toFixed(4), +z.toFixed(4)])
        if (al && i < 40) alphas.push(+al.getX(i).toFixed(3))
      }
      out.children.push({
        visible: m.visible,
        tris: tri,
        drawRange: [dr.start, dr.count],
        bbox: {
          x: [+minX.toFixed(4), +maxX.toFixed(4)],
          y: [+minY.toFixed(4), +maxY.toFixed(4)],
          z: [+minZ.toFixed(4), +maxZ.toFixed(4)],
        },
        distinctZ: (() => {
          const s = new Set()
          for (let i = 0; i < dr.count && i < pos.count; i++)
            s.add(+pos.getZ(i).toFixed(5))
          return [...s]
        })(),
        firstPts: pts,
        firstAlphas: alphas,
        hasAlphaAttr: !!al,
      })
    }
    return out
  })

  console.log(JSON.stringify(dump, null, 2))
  await browser.close()
})().catch((e) => {
  console.error(e)
  process.exit(1)
})
