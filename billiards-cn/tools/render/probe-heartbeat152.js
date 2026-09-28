/**
 * v1.5.2 退出卡顿 —— **主线程心跳探针**。
 *
 * 要回答的唯一问题：退出时那 ~1.5~1.8 秒（点击 → URL 真正变化）里，
 * 主线程到底是「在干活（JS 阻塞）」还是「在干等（浏览器内部等待）」？
 *
 *   主线程忙（JS 阻塞）   → 心跳出现大 gap，可用 CPU Profiler 抓到热点函数 → 可优化
 *   主线程空（浏览器等待）→ 心跳正常，只是浏览器在等 GPU / 卸载 → JS 层面无从下手
 *
 * 手法：点击前注入 20ms 心跳，通过 console.log 实时送到 Node 端收集
 * （跨导航也能保留导航前的全部心跳）。同时记录 pagehide / beforeunload / unload 时刻。
 */
const puppeteer = require("puppeteer-core")
const fs = require("fs")
const OUT = "/tmp/v152"
const BASE = process.env.BASE || "http://127.0.0.1:8151/dist"
const LABEL = process.env.LABEL || "v1.5.1"
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function realTap(page, sel) {
  const el = await page.$(sel)
  if (!el) return false
  await el.evaluate((e) => { try { e.scrollIntoView({ block: "center" }) } catch (err) {} })
  await sleep(80)
  const box = await el.boundingBox()
  if (!box) return false
  await page.touchscreen.touchStart(box.x + box.width / 2, box.y + box.height / 2)
  await page.touchscreen.touchEnd()
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
      "--enable-unsafe-swiftshader", "--user-data-dir=/tmp/chrome-hb152",
      "--in-process-gpu", "--disable-gpu-sandbox", "--window-size=393,851",
    ],
    env: { ...process.env, DISPLAY: "" },
  })
  const page = await browser.newPage()
  await page.setCacheEnabled(false)
  const hb = []      // 心跳
  const marks = []   // 关键事件
  page.on("console", (m) => {
    const t = m.text()
    if (t.startsWith("[HB]")) hb.push(parseFloat(t.split("=")[1]))
    else if (t.startsWith("[MK]")) marks.push(t.replace("[MK] ", ""))
  })
  page.on("pageerror", (e) => marks.push("ERR " + String(e).slice(0, 120)))
  const framenav = []
  page.on("framenavigated", (f) => { if (f === page.mainFrame()) framenav.push({ t: Date.now(), url: f.url() }) })

  await page.goto(`${BASE}/menu.html`, { waitUntil: "domcontentloaded", timeout: 60000 })
  await sleep(1500)
  await page.evaluate(() => { const b = document.getElementById("btnStart"); if (b) b.click() })
  for (let k = 0; k < 200; k++) {
    const ok = await page.evaluate(() => {
      const c = document.querySelector("#viewP1 canvas")
      const l = document.getElementById("view3dLoading")
      return !!(c && c.width > 0) && (!l || getComputedStyle(l).display === "none")
    }).catch(() => false)
    if (ok) break
    await sleep(100)
  }
  await sleep(1500)

  // 齿轮 → 浮层 → 返回主菜单 → 确认弹窗
  await realTap(page, "#menu")
  for (let k = 0; k < 80; k++) {
    if (await page.evaluate(() => {
      const o = document.getElementById("helpOverlay")
      return !!(o && !o.hasAttribute("hidden") && o.offsetParent !== null)
    }).catch(() => false)) break
    await sleep(100)
  }
  await realTap(page, "#backToMenu")
  for (let k = 0; k < 80; k++) {
    if (await page.evaluate(() => !!document.getElementById("back-confirm-cn-backdrop")).catch(() => false)) break
    await sleep(100)
  }

  // 启动心跳 + 注册卸载事件 + 记录点击原点
  await page.evaluate(() => {
    window.__hbStop = false
    const start = performance.now()
    let n = 0
    window.__hbTimer = setInterval(() => {
      if (window.__hbStop) return
      console.log("[HB] t=" + performance.now().toFixed(1))
      if (++n > 2000) clearInterval(window.__hbTimer)
    }, 20)
    window.addEventListener("beforeunload", () => console.log("[MK] beforeunload=" + performance.now().toFixed(1)))
    window.addEventListener("pagehide", () => console.log("[MK] pagehide=" + performance.now().toFixed(1)))
    window.addEventListener("unload", () => console.log("[MK] unload=" + performance.now().toFixed(1)))
    console.log("[MK] HB_START=" + start.toFixed(1))
  })
  await sleep(300)

  const tClickWall = Date.now()
  await page.evaluate(() => console.log("[MK] BEFORE_CLICK=" + performance.now().toFixed(1)))
  await realTap(page, "#back-confirm-cn-backdrop .bcbtn.danger")

  // 等导航
  for (let k = 0; k < 400; k++) {
    const u = page.url()
    if (/\/menu\.html/.test(u)) break
    await sleep(50)
  }
  const tNavWall = Date.now()
  await sleep(500)

  console.log(`\n════════ ${LABEL} 退出主线程心跳 ════════`)
  console.log(`   点击 → URL 变化（墙钟）: ${tNavWall - tClickWall}ms`)
  console.log(`   心跳样本数: ${hb.length}   关键事件: ${marks.length}`)

  // 关键事件（相对点击原点）
  const mk = (k) => { const l = marks.find((x) => x.startsWith(k)); return l ? parseFloat(l.split("=")[1]) : null }
  const clickT = mk("BEFORE_CLICK")
  for (const m of marks) {
    if (/=\d/.test(m)) {
      const v = parseFloat(m.split("=")[1])
      console.log(`   ${m.padEnd(34)} ${clickT ? "+" + (v - clickT).toFixed(1) + "ms" : ""}`)
    } else console.log(`   ${m}`)
  }

  // 心跳 gap 分析
  if (hb.length > 2) {
    const gaps = []
    for (let i = 1; i < hb.length; i++) {
      const g = hb[i] - hb[i - 1]
      if (g > 100) gaps.push({ from: hb[i - 1], dur: g })
    }
    gaps.sort((a, b) => b.dur - a.dur)
    console.log(`\n   ── 心跳间隔 >100ms 的阻塞段（共 ${gaps.length} 段）──`)
    for (const g of gaps.slice(0, 8)) {
      const rel = clickT ? ` (点击后 +${(g.from - clickT).toFixed(0)}ms)` : ""
      console.log(`      阻塞 ${g.dur.toFixed(0)}ms  起于 t=${g.from.toFixed(0)}${rel}`)
    }
    const last = hb[hb.length - 1]
    console.log(`\n   最后心跳: t=${last.toFixed(1)}${clickT ? ` (点击后 +${(last - clickT).toFixed(0)}ms)` : ""}`)
    console.log(`   ${gaps.length === 0 ? "→ 主线程全程未被长时间阻塞 ⇒ 时间花在浏览器内部等待（非 JS 可优化）" : "→ 存在主线程阻塞段 ⇒ 有 JS 热点可优化"}`)
  } else {
    console.log("   ⚠ 心跳样本不足")
  }

  fs.writeFileSync(`${OUT}/hb-${LABEL}.json`, JSON.stringify({ label: LABEL, hb, marks, wall: tNavWall - tClickWall }, null, 2))
  console.log(`\n   明细: ${OUT}/hb-${LABEL}.json`)
  await browser.close()
}

main().catch((e) => { console.error("探针异常:", e); process.exit(2) })
