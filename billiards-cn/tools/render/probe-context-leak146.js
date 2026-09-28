/**
 * v1.4.6 WebGL context 累积专项探针。
 *
 * 直接验证底层定律：反复创建 WebGL context，**不释放**会在 Chromium 上限（约 16）
 * 触顶后创建失败；**每次释放**（loseContext/dispose）则稳定。
 * 这是「游戏退出时不 dispose WebGLRenderer → 真机反复进出累积卡死」的底层依据。
 */
const puppeteer = require("puppeteer-core")

async function newBrowser() {
  return puppeteer.launch({
    executablePath: "/usr/bin/google-chrome",
    headless: "new",
    args: [
      "--no-sandbox", "--hide-scrollbars",
      "--disable-dev-shm-usage", "--no-zygote", "--ozone-platform=headless",
      "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader",
      "--user-data-dir=/tmp/cl152", "--in-process-gpu", "--disable-gpu-sandbox",
      "--allow-file-access-from-files", "--window-size=393,851",
    ],
    env: { ...process.env, DISPLAY: "" },
  })
}

async function main() {
  const browser = await newBrowser()
  const page = await browser.newPage()
  await page.goto("about:blank", { waitUntil: "load" })

  // 测 1：不释放，看多少次后创建失败（模拟"游戏退出不 dispose"在真机上的累积）
  const noRelease = await page.evaluate(() => {
    const ctxs = []
    let created = 0, failedAt = -1
    for (let i = 0; i < 40; i++) {
      const c = document.createElement("canvas")
      const gl = c.getContext("webgl") || c.getContext("experimental-webgl")
      if (!gl) { failedAt = i; break }
      // 故意不释放
      ctxs.push(gl)
      created++
    }
    // 收尾清理
    ctxs.forEach((g) => {
      try { const e = g.getExtension("WEBGL_lose_context"); if (e) e.loseContext() } catch (e) {}
    })
    return { created, failedAt }
  })

  // 测 2：每次创建后立即释放，看能否稳定 40 次（模拟"退出时 dispose"后反复进出）
  const withRelease = await page.evaluate(() => {
    let created = 0, failedAt = -1
    for (let i = 0; i < 40; i++) {
      const c = document.createElement("canvas")
      const gl = c.getContext("webgl")
      if (!gl) { failedAt = i; break }
      try { const e = gl.getExtension("WEBGL_lose_context"); if (e) e.loseContext() } catch (e) {}
      created++
    }
    return { created, failedAt }
  })

  // 测 3：模拟 webgl.ts 的泄漏行为——同一 element 反复 new WebGLRenderer 不移除旧 canvas
  const leakSim = await page.evaluate(() => {
    const el = document.createElement("div")
    document.body.appendChild(el)
    let created = 0, failedAt = -1
    const canvases = []
    for (let i = 0; i < 40; i++) {
      // 模拟 createRenderer：new + appendChild，不移除旧 canvas
      const c = document.createElement("canvas")
      const gl = c.getContext("webgl")
      if (!gl) { failedAt = i; break }
      el.appendChild(c)
      canvases.push(c)
      created++
    }
    const leftover = el.querySelectorAll("canvas").length
    canvases.forEach((c) => {
      try { const e = c.getContext("webgl").getExtension("WEBGL_lose_context"); if (e) e.loseContext() } catch (e) {}
    })
    return { created, failedAt, leftoverCanvases: leftover }
  })

  console.log("测1 不释放:        ", JSON.stringify(noRelease), "→ 约 16 次后触顶失败 = 真机『几次就卡』")
  console.log("测2 每次释放:      ", JSON.stringify(withRelease), "→ 稳定 = 退出时 dispose 可彻底避免")
  console.log("测3 同容器不移除:  ", JSON.stringify(leakSim), "→ 残留 canvas 数 = 单页泄漏量")
  await browser.close()

  const bad = noRelease.failedAt < 0 || withRelease.failedAt >= 0 || leakSim.failedAt < 0
  console.log(bad ? "\n定律验证异常 ✗" : "\n定律验证通过 ✓（不释放触顶 / 释放稳定）")
  process.exit(bad ? 1 : 0)
}

main().catch((e) => { console.error(e); process.exit(2) })
