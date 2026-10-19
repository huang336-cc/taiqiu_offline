const puppeteer = require("puppeteer-core")
async function main() {
  const browser = await puppeteer.launch({
    executablePath: "/usr/bin/google-chrome", headless: true,
    protocolTimeout: 20000,
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu", "--user-data-dir=/tmp/chrome-idbd2"],
  })
  const page = await browser.newPage()
  await page.goto("http://127.0.0.1:8160/dist/menu.html", { waitUntil: "domcontentloaded", timeout: 30000 })
  await new Promise(r => setTimeout(r, 1200))
  const r = await page.evaluate(() => new Promise((resolve) => {
    const out = { steps: [] }
    try {
      const req = indexedDB.open("billiards_replays", 1)
      req.onupgradeneeded = (e) => out.steps.push("upgrade:" + e.oldVersion + "->" + e.newVersion)
      req.onblocked = () => out.steps.push("blocked")
      req.onerror = () => resolve({ ...out, err: String(req.error) })
      req.onsuccess = () => {
        const db = req.result
        out.version = db.version
        out.stores = Array.from(db.objectStoreNames)
        const tx = db.transaction("replays", "readwrite")
        tx.objectStore("replays").put({ id: "diag1", createdAt: Date.now(), rule: "t", label: "t", compressed: "X" })
        tx.oncomplete = () => { db.close(); resolve({ ...out, put: "ok" }) }
        tx.onerror = () => { db.close(); resolve({ ...out, putErr: String(tx.error) }) }
      }
      setTimeout(() => resolve({ ...out, timeout: true }), 5000)
    } catch (e) { resolve({ ...out, exc: String(e) }) }
  }))
  console.log(JSON.stringify(r))
  await browser.close()
}
main().catch(e => { console.error("diag-fail:", e.message); process.exit(1) })
