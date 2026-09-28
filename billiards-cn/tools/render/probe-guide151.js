/**
 * v1.5.1 问题「继续对战后还是显示新手引导」验证探针。
 *
 * 复现路径（原缺陷）：
 *   首局 menu 拼 tutorial=1 → play.html → 引导完成写 seenGuide
 *   → 结算点「继续对战」→ restartGame() 原样保留 URL 参数（含 tutorial=1）
 *   → 新页面 forceTutorial=true 绕过 hasSeenGuide → 每局都弹引导
 *
 * 验证四项：
 *   A. seenGuide 未置位 + tutorial=1  → 引导**应当**出现（不能误伤首次引导）
 *   B. seenGuide 已置位 + tutorial=1  → 引导**不应**出现（本次修复的核心）
 *   C. seenGuide 已置位 + 无参数      → 引导**不应**出现
 *   D. 产物核对：restartGame 的重开参数丢弃表必须包含 tutorial
 */
const puppeteer = require("puppeteer-core")
const fs = require("fs")
const OUT = "/tmp/v151"
const BASE = "http://127.0.0.1:8099"
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function run(page, url, seen) {
  // 先用同源页面写入 localStorage，再跳到目标 URL
  await page.goto(BASE + "/menu.html", { waitUntil: "domcontentloaded", timeout: 60000 })
  await page.evaluate((s) => {
    try {
      localStorage.removeItem("billiards_cn_seenGuide_v1")
      if (s) localStorage.setItem("billiards_cn_seenGuide_v1", "1")
    } catch (e) {}
    try {
      if (s) globalThis.__billiardsSeenGuide = true
      else delete globalThis.__billiardsSeenGuide
    } catch (e) {}
  }, seen)
  await page.goto(BASE + "/" + url, { waitUntil: "domcontentloaded", timeout: 60000 })
  // 轮询观察：controller 什么时候进入 Aim（Aim.onFirst 才会决定要不要弹引导）
  const trace = []
  for (let i = 0; i < 16; i++) {
    await sleep(2000)
    const t = await page.evaluate(() => {
      const c = window.container
      const name = c && c.controller ? (c.controller.constructor.name || "?") : "?"
      const ban = document.querySelectorAll(".tutorial-banner").length
      const dis = !!(c && c.table.cue.aimInputs && c.table.cue.aimInputs.isDisabled())
      return { name, ban, dis }
    })
    trace.push(`${i * 2 + 2}s:${t.name}${t.ban ? "+banner" : ""}${t.dis ? "(锁)" : ""}`)
    if (t.ban) break
    // 卡在 PlaceBall（等玩家摆球）→ 点球桌把母球放下，才会进入 Aim
    if (t.name === "PlaceBall" && i % 2 === 0) {
      await page.touchscreen.touchStart(700, 330)
      await page.touchscreen.touchEnd()
    }
  }
  console.log("   状态轨迹:", trace.join(" "))
  const r = await page.evaluate(() => {
    // 新手引导 = document.body 上的 .tutorial-banner（src/view/tutorial.ts）
    const banners = Array.from(document.querySelectorAll(".tutorial-banner"))
    const vis = banners.filter((d) => {
      const s = getComputedStyle(d)
      return s.display !== "none" && s.visibility !== "hidden" && d.getBoundingClientRect().height > 0
    })
    return {
      overlayCount: vis.length,
      overlays: vis.map((d) => ({
        cls: (d.className || "").toString().slice(0, 40),
        text: (d.textContent || "").replace(/\s+/g, " ").trim().slice(0, 80),
      })),
      snippet: (document.body.innerText || "").replace(/\s+/g, " ").slice(0, 120),
      // 与 forceTutorial 直接绑定的可观测量：aim.ts 里
      //   aimInputs.setDisabled(forceTutorial)  —— 未看过引导+强制引导 ⇒ 控件被锁
      disabled: !!(window.container && window.container.table.cue.aimInputs &&
        window.container.table.cue.aimInputs.isDisabled()),
      bannerTotal: banners.length,
    }
  })
  return r
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true })
  const browser = await puppeteer.launch({
    executablePath: "/usr/bin/google-chrome",
    headless: "new",
    args: [
      "--no-sandbox", "--hide-scrollbars", "--disable-dev-shm-usage", "--no-zygote",
      "--ozone-platform=headless", "--use-gl=angle", "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader", "--user-data-dir=/tmp/chrome-guide151",
      "--in-process-gpu", "--disable-gpu-sandbox", "--window-size=1422,640",
    ],
    env: { ...process.env, DISPLAY: "" },
  })
  const page = await browser.newPage()
  await page.setCacheEnabled(false)
  await page.setViewport({ width: 1422, height: 640, hasTouch: true, isMobile: true, deviceScaleFactor: 1 })

  const cases = [
    { name: "A 未看过引导 + tutorial=1（应弹）", url: "play.html?practice=true&tutorial=1", seen: false },
    { name: "B 已看过引导 + tutorial=1（不应弹）", url: "play.html?practice=true&tutorial=1", seen: true },
    { name: "C 已看过引导 + 无参数（不应弹）", url: "play.html?practice=true", seen: true },
  ]
  for (const c of cases) {
    const r = await run(page, c.url, c.seen)
    console.log("──", c.name)
    console.log("   url:", c.url)
    console.log("   全屏遮罩数:", r.overlayCount, JSON.stringify(r.overlays))
    console.log("   引导 banner 总数:", r.bannerTotal, " 瞄准控件被锁(disabled):", r.disabled)
    await page.screenshot({ path: OUT + "/guide-" + c.name[0] + ".png" })
  }

  const js = fs.readFileSync("/workspace/dev/source/billiards-cn/dist/index.js", "utf8")
  const m = js.match(/"state","replayId","replay","_r"[^\]]*\]/)
  console.log("── D 产物核对：重开丢弃参数表 =", m ? m[0] : "未找到")
  console.log("   含 tutorial:", /"state","replayId","replay","_r","tutorial"/.test(js) ? "✓" : "✗")
  await browser.close()
}
main().catch((e) => { console.error("FATAL", e); process.exit(1) })
