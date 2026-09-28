/**
 * v1.5.1 变更履历屏取证探针。
 * 目的：把「用户实际看到的履历屏」完整描述出来，不靠推理。
 *   A. 进入 设置 → 变更履历，dump #screen-changelog 的**直接子元素**结构
 *      （有没有 h2.screen-title？有没有 back-btn？）
 *   B. dump 注入后正文的前 3 个 / 后 3 个元素，确认标题与返回按钮的实际位置
 *   C. 导出当前可见视口内从上到下的可见文本序列（模拟用户第一眼看到的顺序）
 *   D. 模拟 Android 返回键：history.length / canGoBack 的等价判定 + 触发 back 后落到哪
 * 产出：/tmp/v151/*.json + 截图
 */
const puppeteer = require("puppeteer-core")
const fs = require("fs")
const OUT = "/tmp/v151"
const BASE = "http://127.0.0.1:8099"

async function realTap(page, sel) {
  const el = await page.$(sel)
  if (!el) return false
  await el.evaluate((e) => { try { e.scrollIntoView({ block: "center" }) } catch (err) {} })
  await new Promise((r) => setTimeout(r, 150))
  const box = await el.boundingBox()
  if (!box) return false
  await page.touchscreen.touchStart(box.x + box.width / 2, box.y + box.height / 2)
  await page.touchscreen.touchEnd()
  await new Promise((r) => setTimeout(r, 250))
  return true
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function main() {
  fs.mkdirSync(OUT, { recursive: true })
  const browser = await puppeteer.launch({
    executablePath: "/usr/bin/google-chrome",
    headless: "new",
    args: [
      "--no-sandbox", "--hide-scrollbars", "--disable-dev-shm-usage", "--no-zygote",
      "--ozone-platform=headless", "--use-gl=angle", "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader", "--user-data-dir=/tmp/chrome-v151",
      "--in-process-gpu", "--disable-gpu-sandbox",
      "--window-size=393,851",
    ],
    env: { ...process.env, DISPLAY: "" },
  })
  const page = await browser.newPage()
  await page.setCacheEnabled(false)
  await page.setViewport({ width: 393, height: 851, hasTouch: true, isMobile: true, deviceScaleFactor: 2 })
  const errs = []
  page.on("pageerror", (e) => errs.push(e.message))

  await page.goto(BASE + "/menu.html", { waitUntil: "networkidle2", timeout: 60000 })
  await sleep(1200)

  // 打开设置
  const okSettings = await realTap(page, "#btnSettings")
  console.log("点击设置:", okSettings)
  await sleep(600)
  await page.screenshot({ path: OUT + "/01-settings.png" })

  // 打开变更履历
  const okCl = await realTap(page, "#btnChangelog")
  console.log("点击变更履历:", okCl)
  await sleep(1500)
  await page.screenshot({ path: OUT + "/02-changelog.png" })

  const dump = await page.evaluate(() => {
    const sec = document.getElementById("screen-changelog")
    const body = document.getElementById("changelogBody")
    const directChildren = sec
      ? Array.from(sec.children).map((c) => ({
          tag: c.tagName.toLowerCase(),
          cls: c.className,
          id: c.id,
          text: (c.textContent || "").trim().slice(0, 40),
        }))
      : null
    const bodyKids = body
      ? Array.from(body.children).map((c) => ({
          tag: c.tagName.toLowerCase(),
          cls: c.className,
          text: (c.textContent || "").trim().slice(0, 40),
        }))
      : null
    const bodyFirst3 = bodyKids ? bodyKids.slice(0, 3) : null
    const bodyLast3 = bodyKids ? bodyKids.slice(-3) : null
    // 视口内自上而下的可见文本（前 20 条）
    const vis = []
    const all = sec ? sec.querySelectorAll("*") : []
    for (const el of all) {
      const r = el.getBoundingClientRect()
      if (r.top >= 0 && r.top < window.innerHeight && r.height > 0 && r.width > 0) {
        const t = (el.textContent || "").trim()
        if (t && el.children.length === 0) {
          vis.push({ top: Math.round(r.top), tag: el.tagName.toLowerCase(), cls: el.className, text: t.slice(0, 50) })
        }
      }
    }
    vis.sort((a, b) => a.top - b.top)
    // history 状态
    const hist = { length: history.length, hasBackBtn: !!document.querySelector("#screen-changelog .back-btn") }
    // 所有屏里有多少带 back-btn
    const btns = Array.from(document.querySelectorAll(".back-btn")).map((b) => ({
      screen: b.closest(".screen") ? b.closest(".screen").id : "(none)",
      back: b.getAttribute("data-back"),
    }))
    return {
      directChildren,
      bodyChildCount: bodyKids ? bodyKids.length : -1,
      bodyFirst3,
      bodyLast3,
      visibleText: vis.slice(0, 20),
      hist,
      backBtns: btns,
      // 其他屏是否都有 h2.screen-title
      titles: Array.from(document.querySelectorAll(".screen")).map((s) => ({
        id: s.id,
        h2: !!s.querySelector(":scope > h2.screen-title"),
      })),
    }
  })
  fs.writeFileSync(OUT + "/changelog-dump.json", JSON.stringify(dump, null, 2))
  console.log(JSON.stringify(dump, null, 2))


  // 返回按钮（DOM）是否可见、是否在首屏无需滚动即可点击
  const btnInfo = await page.evaluate(() => {
    const sec = document.getElementById("screen-changelog")
    if (!sec) return null
    const b = sec.querySelector(":scope > button.back-btn")
    if (!b) return { exists: false }
    const r = b.getBoundingClientRect()
    return {
      exists: true,
      parentIsSection: b.parentElement === sec,
      top: Math.round(r.top),
      inViewport: r.top >= 0 && r.bottom <= window.innerHeight,
      text: b.textContent.trim(),
      back: b.getAttribute("data-back"),
    }
  })
  console.log("返回按钮:", JSON.stringify(btnInfo))

  // 模拟 Android 系统返回键：webView.canGoBack() ? goBack() : finish()
  // 期望链路：履历 → 设置 → 主屏 →（再按才退出文档）
  const chain = []
  for (let i = 1; i <= 3; i++) {
    const before = await page.evaluate(() => ({
      len: history.length,
      stack: (window.__screenStackLen ? window.__screenStackLen() : -1),
      screen: (document.querySelector(".screen.active") || {}).id || null,
      url: location.href,
    }))
    if (i === 1) console.log("返回前:", JSON.stringify(before))
    const canGo = await page.evaluate(() => history.length > 1)
    if (!canGo) { chain.push({ i, note: "canGoBack=false → 退出文档" }); break }
    await page.goBack().catch((e) => console.log("goBack 抛错:", e.message))
    await sleep(900)
    const after = await page.evaluate(() => ({
      screen: (document.querySelector(".screen.active") || {}).id || null,
      url: location.href,
      blank: document.body ? document.body.children.length === 0 : true,
    }))
    chain.push({ i, ...after })
    await page.screenshot({ path: OUT + "/03-back-" + i + ".png" })
    if (after.url === "about:blank") break
  }
  console.log("返回链:", JSON.stringify(chain, null, 2))


  console.log("页面错误:", errs.length ? errs : "无")
  await browser.close()
}
main().catch((e) => { console.error("FATAL", e); process.exit(1) })
