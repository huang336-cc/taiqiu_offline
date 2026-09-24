/**
 * v1.3.97 黑椭圆终极定位：复刻 render.js --nodialog 隐藏逻辑，
 * 枚举覆盖 (637,200) 的可见 DOM，逐个隐藏截图看黑椭圆何时消失。
 */
const path = require("path")
const fs = require("fs")
const puppeteer = require("puppeteer-core")

const DIST = "/workspace/dev/source/billiards-cn/dist"
const OUT = "/root/.codebuddy/artifact/room-v1397-probe"

async function main() {
  fs.mkdirSync(OUT, { recursive: true })
  const browser = await puppeteer.launch({
    executablePath: "/usr/bin/google-chrome",
    headless: "new",
    args: [
      "--no-sandbox", "--hide-scrollbars", "--disable-dev-shm-usage", "--no-zygote",
      "--ozone-platform=headless", "--use-gl=angle", "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader", "--user-data-dir=/tmp/chrome-probe-dom2",
      "--in-process-gpu", "--disable-gpu-sandbox", "--allow-file-access-from-files",
      "--window-size=1280,720",
    ],
    env: { ...process.env, DISPLAY: "" },
  })
  const page = await browser.newPage()
  await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 1 })
  await page.goto(`file://${DIST}/play.html?debug=1&bot=Professional`, {
    waitUntil: "load",
    timeout: 120000,
  })
  for (let i = 0; i < 6; i++) {
    const ok = await page
      .evaluate(() => {
        const bc = globalThis.__bc
        const v = bc && bc.container && bc.container.view
        return !!(v && v.scene && v.camera && v.renderer)
      })
      .catch(() => false)
    if (ok) break
    await new Promise((r) => setTimeout(r, 10000))
  }
  await new Promise((r) => setTimeout(r, 3000))
  await page.evaluate(() => globalThis.__bc.container.view.applyScene("room"))
  await new Promise((r) => setTimeout(r, 900))
  await page.evaluate(() => {
    const v = globalThis.__bc.container.view
    const camWrap = v.camera
    const c = camWrap.camera || camWrap
    camWrap.update = function () {
      c.position.set(0, 3.3, 1.75)
      c.lookAt(0, -0.4, 0.1)
      c.fov = 55
      c.updateProjectionMatrix()
    }
    camWrap.update(0, null)
  })
  await new Promise((r) => setTimeout(r, 700))

  // 复刻 render.js --nodialog 隐藏逻辑（逐字一致）
  for (let round = 0; round < 3; round++) {
    const removed = await page.evaluate(() => {
      let n = 0
      const els = [...document.querySelectorAll("body *")]
      const re = /知道了|第\s*\d+\s*步|欢迎/
      for (const el of els) {
        if (el.children.length !== 0) continue
        if (!re.test(el.textContent || "")) continue
        let p = el.parentElement
        for (let i = 0; i < 6 && p; i++) {
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
  await new Promise((r) => setTimeout(r, 500))
  await page.screenshot({ path: path.join(OUT, "dom2_0_repro.png") })
  console.log("shot: dom2_0_repro（应复现黑椭圆）")

  // 枚举 rect 覆盖 (637,200) 的所有可见元素
  const cands = await page.evaluate(() => {
    const px = 637, py = 200
    const out = []
    let idx = 0
    for (const el of document.querySelectorAll("body *")) {
      const cs = getComputedStyle(el)
      if (cs.display === "none" || cs.visibility === "hidden" || +cs.opacity === 0) continue
      const r = el.getBoundingClientRect()
      if (r.width === 0 || r.height === 0) continue
      if (px >= r.x && px <= r.x + r.width && py >= r.y && py <= r.y + r.height) {
        el.setAttribute("data-probe-tag", `P${idx}`)
        out.push({
          tag: `P${idx}`,
          desc: `<${el.tagName.toLowerCase()} class="${String(el.className).slice(0, 50)}">`,
          rect: `(${Math.round(r.x)},${Math.round(r.y)},${Math.round(r.width)}x${Math.round(r.height)})`,
          bg: cs.backgroundColor,
        })
        idx++
      }
    }
    return out
  })
  console.log(`覆盖 (637,200) 的可见元素 ${cands.length} 个（内→外顺序）：`)
  for (const c of cands) console.log(`  [${c.tag}] ${c.desc} rect=${c.rect} bg=${c.bg}`)

  // 逐个隐藏并截图：黑椭圆消失的那个就是元凶
  for (const c of cands) {
    await page.evaluate((tag) => {
      const el = document.querySelector(`[data-probe-tag="${tag}"]`)
      if (el) el.style.display = "none"
    }, c.tag)
    await new Promise((r) => setTimeout(r, 250))
    await page.screenshot({ path: path.join(OUT, `dom2_hide_${c.tag}.png`) })
    // 恢复
    await page.evaluate((tag) => {
      const el = document.querySelector(`[data-probe-tag="${tag}"]`)
      if (el) el.style.display = ""
    }, c.tag)
    await new Promise((r) => setTimeout(r, 150))
  }
  console.log("done")
  await browser.close()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
