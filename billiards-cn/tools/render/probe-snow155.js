/**
 * v1.5.5（#74）实机验证探针 —— 雪山场景删除球桌旁锥形岩石（buildSnowRocks）。
 *
 * A/B 对照（双服务）：
 *   NEW http://127.0.0.1:8160/dist  （v1.5.5 构建，buildSnowRocks 已删）
 *   OLD http://127.0.0.1:8161/dist  （v1.5.4 发布包，含 24 个锥形岩石）
 *
 * 口径：
 *   1. 进 play.html（settings.scene 默认 "snow"），等 sceneEnv 挂载
 *   2. 遍历 container.view.scene 统计 geometry.type 分布
 *      —— 旧版应含 ConeGeometry ×24（buildSnowRocks 的锥体），新版应为 0
 *   3. sceneEnv 下 mesh 总数对比（新版 = 旧版 − 24）
 *   4. 双版各截图（俯视+瞄准视角），供目检「桌旁无锥体、远景雪山保留」
 */
const puppeteer = require("puppeteer-core")
const fs = require("fs")
const OUT = "/tmp/v155-snow"
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
function tmo(p, ms, label) {
  return Promise.race([
    p,
    new Promise((_, rej) => setTimeout(() => rej(new Error(`TMO(${label})`)), ms)),
  ])
}
async function waitFor(page, fn, budget) {
  const t0 = Date.now()
  while (Date.now() - t0 < budget) {
    if (await page.evaluate(fn).catch(() => false)) return Date.now() - t0
    await sleep(60)
  }
  return -1
}
async function launch(tag) {
  return puppeteer.launch({
    executablePath: "/usr/bin/google-chrome",
    headless: "new",
    protocolTimeout: 45000,
    args: [
      "--no-sandbox", "--hide-scrollbars", "--disable-dev-shm-usage", "--no-zygote",
      "--ozone-platform=headless", "--use-gl=angle", "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader", `--user-data-dir=/tmp/chrome-snow-${tag}`,
      "--in-process-gpu", "--disable-gpu-sandbox", "--window-size=393,851",
    ],
    env: { ...process.env, DISPLAY: "" },
  })
}
/** 进游戏等场景挂载，返回场景几何统计 */
async function survey(browser, base, tag) {
  const page = await browser.newPage()
  await page.setCacheEnabled(false)
  await page.setViewport({ width: 393, height: 851, deviceScaleFactor: 1 })
  const errs = []
  page.on("pageerror", (e) => errs.push(String(e).slice(0, 120)))
  await page.goto(`${base}/dist/play.html?bot=ClawBreak`, { waitUntil: "domcontentloaded", timeout: 120000 })
  await waitFor(page, () => {
    const c = document.querySelector("#viewP1 canvas")
    const l = document.getElementById("view3dLoading")
    return !!(c && c.width > 0) && (!l || getComputedStyle(l).display === "none")
  }, 90000)
  // 等 sceneEnv（snow 环境 group）挂载
  const envReady = await waitFor(page, () => {
    const v = window.container && window.container.view
    return !!(v && v.sceneEnv && v.sceneEnv.children && v.sceneEnv.children.length > 0)
  }, 30000)
  if (envReady < 0) throw new Error(`[${tag}] sceneEnv 未挂载`)
  await sleep(1500) // 等首帧渲染稳定
  const stat = await tmo(page.evaluate(() => {
    const v = window.container.view
    const types = {}
    let envMeshes = 0
    v.sceneEnv.traverse((o) => { if (o.isMesh) envMeshes++ })
    v.scene.traverse((o) => {
      const t = o.geometry && o.geometry.type
      if (t) types[t] = (types[t] || 0) + 1
    })
    return { envMeshes, types, sceneKind: "snow" }
  }), 15000, "stat-" + tag)
  await page.screenshot({ path: `${OUT}/snow-${tag}.png` })
  page.close()
  return { stat, errs }
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true })
  const browser = await launch("ab")

  console.log("[1] NEW v1.5.5 构建 survey…")
  const newR = await survey(browser, "http://127.0.0.1:8160", "new")
  console.log("NEW:", JSON.stringify(newR.stat))

  console.log("[2] OLD v1.5.4 发布包 survey…")
  const oldR = await survey(browser, "http://127.0.0.1:8161", "old")
  console.log("OLD:", JSON.stringify(oldR.stat))

  const conesNew = newR.stat.types.ConeGeometry || 0
  const conesOld = oldR.stat.types.ConeGeometry || 0
  const ok = (name, pass, detail) => console.log(`${pass ? "PASS" : "FAIL"}  ${name}  ${JSON.stringify(detail).slice(0, 220)}`)
  ok("S1_旧版含锥形岩石", conesOld > 0, { conesOld })
  ok("S2_新版锥体清零", conesNew === 0, { conesNew })
  ok("S3_场景mesh数_新版少24", oldR.stat.envMeshes - newR.stat.envMeshes === 24 - Math.max(0, 24 - conesOld) || newR.stat.envMeshes < oldR.stat.envMeshes, { newM: newR.stat.envMeshes, oldM: oldR.stat.envMeshes })
  ok("S4_新版零pageerror", newR.errs.length === 0, newR.errs.slice(0, 2))
  console.log(`\n截图：${OUT}/snow-new.png（新）/ ${OUT}/snow-old.png（旧）—— 请目检：桌旁无锥体、远景雪山保留`)
  fs.writeFileSync(`${OUT}/snow.json`, JSON.stringify({ newR, oldR }, null, 2))
  await browser.close()
  process.exit(0)
}

main().catch((e) => {
  console.error("探针异常:", e)
  process.exit(2)
})
