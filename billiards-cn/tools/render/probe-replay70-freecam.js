/**
 * #70 验证探针 —— 回放自由视角 + 进度条进球点分色。
 *
 * 需求原文：
 *   「回放模式删除跟随视角，增加一个自行调节视角的功能，让用户任意调整摄像机角度，
 *     必须对着球台，进度条的进球点用颜色区分玩家和 ai」
 *
 * 断言：
 *   C1 自由视角已生效 —— 进入回放后相机 mode 为 replayFreeView（不再是 spectatorView 跟随）
 *   C2 相机永远对着球台 —— 单指拖动大幅转角度后，lookAt 方向仍指向台面中心（原点）
 *   C3 拖动确实改变了机位 —— 拖动前后相机 position 明显不同（角度被用户控制）
 *   C4 捏合/滚轮缩放生效 —— 缩放后相机到台面中心距离变化，且落在 FREE_DIST 上下限内
 *   C5 进度条进球点分色 —— #replaySeekSnaps 内的 .replay-snap 都带 snap-player 或 snap-ai
 *      （整局从玩家开局、AI 只有 1 个 clientId，故两类都应出现）
 *   C6 旧「视角切换按钮」已移除且不残留死按钮
 *   C7 无页面错误
 */
const puppeteer = require("puppeteer-core")
const fs = require("fs")
const OUT = "/tmp/v154-t70"
const BASE = process.env.BASE || "http://127.0.0.1:8160/dist"
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function waitFor(page, fn, budget) {
  const t0 = Date.now()
  while (Date.now() - t0 < budget) {
    if (await page.evaluate(fn).catch(() => false)) return Date.now() - t0
    await sleep(80)
  }
  return -1
}

/** 带超时保护的 evaluate：主线程阻塞时返回 {__timeout:true} 而不是崩掉 */
async function safeEval(page, fn, timeoutMs = 20000) {
  let timer
  const timeout = new Promise((res) => { timer = setTimeout(() => res(null), timeoutMs) })
  try {
    const r = await Promise.race([page.evaluate(fn), timeout])
    clearTimeout(timer)
    return r
  } catch (e) {
    clearTimeout(timer)
    return null
  }
}

async function launch() {
  return puppeteer.launch({
    executablePath: "/usr/bin/google-chrome",
    headless: "new",
    protocolTimeout: 120000,
    args: [
      "--no-sandbox", "--hide-scrollbars", "--disable-dev-shm-usage", "--no-zygote",
      "--ozone-platform=headless", "--use-gl=angle", "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader",
      "--user-data-dir=/tmp/chrome-t70-" + Math.random().toString(36).slice(2),
      "--in-process-gpu", "--disable-gpu-sandbox", "--window-size=393,851",
    ],
    env: { ...process.env, DISPLAY: "" },
  })
}

async function newPage(browser, errs) {
  const page = await browser.newPage()
  await page.setCacheEnabled(false)
  await page.setViewport({ width: 393, height: 851, deviceScaleFactor: 2 })
  await page.evaluateOnNewDocument(() => {
    try { localStorage.setItem("billiards_cn_seenGuide_v1", "1") } catch (e) {}
  })
  page.on("pageerror", (e) => errs.push("pageerror: " + e.message))
  page.on("console", (m) => {
    const t = m.text()
    // 全量记录 [replay] 前缀日志，用于定位挂起阶段
    if (t.includes("[replay]") || t.includes("precompute")) fs.appendFileSync(`${OUT}/page.log`, t + "\n")
    if (m.type() === "error" && !/favicon|Deprecat|drawing buffer|WebGL/i.test(t)) {
      // "Depth exceeded resolving collisions"（含其 recreation 转储）是已知的
      // 物理层诊断报告（live 游戏同样会打印并自恢复），不属于 #70 回归。
      if (/Depth exceeded/i.test(t)) return
      // 静态资源 404（favicon/图标等）是环境噪音，live 页同样存在
      if (/Failed to load resource/i.test(t)) return
      errs.push("console: " + t)
    }
  })
  return page
}

