/**
 * 场景离线渲染管线（v1.3.85 起）。
 *
 * 沙箱里没有 GPU，但有 Xvfb + ANGLE/SwiftShader 软渲染 —— 只要给 Chrome 一个
 * 虚拟 X 显示，WebGL2 就能跑起来（实测 ANGLE Vulkan 1.3 SwiftShader）。
 * 这解决了此前几十个版本最致命的问题：**改完看不见画面，只能靠指标猜**。
 *
 * 用法：
 *   Xvfb :99 -screen 0 1280x800x24 -nolisten tcp &
 *   DISPLAY=:99 node tools/render/render.js --scene <name> --out <dir> [options]
 */
const path = require("path")
const fs = require("fs")
const puppeteer = require("puppeteer-core")

const ROOT = "/workspace/dev/source/billiards-cn"
const DIST = path.join(ROOT, "dist")
const OUT_DIR = "/root/.codebuddy/artifact/render/shots"

function arg(name, def = null) {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def
}
const flag = (name) => process.argv.includes(`--${name}`)

/**
 * 相机预设。
 *
 * 项目里相机是围绕球桌公转的，`aim` 是贴地平视（真实球员视角）、`top` 是
 * 俯视。这里额外给一个 `free` —— 直接摆一个斜俯视角，能看到桌腿/地面/场景
 * 全貌，是判断「整体观感」最有信息量的机位。
 */
const VIEWS = {
  aim: { desc: "贴地平视（球员视角）", patch: "aim" },
  top: { desc: "俯视（瞄准视角）", patch: "top" },
  free: { desc: "斜俯视全景（自定义）", patch: "free" },
  // v1.3.100：游戏内「远台视角」——直接调用 camera.farView（跟随球杆），测真实代码路径
  far: { desc: "远台视角（跟随球杆，退远+抬高）", patch: "far" },
}

