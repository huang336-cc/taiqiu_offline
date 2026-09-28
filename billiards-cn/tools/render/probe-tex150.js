/**
 * v1.5.0 显存 / 纹理成本探针。
 *
 * 为什么需要它：v1.4.7/1.4.8/1.4.9 连续三版都栽在同一个盲区上 —— headless 用 swiftshader
 * **软件渲染**，GPU 侧操作（上传 / 删除纹理）几乎是空操作，所以「耗时」类指标在容器里
 * 永远测不出真机行为。既然量不到时间，就量**规模**：
 *
 *   真机 GPU 回收 N 张纹理的耗时 ≈ f(总显存字节数)
 *
 * 本探针直接 hook WebGL 纹理 API，精确统计每个文档创建的纹理张数与累计显存字节数
 * （含 mipmap 1.33 系数），并统计 canvas 2D 贴图的绘制规模。拿到这个数字，就能判断
 * 「退出时浏览器回收几百 MB 显存导致主线程冻结 3.5 秒」这一假设是否成立。
 *
 * 同时用 CDP Emulation.setCPUThrottlingRate 模拟中低端手机 CPU，
 * 分段测量：页面解析 / 首帧就绪 / 皮肤预览渲染，用于判断另一端（menu 侧）的成本。
 *
 * 用法：
 *   node probe-tex150.js                # 默认无 throttle
 *   THROTTLE=6 node probe-tex150.js     # 6 倍 CPU 降速，模拟中端手机
 *   LOOPS=3 node probe-tex150.js
 */
const puppeteer = require("puppeteer-core")

const DIST = "/workspace/dev/source/billiards-cn/dist"
const LOOPS = parseInt(process.env.LOOPS || "3", 10)
const THROTTLE = parseInt(process.env.THROTTLE || "1", 10)

async function newBrowser() {
  return puppeteer.launch({
    executablePath: "/usr/bin/google-chrome",
    headless: "new",
    args: [
      "--no-sandbox", "--hide-scrollbars",
      "--disable-dev-shm-usage", "--no-zygote", "--ozone-platform=headless",
      "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader",
      "--user-data-dir=" + (process.env.CHROME_DIR || "/tmp/chrome-tex150"),
      "--in-process-gpu", "--disable-gpu-sandbox",
      "--allow-file-access-from-files", "--window-size=393,851",
    ],
    env: { ...process.env, DISPLAY: "" },
  })
}

async function realTap(page, sel) {
  await page.touchscreen.touchStart(5, 5)
  await page.touchscreen.touchEnd()
  await new Promise((r) => setTimeout(r, 60))
  const el = await page.$(sel)
  if (!el) return false
  const box = await el.boundingBox()
  if (!box) return false
  await page.touchscreen.touchStart(box.x + box.width / 2, box.y + box.height / 2)
  await page.touchscreen.touchEnd()
  return true
}

