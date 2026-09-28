/**
 * v1.4.5 端到端 UI 探针（真实触摸事件流版）。
 *
 * 上轮 probe-uifix145 的漏洞：page.click 只派发鼠标事件，**不触发 touchend
 * 防抖逻辑** —— 真机全是 touch。本探针改用 page.tap（CDP Input.dispatchTouchEvent
 * 真触摸流：touchstart→touchend→浏览器合成 click），与真机行为一致。
 *
 * 测两条完整用户路径（每步前置一次 60ms 前摇触摸，模拟快速连续操作）：
 *   A 进入游戏：menu.html → touch #btnStart → 断言跳 play.html → 场景就绪
 *   B 游戏内退出：touch #menu(齿轮) → helpOverlay 显示 → touch #backToMenu
 *     → back-confirm 弹窗出现 → touch 弹窗「返回主菜单」→ 断言回 menu.html
 */
const puppeteer = require("puppeteer-core")

const DIST = "/workspace/dev/source/billiards-cn/dist"
const results = []

async function newBrowser() {
  return puppeteer.launch({
    executablePath: "/usr/bin/google-chrome",
    headless: "new",
    args: [
      "--no-sandbox", "--hide-scrollbars",
      "--disable-dev-shm-usage", "--no-zygote", "--ozone-platform=headless",
      "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader",
      "--user-data-dir=/tmp/chrome-e2e146", "--in-process-gpu", "--disable-gpu-sandbox",
      "--allow-file-access-from-files", "--window-size=393,851",
    ],
    env: { ...process.env, DISPLAY: "" },
  })
}

/** 真触摸点击（touchstart+touchend），并在 60ms 前对空白处触摸一次（激活防抖） */
async function realTap(page, sel, label) {
  // 前摇：60ms 前在左上角空白处 touch 一次（非交互区 → 会被防抖 preventDefault）
  await page.touchscreen.touchStart(5, 5)
  await page.touchscreen.touchEnd()
  await new Promise((r) => setTimeout(r, 60))
  const el = await page.$(sel)
  if (!el) return { ok: false, why: `${sel} 不存在`, label }
  const box = await el.boundingBox()
  if (!box) return { ok: false, why: `${sel} 无 boundingBox`, label }
  await page.touchscreen.touchStart(box.x + box.width / 2, box.y + box.height / 2)
  await page.touchscreen.touchEnd()
  return { ok: true, label, sel, box }
}

