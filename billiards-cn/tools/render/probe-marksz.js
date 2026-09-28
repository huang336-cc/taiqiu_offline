/**
 * 【v1.4.4 P3 验收】台面标志覆盖层 z 定位探针。
 *
 * 缩略图只有 260×120，看不出覆盖层到底是「贴在台呢上」还是「悬空在库边
 * 上方 / z-fighting 闪烁」。这里直接进真实游戏画面：
 *   1. 写 localStorage 切到指定主题（默认 neon，标志发光、差异最明显）；
 *   2. reload，劫持相机到 topView；
 *   3. 同一机位拍两张：覆盖层 visible=true / false；
 *   4. 同时回读关键 z：台呢顶、库边顶、桌框顶、覆盖层 z、GLTF 缩放。
 *
 * 判定：两张相减，差异像素必须**只落在台面矩形内**，且占比 1%~5%。
 *
 * 用法：node tools/render/probe-marksz.js [--skin neon] [--out /tmp/mz]
 */
const path = require("path")
const fs = require("fs")
const puppeteer = require("puppeteer-core")

const ROOT = "/workspace/dev/source/billiards-cn"
const DIST = path.join(ROOT, "dist")

function arg(name, def = null) {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def
}
const skin = arg("skin", "neon")
const outDir = arg("out", "/tmp/mz")
const W = 1280
const H = 720

fs.mkdirSync(outDir, { recursive: true })