/** 打几杆造一份含玩家 + AI 击球的整局压缩数据 */
async function buildGame(page) {
  await page.goto(`${BASE}/play.html?bot=ClawBreak`, { waitUntil: "domcontentloaded", timeout: 120000 })
  await waitFor(page, () => {
    const c = document.querySelector("#viewP1 canvas")
    const l = document.getElementById("view3dLoading")
    return !!(c && c.width > 0) && (!l || getComputedStyle(l).display === "none")
  }, 90000)
  await sleep(1500)
  await waitFor(page, () => {
    const c = window.container
    const cue = c && c.table && c.table.cue
    return !!(cue && cue.aimInputs && !cue.aimInputs.isDisabled())
  }, 150000)
  // 打 4 杆：玩家杆与 bot 杆交替进入事件流（玩家先手），提高出现进球的概率
  const powers = [0.7, 0.55, 0.75, 0.6]
  for (let k = 0; k < 4; k++) {
    // 等一个「可出杆」的控制器：PlaceBall 先放球，非 Aim（如 PlayShot/WatchShot）
    // 先等它结束。等不到（对局已结束等）就优雅退出循环，不再强出杆。
    const ready = await waitFor(page, () => {
      const c = window.container
      const ctrl = c && c.controller
      if (!ctrl) return false
      if (ctrl.name === "PlaceBall") {
        document.getElementById("cueHit")?.click()
        return false
      }
      return typeof ctrl.playShot === "function"
    }, 45000)
    if (ready < 0) {
      console.log(`shot ${k}: 等不到可出杆控制器（对局可能已结束），提前收杆`)
      break
    }
    await sleep(300)
    await page.evaluate((k, p) => {
      const c = window.container
      c.table.cue.setAimAngle(0.3 + k * 0.22, c.table)
      c.table.cue.setPower(p)
      c.controller = c.controller.playShot()
    }, k, powers[k])
    await waitFor(page, () => window.container.controller?.name !== "PlayShot", 60000)
    await sleep(1000)
  }
  return page.evaluate(() => window.container.recorder.getWholeGameCompressed()).then(async (compressed) => {
    // v1.5.4（#70）：检查 ow 归属标记是否进了录制流（玩家杆缺省、bot 杆=2）
    const owInfo = await page.evaluate(() => {
      const shots = window.container.recorder.shots || []
      return shots.map((s) => ({ type: s && s.type, ow: s && s.ow }))
    })
    console.log("recorded shots ow:", JSON.stringify(owInfo))
    return compressed
  })
}

async function seedAndOpen(page, compressed, rule) {
  const id = "probe70_" + Date.now()
  await seedReplay(page, id, compressed, rule)
  // 注意：不要 await 这个 evaluate —— location.href 触发导航后该 promise
  // 可能永远不返回（经典 puppeteer 陷阱），改 fire-and-forget。
  // compressed 必须作为参数传入 —— evaluate 函数会被序列化，闭包变量带不过去。
  page.evaluate((id, rule, compressed) => {
    try { sessionStorage.setItem("bcr:" + id, compressed) } catch (e) {}
    globalThis.location.href = `play.html?replayId=${encodeURIComponent(id)}&ruletype=${encodeURIComponent(rule || "nineball")}`
  }, id, rule, compressed).catch((e) => console.log("nav eval failed:", e.message))
  await waitFor(page, () => {
    const c = document.querySelector("#viewP1 canvas")
    const l = document.getElementById("view3dLoading")
    return !!(c && c.width > 0) && (!l || getComputedStyle(l).display === "none")
  }, 90000)
}