async function main() {
  const browser = await newBrowser()
  const page = await browser.newPage()
  await page.setViewport({ width: 393, height: 851, hasTouch: true, isMobile: true, deviceScaleFactor: 2 })

  const reports = []
  const errs = []
  page.on("console", (m) => {
    const t = m.text()
    if (t.startsWith("TEXSTAT ")) reports.push(t.slice(8))
    else if (t.startsWith("MARK ")) reports.push(t)
    else if (m.type() === "error" && !/wave\.jpg|Failed to load resource/.test(t)) errs.push("[console] " + t)
  })
  page.on("pageerror", (e) => errs.push("[pageerror] " + e.message))

  // ★ 核心：hook WebGL 纹理 API，统计规模
  await page.evaluateOnNewDocument(() => {
    window.__TEX = { texCount: 0, bytes: 0, canvasBytes: 0, canvasCount: 0, deletes: 0, maxSide: 0 }
    const S = window.__TEX

    const hookProto = (proto, name) => {
      if (!proto || !proto[name]) return
      const orig = proto[name]
      proto[name] = function (...a) {
        try { sizeOf(name, a) } catch (e) {}
        return orig.apply(this, a)
      }
    }
    const sizeOf = (name, a) => {
      let w = 0, h = 0
      if (name === "texImage2D") {
        // 重载1: (target, level, internalformat, width, height, border, format, type, pixels)
        // 重载2: (target, level, internalformat, format, type, source)
        if (a.length >= 9 && typeof a[3] === "number") { w = a[3]; h = a[4] }
        else {
          const src = a[5]
          if (src && src.width) { w = src.width; h = src.height }
        }
      } else if (name === "texStorage2D") { w = a[2]; h = a[3] }
      else if (name === "compressedTexImage2D") { w = a[3]; h = a[4] }
      if (!w || !h) return
      // 4 字节/像素，mipmap 约 1.33 倍
      const b = Math.round(w * h * 4 * 1.33)
      S.texCount++
      S.bytes += b
      if (Math.max(w, h) > S.maxSide) S.maxSide = Math.max(w, h)
    }
    for (const p of [window.WebGLRenderingContext, window.WebGL2RenderingContext]) {
      if (!p) continue
      for (const n of ["texImage2D", "texStorage2D", "compressedTexImage2D"]) hookProto(p.prototype, n)
      const od = p.prototype.deleteTexture
      if (od) p.prototype.deleteTexture = function (...a) { S.deletes++; return od.apply(this, a) }
    }
    // canvas 2D 贴图源（程序化贴图的绘制成本）
    const occ = window.HTMLCanvasElement.prototype.getContext
    window.HTMLCanvasElement.prototype.getContext = function (type, ...rest) {
      const ctx = occ.call(this, type, ...rest)
      if (ctx && /2d/.test(String(type))) {
        const osw = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, "width")
        try {
          Object.defineProperty(this, "width", {
            get() { return osw.get.call(this) },
            set(v) {
              osw.set.call(this, v)
              if (v > 0 && this.height > 0) { S.canvasCount++; S.canvasBytes += v * this.height * 4 }
            },
            configurable: true,
          })
        } catch (e) {}
      }
      return ctx
    }

    const mb = (b) => (b / 1024 / 1024).toFixed(1) + "MB"
    const dump = (tag) => {
      try {
        console.log(
          `TEXSTAT ${tag} 纹理=${S.texCount}张 显存≈${mb(S.bytes)} 最大边=${S.maxSide}` +
          ` 2D画布=${S.canvasCount}个/${mb(S.canvasBytes)} delete=${S.deletes}`
        )
      } catch (e) {}
    }
    window.__dumpTex = dump
    // 导航离开前（旧文档对象仍存活）上报本页累计
    window.addEventListener("beforeunload", () => dump("卸载[" + (location.pathname.split("/").pop() || "") + "]"))
    window.addEventListener("load", () => setTimeout(() => dump("就绪[" + (location.pathname.split("/").pop() || "") + "]"), 800))
    // 页面内就绪自检（不依赖 puppeteer 轮询，避免 swiftshader 渲染循环推迟）
    const mark = (name) => console.log("MARK " + name + " " + Date.now())
    const selfCheck = (cond, name) => {
      let done = false
      const tick = () => {
        if (done) return
        let ok = false
        try { ok = cond() } catch (e) { ok = false }
        if (ok) { done = true; mark(name) } else requestAnimationFrame(tick)
      }
      requestAnimationFrame(tick)
    }
    if (location.pathname.indexOf("play.html") >= 0) {
      selfCheck(() => {
        const c = document.querySelector("#viewP1 canvas")
        const l = document.getElementById("view3dLoading")
        return !!(c && c.width > 0 && c.offsetHeight > 0) && (!l || getComputedStyle(l).display === "none")
      }, "PLAY_READY")
    }
    if (location.pathname.indexOf("menu.html") >= 0) {
      selfCheck(() => {
        const e = document.getElementById("btnStart")
        const r = e && e.getBoundingClientRect()
        return !!(e && r && r.width > 0 && r.height > 0)
      }, "MENU_READY")
    }
    // 捕获点击时刻
    document.addEventListener("click", (e) => {
      const t = e.target
      if (!t || !t.closest) return
      if (location.pathname.indexOf("menu.html") >= 0 && t.closest("#btnStart")) mark("MENU_CLICK")
      if (location.pathname.indexOf("play.html") >= 0 && t.closest("#back-confirm-cn-backdrop .bcbtn.danger")) {
        window.__exitClickAt = performance.now()
        mark("EXIT_CLICK")
      }
    }, true)
    window.addEventListener("beforeunload", () => {
      if (window.__exitClickAt != null) {
        mark("CLICK_TO_UNLOAD:" + Math.round(performance.now() - window.__exitClickAt))
      }
    })
  })

  const client = await page.target().createCDPSession()
  if (THROTTLE > 1) {
    await client.send("Emulation.setCPUThrottlingRate", { rate: THROTTLE })
    console.log(`=== CPU 降速 ${THROTTLE}x（模拟中低端手机）===`)
  } else {
    console.log("=== CPU 无降速（服务器基准）===")
  }

  await page.goto(`file://${DIST}/menu.html`, { waitUntil: "load", timeout: 180000 })
  await new Promise((r) => setTimeout(r, 3000))

  const waitMark = async (name, maxMs) => {
    const lim = Date.now() + (maxMs || 30000)
    while (Date.now() < lim) {
      if (marks.some((m) => m.startsWith(name))) return true
      await new Promise((r) => setTimeout(r, 80))
    }
    return false
  }
  const marks = []
  const origPush = reports.push.bind(reports)
  page.on("console", (m) => { const t = m.text(); if (t.startsWith("MARK ")) marks.push(t.slice(5)) })
  const texOf = async (tag) => {
    try {
      const s = await page.evaluate(() => window.__TEX || null)
      if (!s) return `${tag}: 无 __TEX`
      return `${tag}: 纹理 ${s.texCount} 张 / 显存≈${(s.bytes / 1024 / 1024).toFixed(1)}MB / 最大边 ${s.maxSide}` +
        ` / 2D画布 ${s.canvasCount} 个 ${(s.canvasBytes / 1024 / 1024).toFixed(1)}MB / delete ${s.deletes}`
    } catch (e) { return `${tag}: 读取失败 ${e.message}` }
  }

  for (let i = 1; i <= LOOPS; i++) {
    console.log(`\n---------- 第 ${i} 轮 ----------`)
    reports.length = 0; marks.length = 0

    await realTap(page, "#btnStart")
    const okEnter = await waitMark("PLAY_READY")
    await new Promise((r) => setTimeout(r, 1500))
    console.log("  " + (await texOf("进入后(play)")))
    const mc = marks.find((m) => m.startsWith("MENU_CLICK")), pr = marks.find((m) => m.startsWith("PLAY_READY"))
    const tEnter = mc && pr ? parseInt(pr.split(" ")[1]) - parseInt(mc.split(" ")[1]) : -1

    await realTap(page, "#menu")
    await new Promise((r) => setTimeout(r, 500))
    await realTap(page, "#backToMenu")
    await new Promise((r) => setTimeout(r, 500))
    const okExit = await waitMark("MENU_READY", 40000)
    await new Promise((r) => setTimeout(r, 1500))
    console.log("  " + (await texOf("退出后(menu)")))
    const ec = marks.find((m) => m.startsWith("EXIT_CLICK")), mr = marks.find((m) => m.startsWith("MENU_READY"))
    const tExit = ec && mr ? parseInt(mr.split(" ")[1]) - parseInt(ec.split(" ")[1]) : -1
    const cu = marks.find((m) => m.startsWith("CLICK_TO_UNLOAD"))

    console.log(`  进入端到端=${tEnter}ms 退出端到端=${tExit}ms 同步阻塞=${cu ? cu.split(":")[1] : "?"}ms`)
    reports.filter((r) => r.startsWith("TEXSTAT")).forEach((r) => console.log("  · " + r))
    if (!okEnter || !okExit) console.log("  !! 就绪自检超时 enter=" + okEnter + " exit=" + okExit)
  }

  console.log("\n页面错误:", errs.length ? errs.slice(0, 6) : "无")
  await browser.close()
  process.exit(0)
}

main().catch((e) => { console.error(e); process.exit(2) })
