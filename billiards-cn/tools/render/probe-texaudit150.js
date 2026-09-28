/**
 * v1.5.0 纹理审计探针（完整流程版）。
 *
 * 必须从 menu.html 点「开始游戏」进入 play.html?<参数>，否则场景不会真正建立。
 * hook 覆盖 three.js 在 WebGL2 下的真实上传路径：texStorage2D（分配）+ texSubImage2D（上传像素），
 * 以及 WebGL1 路径 texImage2D。逐张登记尺寸，输出总量与 Top 明细。
 *
 * 目的：量化「一局游戏占用多少显存」—— 这决定退出时 GPU 回收的成本。
 * headless 是 swiftshader 软件渲染，删纹理是空操作，量不到时间；但**规模**是可以量准的。
 *
 * 用法：node probe-texaudit150.js [play|menu] [等待毫秒]
 */
const puppeteer = require("puppeteer-core")
const DIST = "/workspace/dev/source/billiards-cn/dist"
const TARGET = process.argv[2] || "play"
const WAIT = parseInt(process.argv[3] || process.env.WAIT || "9000", 10)

async function realTap(page, sel) {
  await page.touchscreen.touchStart(5, 5)
  await page.touchscreen.touchEnd()
  await new Promise((r) => setTimeout(r, 80))
  const el = await page.$(sel)
  if (!el) return false
  const box = await el.boundingBox()
  if (!box) return false
  await page.touchscreen.touchStart(box.x + box.width / 2, box.y + box.height / 2)
  await page.touchscreen.touchEnd()
  return true
}