async function main() {
  /**
   * v1.3.96：不再强制要求 DISPLAY。
   * SwiftShader 软件渲染在「纯 headless」下最稳（`--ozone-platform=headless`
   * 已加进启动参数）。一旦 DISPLAY 被设置，Chrome 的 GPU 进程会改走 Vulkan-XCB
   * 路径去连 X 服务器，反而 `xcb_connect() failed` 崩溃。所以这里允许 DISPLAY
   * 为空，并把传给浏览器的 env 里的 DISPLAY 删掉，强制走 headless GL。
   */
  if (!process.env.DISPLAY) {
    console.warn("提示：未设置 DISPLAY，将以纯 headless 软件渲染（SwiftShader）运行。")
  }

  const scene = arg("scene", "room")
  const viewName = arg("view", "aim")
  const w = parseInt(arg("w", "540"), 10)
  const h = parseInt(arg("h", "960"), 10)
  const settle = parseInt(arg("settle", "2500"), 10)
  const outDir = arg("out", OUT_DIR)
  const tag = arg("tag", "")

  fs.mkdirSync(outDir, { recursive: true })

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
      /**
       * v1.3.85 稳定性修正：SwiftShader 在页面被反复创建/销毁时会因
       * GPU 进程复用失败报 `BindToCurrentSequence failed`，表现为
       * WebGL 上下文创建失败。用**独立用户数据目录**隔离每次运行，
       * 并把 GPU 进程改成进程内模式，能让连续批渲染稳定复现。
       */
      "--user-data-dir=/tmp/chrome-render-profile",
      "--in-process-gpu",
      "--disable-gpu-sandbox",
      "--allow-file-access-from-files",
      `--window-size=${w},${h}`,
    ],
    env: { ...process.env, DISPLAY: "" },
  })

  const page = await browser.newPage()
  await page.setViewport({ width: w, height: h, deviceScaleFactor: 1 })

  const logs = []
  page.on("console", (m) => logs.push(`[${m.type()}] ${m.text()}`))
  page.on("pageerror", (e) => logs.push(`[pageerror] ${e.message}`))

  /**
   * ⚠️ v1.3.85 修正：`?env=` 是**不存在的参数**。
   *
   * 页面侧（src/index.ts）只读 `debug`，从不读 `env`；场景由
   * `Settings.get().scene` 决定，默认值 `"snow"`。所以此前用
   * `?env=<scene>` 拍的 14 张「基线图」实际**全是雪山**——这正是
   * 「改了几十版画面没变化」在验证环节的根因：量具本身是坏的。
   *
   * 正确做法是在页面就绪后运行时调 `view.applyScene(scene)`。
   * 下面先 goto 一个中性 URL，再切场景；切完由 `sceneSwitch` 自检。
   */
  const url = `file://${DIST}/play.html?debug=1&bot=Professional`
  await page.goto(url, { waitUntil: "load", timeout: 120000 })

  // 等容器就绪（index.ts 在 ?debug=1 时挂 globalThis.__bc）
  /**
   * ⚠️ v1.3.88：就绪判定必须**重试 + 看门狗**，不能只等一次。
   *
   * 实测（probe-boot.js）：同一份 dist、同一个 URL，`__bc.container.view` 的
   * 就绪时刻在 SwiftShader 软渲染下能从 5s 漂到 **25s 以上**（CPU 抢占、
   * profile 冷启动、GLTF 解码都会拖）。`waitForFunction` 超时 90s 却在
   * 25s 就放弃过 —— 因为 `page.evaluate` 抛的 `Target closed` 被 catch 吞掉，
   * 直接走了 `ready=false` 分支。
   *
   * 现在改成：分片轮询，每片 15s，最多 6 片（≈90s）；只有**明确判定
   * 页面已崩**（连续两片 evaluate 抛异常）才提前放弃。
   */
  let ready = false
  let evalFails = 0
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
      view: !!view,
      scene: !!(view && view.scene),
      camera: !!(view && view.camera),
      renderer: !!r,
      gl: !!gl,
    }
  }
  for (let i = 0; i < 6 && !ready; i++) {
    const st = await page
      .evaluate(READY_PROBE)
      .then((v) => v)
      .catch((e) => {
        evalFails++
        return { ok: false, why: "evaluate 失败: " + e.message }
      })
    if (st.ok) {
      ready = true
      if (i > 0) console.log(`   （容器第 ${i + 1} 片就绪）`)
      break
    }
    if (i === 0) console.log(`   容器状态: ${JSON.stringify(st)}`)
    if (evalFails >= 2) {
      console.error("页面实例已不可访问（连续 evaluate 失败），提前放弃。")
      break
    }
    await new Promise((r) => setTimeout(r, 15000))
  }

  if (!ready) {
    console.error("容器未就绪。页面日志：")
    console.error(logs.slice(-25).join("\n"))
    await browser.close()
    process.exit(2)
  }

  // 等首帧渲染 + 环境构建完成
  await new Promise((r) => setTimeout(r, settle))

  /**
   * 运行时切换场景（`?env=` 不存在，见上方说明）。
   *
   * `applyScene` 由 `Settings.get().scene` 之外显式传入 sceneId —— 它内部
   * 会重建 `sceneEnv`（走 Assets 的 envCache），并重设光照/雾/远裁剪/色调映射。
   * 切完必须**自检**：读回 `sceneEnv.name` 确认真的换了，而不是静默失败。
   */
  const sceneSwitch = await page.evaluate((sc) => {
    const view = globalThis.__bc.container.view
    try {
      if (typeof view.applyScene !== "function") {
        return { ok: false, why: "view.applyScene 不存在" }
      }
      view.applyScene(sc)
      const env = view.sceneEnv
      return {
        ok: true,
        requested: sc,
        envName: env ? env.name || "(未命名)" : null,
        envChildren: env ? env.children.length : null,
      }
    } catch (e) {
      return { ok: false, why: e.message }
    }
  }, scene)

  if (!sceneSwitch.ok) {
    console.error(`场景切换失败：${sceneSwitch.why}`)
    await browser.close()
    process.exit(3)
  }
  console.log(
    `   场景: 请求 "${sceneSwitch.requested}" → sceneEnv.name="${sceneSwitch.envName}" ` +
      `(${sceneSwitch.envChildren} 个子节点)`
  )
  if (!sceneSwitch.envName) {
    console.error(
      `⚠️ sceneEnv 为 null —— 场景 "${scene}" 没有几何环境，拍到的不是目标场景。`
    )
  }

  // 切场景后需要再等一帧重建完成
  await new Promise((r) => setTimeout(r, 900))

  // 摆相机
  /**
   * ⚠️ 关键：`view.update()` 每帧都会调 `camera.update(elapsed, aim)` 把相机
   * 位置重置回它自己的机位。所以「自定义机位」不能只设一次 —— 必须**劫持**
   * `camera.update`，让它在我们的目标机位上收敛，否则下一帧就被覆盖。
   */
  const patched = await page.evaluate((vn, sc) => {
    const view = globalThis.__bc.container.view
    const camWrap = view.camera
    const c = camWrap.camera || camWrap
    try {
      /**
       * ⚠️ `aim` / `top` 的机位必须用**真实的 AimEvent 驱动**（v1.3.85 修正）。
       *
       * 教训：此前这里只调 `camWrap.forceMode("aim")`。但 `forceMode` **只
       * 切换模式标记**，真正摆机位的是 `forceMove(aim)` → `aimView(aim,1)`，
       * 而后者需要一个 `AimEvent`。少了它，相机压根不动 —— 实测停在
       * `[0, 0, 9.56]`，那是**俯视高度**，不是瞄准视角。
       * 所以此前所有 `--view aim` 的图其实都是俯视图。
       */
      if (vn === "aim") {
        /**
         * ✅ v1.3.85 二次修正：**不要自己编 AimEvent**，用游戏自己的。
         *
         * 上一版用 `angle: Math.PI/2` 手工构造 AimEvent 驱动 `aimView`，
         * 结果拍出来构图不对（台面占画面下半 2/3、白球偏左、几乎看不到
         * 环境）—— 因为真实玩家瞄准时相机是**跟着球杆朝向走的**，还有
         * `aimSlider` 的高度、插值收敛时间等一堆状态。
         *
         * 现在的前提已经变了：`Init` / `WatchShot` 的摆球泄漏修好后，
         * 页面进入 aiming 态就会**自己**把相机摆到正确的瞄准机位。
         * 所以这里最忠实的做法是——**什么都不做，只截屏**。
         *
         * 但 `view.update()` 每帧都要一个 aim 事件，我们不能让它拿不到。
         * 于是：只做「保持模式」这一件最小的事，其余交给页面。
         */
        camWrap.forceMode("aim")
        const balls = (view.table && view.table.balls) || []
        const cue =
          balls.find((b) => b && b.label === 0) || view.table?.cueball || balls[0]
        const cp = cue && cue.pos
        return `aimView(native) cue@(${cp ? cp.x.toFixed(3) : "?"},${
          cp ? cp.y.toFixed(3) : "?"
        }) fov=${c.fov.toFixed(1)}`
      }
      if (vn === "top") {
        camWrap.forceMode("top")
        camWrap.update = function () {
          camWrap.topView(null)
        }
        camWrap.update(0, null)
        return `topView(hijacked)`
      }
      // v1.3.100：远台跟随视角 —— 劫持 update 调 farView（跟随球杆方向）。
      // 需要真实 AimEvent 驱动（同 aim 分支），这里取游戏自己的 aim。
      // farView 内部用 lerp(…,0.12) 平滑到位，主动多跑几帧让它收敛。
      if (vn === "far") {
        const aim =
          (view.table && view.table.cue && view.table.cue.aim) || null
        if (!aim) return `farView(ERROR: no aim event)`
        camWrap.update = function () {
          camWrap.farView(aim)
        }
        for (let i = 0; i < 80; i++) camWrap.update(16, null)
        return `farView(follow) cue@(${aim.pos.x.toFixed(2)},${aim.pos.y.toFixed(
          2
        )}) angle=${(aim.angle * 180 / Math.PI).toFixed(1)}° pos=(${c.position.x.toFixed(
          2
        )},${c.position.y.toFixed(2)},${c.position.z.toFixed(2)}) fov=${c.fov.toFixed(1)}`
      }
      // free：劫持 update，摆场景总览机位（v1.3.90b 真实比例球场）
      // 球桌在 XY 平面、Z 向上。篮球场 28×15m、足球场 105×68m，总览机位
      // 必须退到足够远才能把整场 + 两端器材框进来。
      const FREE = {
        // 篮球场：从本端看台高处（馆内）斜向俯瞰全场与远端篮筐。
        // 体育馆是封闭空间，相机必须在墙内（墙在 y=±13、x=±19），否则看到墙背面被剔除。
        basketball: { pos: [0, -10, 8.5], look: [0, 7, 2.5], fov: 75 },
        // 足球场：105m×68m 太大，透视下从端线看会把远端压成细线；
        // 改用略带倾角的顶视图，场地几乎撑满画面，比例关系最清晰。
        football:   { pos: [0, 0, 60], look: [0, 0, 0], fov: 90 },
        // room：复刻参考图机位 —— 从 +Y 长边侧、离地 ~2.55m 斜俯视，
        // 视线沿 −Y：远端 −Y 墙两角的落地灯/边几、±X 墙沙发左右入画，
        // 构图与用户参考图（豆包 AI 生成图）1:1 对应。
        room:       { pos: [0, 3.3, 1.75], look: [0, -0.4, 0.1], fov: 55 },
        default:    { pos: [0, -7.2, 3.4], look: [0, 0.2, 0.85], fov: 55 },
      }
      const TARGET = FREE[sc] || FREE.default
      const origUpdate = camWrap.update.bind(camWrap)
      camWrap.update = function () {
        /* 故意不调 origUpdate —— 它会重置机位 */
        c.position.set(TARGET.pos[0], TARGET.pos[1], TARGET.pos[2])
        c.lookAt(TARGET.look[0], TARGET.look[1], TARGET.look[2])
        c.fov = TARGET.fov
        c.updateProjectionMatrix()
      }
      camWrap.update(0, null)
      return "free(hijacked update)"
    } catch (e) {
      return "error:" + e.message
    }
  }, viewName, scene)

  await new Promise((r) => setTimeout(r, 700))

  /**
   * v1.3.88：--nodialog —— 关掉欢迎弹窗（「知道了，开始」）。
   *
   * 弹窗是 DOM 元素，居中悬浮在画面中带（py 180~330），正好压住
   * basketball 三秒区漆面 / football 围挡这些新特征物的落位带。
   * 双保险：① 找含「知道了」文本的叶子节点派发冒泡 click；
   * ② 从命中点向上找宽 >260px 的容器直接 display:none（防框架
   * 事件绑定不在叶子节点上时点击无效）。
   */
  if (flag("nodialog")) {
    // 循环 3 遍：欢迎弹窗 → 第 1/2 步教学提示 → ……（关掉一个冒出下一个）
    // ⚠️ 容器宽度必须 <0.75×视口宽 才允许隐藏：曾因无上限把整页根容器
    // 藏掉渲染出全白图（横屏 1200 与竖屏 540 双双中招）。
    for (let round = 0; round < 3; round++) {
      const removed = await page.evaluate(() => {
        let n = 0
        const els = [...document.querySelectorAll("body *")]
        // 只匹配弹窗/教学提示的独有文案，避免命中常驻 UI 文本
        const re = /知道了|第\s*\d+\s*步|欢迎/
        for (const el of els) {
          if (el.children.length !== 0) continue
          if (!re.test(el.textContent || "")) continue
          let p = el.parentElement
          for (let i = 0; i < 6 && p; i++) {
            // 下限 100：横屏下欢迎弹窗只有 ~140px 宽（竖屏 ~380px），
            // 260 的旧下限会让横屏弹窗漏网；上限挡根容器防全白
            if (p.offsetWidth > 100 && p.offsetWidth < innerWidth * 0.75) {
              p.style.display = "none"
              n++
              break
            }
            p = p.parentElement
          }
        }
        return n
      })
      if (!removed) break
      await new Promise((r) => setTimeout(r, 350))
    }
    // v1.3.97：教学横幅的收起态小标签（.tutorial-banner，~30x18 深色圆点）
    // 自身无可匹配文案，上面的主循环漏网；它压在画面中带（横竖屏都居中）
    // 曾被误判为「3D 场景黑色悬浮物」。真实对局里它属正常 UI，仅截图时隐藏。
    await page.evaluate(() => {
      for (const el of document.querySelectorAll(".tutorial-banner")) {
        el.style.display = "none"
      }
    })
  }

  /**
   * ⚠️⚠️ v1.3.88 关键修正：截图前必须**强制同步渲染一帧**。
   *
   * ## 教训（这是「八场景拍了全是雪山」的真正根因）
   *
   * `--view aim` 分支只调了 `camWrap.forceMode("aim")`。而 `forceMode` 只改
   * 相机**模式标记**（`camera.ts:438`），**不摆机位、也不产生新帧**：
   *
   *     forceMode(mode) {
   *       if (mode !== this.aimView) this.restoreSavedDistance()
   *       this.mode = mode
   *       this.mainMode = mode
   *       ...
   *     }
   *
   * 真正摆机位的是 `forceMove(aim)` → `aimView(aim, 1)`，需要一个 AimEvent；
   * 而页面在 aiming 态自己每帧调 `camera.update()` 收敛。
   *
   * 问题在于 **`page.screenshot()` 抓的是最后一次合成出来的帧**。切场景后
   * 我们只等了 900+700ms，如果这期间页面没再提交新帧（SwiftShader 软渲染
   * 下 rAF 可能被节流），抓到的就是**切场景之前的旧帧** —— 于是明明
   * `sceneEnv.name === "Office"`，像素上却是上一张雪山。
   *
   * 这解释了那个极其矛盾的观测：**自检全过、图是雪山**。
   *
   * 修复：截图前显式 `renderer.render(scene, camera)` 一次，确保帧内容 =
   * 当前 scene 图。这一步是幂等的，对已经正确的场景无副作用。
   */
  await page.evaluate(() => {
    const view = globalThis.__bc.container.view
    const cam = view.camera.camera || view.camera
    cam.updateMatrixWorld(true)
    // 再走一次页面自己的尺寸/视口逻辑，避免残留的 scissor 裁掉内容
    view.ensureRendererAndRender?.()
    view.renderer?.render(view.scene, cam)
    view.renderer?.getContext?.()?.finish?.()
  })
  await new Promise((r) => setTimeout(r, 250))

  // 取渲染诊断
  const diag = await page.evaluate(() => {
    const view = globalThis.__bc.container.view
    const r = view.renderer
    const gl = r.getContext()
    const info = r.info
    return {
      glVersion: gl.getParameter(gl.VERSION),
      drawCalls: info && info.render ? info.render.calls : null,
      triangles: info && info.render ? info.render.triangles : null,
      sceneChildren: view.scene.children.length,
      camPos: view.camera.camera
        ? view.camera.camera.position.toArray().map((v) => +v.toFixed(2))
        : null,
      pixelRatio: r.getPixelRatio ? r.getPixelRatio() : null,
    }
  })

  const shotName = `${scene}_${viewName}${tag ? "_" + tag : ""}.png`
  const outPath = path.join(outDir, shotName)
  await page.screenshot({ path: outPath, type: "png" })

  /**
   * ⚠️ 像素级自检（v1.3.85 新增）。
   *
   * 教训：上一轮 8 个场景 `aim` 机位三角面数**完全相同**（都是 55226），
   * 我当时判为「环境不入画」。实际上真正的原因是场景压根没切。
   * 只要不同场景在同一机位下三角面数**一模一样**，就高度可疑。
   *
   * 这里给出三项可在多场景间横向比对的指纹：
   *   - triangles    三角面数（场景几何的直接体现，室内三件套应互不相同）
   *   - envName      场景环境名（Room / Office / Cybercafe …）
   *   - envTris      仅统计 sceneEnv 子树的三角面数（真正代表"这个场景"）
   * 三项都打进 JSONL 便于批量比对。
   */
  const fingerprint = await page.evaluate(() => {
    const view = globalThis.__bc.container.view
    const r = view.renderer
    const tri = (root) => {
      let n = 0
      root.traverse((o) => {
        const g = o.geometry
        if (!g || !g.attributes || !g.attributes.position) return
        const c = g.index ? g.index.count : g.attributes.position.count
        n += c / 3
      })
      return Math.round(n)
    }
    const env = view.sceneEnv
    return {
      triangles: r.info && r.info.render ? r.info.render.triangles : null,
      envName: env ? env.name || null : null,
      envTris: env ? tri(env) : null,
      wholeSceneTris: tri(view.scene),
      hasEnvMap: !!(view.scene.environment && view.scene.environment.isTexture),
      toneMapping: r.toneMapping,
      exposure: r.toneMappingExposure,
      shadowMapEnabled: r.shadowMap ? r.shadowMap.enabled : null,
      lights: view.scene.children
        .filter((o) => o.isLight)
        .map((o) => ({
          type: o.type,
          intensity: +o.intensity.toFixed(4),
          visible: o.visible,
          color: "#" + o.color.getHexString(),
        })),
    }
  })

  const meta = {
    scene,
    view: viewName,
    file: shotName,
    requested: sceneSwitch.requested,
    ...fingerprint,
    camPos: diag.camPos,
    glVersion: diag.glVersion,
    pixelRatio: diag.pixelRatio,
  }

  // JSONL 追加（多场景横向比对的唯一可靠来源）
  const metaPath = path.join(outDir, "_meta.jsonl")
  fs.appendFileSync(metaPath, JSON.stringify(meta) + "\n")

  console.log(`✅ ${shotName}`)
  console.log(`   场景: 请求 "${scene}" → "${fingerprint.envName}"`)
  console.log(`   相机: ${patched}`)
  console.log(
    `   WebGL: ${diag.glVersion} | draw calls: ${diag.drawCalls} | ` +
      `三角面: ${diag.triangles} (场景环境 ${fingerprint.envTris})`
  )
  console.log(`   场景子节点: ${diag.sceneChildren} | 相机位置: ${JSON.stringify(diag.camPos)}`)

  /**
   * ⚠️ 机位生效性自检（v1.3.85）。
   *
   * 教训：`--view aim` 曾因为只调 `forceMode` 而**停在俯视高度 z=9.56**，
   * 拍出来全是俯视图，却被当成瞄准视角用了很久。
   * 这里对每个机位给出预期高度区间，不符就显著告警。
   */
  const cz = diag.camPos ? diag.camPos[2] : null
  const EXPECT = {
    aim: { min: 0.1, max: 1.2, why: "瞄准视角：贴地平视，相机 z 应在 0.1~1.2m" },
    top: { min: 3, max: 30, why: "俯视：相机 z 应在 3~30m" },
    free: { min: 2, max: 8, why: "free：自定义斜俯视，z≈3.4" },
    far: { min: 0.9, max: 1.3, why: "far：远台跟随机位，相机 z≈1.10" },
  }[viewName]
  if (EXPECT && cz !== null) {
    if (cz < EXPECT.min || cz > EXPECT.max) {
      console.log(
        `   ⚠️⚠️ 机位可疑：相机 z=${cz} 不在预期 [${EXPECT.min}, ${EXPECT.max}]。`
      )
      console.log(`         ${EXPECT.why}`)
      console.log(`         —— 这很可能是「以为拍到了 A，其实拍到 B」，请先排查！`)
    } else {
      console.log(`   ✓ 机位自检通过（z=${cz} ∈ [${EXPECT.min}, ${EXPECT.max}]）`)
    }
  }

  console.log(`   材质指纹: envMap=${fingerprint.hasEnvMap} | ` +
    `tone=${fingerprint.toneMapping}@${fingerprint.exposure} | ` +
    `shadow=${fingerprint.shadowMapEnabled}`)
  console.log(`   光源: ${JSON.stringify(fingerprint.lights)}`)
  console.log(`   输出: ${outPath}`)

  const errs = logs.filter((l) => l.startsWith("[pageerror]") || l.includes("THREE."))
  if (errs.length) {
    console.log(`   ⚠️ 页面告警 ${errs.length} 条：`)
    errs.slice(0, 6).forEach((l) => console.log(`      ${l.slice(0, 160)}`))
  }

  await browser.close()

  /**
   * ⚠️⚠️ v1.3.88 硬闸门：场景切换失败必须**让进程失败退出**。
   *
   * 血的教训：上面第 162 行那句「sceneEnv 为 null」只 `console.error` 就放过去了，
   * 脚本照样退出码 0、照样把 PNG 落盘。结果八个场景的 aim 图**全都是雪山**
   * （Settings 默认场景），却因为「文件名对得上」被当成八个场景的审计依据。
   *
   * 更早的同一类错误（`?env=` 参数不存在）也是这么漏过去的 —— 量具坏了却没人知道。
   * 结论：**验证脚本发现「拍到的不是目标场景」时，唯一正确的动作是失败退出**，
   * 而不是打印一句警告继续截图。
   */
  const problems = []
  if (!sceneSwitch.envName) {
    problems.push(`请求场景 "${scene}" 的 sceneEnv 为 null（该场景没有几何环境）`)
  }
  const list = (fingerprint.envName || "").toLowerCase().replace(/[^a-z]/g, "")
  const want = scene.toLowerCase().replace(/[^a-z]/g, "")
  /**
   * 名字不必逐字符相等（`room` → `Room`、`cybercafe` → `CyberCafe` …），
   * 只要求「目标词」出现在实际环境名里；`cybercaf` 允许被截断匹配。
   */
  if (list && want && !list.includes(want) && !want.includes(list)) {
    problems.push(`请求场景 "${scene}" 实际拿到的是 "${fingerprint.envName}" —— 场景没切过去`)
  }
  if (problems.length) {
    console.error("")
    console.error("❌❌ 场景校验未通过，本次渲染的 PNG 不代表目标场景，已作废：")
    problems.forEach((p) => console.error(`   · ${p}`))
    console.error("   请先排查 applyScene 的切换逻辑，不要拿这张图当证据。")
    process.exit(4)
  }
  console.log(
    `   ✓ 场景自检通过（请求 "${scene}" → 实际 "${fingerprint.envName}"，` +
      `${fingerprint.envTris} 面）`
  )
}

main().catch((e) => {
  console.error("渲染失败:", e.message)
  process.exit(1)
})