async function main() {
  const browser = await newBrowser()
  const page = await browser.newPage()
  await page.setViewport({ width: 393, height: 851, hasTouch: true, isMobile: true, deviceScaleFactor: 2 })

  const errs = []
  const notFound = new Set() // 精确记录 404 URL（Chrome 的 console 文案不带 URL）
  page.on("pageerror", (e) => errs.push("[pageerror] " + e.message))
  page.on("response", (r) => { if (r.status() >= 400) notFound.add(r.url()) })
  page.on("console", (m) => {
    if (m.type() !== "error") return
    const t = m.text()
    // wave.jpg 404 是 v1.3.87 已定论的预存在问题（缺失静默跳过，补图反而改台呢外观）；
    // 「Failed to load resource」不带 URL 的通用文案与 notFound 集合对照后过滤
    if (/wave\.jpg|Failed to load resource/.test(t)) return
    errs.push("[console] " + t)
  })

  /* ---------- 路径 A：进入游戏 ---------- */
  const url = `file://${DIST}/menu.html`
  await page.goto(url, { waitUntil: "load", timeout: 120000 })
  await new Promise((r) => setTimeout(r, 800))

  // A1: 真触摸点开始游戏
  const a1 = await realTap(page, "#btnStart", "A1 touch #btnStart")
  let urlA = ""
  try {
    await page.waitForFunction(() => location.pathname.includes("play.html"), { timeout: 8000 })
    urlA = page.url()
  } catch { urlA = page.url() }
  results.push({ ...a1, after: urlA, ok: a1.ok && urlA.includes("play.html") })

  if (!urlA.includes("play.html")) {
    console.log("路径 A 失败，提前终止。errs:", errs.slice(0, 5))
    await browser.close()
    process.exit(1)
  }

  // A2: 等场景就绪。注意跳转 URL 含 tutorial=1（首次安装），新手引导期间
  // 底部操作栏可能隐藏 —— 判定放宽为 canvas 就位 + 全程零 pageerror
  // （B1-B3 的行为链才是「游戏可用」的硬证据）。
  const errBeforeA2 = errs.length
  let ready = false
  for (let i = 0; i < 40 && !ready; i++) {
    ready = await page.evaluate(() => {
      const cv = document.querySelector("#viewP1 canvas")
      return !!(cv && cv.width > 0 && cv.offsetHeight > 0)
    }).catch(() => false)
    if (!ready) await new Promise((r) => setTimeout(r, 500))
  }
  const noErrA2 = errs.length === errBeforeA2
  if (!noErrA2) console.log("   路径 A 期间错误:", errs.slice(errBeforeA2).slice(0, 6).map((e) => e.slice(0, 200)))
  const bad404 = [...notFound].filter((u) => !/wave\.jpg/.test(u))
  if (bad404.length) console.log("   非 wave.jpg 的 404:", bad404)
  results.push({ label: "A2 play 场景就绪（canvas + 零页面错误）", ok: ready && noErrA2 && bad404.length === 0, why: ready ? (noErrA2 && bad404.length === 0 ? "" : "有页面错误") : "canvas 未就位" })

  /* ---------- 路径 B：游戏内退出 ---------- */
  const beforeErrs = errs.length

  // B1: touch 齿轮 #menu → helpOverlay 显示
  const b1 = await realTap(page, "#menu", "B1 touch 齿轮 #menu")
  let overlayShown = false
  try {
    await page.waitForFunction(() => {
      const o = document.getElementById("helpOverlay")
      return o && !o.hasAttribute("hidden") && o.offsetParent !== null
    }, { timeout: 5000 })
    overlayShown = true
  } catch {}
  results.push({ ...b1, ok: b1.ok && overlayShown, why: overlayShown ? "" : "helpOverlay 未显示" })

  // B2: touch #backToMenu → back-confirm 弹窗出现
  const b2 = await realTap(page, "#backToMenu", "B2 touch #backToMenu")
  let dialogShown = false
  try {
    await page.waitForFunction(() => !!document.getElementById("back-confirm-cn-backdrop"), { timeout: 5000 })
    dialogShown = true
  } catch {}
  results.push({ ...b2, ok: b2.ok && dialogShown, why: dialogShown ? "" : "退出弹窗未出现" })

  // B3: touch 弹窗「返回主菜单」→ 回 menu.html
  // 注意保留 realTap 的前摇空白触摸 —— v1.4.5 真机上这次触摸会把弹窗关掉
  // （「点了没反应」根因）；v1.4.6 修复后弹窗只抖动不关闭，本步应通过。
  const b3 = await realTap(page, "#back-confirm-cn-backdrop .bcbtn.danger", "B3 touch 弹窗『返回主菜单』（带前摇误触）")
  let backUrl = ""
  try {
    await page.waitForFunction(() => location.pathname.includes("menu.html"), { timeout: 8000 })
    backUrl = page.url()
  } catch { backUrl = page.url() }
  results.push({ ...b3, after: backUrl, ok: b3.ok && backUrl.includes("menu.html") })

  /* ---------- 输出 ---------- */
  console.log("=" + "=".repeat(70))
  for (const r of results) {
    console.log(`${r.ok ? "✓" : "✗"} ${r.label}`)
    if (r.why) console.log(`   └ ${r.why}`)
    if (r.after) console.log(`   └ 跳转后: ${r.after}`)
    if (r.box) console.log(`   └ 触点: (${Math.round(r.box.x + r.box.width / 2)}, ${Math.round(r.box.y + r.box.height / 2)}) 尺寸 ${Math.round(r.box.width)}×${Math.round(r.box.height)}`)
  }
  const newErrs = errs.slice(beforeErrs)
  console.log("-".repeat(71))
  console.log("页面错误（路径 B 期间）:", newErrs.length ? newErrs.slice(0, 5) : "无")
  await page.screenshot({ path: "/tmp/e2e-final.png" })
  const allOk = results.every((r) => r.ok)
  console.log(`\n结论: ${allOk ? "全部通过 ✓" : "存在失败 ✗"}`)
  await browser.close()
  process.exit(allOk ? 0 : 1)
}

main().catch((e) => { console.error(e); process.exit(2) })