async function main() {
  const browser = await puppeteer.launch({
    executablePath: "/usr/bin/google-chrome",
    headless: "new",
    args: [
      "--no-sandbox", "--hide-scrollbars", "--disable-dev-shm-usage", "--no-zygote",
      "--ozone-platform=headless", "--use-gl=angle", "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader", "--user-data-dir=/tmp/chrome-audit150",
      "--in-process-gpu", "--disable-gpu-sandbox", "--allow-file-access-from-files",
      "--window-size=393,851",
    ],
    env: { ...process.env, DISPLAY: "" },
  })
  const page = await browser.newPage()
  await page.setViewport({ width: 393, height: 851, hasTouch: true, isMobile: true, deviceScaleFactor: 2 })
  page.on("pageerror", (e) => console.log("[pageerror]", e.message))

  await page.evaluateOnNewDocument(() => {
    window.__LIST = []
    const L = window.__LIST
    const rec = (w, h, src) => {
      if (!w || !h) return
      if (w > 65536 || h > 65536) { L.push({ bad: true, w, h, src }); return }
      L.push({ w, h, bytes: Math.round(w * h * 4 * 1.33), src })
    }
    const srcName = (s) => {
      if (!s) return "?"
      if (s.tagName) return s.tagName.toLowerCase() + (s.className ? "." + String(s.className).slice(0, 20) : "")
      if (s.constructor && s.constructor.name) return s.constructor.name
      return "obj"
    }
    const hook = (proto, name) => {
      if (!proto || !proto[name]) return
      const orig = proto[name]
      proto[name] = function (...a) {
        try {
          let w = 0, h = 0, src = name
          if (name === "texImage2D") {
            if (a.length >= 9 && typeof a[3] === "number" && typeof a[4] === "number") { w = a[3]; h = a[4]; src = "texImage2D(像素数组)" }
            else if (a.length >= 6 && a[5] && a[5].width) { w = a[5].width; h = a[5].height; src = "texImage2D(" + srcName(a[5]) + ")" }
          } else if (name === "texStorage2D") {
            w = a[3]; h = a[4]; src = "texStorage2D(分配)"
          } else if (name === "texSubImage2D") {
            // (target, level, xoffset, yoffset, width, height, format, type, pixels)
            // 或 (target, level, xoffset, yoffset, format, type, source)
            if (a.length >= 9 && typeof a[4] === "number" && typeof a[5] === "number") { w = a[4]; h = a[5]; src = "texSubImage2D(像素数组)" }
            else if (a.length >= 7 && a[6] && a[6].width) { w = a[6].width; h = a[6].height; src = "texSubImage2D(" + srcName(a[6]) + ")" }
          } else if (name === "compressedTexImage2D" || name === "compressedTexSubImage2D") {
            w = a[3]; h = a[4]; src = name
          }
          if (w && h) rec(w, h, src)
        } catch (e) {}
        return orig.apply(this, a)
      }
    }
    for (const p of [window.WebGLRenderingContext, window.WebGL2RenderingContext]) {
      if (!p) continue
      for (const n of ["texImage2D", "texStorage2D", "texSubImage2D", "compressedTexImage2D", "compressedTexSubImage2D"]) {
        hook(p.prototype, n)
      }
      const od = p.prototype.deleteTexture
      if (od) { p.prototype.deleteTexture = function (...a) { window.__DEL = (window.__DEL || 0) + 1; return od.apply(this, a) } }
    }
  })

  await page.goto(`file://${DIST}/menu.html`, { waitUntil: "load", timeout: 180000 })
  await new Promise((r) => setTimeout(r, 2500))

  if (TARGET === "play") {
    console.log("从主菜单点『开始游戏』进入对局…")
    const ok = await realTap(page, "#btnStart")
    console.log("点击 btnStart:", ok)
    await new Promise((r) => setTimeout(r, WAIT))
  }

  const out = await page.evaluate(() => {
    const L = window.__LIST || []
    // three.js 自带统计
    let three = null
    try {
      const r = window.__renderer || (window.__view && window.__view.renderer) || null
      if (r && r.info && r.info.memory) three = { textures: r.info.memory.textures, geometries: r.info.memory.geometries }
    } catch (e) {}
    return {
      list: L, del: window.__DEL || 0, url: location.pathname.split("/").pop() + location.search,
      canvases: document.querySelectorAll("canvas").length, three,
    }
  })

  const good = out.list.filter((x) => !x.bad)
  const bad = out.list.filter((x) => x.bad)
  const total = good.reduce((s, x) => s + x.bytes, 0)
  console.log(`\n===== ${TARGET} 纹理审计 =====`)
  console.log(`当前文档: ${out.url} | canvas 数: ${out.canvases} | deleteTexture 调用: ${out.del}`)
  if (out.three) console.log(`three.js renderer.info: 纹理 ${out.three.textures} / geometry ${out.three.geometries}`)
  console.log(`纹理上传调用: ${out.list.length}（合法 ${good.length} / 异常 ${bad.length}）`)
  console.log(`累计显存≈ ${(total / 1024 / 1024).toFixed(1)} MB`)
  console.log(`\n--- Top 20（按显存降序）---`)
  good.sort((a, b) => b.bytes - a.bytes).slice(0, 20).forEach((x, i) => {
    console.log(`${String(i + 1).padStart(2)}. ${x.w}×${x.h} = ${(x.bytes / 1024 / 1024).toFixed(2)}MB  ${x.src}`)
  })
  const g = {}
  good.forEach((x) => { const k = `${x.w}×${x.h}`; g[k] = (g[k] || 0) + 1 })
  console.log(`\n--- 尺寸分布 ---`)
  Object.entries(g).sort((a, b) => b[1] * parseInt(a[0]) - a[1] * parseInt(b[0])).slice(0, 20).forEach(([k, v]) => console.log(`  ${k}: ${v} 次`))
  if (bad.length) { console.log(`\n--- 异常尺寸 ---`); bad.slice(0, 8).forEach((x) => console.log(`  w=${x.w} h=${x.h} ${x.src}`)) }
  await browser.close()
  process.exit(0)
}
main().catch((e) => { console.error(e); process.exit(2) })
