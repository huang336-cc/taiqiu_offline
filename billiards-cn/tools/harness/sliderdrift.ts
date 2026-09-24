/**
 * 临时验证：细微瞄准条「手指停在右端不动」时角度是否还在自己跑。
 *
 * v1.4.2 修复前：滑条右端距屏幕右边缘恒为 37px，落在贴边自转触发带内
 * （max(36, 屏宽12%) = 101~153px），手指静置即被每帧注入虚拟位移 ≈3.4°/秒。
 * 修复后：两端一律只跟随手指真实位移 —— 静置不应有角度变化。
 *
 * 判据：拖到右端后手指不动 1.5 秒，角度漂移 < 0.001 rad（≈0.06°）。
 */
import http from "http"
import fs from "fs"
import path from "path"
import puppeteer from "puppeteer-core"

const DIST = path.resolve(__dirname, "../../dist")
const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".mp3": "audio/mpeg",
  ".gltf": "model/gltf+json",
  ".woff2": "font/woff2",
}

async function main() {
  const server = http.createServer((req, res) => {
    const url = decodeURIComponent((req.url || "/").split("?")[0])
    const file = path.join(DIST, url === "/" ? "index.html" : url)
    if (!file.startsWith(DIST) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404)
      res.end("404")
      return
    }
    res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" })
    fs.createReadStream(file).pipe(res)
  })
  await new Promise<void>((r) => server.listen(8097, r))

  const browser = await puppeteer.launch({
    executablePath: "/usr/bin/chromium",
    args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage", "--use-gl=swiftshader"],
    headless: true,
  })
  const page = await browser.newPage()
  const errs: string[] = []
  page.on("pageerror", (e) => errs.push(e.message.slice(0, 120)))
  await page.setViewport({ width: 915, height: 412 })
  await page.goto("http://127.0.0.1:8097/play.html?ruletype=nineball&practice&debug=1", {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  })

  // 等游戏起来（__bc 挂载 + 轮到玩家出杆）
  await page.waitForFunction("!!window.__bc", { timeout: 60000 })
  await new Promise((r) => setTimeout(r, 4000))
  const shape = await page.evaluate(`(() => {
    const bc = globalThis.__bc
    const keys = Object.keys(bc || {}).slice(0, 40)
    const hits = []
    for (const k of keys) {
      const v = bc[k]
      if (v && typeof v === "object" && v.cue && v.cue.aim) hits.push(k)
    }
    return { keys: keys, cueHosts: hits }
  })()`)
  console.log("__bc 结构:", JSON.stringify(shape))

  // 等到轮到玩家出杆（瞄准控件启用）才拖 —— 否则 AimSlider 直接 return
  try {
    await page.waitForFunction(
      `(() => { const c = globalThis.__bc && globalThis.__bc.container
        return !!(c && c.table && c.table.cue && c.table.cue.aimInputs && !c.table.cue.aimInputs.isDisabled()) })()`,
      { timeout: 60000 }
    )
  } catch {
    console.log("⚠️ 60s 内未进入可瞄准状态")
  }
  const ready = await page.evaluate(`(() => {
    const c = globalThis.__bc && globalThis.__bc.container
    const bar = document.getElementById("aimAngleBar")
    const track = document.getElementById("aim-angle-track")
    return {
      hasBar: !!bar,
      barHidden: bar ? bar.hidden : null,
      disabled: !!(c && c.table && c.table.cue && c.table.cue.aimInputs
        ? c.table.cue.aimInputs.isDisabled() : true),
      trackRect: track ? track.getBoundingClientRect().toJSON() : null,
    }
  })()`)
  console.log("就绪状态:", JSON.stringify(ready))
  if (!ready.hasBar || ready.disabled || !ready.trackRect) {
    console.log("⚠️ 未进入可瞄准状态，跳过拖动验证")
    await browser.close()
    server.close()
    return
  }

  const r = ready.trackRect
  const cy = r.y + r.height / 2
  const readAngle = () =>
    page.evaluate(
      `(() => globalThis.__bc.container.table.cue.aim.angle)()`
    ) as Promise<number>

  const a0 = await readAngle()
  // 1) 按下轨道中心
  await page.mouse.move(r.x + r.width / 2, cy)
  await page.mouse.down()
  // 2) 拖到轨道右端（= 屏幕右边缘带内）
  await page.mouse.move(r.x + r.width - 2, cy, { steps: 8 })
  await new Promise((res) => setTimeout(res, 300))
  const a1 = await readAngle()
  // 3) 手指不动，静置 1.5 秒
  await new Promise((res) => setTimeout(res, 1500))
  const a2 = await readAngle()
  // 4) 同样测左端
  await page.mouse.move(r.x + 2, cy, { steps: 8 })
  await new Promise((res) => setTimeout(res, 300))
  const a3 = await readAngle()
  await new Promise((res) => setTimeout(res, 1500))
  const a4 = await readAngle()
  await page.mouse.up()

  const deg = (x: number) => ((x * 180) / Math.PI).toFixed(4)
  console.log("")
  console.log("初始角          :", deg(a0), "°")
  console.log("拖到右端        :", deg(a1), "°  （拖动增量", deg(a1 - a0), "°）")
  console.log("右端静置 1.5s 后:", deg(a2), "°  （漂移", deg(a2 - a1), "°）")
  console.log("拖到左端        :", deg(a3), "°")
  console.log("左端静置 1.5s 后:", deg(a4), "°  （漂移", deg(a4 - a3), "°）")
  const driftR = Math.abs(a2 - a1)
  const driftL = Math.abs(a4 - a3)
  console.log("")
  console.log(
    Math.max(driftR, driftL) < 0.001
      ? "✅ 两端静置均无漂移（左右一致）"
      : `❌ 仍有漂移 右=${deg(driftR)}° 左=${deg(driftL)}°`
  )
  console.log("页面错误:", errs.length ? errs.join(" | ") : "无")

  await browser.close()
  server.close()
  process.exit(Math.max(driftR, driftL) < 0.001 ? 0 : 1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
