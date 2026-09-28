const puppeteer = require("puppeteer-core")
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function main() {
  const browser = await puppeteer.launch({
    executablePath: "/usr/bin/google-chrome", headless: "new",
    args: ["--no-sandbox","--ozone-platform=headless","--use-gl=angle","--use-angle=swiftshader","--enable-unsafe-swiftshader","--user-data-dir=/tmp/chrome-cl152","--window-size=393,851"],
    env: { ...process.env, DISPLAY: "" },
  })
  const page = await browser.newPage()
  await page.setCacheEnabled(false)
  const errs = []
  page.on("pageerror", (e) => errs.push(String(e).slice(0,100)))
  await page.goto("http://127.0.0.1:8151/dist/menu.html", { waitUntil: "networkidle2", timeout: 60000 })
  await sleep(1200)
  // 进 设置 → 变更履历
  const tap = async (sel) => { const el = await page.$(sel); if (!el) return false; const b = await el.boundingBox(); if(!b) return false; await page.touchscreen.touchStart(b.x+b.width/2, b.y+b.height/2); await page.touchscreen.touchEnd(); await sleep(400); return true }
  await tap('#btnSettings')
  await tap('#btnChangelog')
  await sleep(1500)
  const info = await page.evaluate(() => {
    const body = document.getElementById("changelogBody")
    return {
      loaded: !!body && body.children.length > 3,
      firstH3: body ? (body.querySelector("h3") || {}).textContent || "" : "",
      has152: body ? body.innerHTML.includes("v1.5.2") : false,
      children: body ? body.children.length : 0,
      backBtnVisible: (() => { const b = document.querySelector("#screen-changelog > .back-btn"); if (!b) return false; const r = b.getBoundingClientRect(); return r.width > 0 && r.height > 0 })(),
    }
  })
  console.log("履历懒加载:", JSON.stringify(info, null, 2))
  console.log("v1.5.2 条目置顶:", info.firstH3.includes("v1.5.2") ? "✓" : "✗", "| 返回按钮可见:", info.backBtnVisible ? "✓" : "✗", "| 页面错误:", errs.length ? errs : "无")
  await browser.close()
}
main().catch((e) => { console.error("异常:", e); process.exit(2) })