async function main() {
  const browser = await puppeteer.launch({
    executablePath: "/usr/bin/google-chrome",
    headless: "new",
    args: [
      "--no-sandbox",
      "--hide-scrollbars",
      "--disable-dev-shm-usage",
      "--no-zygote",
      "--ozone-platform=headless",
      "--use-gl=angle",
      "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader",
      "--user-data-dir=/tmp/chrome-marksz-profile",
      "--in-process-gpu",
      "--disable-gpu-sandbox",
      "--allow-file-access-from-files",
      `--window-size=${W},${H}`,
    ],
    env: { ...process.env, DISPLAY: "" },
  })

  const page = await browser.newPage()
  await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 })
  const logs = []
  page.on("console", (m) => logs.push(`[${m.type()}] ${m.text()}`))
  page.on("pageerror", (e) => logs.push(`[pageerror] ${e.message}`))

  const url = `file://${DIST}/play.html?debug=1&bot=Professional`
  await page.goto(url, { waitUntil: "load", timeout: 120000 })

  // ① 切主题：写 localStorage 再 reload
  const wrote = await page
    .evaluate((sk) => {
      try {
        const KEY = "billiards_cn_settings_v1"
        let s = {}
        try {
          s = JSON.parse(localStorage.getItem(KEY) || "{}")
        } catch {
          s = {}
        }
        s.tableSkin = sk
        localStorage.setItem(KEY, JSON.stringify(s))
        return { ok: true, skin: sk }
      } catch (e) {
        return { ok: false, why: e.message }
      }
    }, skin)
    .catch((e) => ({ ok: false, why: "evaluate 失败 " + e.message }))
  console.log("写 localStorage:", JSON.stringify(wrote))
  await page.reload({ waitUntil: "load", timeout: 120000 })

  // ② 等容器就绪（分片轮询，同 render.js）
  const READY_PROBE = () => {
    const bc = globalThis.__bc
    const view = bc && bc.container && bc.container.view
    const r = view && view.renderer
    let gl = null
    try {
      gl = r && r.getContext ? r.getContext() : null
    } catch {
      return { ok: false, why: "getContext 抛异常" }
    }
    return {
      ok: !!(view && view.scene && view.camera && gl && typeof gl === "object"),
    }
  }
  let ready = false
  for (let i = 0; i < 6 && !ready; i++) {
    const st = await page
      .evaluate(READY_PROBE)
      .then((v) => v)
      .catch(() => ({ ok: false }))
    if (st.ok) {
      ready = true
      if (i > 0) console.log(`   （容器第 ${i + 1} 片就绪）`)
      break
    }
    await new Promise((r) => setTimeout(r, 15000))
  }
  if (!ready) {
    console.error("容器未就绪。日志尾部：")
    console.error(logs.slice(-25).join("\n"))
    await browser.close()
    process.exit(2)
  }
  await new Promise((r) => setTimeout(r, 3000))

  // ③ 回读关键 z（诊断）
  const diag = await page.evaluate(() => {
    const view = globalThis.__bc.container.view
    const scene = view.scene
    scene.updateMatrixWorld(true)
    const out = { skin: null, marks: null, tops: [], tableScale: null }
    try {
      out.skin =
        (globalThis.__bc.container.controller &&
          globalThis.__bc.container.controller.settings &&
          globalThis.__bc.container.controller.settings.tableSkin) ||
        (globalThis.__bc.Settings && globalThis.__bc.Settings.get().tableSkin) ||
        null
    } catch {}
    scene.traverse((o) => {
      if (!o.isMesh || !o.geometry) return
      if (!o.geometry.boundingBox) o.geometry.computeBoundingBox()
      const bb = o.geometry.boundingBox
      const e = o.matrixWorld.elements
      const wz = (x, y, z) => e[2] * x + e[6] * y + e[10] * z + e[14]
      const top = Math.max(
        wz(bb.min.x, bb.min.y, bb.max.z),
        wz(bb.min.x, bb.max.y, bb.max.z),
        wz(bb.max.x, bb.min.y, bb.max.z),
        wz(bb.max.x, bb.max.y, bb.max.z)
      )
      const mats = Array.isArray(o.material) ? o.material : [o.material]
      const names = mats.map((m) => (m && m.name) || "(无名)").join("|")
      if (o.name === "ClothMarks") {
        // 世界包围盒：8 角全变换，验证尺寸/位置是否真的压在台面上
        let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, z0 = Infinity, z1 = -Infinity
        for (const cx of [bb.min.x, bb.max.x])
          for (const cy of [bb.min.y, bb.max.y])
            for (const cz of [bb.min.z, bb.max.z]) {
              const e2 = o.matrixWorld.elements
              const wx = e2[0] * cx + e2[4] * cy + e2[8] * cz + e2[12]
              const wy = e2[1] * cx + e2[5] * cy + e2[9] * cz + e2[13]
              const wzz = e2[2] * cx + e2[6] * cy + e2[10] * cz + e2[14]
              x0 = Math.min(x0, wx); x1 = Math.max(x1, wx)
              y0 = Math.min(y0, wy); y1 = Math.max(y1, wy)
              z0 = Math.min(z0, wzz); z1 = Math.max(z1, wzz)
            }
        const m0 = Array.isArray(o.material) ? o.material[0] : o.material
        out.marks = {
          localZ: +o.position.z.toFixed(5),
          worldZ: +((z0 + z1) / 2).toFixed(5),
          worldSize: [+(x1 - x0).toFixed(4), +(y1 - y0).toFixed(4)],
          worldXY: [
            +((x0 + x1) / 2).toFixed(4),
            +((y0 + y1) / 2).toFixed(4),
          ],
          hasMap: !!(m0 && m0.map),
          mapSize: m0 && m0.map && m0.map.image
            ? [m0.map.image.width, m0.map.image.height]
            : null,
          emissive: m0 && m0.emissiveIntensity,
          visible: o.visible,
          renderOrder: o.renderOrder,
          parent: o.parent && (o.parent.name || o.parent.type),
        }
      }
      const ln = (o.name || "").toLowerCase() + " " + names.toLowerCase()
      if (ln.includes("cloth")) {
        // 台呢世界包围盒（验证覆盖层是否与之对齐）
        let X0 = Infinity, X1 = -Infinity, Y0 = Infinity, Y1 = -Infinity
        for (const cx of [bb.min.x, bb.max.x])
          for (const cy of [bb.min.y, bb.max.y]) {
            const wx = e[0] * cx + e[4] * cy + e[12]
            const wy = e[1] * cx + e[5] * cy + e[13]
            X0 = Math.min(X0, wx); X1 = Math.max(X1, wx)
            Y0 = Math.min(Y0, wy); Y1 = Math.max(Y1, wy)
          }
        out.cloth = {
          name: o.name,
          mat: names,
          topZ: +top.toFixed(5),
          worldSize: [+(X1 - X0).toFixed(4), +(Y1 - Y0).toFixed(4)],
          worldCenter: [+((X0 + X1) / 2).toFixed(4), +((Y0 + Y1) / 2).toFixed(4)],
        }
      }
      if (
        ln.includes("cushion") ||
        ln.includes("frame") ||
        ln.includes("rail")
      ) {
        out.tops.push({ name: o.name, mat: names, topZ: +top.toFixed(5) })
      }
    })
    out.tops.sort((a, b) => b.topZ - a.topZ)
    out.tops = out.tops.slice(0, 12)
    return out
  })
  console.log("诊断:", JSON.stringify(diag, null, 2))

  // ④ 劫持相机到俯视
  /**
   * ⚠️ topView 内部是 lerp 插值：只调一次会停在半路，相机位置每次运行都
   * 不一样 —— 这正是此前「台面屏幕范围」被误判成 159..1120 的根因（实测
   * 权威值是 x∈[384,896]、y∈[222,498]）。必须多跑若干帧让它收敛，并回读
   * camPos 与后续截图对齐（见 tools/render/probe-spotpos.js）。
   */
  const camInfo = await page.evaluate(() => {
    const view = globalThis.__bc.container.view
    const camWrap = view.camera
    camWrap.forceMode("top")
    camWrap.update = function () {
      camWrap.topView(null)
    }
    for (let i = 0; i < 120; i++) camWrap.update(16, null)
    const c = camWrap.camera || camWrap
    return { pos: [+c.position.x.toFixed(3), +c.position.y.toFixed(3), +c.position.z.toFixed(3)] }
  })
  console.log("俯视相机:", JSON.stringify(camInfo))
  await new Promise((r) => setTimeout(r, 1500))
  await page.screenshot({ path: path.join(outDir, "top-marks-on.png") })

  // ⑤ 关掉覆盖层再拍一张
  await page.evaluate(() => {
    const view = globalThis.__bc.container.view
    const m = view.scene.getObjectByName("ClothMarks")
    if (m) m.visible = false
  })
  await new Promise((r) => setTimeout(r, 1200))
  await page.screenshot({ path: path.join(outDir, "top-marks-off.png") })

  // ⑤b 隐藏所有球再拍一组：开局球阵正好压在 foot spot / 中点上，
  //    不藏起来就看不到置球点，无法判断点位是否画对。
  const hid = await page.evaluate(() => {
    const view = globalThis.__bc.container.view
    let n = 0
    const hide = (o) => {
      if (o.visible) {
        o.visible = false
        n++
      }
    }
    const balls = (view.table && view.table.balls) || []
    for (const b of balls) {
      if (b && b.mesh) hide(b.mesh)
      else if (b && b.isObject3D) hide(b)
    }
    /**
     * 瞄准辅助（ghost ball / 瞄准线）也要藏：它是半透明白球、跟着瞄准
     * 方向动，两张截图之间位置会变，在 A/B 差异图里形成比置球点还强的
     * 假信号 —— 曾据此把「中点没画出来」误判成「中点画出来了」。
     */
    view.scene.traverse((o) => {
      if (!o.isMesh && !o.isLine && !o.isSprite) return
      const nm = (o.name || "").toLowerCase()
      const mn = Array.isArray(o.material) ? o.material[0] : o.material
      const mm = ((mn && mn.name) || "").toLowerCase()
      const t = (o.type || "").toLowerCase()
      if (
        nm.includes("ball") || mm.includes("ball") ||
        nm.includes("ghost") || nm.includes("aim") || nm.includes("line") ||
        t.includes("line") || t.includes("sprite")
      ) hide(o)
    })
    return n
  })
  console.log("隐藏球体数量:", hid)
  await new Promise((r) => setTimeout(r, 1200))
  await page.evaluate(() => {
    const view = globalThis.__bc.container.view
    const m = view.scene.getObjectByName("ClothMarks")
    if (m) m.visible = true
  })
  await new Promise((r) => setTimeout(r, 1200))
  await page.screenshot({ path: path.join(outDir, "nb-marks-on.png") })
  await page.evaluate(() => {
    const view = globalThis.__bc.container.view
    const m = view.scene.getObjectByName("ClothMarks")
    if (m) m.visible = false
  })
  await new Promise((r) => setTimeout(r, 1200))
  await page.screenshot({ path: path.join(outDir, "nb-marks-off.png") })

  // ⑦ 纯色遮罩：把覆盖层贴图换成不透明纯红，一次性分清是「几何/UV 错位」
  //    还是「贴图内容没画上」。红色区域 = 覆盖层实际铺到的台面范围。
  await page.evaluate(() => {
    const view = globalThis.__bc.container.view
    const m = view.scene.getObjectByName("ClothMarks")
    if (!m) return
    m.visible = true
    const mat = Array.isArray(m.material) ? m.material[0] : m.material
    globalThis.__savedMarksMap = mat.map // 留给 ⑧ 复原
    mat.map = null
    mat.emissiveMap = null
    mat.emissiveIntensity = 0
    mat.color.setHex(0xff0000)
    mat.opacity = 0.65
    mat.needsUpdate = true
  })
  await new Promise((r) => setTimeout(r, 1200))
  await page.screenshot({ path: path.join(outDir, "red-mask.png") })

  // ⑥ 再拍一张斜俯视（z-fighting 在斜角最容易暴露）
  await page.evaluate(() => {
    const view = globalThis.__bc.container.view
    const m = view.scene.getObjectByName("ClothMarks")
    if (m) m.visible = true
    const c = view.camera.camera || view.camera
    view.camera.update = function () {
      c.position.set(0, -2.6, 1.9)
      c.lookAt(0, 0, 0.78)
    }
    view.camera.update(0, null)
  })
  await new Promise((r) => setTimeout(r, 1200))
  await page.screenshot({ path: path.join(outDir, "oblique-marks-on.png") })

  await page.evaluate(() => {
    const view = globalThis.__bc.container.view
    const m = view.scene.getObjectByName("ClothMarks")
    if (m) m.visible = false
  })
  await new Promise((r) => setTimeout(r, 1200))
  await page.screenshot({ path: path.join(outDir, "oblique-marks-off.png") })

  /**
   * ⑧ 终局诊断：foot spot（u=0.75）在游戏里完全不显示，而 center（u=0.5）
   * 正常。这里一次分清三种可能：
   *   a) 游戏内实际贴图在 u=0.75 处本来就没内容（贴图生成问题）；
   *   b) 贴图有内容但被光照冲掉（换成不受光的 MeshBasicMaterial 验证）；
   *   c) UV/几何问题（已被 ⑦ 红遮罩排除）。
   */
  const texProbe = await page.evaluate(() => {
    const view = globalThis.__bc.container.view
    const m = view.scene.getObjectByName("ClothMarks")
    if (!m) return { err: "no ClothMarks" }
    const mat = Array.isArray(m.material) ? m.material[0] : m.material
    if (!mat.map && globalThis.__savedMarksMap) mat.map = globalThis.__savedMarksMap
    const img = mat.map && mat.map.image
    if (!img) return { err: "no map image" }
    const c2 = document.createElement("canvas")
    c2.width = img.width
    c2.height = img.height
    const cx = c2.getContext("2d")
    cx.drawImage(img, 0, 0)
    const stat = (ux, vy, half) => {
      const x = Math.round(ux * img.width)
      const y = Math.round(vy * img.height)
      const d = cx.getImageData(
        Math.max(0, x - half),
        Math.max(0, y - half),
        half * 2,
        half * 2
      ).data
      let mx = 0,
        n = 0
      for (let i = 3; i < d.length; i += 4) {
        if (d[i] > mx) mx = d[i]
        if (d[i] > 0) n++
      }
      return { at: [x, y], alphaMax: mx, alphaNonZero: n }
    }
    return {
      size: [img.width, img.height],
      repeat: mat.map.repeat ? [mat.map.repeat.x, mat.map.repeat.y] : null,
      offset: mat.map.offset ? [mat.map.offset.x, mat.map.offset.y] : null,
      wrap: [mat.map.wrapS, mat.map.wrapT],
      foot: stat(0.75, 0.5, 40),
      head: stat(0.25, 0.5, 40),
      center: stat(0.5, 0.5, 40),
      line: stat(0.25, 0.15, 40),
    }
  })
  console.log("贴图像素探针:", JSON.stringify(texProbe))

  // 拉满自发光：排除「光照把半透明层冲掉」的可能（发光不受场景光影响）
  await page.evaluate(() => {
    const view = globalThis.__bc.container.view
    const m = view.scene.getObjectByName("ClothMarks")
    if (!m) return
    const mat = Array.isArray(m.material) ? m.material[0] : m.material
    mat.color.setHex(0xffffff)
    mat.emissive.setHex(0xffffff)
    mat.emissiveMap = mat.map
    mat.emissiveIntensity = 3
    mat.opacity = 1
    mat.needsUpdate = true
  })
  await new Promise((r) => setTimeout(r, 1200))
  await page.screenshot({ path: path.join(outDir, "glow-marks-on.png") })

  console.log("已输出 7 张到", outDir)
  await browser.close()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
