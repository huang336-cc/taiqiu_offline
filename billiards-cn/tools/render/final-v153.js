/**
 * v1.5.3 —— **发布站点终验**（面向 http://127.0.0.1:3000，即 publish-online）。
 *   A. 发布页 index.html：标题/版本、APK 与 zip 下载链接是否指向 v1.5.3（HEAD 200）
 *   B. menu.html 版本戳 = 1.5.3-26092803，主界面可用
 *   C. 变更履历动态加载：正文首位 = v1.5.3，历史 v1.5.2/v1.5.0/v1.4.9/v1.0.4 无缺失
 *   D. 游戏内：打开击球点面板 → 无杆法按钮 → 真实拖动画辅助线 → 复位隐藏
 *   E. 全程零 pageerror
 */
const puppeteer = require("puppeteer-core")
const fs = require("fs")
const OUT = "/tmp/v153-final"
const BASE = "http://127.0.0.1:3000"
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function settle(page, sel = "#cueSpinGuide") {
  let prev = null
  for (let i = 0; i < 30; i++) {
    const v = await page
      .evaluate(
        (s) =>
          new Promise((res) => {
            requestAnimationFrame(() =>
              requestAnimationFrame(() => res(getComputedStyle(document.querySelector(s)).opacity))
            )
          }),
        sel
      )
      .catch(() => null)
    if (v !== null && prev !== null && v === prev) return v
    prev = v
    await sleep(70)
  }
  return prev
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true })
  const browser = await puppeteer.launch({
    executablePath: "/usr/bin/google-chrome",
    headless: "new",
    args: [
      "--no-sandbox", "--hide-scrollbars", "--disable-dev-shm-usage", "--no-zygote",
      "--ozone-platform=headless", "--use-gl=angle", "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader", "--user-data-dir=/tmp/chrome-v153fin",
      "--in-process-gpu", "--disable-gpu-sandbox", "--window-size=393,851",
    ],
    env: { ...process.env, DISPLAY: "" },
  })
  const page = await browser.newPage()
  await page.setCacheEnabled(false)
  await page.setViewport({ width: 393, height: 851, deviceScaleFactor: 1 })
  const errs = []
  page.on("pageerror", (e) => errs.push("pageerror: " + String(e).slice(0, 160)))

  const checks = []
  const push = (n, ok, d = "") => checks.push({ n, ok, d })
  console.log("════════ v1.5.3 发布站点终验 ════════\n")

  // ---------- A. 发布页 ----------
  const A = await page.goto(`${BASE}/index.html`, { waitUntil: "domcontentloaded", timeout: 60000 })
  push("A1 发布页 HTTP 200", A.status() === 200, String(A.status()))
  const apub = await page.evaluate(() => ({
    title: document.title,
    ver: document.querySelector(".brand .ver")?.innerText,
    apk: document.querySelector('a.dl[href$=".apk"]')?.getAttribute("href"),
    zip: document.querySelector('a.dl[href$=".zip"]')?.getAttribute("href"),
    cards: Array.from(document.querySelectorAll(".card h2")).map((h) => h.innerText),
  }))
  push("A2 标题含 v1.5.3", apub.title.includes("v1.5.3"), apub.title)
  push("A3 版本行 v1.5.3", (apub.ver || "").includes("v1.5.3"), apub.ver)
  push("A4 存在「v1.5.3 更新要点」卡片", (apub.cards || []).some((t) => t.toLowerCase().includes("v1.5.3 更新要点")), JSON.stringify(apub.cards))
  for (const [k, href] of [["APK", apub.apk], ["ZIP", apub.zip]]) {
    const r = await page.evaluate(async (h) => {
      const res = await fetch(h, { method: "HEAD" })
      return { s: res.status, len: res.headers.get("content-length") }
    }, href)
    push(`A5 ${k} 链接 ${href} 可下载（200）`, r.s === 200, `HTTP ${r.s} ${Math.round(r.len / 1e6 * 10) / 10}MB`)
  }
  await page.screenshot({ path: `${OUT}/publish.png` })

  // ---------- B. 菜单 ----------
  await page.goto(`${BASE}/menu.html`, { waitUntil: "domcontentloaded", timeout: 60000 })
  await page.waitForFunction(() => {
    const e = document.getElementById("btnStart")
    return !!e && e.getBoundingClientRect().width > 0
  }, { timeout: 60000 })
  const stamp = await page.evaluate(() => window.__BILLIARDS_VERSION__)
  push("B1 menu 版本戳 1.5.3-26092803", stamp === "1.5.3-26092803", stamp)
  await page.screenshot({ path: `${OUT}/menu.png` })

  // ---------- C. 变更履历 ----------
  await page.evaluate(() => document.getElementById("btnSettings")?.click())
  await sleep(500)
  await page.evaluate(() => document.getElementById("btnChangelog")?.click())
  await sleep(1200)
  const cl = await page.evaluate(() => {
    const body = document.getElementById("changelogBody")
    const heads = Array.from(body.querySelectorAll("h3")).map((h) => h.innerText)
    return { len: (body.innerText || "").length, heads: heads.slice(0, 4), total: heads.length }
  })
  push("C1 履历正文已注入（长度>1000）", cl.len > 1000, String(cl.len))
  push("C2 首条 = v1.5.3", (cl.heads[0] || "").startsWith("v1.5.3"), cl.heads[0])
  const must = ["v1.5.2", "v1.5.0", "v1.4.9", "v1.0.4"]
  const missing = []
  await page.evaluate(async (list) => {
    window.__clcheck = {}
    const body = document.getElementById("changelogBody")
    for (const v of list) window.__clcheck[v] = body.innerText.includes(v)
  }, must).catch(() => {})
  const clcheck = await page.evaluate(() => window.__clcheck || {}).catch(() => ({}))
  for (const v of must) push(`C3 历史条目 ${v} 无缺失`, clcheck[v] === true, String(clcheck[v]))
  await page.screenshot({ path: `${OUT}/changelog.png` })

  // ---------- D. 游戏内辅助线（发布产物） ----------
  await page.goto(`${BASE}/menu.html`, { waitUntil: "domcontentloaded", timeout: 60000 })
  await page.waitForFunction(() => {
    const e = document.getElementById("btnStart")
    return !!e && e.getBoundingClientRect().width > 0
  }, { timeout: 60000 })
  await sleep(800)
  await page.evaluate(() => document.getElementById("btnStart")?.click())
  const inScene = await page
    .waitForFunction(
      () => {
        const c = document.querySelector("#viewP1 canvas")
        const l = document.getElementById("view3dLoading")
        return !!(c && c.width > 0) && (!l || getComputedStyle(l).display === "none")
      },
      { timeout: 90000 }
    )
    .then(() => true)
    .catch(() => false)
  push("D1 开始游戏进入场景", inScene, "")
  await sleep(2000)
  await page.evaluate(() => document.getElementById("cueBallTrigger")?.click())
  await sleep(500)
  const D0 = await page.evaluate(() => ({
    popupOpen: !document.getElementById("cueballPopup")?.hidden,
    gearButtons: ["spinStun", "spinFollow", "spinDraw", "spinJump"].filter((i) => document.getElementById(i)),
    gearArea: !!document.querySelector(".cb-gear-area"),
    areas: document.querySelectorAll("#cueballPopup .cb-area").length,
  }))
  push("D2 面板打开", D0.popupOpen, "")
  push("D3 无杆法按钮/区域", D0.gearButtons.length === 0 && !D0.gearArea, JSON.stringify(D0.gearButtons))
  push("D4 面板只剩两块", D0.areas === 2, String(D0.areas))

  const b = await page.evaluate(() => {
    const r = document.getElementById("cueBall").getBoundingClientRect()
    return { x: r.left, y: r.top, w: r.width, h: r.height }
  })
  await page.mouse.move(b.x + b.w / 2, b.y + b.h / 2)
  await page.mouse.down()
  await page.mouse.move(b.x + b.w * 0.78, b.y + b.h * 0.24, { steps: 6 })
  await page.mouse.up()
  const op = await settle(page)
  const D1 = await page.evaluate(() => {
    const ball = document.getElementById("cueBall")
    const tip = document.getElementById("cueTip")
    const root = document.getElementById("cueSpinGuide")
    const vr = document.querySelector(".cue-guide-v")?.getBoundingClientRect()
    const hr = document.querySelector(".cue-guide-h")?.getBoundingClientRect()
    const br = ball.getBoundingClientRect()
    const tr = tip.getBoundingClientRect()
    return {
      visible: root.classList.contains("is-visible"),
      opacity: getComputedStyle(root).opacity,
      vd: Math.abs(vr.left + vr.width / 2 - (tr.left + tr.width / 2)).toFixed(2),
      hd: Math.abs(hr.top + hr.height / 2 - (tr.top + tr.height / 2)).toFixed(2),
      off: Math.hypot(tr.left + tr.width / 2 - (br.left + br.width / 2), tr.top + tr.height / 2 - (br.top + br.height / 2)).toFixed(1),
      rlen: parseFloat(document.getElementById("cueGuideRadial").style.width).toFixed(1),
    }
  })
  push("D5 真实拖动后辅助线显示", D1.visible && D1.opacity === "1", `opacity=${D1.opacity}`)
  // 说明：setSpin 有既有的物理钳制（击球点须落在球面接触区内），两次不同拖点
  // 都收敛到 ~28.4px 正是钳制生效；这里只要求「确实偏离中心」即拖动生效。
  push("D6 确实偏心（拖动已生效）", Number(D1.off) > 20, `${D1.off}px（受 setSpin 接触区钳制）`)
  push("D7 三线对齐杆头", Number(D1.vd) <= 1.5 && Number(D1.hd) <= 1.5, `${D1.vd}/${D1.hd}px`)
  push("D8 半径线长度=球心到杆头距离", Math.abs(Number(D1.rlen) - Number(D1.off)) <= 1.5, `${D1.rlen} vs ${D1.off}`)
  await page.screenshot({ path: `${OUT}/ingame-guide.png` })

  await page.evaluate(() => document.getElementById("resetSpin")?.click())
  const op2 = await settle(page)
  push("D9 复位后辅助线隐藏", op2 === "0", `opacity=${op2}`)

  // ---------- E ----------
  push("E1 全程零 pageerror", errs.length === 0, errs.join(" | ") || "无")

  let fail = 0
  for (const c of checks) {
    if (!c.ok) fail++
    console.log(`[${c.ok ? "PASS" : "FAIL"}] ${c.n}${c.d ? "  —— " + c.d : ""}`)
  }
  console.log(`\n合计 ${checks.length} 项，FAIL ${fail} 项`)
  fs.writeFileSync(`${OUT}/result.json`, JSON.stringify({ checks, errs }, null, 2))
  await browser.close()
  process.exit(fail === 0 ? 0 : 1)
}

main().catch((e) => {
  console.error("终验异常:", e)
  process.exit(2)
})
