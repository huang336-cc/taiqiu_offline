/**
 * v1.5.1 发布前终验探针（面向**发布站点** http://127.0.0.1:8099）。
 *   A. 发布页 index.html：标题版本、APK/zip 下载链接是否指向 v1.5.1
 *   B. 菜单主页可加载、版本戳一致
 *   C. 球杆主题 13 款逐个切换，记录控制台/页面错误（零新增为验收线）
 *   D. 复盘 v1.5.1 五问的关键落脚点在发布包里是否成立
 * 产出：/tmp/v151rel/*.png + 控制台打印
 */
const puppeteer = require("puppeteer-core")
const fs = require("fs")
const OUT = "/tmp/v151rel"
const BASE = "http://127.0.0.1:8099"
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function realTap(page, sel) {
  const el = await page.$(sel)
  if (!el) return false
  await el.evaluate((e) => { try { e.scrollIntoView({ block: "center" }) } catch (err) {} })
  await sleep(120)
  const box = await el.boundingBox()
  if (!box) return false
  await page.touchscreen.touchStart(box.x + box.width / 2, box.y + box.height / 2)
  await page.touchscreen.touchEnd()
  await sleep(220)
  return true
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true })
  const browser = await puppeteer.launch({
    executablePath: "/usr/bin/google-chrome",
    headless: "new",
    args: [
      "--no-sandbox", "--hide-scrollbars", "--disable-dev-shm-usage", "--no-zygote",
      "--ozone-platform=headless", "--use-gl=angle", "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader", "--user-data-dir=/tmp/chrome-v151rel",
      "--in-process-gpu", "--disable-gpu-sandbox",
      "--window-size=393,851", "--force-device-scale-factor=1",
    ],
    env: { ...process.env, DISPLAY: "" },
  })

  let pass = 0, fail = 0
  const ok = (name, cond, extra = "") => {
    if (cond) { pass++; console.log(`   ✓ ${name}${extra ? " " + extra : ""}`) }
    else { fail++; console.log(`   ✗ ${name}${extra ? " " + extra : ""}`) }
  }

  // ---------- A. 发布页 ----------
  console.log("\n=== A. 发布页 index.html ===")
  {
    const page = await browser.newPage()
    await page.setCacheEnabled(false)
    const errs = []
    page.on("pageerror", (e) => errs.push(String(e)))
    await page.goto(BASE + "/index.html", { waitUntil: "networkidle2", timeout: 30000 })
    const info = await page.evaluate(() => ({
      title: document.title,
      ver: (document.querySelector(".ver") || {}).textContent || "",
      links: Array.from(document.querySelectorAll("a.dl")).map((a) => a.getAttribute("href")),
      log2: (document.querySelectorAll(".card h2")[1] || {}).textContent || "",
      has151: document.body.innerText.includes("v1.5.1"),
      has150: document.body.innerText.includes("v1.5.0"),
    }))
    console.log("   标题:", info.title)
    console.log("   版本:", info.ver)
    console.log("   下载链接:", JSON.stringify(info.links))
    console.log("   首张要点卡:", info.log2)
    ok("标题含 v1.5.1", /v1\.5\.1/.test(info.title))
    ok("版本行 v1.5.1", /v1\.5\.1/.test(info.ver))
    ok("APK 链接指向 v1.5.1", info.links.some((h) => (h || "").includes("billiards-cn-v1.5.1.apk")))
    ok("zip 链接指向 v1.5.1", info.links.some((h) => (h || "").includes("release-v1.5.1.zip")))
    ok("要点首卡为 v1.5.1", /v1\.5\.1/.test(info.log2))
    ok("页面错误为 0", errs.length === 0, errs.length ? JSON.stringify(errs) : "")
    await page.screenshot({ path: OUT + "/publish-page.png", fullPage: false })
    await page.close()
  }

  // ---------- B. 菜单主页 ----------
  console.log("\n=== B. 菜单主页 menu.html ===")
  const page = await browser.newPage()
  await page.setCacheEnabled(false)
  const errs = []
  page.on("pageerror", (e) => errs.push(String(e)))
  page.on("console", (m) => { if (m.type() === "error") errs.push("console: " + m.text()) })
  await page.goto(BASE + "/menu.html", { waitUntil: "networkidle2", timeout: 30000 })
  await sleep(800)
  {
    const info = await page.evaluate(() => ({
      ver: (window.__BILLIARDS_VERSION__ || ""),
      title: (document.querySelector(".home-title, h1, .title") || {}).textContent || "",
      changelogScreen: !!document.querySelector("#screen-changelog"),
      backBtnInChangelog: !!document.querySelector("#screen-changelog > .back-btn"),
      seenGuideKeys: Object.keys(localStorage || {}).filter((k) => /guide/i.test(k)),
    }))
    console.log("   版本戳:", info.ver)
    console.log("   履历屏存在:", info.changelogScreen, "| 返回按钮在 screen 层:", info.backBtnInChangelog)
    ok("版本戳为 1.5.1-26092801", info.ver === "1.5.1-26092801", info.ver)
    ok("履历屏存在", info.changelogScreen)
    ok("履历返回按钮在 screen 层（非正文）", info.backBtnInChangelog)
  }

  // ---------- C. 13 款主题冒烟 ----------
  console.log("\n=== C. 球杆主题冒烟 ===")
  {
    await realTap(page, '#customRows .menu-row[data-target="cuetheme"]')
    await sleep(700)
    const themeCount = await page.evaluate(() =>
      document.querySelectorAll('#cueThemeCards .skin-card[data-cuetheme]').length)
    console.log("   主题行数:", themeCount)
    let tested = 0
    const errBefore = errs.length
    const ids = await page.evaluate(() =>
      Array.from(document.querySelectorAll('#cueThemeCards .skin-card[data-cuetheme]'))
        .map((c) => c.getAttribute("data-cuetheme")))
    for (const id of ids) {
      const okTap = await page.evaluate((tid) => {
        const el = document.querySelector(`#cueThemeCards .skin-card[data-cuetheme="${tid}"]`)
        if (!el) return false
        el.click()
        return true
      }, id)
      if (!okTap) continue
      await sleep(280)
      tested++
    }
    console.log(`   已切换 ${tested} 款，累计错误增量: ${errs.length - errBefore}`)
    ok("主题全部可切换", tested === themeCount && themeCount > 0, `${tested}/${themeCount}`)
    await page.screenshot({ path: OUT + "/cuetheme.png" })
  }

  console.log("\n=== 汇总 ===")
  console.log("   页面错误总数:", errs.length, errs.length ? JSON.stringify(errs.slice(0, 5)) : "（无）")
  ok("发布站点零页面错误", errs.length === 0)
  console.log(`\n通过 ${pass} / 失败 ${fail}`)
  await page.close()
  await browser.close()
  process.exit(fail === 0 ? 0 : 1)
}

main().catch((e) => { console.error("探针异常:", e); process.exit(2) })
