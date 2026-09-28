/**
 * v1.5.2 —— WebGL 启动规模统计 + 渲染真实性确认。
 *
 * 要回答：
 *   1. 画面到底渲染出来没有？（截图 + 像素方差）—— 上一轮像素方差=0，必须确认不是空渲染
 *   2. 启动时编译了多少个 shader program？（决定「减少编译次数」的收益上限）
 *   3. 上传了多少纹理、多大？（决定「纹理优化」的收益上限）
 *   4. 这些事发生在什么时间窗内？（对齐到时间轴）
 */
const puppeteer = require("puppeteer-core")
const fs = require("fs")
const OUT = "/tmp/v152"
const BASE = process.env.BASE || "http://127.0.0.1:8151/dist"
const LABEL = process.env.LABEL || "v1.5.1"
const RATE = parseInt(process.env.RATE || "6", 10)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function main() {
  fs.mkdirSync(OUT, { recursive: true })
  const browser = await puppeteer.launch({
    executablePath: "/usr/bin/google-chrome",
    headless: "new",
    args: [
      "--no-sandbox", "--hide-scrollbars", "--disable-dev-shm-usage", "--no-zygote",
      "--ozone-platform=headless", "--use-gl=angle", "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader", "--user-data-dir=/tmp/chrome-glstats152",
      "--in-process-gpu", "--disable-gpu-sandbox", "--window-size=393,851",
    ],
    env: { ...process.env, DISPLAY: "" },
  })
  const page = await browser.newPage()
  await page.setCacheEnabled(false)
  const client = await page.createCDPSession()
  await client.send("Emulation.setCPUThrottlingRate", { rate: RATE })

  // hook WebGL：统计 program / 纹理上传 / drawcall
  await page.evaluateOnNewDocument(() => {
    window.__gl = { programs: [], textures: [], drawCalls: 0, t0: performance.now() }
    const hook = (protoName) => {
      const P = window[protoName]
      if (!P || !P.prototype) return
      const p = P.prototype
      const origCreateProgram = p.createProgram
      const origLinkProgram = p.linkProgram
      const origShaderSource = p.shaderSource
      const origTexImage = p.texImage2D
      const origTexSub = p.texSubImage2D
      const origDrawElements = p.drawElements
      const origDrawArrays = p.drawArrays
      let pendingSrc = null
      if (origShaderSource) p.shaderSource = function (sh, src) { pendingSrc = src; return origShaderSource.apply(this, arguments) }
      if (origCreateProgram) p.createProgram = function () { const r = origCreateProgram.apply(this, arguments); return r }
      if (origLinkProgram) p.linkProgram = function (prog) {
        const a = performance.now()
        const r = origLinkProgram.apply(this, arguments)
        const b = performance.now()
        // 估算着色器规模
        window.__gl.programs.push({ t: Math.round(a - window.__gl.t0), linkMs: Math.round(b - a), srcLen: (pendingSrc || "").length })
        return r
      }
      let texN = 0
      if (origTexImage) p.texImage2D = function () {
        const a = performance.now()
        const r = origTexImage.apply(this, arguments)
        const b = performance.now()
        const w = arguments[3], h = arguments[4]
        if (typeof w === "number" && typeof h === "number") {
          window.__gl.textures.push({ t: Math.round(a - window.__gl.t0), ms: Math.round(b - a), w, h, kind: "texImage2D" })
        }
        return r
      }
      if (origTexSub) p.texSubImage2D = function () {
        const a = performance.now()
        const r = origTexSub.apply(this, arguments)
        const b = performance.now()
        const w = arguments[4], h = arguments[5]
        if (typeof w === "number" && typeof h === "number") {
          window.__gl.textures.push({ t: Math.round(a - window.__gl.t0), ms: Math.round(b - a), w, h, kind: "texSubImage2D" })
        }
        return r
      }
      if (origDrawElements) p.drawElements = function () { window.__gl.drawCalls++; return origDrawElements.apply(this, arguments) }
      if (origDrawArrays) p.drawArrays = function () { window.__gl.drawCalls++; return origDrawArrays.apply(this, arguments) }
    }
    hook("WebGL2RenderingContext")
    hook("WebGLRenderingContext")
  })

  await page.goto(`${BASE}/menu.html`, { waitUntil: "domcontentloaded", timeout: 120000 })
  await sleep(1800)
  const t0 = Date.now()
  await page.evaluate(() => { const b = document.getElementById("btnStart"); if (b) b.click() })
  for (let k = 0; k < 900; k++) {
    const ok = await page.evaluate(() => {
      const c = document.querySelector("#viewP1 canvas")
      const l = document.getElementById("view3dLoading")
      return !!(c && c.width > 0 && c.offsetHeight > 0) && (!l || getComputedStyle(l).display === "none")
    }).catch(() => false)
    if (ok) break
    await sleep(50)
  }
  const tScene = Date.now() - t0
  await sleep(1500)

  const gl = await page.evaluate(() => window.__gl || {}).catch(() => ({}))
  await page.screenshot({ path: `${OUT}/scene-${LABEL}.png` })
  // 用 canvas 导出判断画面非空
  const paint = await page.evaluate(() => {
    try {
      const c = document.querySelector("#viewP1 canvas")
      if (!c) return { err: "no canvas" }
      const off = document.createElement("canvas")
      off.width = 64; off.height = 64
      const ctx = off.getContext("2d")
      ctx.drawImage(c, 0, 0, 64, 64)
      const d = ctx.getImageData(0, 0, 64, 64).data
      let sum = 0, sum2 = 0, n = 0
      for (let i = 0; i < d.length; i += 4) { sum += d[i]; sum2 += d[i] * d[i]; n++ }
      const mean = sum / n
      return { variance: Math.round(sum2 / n - mean * mean), mean: Math.round(mean) }
    } catch (e) { return { err: String(e).slice(0, 80) } }
  }).catch((e) => ({ err: String(e).slice(0, 60) }))

  console.log(`\n════════ ${LABEL} WebGL 启动规模（CPU ${RATE}x）════════`)
  console.log(`  点击→场景就绪: ${tScene}ms`)
  console.log(`  画面确认: ${JSON.stringify(paint)}  ${paint.variance > 0 ? "✓ 画面有内容（非纯色）" : "⚠ 画面为纯色/空白"}`)
  console.log(`  截图: ${OUT}/scene-${LABEL}.png`)

  const progs = gl.programs || []
  const texs = gl.textures || []
  console.log(`\n  ── Shader Program 编译：${progs.length} 个 ──`)
  const slow = progs.slice().sort((a, b) => b.linkMs - a.linkMs)
  for (const p of slow.slice(0, 10)) {
    console.log(`     link ${String(p.linkMs).padStart(5)}ms  t=${String(p.t).padStart(5)}ms  srcLen=${p.srcLen}`)
  }
  const sumLink = progs.reduce((s, p) => s + p.linkMs, 0)
  console.log(`     link 累计 ${sumLink}ms（注：linkProgram 返回不代表编译完成，实际编译在首次使用/onFirstUse 触发）`)

  console.log(`\n  ── 纹理上传：${texs.length} 次 ──`)
  const big = texs.slice().sort((a, b) => b.ms - a.ms)
  for (const t of big.slice(0, 10)) {
    console.log(`     ${String(t.ms).padStart(5)}ms  t=${String(t.t).padStart(5)}ms  ${t.w}×${t.h}  ${t.kind}`)
  }
  const sumTex = texs.reduce((s, t) => s + t.ms, 0)
  const pixels = texs.reduce((s, t) => s + (t.w || 0) * (t.h || 0), 0)
  console.log(`     上传累计 ${sumTex}ms，总像素 ${(pixels / 1048576).toFixed(1)}M`)
  console.log(`\n  DrawCall（就绪后 1.5s 内累计）: ${gl.drawCalls || 0}`)

  fs.writeFileSync(`${OUT}/glstats-${LABEL}-${RATE}x.json`, JSON.stringify({ label: LABEL, tScene, paint, gl }, null, 2))
  console.log(`\n明细: ${OUT}/glstats-${LABEL}-${RATE}x.json`)
  await browser.close()
}

main().catch((e) => { console.error("探针异常:", e); process.exit(2) })
