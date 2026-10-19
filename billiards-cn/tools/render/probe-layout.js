const puppeteer = require("puppeteer-core")
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function main() {
  const browser = await puppeteer.launch({
    executablePath: "/usr/bin/google-chrome", headless: true, protocolTimeout: 45000,
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu", "--user-data-dir=/tmp/chrome-lay", "--window-size=393,851"],
  })
  const page = await browser.newPage()
  await page.goto("http://127.0.0.1:8160/dist/play.html?ruletype=eightball&bot=ClawBreak", { waitUntil: "domcontentloaded", timeout: 120000 })
  const t0 = Date.now()
  while (Date.now() - t0 < 90000) {
    const ok = await page.evaluate(() => {
      const c = window.container
      const cue = c && c.table && c.table.cue
      if (!cue || !cue.aimInputs) return false
      const ack = document.querySelector('[data-tut-ack="1"]')
      if (ack) { ack.click(); return false }
      const n = c.controller && c.controller.name
      if (n === "PlaceBall") { document.getElementById("cueHit")?.click(); return false }
      return !cue.aimInputs.isDisabled() && typeof c.controller.playShot === "function"
    }).catch(() => false)
    if (ok) break
    await sleep(80)
  }
  await sleep(500)
  const r = await page.evaluate(() => {
    const c = window.container
    const t = c.table
    const balls = t.balls.map((b, i) => ({
      i, label: b.label, x: +b.pos.x.toFixed(4), y: +b.pos.y.toFixed(4), z: +b.pos.z.toFixed(4), on: b.onTable(),
    }))
    const cueBall = t.cueball
    return {
      ctrl: c.controller.name,
      rule: c.rules.rulename,
      cue: { x: +cueBall.pos.x.toFixed(4), z: +cueBall.pos.z.toFixed(4) },
      balls,
    }
  })
  console.log("ctrl:", r.ctrl, "rule:", r.rule)
  console.log("白球:", JSON.stringify(r.cue))
  for (const b of r.balls) console.log(`  #${b.i} label=${b.label} (${b.x}, ${b.y}, ${b.z}) on=${b.on}`)
  await browser.close()
}
main().catch((e) => { console.error("fail:", e); process.exit(1) })
