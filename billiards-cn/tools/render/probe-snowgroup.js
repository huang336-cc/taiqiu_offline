const puppeteer = require("puppeteer-core")
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function waitFor(page, fn, budget) {
  const t0 = Date.now()
  while (Date.now() - t0 < budget) {
    if (await page.evaluate(fn).catch(() => false)) return true
    await sleep(80)
  }
  return false
}
async function survey(browser, base, tag) {
  const page = await browser.newPage()
  await page.goto(`${base}/dist/play.html?bot=ClawBreak`, { waitUntil: "domcontentloaded", timeout: 120000 })
  await waitFor(page, () => {
    const c = document.querySelector("#viewP1 canvas")
    return !!(c && c.width > 0)
  }, 90000)
  await waitFor(page, () => {
    const v = window.container && window.container.view
    return !!(v && v.sceneEnv && v.sceneEnv.children.length > 0)
  }, 30000)
  await sleep(800)
  const r = await page.evaluate(() => {
    let found = null
    window.container.view.sceneEnv.traverse((o) => { if (o.name === "SnowRocks") found = true })
    const names = window.container.view.sceneEnv.children.map((o) => o.name || "(anon)")
    return { snowRocks: !!found, topGroups: names }
  })
  console.log(`[${tag}]`, JSON.stringify(r))
  page.close()
  return r
}
async function main() {
  const browser = await puppeteer.launch({
    executablePath: "/usr/bin/google-chrome", headless: true, protocolTimeout: 45000,
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu", "--user-data-dir=/tmp/chrome-sg", "--window-size=393,851"],
  })
  const oldR = await survey(browser, "http://127.0.0.1:8161", "OLD v1.5.4")
  const newR = await survey(browser, "http://127.0.0.1:8160", "NEW v1.5.5")
  console.log(oldR.snowRocks && !newR.snowRocks ? "PASS  SnowRocks组 旧有新无（#74 删除实锤）" : "FAIL  " + JSON.stringify({ old: oldR.snowRocks, new: newR.snowRocks }))
  await browser.close()
}
main().catch((e) => { console.error("fail:", e.message); process.exit(1) })
