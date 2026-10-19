/**
 * v1.5.5（#75）实机验证探针 —— 回放列表「删除」二次确认弹窗。
 *
 * 路径（真实点击驱动 menu-cn.js 的 openDeleteConfirm/closeDeleteConfirm）：
 *   ① 往 IndexedDB(billiards_replays/replays) 播种 2 条测试记录
 *   ② 菜单点「查看回放」→ 列表渲染 2 项
 *   ③ 点「删除」→ #replayDeleteConfirm 弹出且 #replayDelName 带记录名（不立即删）
 *   ④ 点「取消」→ 弹窗关，记录仍在库（确认框真的挡住了删除）
 *   ⑤ 再点「删除」→ 点「确认删除」→ 弹窗关，记录从库里消失，列表刷新
 *   ⑥ 再点「删除」→ 点弹窗 backdrop → 仅关弹窗，记录仍在
 *   ⑦ 全程零 pageerror
 */
const puppeteer = require("puppeteer-core")
const fs = require("fs")
const OUT = "/tmp/v155-del"
const BASE = process.env.BASE || "http://127.0.0.1:8160/dist"
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function tmo(p, ms, label) {
  return Promise.race([
    p,
    new Promise((_, rej) => setTimeout(() => rej(new Error(`TMO(${label})`)), ms)),
  ])
}
async function launch() {
  return puppeteer.launch({
    executablePath: "/usr/bin/google-chrome",
    headless: true,
    protocolTimeout: 45000,
    args: [
      "--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu",
      "--user-data-dir=/tmp/chrome-delv", "--window-size=393,851",
    ],
    env: { ...process.env, DISPLAY: "" },
  })
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true })
  const browser = await launch()
  const page = await browser.newPage()
  await page.setCacheEnabled(false)
  await page.setViewport({ width: 393, height: 851, deviceScaleFactor: 1 })
  const errs = []
  page.on("pageerror", (e) => errs.push(String(e).slice(0, 160)))
  const ok = (name, pass, detail) => console.log(`${pass ? "PASS" : "FAIL"}  ${name}  ${JSON.stringify(detail).slice(0, 240)}`)

  console.log("[1] 开菜单并播种两条回放记录…")
  await page.goto(`${BASE}/menu.html`, { waitUntil: "domcontentloaded", timeout: 60000 })
  await sleep(1500)
  const seeded = await tmo(page.evaluate(() => {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open("billiards_replays", 1)
      req.onupgradeneeded = () => {
        const db = req.result
        if (!db.objectStoreNames.contains("replays")) {
          db.createObjectStore("replays", { keyPath: "id" })
        }
      }
      req.onerror = () => reject(req.error)
      req.onsuccess = () => {
        const db = req.result
        const tx = db.transaction("replays", "readwrite")
        const st = tx.objectStore("replays")
        st.put({ id: "probe75a", createdAt: Date.now() - 1000, rule: "nineball", label: "测试回放A", compressed: "AAAA" })
        st.put({ id: "probe75b", createdAt: Date.now(), rule: "eightball", label: "测试回放B", compressed: "BBBB" })
        tx.oncomplete = () => { db.close(); resolve(true) }
        tx.onerror = () => { db.close(); reject(tx.error) }
      }
    })
  }), 10000, "seed")
  if (!seeded) throw new Error("播种失败")

  const count0 = await tmo(page.evaluate(() => new Promise((res) => {
    const req = indexedDB.open("billiards_replays", 1)
    req.onsuccess = () => {
      const db = req.result
      const tx = db.transaction("replays", "readonly")
      const g = tx.objectStore("replays").getAll()
      g.onsuccess = () => { db.close(); res(g.result.length) }
    }
  })), 8000, "count0")
  console.log("库内记录数:", count0)

  console.log("[2] 打开回放列表…")
  await tmo(page.evaluate(() => document.getElementById("btnReplays").click()), 8000, "btn")
  await sleep(500)
  const listState = await tmo(page.evaluate(() => ({
    overlayHidden: document.getElementById("replayListOverlay").hidden,
    items: document.querySelectorAll(".replay-item").length,
    confirmHidden: document.getElementById("replayDeleteConfirm").hidden,
  })), 8000, "list")
  ok("D1_列表打开且渲染2项", !listState.overlayHidden && listState.items === 2 && listState.confirmHidden, listState)

  console.log("[3] 点第一行「删除」→ 确认框应弹出且不落库…")
  await tmo(page.evaluate(() => document.querySelector(".replay-item .replay-del").click()), 8000, "del1")
  await sleep(300)
  const c1 = await tmo(page.evaluate(() => ({
    confirmHidden: document.getElementById("replayDeleteConfirm").hidden,
    name: document.getElementById("replayDelName")?.textContent || "",
  })), 8000, "c1")
  ok("D2_删除弹出确认框", !c1.confirmHidden && c1.name.includes("测试回放"), c1)

  console.log("[4] 点「取消」→ 记录应仍在…")
  await tmo(page.evaluate(() => {
    const btns = document.querySelectorAll("#replayDeleteConfirm [data-replay-del-cancel]")
    btns[btns.length - 1].click() // 最后一个是「取消」按钮（第一个是 backdrop）
  }), 8000, "cancel")
  await sleep(300)
  const a1 = await tmo(page.evaluate(() => new Promise((res) => {
    const req = indexedDB.open("billiards_replays", 1)
    req.onsuccess = () => {
      const db = req.result
      const g = db.transaction("replays", "readonly").objectStore("replays").getAll()
      g.onsuccess = () => { db.close(); res({ n: g.result.length, ids: g.result.map((r) => r.id) }) }
    }
  })), 8000, "a1")
  ok("D3_取消后记录仍在", a1.n === 2 && a1.ids.includes("probe75a"), a1)

  console.log("[5] 再点「删除」→ 点「确认删除」→ 记录应消失…")
  await tmo(page.evaluate(() => document.querySelector(".replay-item .replay-del").click()), 8000, "del2")
  await sleep(200)
  await tmo(page.evaluate(() => document.getElementById("replayDelYes").click()), 8000, "yes")
  // 时间序列采样：观察列表刷新时序（判断「慢刷新」还是「未刷新」）
  const refreshSeq = []
  for (const ms of [200, 300, 500, 800]) {
    await sleep(ms)
    refreshSeq.push(await tmo(page.evaluate(() => new Promise((res) => {
      const req = indexedDB.open("billiards_replays", 1)
      req.onsuccess = () => {
        const db = req.result
        const g = db.transaction("replays", "readonly").objectStore("replays").getAll()
        g.onsuccess = () => { db.close(); res({ items: document.querySelectorAll(".replay-item").length, n: g.result.length }) }
      }
    })), 8000, "rf"))
  }
  console.log("刷新时间序列:", JSON.stringify(refreshSeq))
  const a2 = await tmo(page.evaluate(() => new Promise((res) => {
    const req = indexedDB.open("billiards_replays", 1)
    req.onsuccess = () => {
      const db = req.result
      const g = db.transaction("replays", "readonly").objectStore("replays").getAll()
      g.onsuccess = () => { db.close(); res({ n: g.result.length, ids: g.result.map((r) => r.id), items: document.querySelectorAll(".replay-item").length }) }
    }
  })), 8000, "a2")
  ok("D4_确认后记录删除且列表刷新", a2.n === 1 && a2.ids[0] === "probe75a" && a2.items === 1, a2)

  console.log("[6] 点「删除」→ 点 backdrop → 仅关弹窗…")
  await tmo(page.evaluate(() => document.querySelector(".replay-item .replay-del").click()), 8000, "del3")
  await sleep(200)
  await tmo(page.evaluate(() => {
    document.querySelector("#replayDeleteConfirm [data-replay-del-cancel]").click() // 第一个是 backdrop
  }), 8000, "bdrop")
  await sleep(300)
  const a3 = await tmo(page.evaluate(() => ({
    confirmHidden: document.getElementById("replayDeleteConfirm").hidden,
  })), 8000, "a3")
  ok("D5_backdrop关闭且未误删", a3.confirmHidden, a3)
  const a4 = await tmo(page.evaluate(() => new Promise((res) => {
    const req = indexedDB.open("billiards_replays", 1)
    req.onsuccess = () => {
      const db = req.result
      const g = db.transaction("replays", "readonly").objectStore("replays").getAll()
      g.onsuccess = () => { db.close(); res(g.result.length) }
    }
  })), 8000, "a4")
  ok("D6_backdrop未删记录", a4 === 1, { n: a4 })

  ok("D7_零页面错误", errs.length === 0, errs.slice(0, 3))
  console.log("\n合计：#75 删除二次确认验证完成")
  fs.writeFileSync(`${OUT}/del.json`, JSON.stringify({ listState, c1, a1, a2, a3, a4, errs }, null, 2))
  await browser.close()
  process.exit(0)
}

main().catch((e) => {
  console.error("探针异常:", e)
  process.exit(2)
})