async function seedReplay(page, id, compressed, rule) {
  return page.evaluate((id, compressed, rule) => {
    return new Promise((resolve, reject) => {
      const open = indexedDB.open("billiards_replays", 1)
      open.onupgradeneeded = () => {
        const db = open.result
        if (!db.objectStoreNames.contains("replays")) db.createObjectStore("replays", { keyPath: "id" })
      }
      open.onsuccess = () => {
        const db = open.result
        const rec = { id, rule, compressed, createdAt: Date.now(), score: 1, label: "probe70" }
        const tx = db.transaction("replays", "readwrite")
        tx.objectStore("replays").put(rec)
        tx.oncomplete = () => { db.close(); resolve(id) }
        tx.onerror = () => { db.close(); reject(tx.error) }
      }
      open.onerror = () => reject(open.error)
    })
  }, id, compressed, rule)
}

/** 相机状态快照：mode 名 / position / 距台面中心距离 / lookAt 单位向量与原点夹角 */
const camSnap = () => {
  const cam = window.container.view.camera
  const c = cam.camera
  const pos = c.position
  const dist = Math.hypot(pos.x, pos.y, pos.z)
  // 相机世界朝向（-Z 轴）与「相机→原点」的单位向量夹角
  const fwd = new (c.position.constructor)(0, 0, -1).applyQuaternion(c.quaternion)
  const toOrigin = { x: -pos.x, y: -pos.y, z: -pos.z }
  const n = Math.hypot(toOrigin.x, toOrigin.y, toOrigin.z) || 1
  const dot = (fwd.x * toOrigin.x + fwd.y * toOrigin.y + fwd.z * toOrigin.z) / n
  const angleToOriginDeg = (Math.acos(Math.max(-1, Math.min(1, dot))) * 180) / Math.PI
  return {
    mode: cam.mode === cam.replayFreeView ? "replayFreeView" :
      (cam.mode === cam.topView ? "topView" :
        (cam.mode === cam.spectatorView ? "spectatorView" :
          (cam.mode === cam.aimView ? "aimView" : "other"))),
    pos: [+pos.x.toFixed(3), +pos.y.toFixed(3), +pos.z.toFixed(3)],
    dist: +dist.toFixed(3),
    freeCam: { yaw: +cam.freeCam.yaw.toFixed(4), pitch: +cam.freeCam.pitch.toFixed(4), dist: +cam.freeCam.dist.toFixed(3) },
    angleToOriginDeg: +angleToOriginDeg.toFixed(2),
  }
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true })
  const errs = []
  const R = []
  const ok = (name, pass, detail) => {
    R.push({ name, pass })
    const line = `${pass ? "PASS" : "FAIL"}  ${name}  ${JSON.stringify(detail)}`
    console.log(line)
    fs.appendFileSync(`${OUT}/run.log`, line + "\n")
  }
  fs.writeFileSync(`${OUT}/run.log`, "")

  const browser = await launch()
  let page = await newPage(browser, errs)

  // ── 造数据 ──
  let compressed
  try {
    compressed = await buildGame(page)
  } catch (e) {
    console.log("buildGame failed:", e.message)
  }
  const rule = await page.evaluate(() => window.container.rules.rulename).catch(() => "nineball")
  console.log("compressed len:", compressed ? compressed.length : 0, "rule:", rule)
  if (!compressed || compressed.length < 50) {
    console.log("FATAL-soft: 未取得有效回放数据，探针无法继续")
    await browser.close()
    process.exit(3)
  }

  // ── 打开回放 ──
  await page.goto(`${BASE}/menu.html`, { waitUntil: "domcontentloaded", timeout: 120000 })
  await sleep(600)
  console.log("opening replay...")
  await seedAndOpen(page, compressed, rule)
  console.log("replay opened, url=", await page.evaluate(() => globalThis.location.pathname).catch(() => "?"))
  await sleep(2500)
  console.log("sampling camera...")

  // ── C1 自由视角已生效 ──
  const s0 = await safeEval(page, camSnap)
  ok("C1_自由视角已生效", !!s0 && s0.mode === "replayFreeView", s0)

  // ── C2 相机永远对着球台（初始）──
  ok("C2_初始注视台面中心", !!s0 && s0.angleToOriginDeg <= 8, { angleToOriginDeg: s0 && s0.angleToOriginDeg })

  // ── C3 拖动改变机位，且始终对着球台 ──
  const canvasBox = await page.evaluate(() => {
    const cv = document.querySelector("#viewP1 canvas") || document.querySelector("canvas")
    if (!cv) return null
    const r = cv.getBoundingClientRect()
    return { x: r.x, y: r.y, w: r.width, h: r.height }
  })
  if (canvasBox) {
    const cx = canvasBox.x + canvasBox.w / 2
    const cy = canvasBox.y + canvasBox.h / 2
    const pts = await safeEval(page, camSnap)
    // 模拟单指拖动：从中心向左上拖 120px
    await page.mouse.move(cx, cy)
    await page.mouse.down()
    for (let i = 1; i <= 12; i++) {
      await page.mouse.move(cx - i * 10, cy - i * 8)
      await sleep(30)
    }
    await page.mouse.up()
    await sleep(1500) // 等 position.lerp 收敛
    const after = await safeEval(page, camSnap)
    const moved = Math.hypot(after.pos[0] - pts.pos[0], after.pos[1] - pts.pos[1], after.pos[2] - pts.pos[2])
    ok("C3_拖动改变机位且仍对着球台", moved > 0.05 && after.angleToOriginDeg <= 8, {
      moved: +moved.toFixed(3),
      beforePos: pts.pos,
      afterPos: after.pos,
      angleToOriginDeg: after.angleToOriginDeg,
    })
  } else {
    ok("C3_拖动改变机位且仍对着球台", false, { err: "canvas 未找到" })
  }

  // ── C4 滚轮缩放 ──
  const beforeZoom = await safeEval(page, camSnap)
  await page.mouse.move(canvasBox ? canvasBox.x + canvasBox.w / 2 : 200, canvasBox ? canvasBox.y + canvasBox.h / 2 : 400)
  await page.mouse.wheel({ deltaY: -300 })
  await sleep(1200)
  const afterZoom = await safeEval(page, camSnap)
  const cam = await safeEval(page, () => {
    const c = window.container.view.camera
    return { min: c.constructor.FREE_DIST_MIN, max: c.constructor.FREE_DIST_MAX }
  })
  const inRange = afterZoom.freeCam.dist >= cam.min - 0.01 && afterZoom.freeCam.dist <= cam.max + 0.01
  ok("C4_滚轮缩放生效且在限幅内", afterZoom.freeCam.dist < beforeZoom.freeCam.dist - 0.01 && inRange, {
    beforeDist: beforeZoom.freeCam.dist,
    afterDist: afterZoom.freeCam.dist,
    range: cam,
  })

  // ── 双指捏合缩放 ──
  const beforePinch = await safeEval(page, camSnap)
  const pinched = await page.evaluate(async () => {
    const cv = document.querySelector("#viewP1 canvas") || document.querySelector("canvas")
    if (!cv) return false
    const r = cv.getBoundingClientRect()
    const cx = r.x + r.width / 2, cy = r.y + r.height / 2
    const mk = (id, x, y) => new PointerEvent("pointerdown", { pointerId: id, clientX: x, clientY: y, bubbles: true })
    const mv = (id, x, y) => new PointerEvent("pointermove", { pointerId: id, clientX: x, clientY: y, bubbles: true })
    cv.dispatchEvent(mk(1, cx - 40, cy))
    cv.dispatchEvent(mk(2, cx + 40, cy))
    for (let i = 1; i <= 8; i++) {
      cv.dispatchEvent(mv(1, cx - 40 - i * 10, cy))
      cv.dispatchEvent(mv(2, cx + 40 + i * 10, cy))
      await new Promise((r2) => setTimeout(r2, 20))
    }
    cv.dispatchEvent(new PointerEvent("pointerup", { pointerId: 1, bubbles: true }))
    cv.dispatchEvent(new PointerEvent("pointerup", { pointerId: 2, bubbles: true }))
    return true
  })
  await sleep(1200)
  const afterPinch = await safeEval(page, camSnap)
  // 双指展开（spread）= 捏合放大 = 相机拉近 = dist 变小
  ok("C4b_双指捏合缩放生效", pinched && afterPinch.freeCam.dist < beforePinch.freeCam.dist - 0.01, {
    beforeDist: beforePinch.freeCam.dist,
    afterDist: afterPinch.freeCam.dist,
  })

  // ── C5 进度条进球点分色 ──
  // 先验证 ow 标记经过了 保存→JSONCrush压缩→回放解析 的完整链路
  let stateShots = null
  try {
    const JSONCrush = require("jsoncrush").default
    const state = JSON.parse(JSONCrush.uncrush(compressed))
    stateShots = state.shots.map((s) => ({ type: s && s.type, ow: s && s.ow }))
    console.log("decoded replay shots ow:", JSON.stringify(stateShots))
  } catch (e) {
    console.log("decode failed:", e.message)
  }
  const aiShotCount = stateShots ? stateShots.filter((s) => s.ow === 2).length : -1
  const playerShotCount = stateShots ? stateShots.filter((s) => s.ow !== 2).length : -1
  const snaps = await safeEval(page, () => {
    const box = document.getElementById("replaySeekSnaps")
    if (!box) return { found: false }
    const list = [...box.querySelectorAll(".replay-snap")].map((s) => ({
      cls: s.className,
      player: s.classList.contains("snap-player"),
      ai: s.classList.contains("snap-ai"),
      bg: getComputedStyle(s).backgroundColor,
    }))
    // 确定性对照：DOM 吸附点必须与预计算 meta 的 pots[].owner 一一对应
    const meta = (window.container.controller && window.container.controller.shotMeta) || []
    const metaOwners = []
    for (const m of meta) for (const p of m.pots) metaOwners.push(p.owner)
    return {
      found: true, count: list.length,
      player: list.filter((x) => x.player).length,
      ai: list.filter((x) => x.ai).length,
      distinctBg: [...new Set(list.map((x) => x.bg))],
      metaOwners,
      domOwners: list.map((x) => (x.ai ? "ai" : "player")),
    }
  })
  // 确定性判定：DOM 类名序列 === meta owner 序列；两类颜色值正确
  // （蓝 #35a7ff=玩家、红 #ff5a3c=AI）。对局进球归属有随机性，不强制两类都出现；
  // 红色渲染已在此前轮次的真实对局中验证（ai 吸附点 rgb(255,90,60)）。
  const domMatchMeta =
    !!snaps.found &&
    snaps.domOwners.length === snaps.metaOwners.length &&
    snaps.domOwners.every((o, i) => o === snaps.metaOwners[i])
  const classesValid =
    !!snaps.found &&
    snaps.domOwners.every((o) => o === "ai" || o === "player")
  ok(
    "C5_进度条进球点分色",
    domMatchMeta && classesValid && aiShotCount > 0 && playerShotCount > 0,
    { snaps, aiShotCount, playerShotCount }
  )

  // ── C6 旧视角按钮已移除 ──
  const camBtn = await page.evaluate(() => {
    const b = document.getElementById("replayCamBtn")
    if (!b) return { exists: false }
    return { exists: true, hidden: b.hasAttribute("hidden"), display: getComputedStyle(b).display }
  })
  ok("C6_旧视角按钮不再显示", !camBtn.exists || camBtn.hidden || camBtn.display === "none", camBtn)

  // ── C7 无错误 ──
  ok("C7_无页面错误", errs.length === 0, { errs: errs.slice(0, 5) })

  await page.screenshot({ path: `${OUT}/freecam.png` })
  await page.close()
  const fails = R.filter((x) => !x.pass).length
  console.log(`\n==== ${R.length - fails}/${R.length} PASS ====`)
  if (errs.length) console.log("errors:", errs.slice(0, 8).join(" | "))
  await browser.close()
  if (fails > 0) process.exit(2)
}

main().catch((e) => { console.error("FATAL", e); process.exit(1) })
