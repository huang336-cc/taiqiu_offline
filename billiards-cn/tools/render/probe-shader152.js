/**
 * v1.5.2 —— 对照实验：关闭 three.js 的 checkShaderErrors 能省多少？
 *
 * 背景（probe-prof152，CPU 6x 降速）：
 *   开始游戏 4459ms，热点第一是 `onFirstUse @three_module.js` 自身耗时 **1233ms（25.5%）**。
 *   该函数正是 three.js WebGLProgram 的 onFirstUse，在 `renderer.debug.checkShaderErrors`
 *   为 true 时同步调用 getProgramInfoLog / getShaderInfoLog —— 强制等待 GPU 完成着色器编译。
 *   three.js 官方建议生产环境设为 false。本项目源码里**从未设置过**（默认 true）。
 *
 * 对照实验（不改产品代码，只在页面里 patch）：
 *   对照 A（基线）  ：原样
 *   对照 B（关闭）  ：把 WebGL2RenderingContext/WebGLRenderingContext 的
 *                     getProgramInfoLog / getShaderInfoLog 替换为空操作
 *                     —— 等价于 checkShaderErrors=false 的效果
 *   对照 C（关+纹理）：同时把程序化纹理生成也跳过（评估纹理这部分的占比）
 *
 * 每组重复 N 次取中位数，避免单次噪声。
 */
const puppeteer = require("puppeteer-core")
const fs = require("fs")
const OUT = "/tmp/v152"
const BASE = process.env.BASE || "http://127.0.0.1:8151/dist"
const RATE = parseInt(process.env.RATE || "6", 10)
const REPEAT = parseInt(process.env.REPEAT || "3", 10)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const PATCH_SHADER = () => {
  for (const proto of [window.WebGL2RenderingContext, window.WebGLRenderingContext]) {
    if (!proto || !proto.prototype) continue
    try {
      proto.prototype.getProgramInfoLog = function () { return "" }
      proto.prototype.getShaderInfoLog = function () { return "" }
      // getShaderParameter / getProgramParameter 仍保留（three 用它查编译状态）
    } catch (e) {}
  }
}

async function measure(base, patch, n) {
  const browser = await puppeteer.launch({
    executablePath: "/usr/bin/google-chrome",
    headless: "new",
    args: [
      "--no-sandbox", "--hide-scrollbars", "--disable-dev-shm-usage", "--no-zygote",
      "--ozone-platform=headless", "--use-gl=angle", "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader", "--user-data-dir=/tmp/chrome-shader152",
      "--in-process-gpu", "--disable-gpu-sandbox", "--window-size=393,851",
    ],
    env: { ...process.env, DISPLAY: "" },
  })
  const times = []
  const errs = []
  for (let i = 0; i < n; i++) {
    const page = await browser.newPage()
    await page.setCacheEnabled(false)
    const client = await page.createCDPSession()
    await client.send("Emulation.setCPUThrottlingRate", { rate: RATE })
    page.on("pageerror", (e) => errs.push(String(e).slice(0, 100)))
    if (patch) await page.evaluateOnNewDocument(patch)
    await page.goto(`${base}/menu.html`, { waitUntil: "domcontentloaded", timeout: 120000 })
    await sleep(1800)
    const t0 = Date.now()
    await page.evaluate(() => { const b = document.getElementById("btnStart"); if (b) b.click() })
    let okSeen = false
    for (let k = 0; k < 900; k++) {
      const ok = await page.evaluate(() => {
        const c = document.querySelector("#viewP1 canvas")
        const l = document.getElementById("view3dLoading")
        return !!(c && c.width > 0 && c.offsetHeight > 0) && (!l || getComputedStyle(l).display === "none")
      }).catch(() => false)
      if (ok) { okSeen = true; break }
      await sleep(50)
    }
    times.push(okSeen ? Date.now() - t0 : -1)
    // 顺带确认画面真渲染出来了（非空白）：取 canvas 像素方差
    const painted = await page.evaluate(() => {
      try {
        const c = document.querySelector("#viewP1 canvas")
        if (!c) return -1
        const gl = c.getContext("webgl2") || c.getContext("webgl")
        if (!gl) return -2
        const px = new Uint8Array(4 * 64)
        gl.readPixels(Math.floor(c.width / 2), Math.floor(c.height / 2), 8, 8, gl.RGBA, gl.UNSIGNED_BYTE, px)
        let sum = 0, sum2 = 0
        for (let i = 0; i < px.length; i += 4) { sum += px[i]; sum2 += px[i] * px[i] }
        const mean = sum / (px.length / 4)
        return Math.round(sum2 / (px.length / 4) - mean * mean)
      } catch (e) { return -3 }
    }).catch(() => -4)
    if (i === 0) console.log(`     首轮画面像素方差: ${painted}（>0 表示真的画出东西了）`)
    await page.close()
    await sleep(500)
  }
  await browser.close()
  const valid = times.filter((t) => t > 0).sort((a, b) => a - b)
  return { times, median: valid.length ? valid[Math.floor(valid.length / 2)] : -1, errs }
}

const median = (a) => { const v = a.filter((x) => x > 0).sort((x, y) => x - y); return v.length ? v[Math.floor(v.length / 2)] : -1 }

async function main() {
  fs.mkdirSync(OUT, { recursive: true })
  console.log(`CPU ${RATE}x 降速，每组 ${REPEAT} 次\n`)
  const res = {}
  console.log("  ── A 基线（原样）──")
  res.base = await measure(BASE, null, REPEAT)
  console.log(`     各次: ${res.base.times.join(" / ")}ms   中位 ${median(res.base.times)}ms`)

  console.log("  ── B 关闭 shader 错误检查（等价 checkShaderErrors=false）──")
  res.noShader = await measure(BASE, PATCH_SHADER, REPEAT)
  console.log(`     各次: ${res.noShader.times.join(" / ")}ms   中位 ${median(res.noShader.times)}ms`)

  const mb = median(res.base.times), mn = median(res.noShader.times)
  console.log(`\n════════ 结论 ════════`)
  console.log(`   基线中位           ${mb}ms`)
  console.log(`   关闭 shader 检查   ${mn}ms`)
  console.log(`   节省               ${mb - mn}ms  (${mb ? (((mb - mn) / mb) * 100).toFixed(1) : "-"}%)`)
  console.log(`   页面错误: 基线 ${res.base.errs.length} / 关闭后 ${res.noShader.errs.length}`)
  if (res.noShader.errs.length) console.log(`     ${JSON.stringify(res.noShader.errs.slice(0, 3))}`)
  fs.writeFileSync(`${OUT}/shader-ab-${RATE}x.json`, JSON.stringify(res, null, 2))
  console.log(`\n明细: ${OUT}/shader-ab-${RATE}x.json`)
}

main().catch((e) => { console.error("探针异常:", e); process.exit(2) })
