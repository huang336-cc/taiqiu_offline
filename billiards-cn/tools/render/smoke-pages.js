// 【v1.4.3 发布冒烟】headless 打开 dist/index.html 与 dist/menu.html，
// 收集 console error / pageerror / requestfailed，输出版本串。
// 仅会话级验证工具，不属于构建链路。
const { chromium } = require("playwright-core")

async function main() {
  const b = await chromium.launch({ headless: true, args: ["--no-sandbox", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] })
  const targets = [
    ["index", "file:///workspace/dev/source/billiards-cn/dist/index.html"],
    ["menu-file", "file:///workspace/dev/source/billiards-cn/dist/menu.html"],
    ["menu-http", "http://127.0.0.1:8931/menu.html"],
  ]
  for (const [name, url] of targets) {
    const p = await b.newPage()
    const errs = []
    const failed = []
    p.on("console", (m) => { if (m.type() === "error") errs.push(m.text().slice(0, 220)) })
    p.on("pageerror", (e) => errs.push("PAGEERROR: " + String(e).slice(0, 220)))
    p.on("requestfailed", (r) => failed.push(r.url().slice(-100) + " :: " + (r.failure() || {}).errorText))
    const resp = null
    await p.goto(url, { waitUntil: "load", timeout: 30000 }).catch((e) => errs.push("GOTO: " + String(e).slice(0, 120)))
    await p.waitForTimeout(4000)
    const title = await p.title().catch(() => "?")
    const ver = await p.evaluate(`(function(){ var m = document.body && document.body.innerText && document.body.innerText.match(/v1\\.4\\.3[^\\n]*/); return m ? m[0] : "NO_V143_FOUND"; })()`).catch(() => "EVAL_FAIL")
    console.log("SMOKE " + name + " title=" + JSON.stringify(title) + " ver=" + JSON.stringify(ver))
    console.log("  errors(" + errs.length + "): " + JSON.stringify(errs.slice(0, 8)))
    console.log("  requestfailed(" + failed.length + "): " + JSON.stringify(failed.slice(0, 8)))
    await p.close()
  }
  await b.close()
}
main().catch((e) => { console.error("SMOKE_FAIL", e); process.exit(1) })
