/**
 * v1.5.6 真实用户路径探针 —— 走「菜单 → 我的回放 → 进入」，而非直灌 sessionStorage。
 *
 * 合成路径（seedAndOpen）测不出用户报的现象，因为少了菜单导航这一步：
 *   · 通知横幅：进回放由 menu 导航而来，监听必须跨导航存活（用 evaluateOnNewDocument）
 *   · 吸附点：除 DOM/class 外，还要验证**视觉可见**（rect 非零 + elementFromPoint 命中）
 *   · seek 往返 / 末尾时刻：在真实进入的回放上重测
 *
 *   R1 进回放不弹「自由练习 / 祝你好运」
 *   R2 吸附点可见且分色（玩家蓝 / AI 红）
 *   R3 seek 往返同一位置时刻一致
 *   R4 拖到末尾 = 对局结束时刻
 *   R5 零页面错误
 */
const puppeteer = require("puppeteer-core")
const fs = require("fs")
const OUT = "/tmp/v156-real"
const BASE = process.env.BASE || "http://127.0.0.1:8160/dist"
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
function tmo(p, ms, label) {
  return Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`TMO(${label})`)), ms))])
}
async function waitFor(page, fn, budget) {
  const t0 = Date.now()
  while (Date.now() - t0 < budget) {
    if (await page.evaluate(fn).catch(() => false)) return Date.now() - t0
    await sleep(60)
  }
  return -1
}
async function launch() {
  return puppeteer.launch({
    executablePath: "/usr/bin/google-chrome",
    headless: true,
    protocolTimeout: 45000,
    args: [
      "--no-sandbox", "--disable-dev-shm-usage", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader",
      "--user-data-dir=/tmp/chrome-r156r", "--window-size=393,851",
    ],
    env: { ...process.env, DISPLAY: "" },
  })
}

async function buildGame(page, n) {
  const RULE = process.env.RULE || "nineball"
  await page.goto(`${BASE}/play.html?bot=ClawBreak&ruletype=${RULE}`, { waitUntil: "domcontentloaded", timeout: 120000 })
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
  const powers = [0.72, 0.5, 0.78, 0.55, 0.68, 0.6]
  for (let k = 0; k < n; k++) {
    const ready = await waitFor(page, () => {
      const c = window.container
      const ctrl = c && c.controller
      if (!ctrl) return false
      if (ctrl.name === "PlaceBall") { document.getElementById("cueHit")?.click(); return false }
      return typeof ctrl.playShot === "function"
    }, 45000)
    if (ready < 0) { console.log(`shot ${k}: 提前收杆`); break }
    await sleep(300)
    await page.evaluate((k, p) => {
      const c = window.container
      c.table.cue.setAimAngle(0.3 + k * 0.19, c.table)
      c.table.cue.setPower(p)
      c.controller = c.controller.playShot()
    }, k, powers[k])
    await waitFor(page, () => window.container.controller?.name !== "PlayShot", 60000)
    await sleep(900)
  }
  return page.evaluate(() => window.container.recorder.getWholeGameCompressed())
}

const G = () => {
  const c = window.container
  const r = c && c.controller
  if (!r || !r.shotMeta) return null
  let acc = 0
  const cum = []
  for (const m of r.shotMeta) { cum.push(acc); acc += Math.max(m.duration, 1e-3) }
  const idx = r.currentShotIndex
  const shotTime = idx < 0 ? 0 : c.table.time
  return {
    idx,
    globalT: +Number(idx < 0 ? 0 : cum[idx] + shotTime).toFixed(1),
    total: +acc.toFixed(1),
    seek: +document.getElementById("replaySeek").value,
    metaLen: r.shotMeta.length,
    potsTotal: r.shotMeta.reduce((s, m) => s + (m.pots ? m.pots.length : 0), 0),
  }
}

/**
 * v1.6.0：原子快照 —— G 与 BOARD 必须在**同一次 evaluate** 里取。
 *
 * 原 R3c 先 evaluate(G) 再 evaluate(BOARD)，两次往返（swiftshader 下每次
 * 数百毫秒）之间回放仍在播放 → 「档位读数」与「球位快照」来自不同时刻，
 * 对比时把播放推进误当成 seek 不确定性（实测 283 vs 280、位移 0.016m）。
 */
const GC = () => {
  // G 体（内联）：进度条读数 + 全局时钟
  const c = window.container
  const r = c && c.controller
  if (!r || !r.shotMeta) return null
  let acc = 0
  const cum = []
  for (const m of r.shotMeta) {
    cum.push(acc)
    acc += Math.max(m.duration, 1e-3)
  }
  const idx = r.currentShotIndex
  const shotTime = idx < 0 ? 0 : c.table.time
  // BOARD 体（内联）：台面球位快照
  const balls = c.table.balls.map((b) => ({
    x: +b.pos.x.toFixed(3),
    y: +b.pos.y.toFixed(3),
    on: b.onTable(),
  }))
  return {
    idx,
    globalT: +Number(idx < 0 ? 0 : cum[idx] + shotTime).toFixed(1),
    total: +acc.toFixed(1),
    seek: +document.getElementById("replaySeek").value,
    metaLen: r.shotMeta.length,
    potsTotal: r.shotMeta.reduce((s, m) => s + (m.pots ? m.pots.length : 0), 0),
    board: balls,
  }
}

/** 画面球局快照：用户感知的「实际时间点」是台面状态，不是内部计数 */
const BOARD = () => {
  const c = window.container
  const balls = c.table.balls.map((b) => ({
    x: +b.pos.x.toFixed(3),
    y: +b.pos.y.toFixed(3),
    on: b.onTable(),
  }))
  return balls
}
const boardDiff = (a, b) => {
  let max = 0
  const n = Math.min(a.length, b.length)
  for (let i = 0; i < n; i++) {
    max = Math.max(max, Math.hypot(a[i].x - b[i].x, a[i].y - b[i].y))
  }
  return +max.toFixed(3)
}

/** 吸附点：DOM + 可见性（rect 非零 + 该坐标能被命中到自身） */
const SNAPS_VIS = () => {
  const box = document.getElementById("replaySeekSnaps")
  if (!box) return { exists: false }
  const els = Array.from(box.querySelectorAll(".replay-snap"))
  const vis = els.map((e) => {
    const r = e.getBoundingClientRect()
    const cx = r.left + r.width / 2
    const cy = r.top + r.height / 2
    const hit = document.elementFromPoint(cx, cy)
    return {
      cls: e.className.replace("replay-snap ", ""),
      bg: getComputedStyle(e).backgroundColor,
      w: +r.width.toFixed(1),
      h: +r.height.toFixed(1),
      visible: r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== "hidden" && getComputedStyle(e).display !== "none",
      hitSelf: !!hit && (hit === e || e.contains(hit)),
      hitTag: hit ? hit.className || hit.tagName : null,
    }
  })
  return { exists: true, count: els.length, vis: vis.slice(0, 10) }
}

async function dragSeekTo(page, frac, steps = 4) {
  const r = await tmo(page.evaluate(() => {
    const el = document.getElementById("replaySeek")
    const b = el.getBoundingClientRect()
    return { x: b.left, y: b.top, w: b.width, h: b.height, val: +el.value }
  }), 8000, "rect")
  const y = r.y + r.h / 2
  const curX = r.x + r.w * (r.val / 1000)
  const tgtX = r.x + r.w * Math.max(0, Math.min(1, frac))
  await tmo(page.mouse.move(curX, y), 8000, "m0")
  await tmo(page.mouse.down(), 8000, "down")
  for (let i = 1; i <= steps; i++) {
    await tmo(page.mouse.move(curX + ((tgtX - curX) * i) / steps, y), 8000, "m" + i)
    await sleep(50)
  }
  await tmo(page.mouse.up(), 8000, "up")
  await sleep(400)
}

/**
 * 确定性定位：直接写 value + input 事件（onSeekInput 走 seekToFraction，
 * 不经过 snapFraction），落点就是给定的整数档位。
 *
 * 为什么需要它：鼠标拖轨道有 ±1px 定位抖动，轨道宽约 300px / 1000 档，
 * 1px ≈ 3 档 ≈ 195ms，球在运动中的位移轻松超过 0.3m —— 拿两个差 3 档的
 * 时刻比画面，量到的是鼠标误差，不是回放不确定性。往返一致性必须在
 * **同一 seek 档位**上比。
 */
async function setSeekExact(page, v, settleMs = 700, noRelease = false) {
  /**
   * v1.6.0：新增 noRelease —— 只派发 input、不派发 change。
   *
   * 原因：产品在**松手**（change / pointerup）时会有意把落点吸附到 2.5%
   * 内的进球点（v1.5.6 #80 的 SEEK_SNAP_FRAC）。本探针每轮新录一局随机
   * 对局，采样点 350/280/470 是否落在某个进球点的吸附窗口内**随对局而变**：
   * 落在窗口内 → 落点被改写成进球点（实测 350→374、470→358），两次
   * 吸附到的进球点还可能差 1~2 档 → 两次比对时刻不同 → R3c 量到 0.179m
   * 假位移。这些红都不是产品缺陷（位移差恒为 0 的轮次里 T/idx 完全相同），
   * 而是「固定采样点 vs 内容相关吸附点」的口径冲突。
   *
   * R3b/R3c/R3d 检验的是**确定性重跑的往返一致性**（对齐到同一档位后画面
   * 一致），与吸附无关；吸附行为本身由 R4/R4c/R4d 专职覆盖（且全绿）。
   * 因此这三条的**对齐**动作改用 noRelease 注入，落点精确等于请求值，
   * 往返比对才有意义。
   */
  await tmo(page.evaluate((vv, noRel) => {
    const el = document.getElementById("replaySeek")
    el.value = String(vv)
    el.dispatchEvent(new Event("input", { bubbles: true }))
    if (!noRel) el.dispatchEvent(new Event("change", { bubbles: true }))
  }, v, noRelease), 8000, "setseek")
  await sleep(settleMs)
}

/**
 * 点真实「暂停 / 继续」按钮并校验生效。
 *
 * 为什么 R3 系列必须先暂停：v1.3.75 起拖动结束会 resumeAfterSeek 恢复播放，
 * 不冻结的话采样窗口内台面一直在推进 —— 量到的位移差混着「播放了多少」，
 * 不是 seek 的不确定性。SEEKDIAG 实锤：注入 280 落点精确（frac=0.280），
 * 随后 1 秒内就被播放推到 0.291，杆内 tt 从 4898ms 涨到 5992ms。
 */
async function clickPause(page, want) {
  const has = await tmo(page.evaluate(() => !!document.getElementById("replayPauseBtn")), 8000, "pauseBtn")
  if (!has) throw new Error("找不到 #replayPauseBtn")
  await tmo(page.evaluate((w) => {
    const b = document.getElementById("replayPauseBtn")
    if (!!window.container.controller.userPaused !== w) b.click()
  }, want), 8000, "pauseClick")
  await sleep(400)
  const after = await tmo(page.evaluate(() => !!window.container.controller.userPaused), 8000, "pauseState")
  if (after !== want) throw new Error(`暂停切换失败：期望 ${want}，实际 ${after}`)
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true })
  const browser = await launch()
  const page = await browser.newPage()
  await page.setCacheEnabled(false)
  await page.setViewport({ width: 393, height: 851, deviceScaleFactor: 1 })
  const errs = []
  page.on("pageerror", (e) => errs.push(String(e).slice(0, 160)))
  const ok = (n, p, d) => console.log(`${p ? "PASS" : "FAIL"}  ${n}  ${JSON.stringify(d).slice(0, 300)}`)

  // 跨导航存活的通知监听（evaluateOnNewDocument 在每个新文档注入）
  await page.evaluateOnNewDocument(() => {
    window.__notifs = []
    const scan = () => {
      const els = document.querySelectorAll(".notification-banner, .notification-text-group, .notification-main")
      els.forEach((el) => {
        const txt = (el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 80)
        if (txt && window.__notifs.indexOf(txt) === -1) window.__notifs.push(txt)
      })
    }
    document.addEventListener("DOMContentLoaded", () => setTimeout(scan, 50))
    setInterval(scan, 150)
  })

  console.log("[1] 打 6 杆并取压缩回放…")
  let compressed = null
  if (!process.env.SHAPE && !process.env.PICK) {
    compressed = await buildGame(page, 6)
    console.log("compressed len:", compressed ? compressed.length : 0)
  }

  console.log("[2] 落 IndexedDB（与「保存回放」同一结构）…")
  if (!process.env.SHAPE && !process.env.PICK && compressed) {
    await page.evaluate((compressed) => {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open("billiards_replays", 1)
      req.onupgradeneeded = () => {
        const db = req.result
        if (!db.objectStoreNames.contains("replays")) db.createObjectStore("replays", { keyPath: "id" })
      }
      req.onsuccess = () => {
        const db = req.result
        const tx = db.transaction("replays", "readwrite")
        tx.objectStore("replays").put({
          id: "probe156_real_" + Date.now(),
          rule: "nineball",
          compressed,
          createdAt: Date.now(),
          score: 0,
          label: "探针真实路径回放",
        })
        tx.oncomplete = () => resolve(true)
        tx.onerror = () => reject(tx.error)
      }
      req.onerror = () => reject(req.error)
    })
  }, compressed)
  }

  console.log("[3] 回菜单 → 查看回放 → 进入第一条…")
  await page.goto(`${BASE}/menu.html`, { waitUntil: "domcontentloaded", timeout: 60000 })
  await sleep(1500)
  await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll("button, .menu-item, [id*=replay], [id*=Replay]"))
      .find((b) => (b.textContent || "").includes("查看回放"))
    if (btn) btn.click()
  })
  await sleep(1200)
  await page.screenshot({ path: `${OUT}/menu-replaylist.png` })
  // .replay-item 是外层 div（无点击），真正绑定 navigateToReplay 的是内部 .replay-info
  const PICK = Number(process.env.PICK || 0)
  const entered = await page.evaluate((pick) => {
    const infos = document.querySelectorAll(".replay-item .replay-info")
    if (infos.length) {
      const el = infos[Math.min(pick, infos.length - 1)]
      el.click()
      return { clicked: true, pick, n: infos.length, sel: ".replay-info" }
    }
    const items = document.querySelectorAll(".replay-item")
    return { clicked: false, pick, n: items.length, sel: "fallback", listHtml: document.getElementById("replayList")?.innerHTML.slice(0, 200) }
  }, PICK)
  console.log("  列表点击:", JSON.stringify(entered))
  const got = await waitFor(page, () => window.container?.controller?.name === "Replay", 60000)
  const where = await page.evaluate(() => ({
    url: location.pathname + location.search,
    ctrl: window.container?.controller?.name || null,
    keys: window.container?.controller ? Object.keys(window.container.controller).slice(0, 14) : [],
  }))
  console.log("  进回放结果:", got, JSON.stringify(where))
  if (got < 0) throw new Error("未能进入回放控制器，R1~R4 无法判定")
  await sleep(2500)

  // ---- SHAPE：只 dump 本局形态（metaLen + 事件尾 + 各杆时长）后退出 ----
  if (process.env.SHAPE) {
    const shape = await page.evaluate(() => {
      const r = window.container.controller
      return {
        metaLen: r.shotMeta.length,
        tail: r.allShots.slice(-8).map((e) => e?.type),
        durs: r.shotMeta.map((m) => +m.duration.toFixed(0)),
      }
    })
    console.log("  SHAPE:", JSON.stringify(shape))
    await browser.close()
    return
  }

  // ---- R1 通知横幅 ----
  const notifs = await page.evaluate(() => window.__notifs || [])
  const bad = notifs.filter((t) => t.includes("自由练习") || t.includes("祝你好运"))
  ok("R1_进回放不弹自由练习横幅", bad.length === 0, { 相关横幅: bad, 全部: notifs.slice(0, 6) })

  // ---- R2 吸附点可见 + 分色 ----
  await sleep(1000)
  const g1 = await tmo(page.evaluate(G), 8000, "g1")
  const sv = await tmo(page.evaluate(SNAPS_VIS), 8000, "sv")
  console.log("  数据层 pots:", g1 && g1.potsTotal, " DOM 点数:", sv.count)
  console.log("  可见性明细:", JSON.stringify(sv.vis && sv.vis.slice(0, 6)))
  const allVisible = sv.count > 0 && sv.vis.every((v) => v.visible)
  // 本局可能只有一方进球（如全是 AI 进的），故只校验「颜色与归属一一对应」
  const colorOk = sv.vis.every(
    (v) => (v.cls === "snap-player" && v.bg === "rgb(53, 167, 255)") || (v.cls === "snap-ai" && v.bg === "rgb(255, 90, 60)")
  )
  const owners = await tmo(page.evaluate(() => {
    const r = window.container.controller
    return r.shotMeta.reduce((a, m) => a.concat((m.pots || []).map((p) => p.owner)), [])
  }), 8000, "ow")
  ok("R2_吸附点存在且可见", allVisible && sv.count === (g1 ? g1.potsTotal : -1), { dom: sv.count, data: g1 && g1.potsTotal, 全可见: allVisible })
  ok("R2_吸附点按归属分色", colorOk && sv.count > 0, { 点数: sv.count, 归属分布: owners, 颜色全部对应: colorOk })
  await page.screenshot({ path: `${OUT}/replay-seek.png` })

  // ---- DIAG：seek 档位注入追踪（SEEKDIAG=1 时只跑这一段即退出）----
  // 用途：定位「注入 value=280，读回来却是 512」到底是 seek 定位错了、
  // 还是 UI 回写口径错位、还是松手后被播放推走。
  if (process.env.SEEKDIAG) {
    console.log("[DIAG] 逐档位注入 seek，追踪 value / idx / table.time 时序…")
    const SNAP = () => {
      const c = window.container
      const r = c.controller
      let acc = 0
      const cum = []
      for (const m of r.shotMeta) { cum.push(acc); acc += Math.max(m.duration, 1e-3) }
      const idx = r.currentShotIndex
      const base = cum[idx < 0 ? 0 : idx] || 0
      return {
        v: +document.getElementById("replaySeek").value,
        idx, cum: +base.toFixed(0), tt: +c.table.time.toFixed(0),
        cur: +(base + c.table.time).toFixed(0), total: +acc.toFixed(0),
        frac: +((base + c.table.time) / acc).toFixed(3),
        up: !!r.userPaused, scrub: !!r.userScrubbing,
      }
    }
    for (const v of [280, 350, 660]) {
      for (const withChange of [false, true]) {
        await page.evaluate((vv, wc) => {
          const el = document.getElementById("replaySeek")
          el.value = String(vv)
          el.dispatchEvent(new Event("input", { bubbles: true }))
          if (wc) el.dispatchEvent(new Event("change", { bubbles: true }))
        }, v, withChange)
        const seq = [await page.evaluate(SNAP)]
        for (let i = 0; i < 5; i++) { await sleep(200); seq.push(await page.evaluate(SNAP)) }
        console.log(`  注入 ${v}${withChange ? "+change" : "      "} → ` + JSON.stringify(seq))
      }
    }
    await browser.close()
    return
  }

  // ---- DIAG3：逐杆调度日志（查「最后一杆为何没播成杆」）----
  if (process.env.DIAG3) {
    console.log("[DIAG3] 打点 playNextShot / handleHit，追踪事件队列消费…")
    const navLog = []
    page.on("framenavigated", (f) => navLog.push(`nav:${f.url()}`))
    page.on("framedetached", (f) => navLog.push(`detached:${f.url()}`))
    page.on("close", () => navLog.push("close"))
    page.on("crash", () => navLog.push("crash"))
    page.on("pageerror", (e) => navLog.push(`pageerror:${e.message}`))
    await page.evaluate(() => {
      const r = window.container.controller
      window.__log = []
      const origPn = r.playNextShot.bind(r)
      r.playNextShot = function (delay) {
        const nx = r.shots[0]
        window.__log.push({
          ev: "playNextShot", next: nx?.type, left: r.shots.length,
          timer: r.timer !== undefined, idx: r.currentShotIndex,
        })
        return origPn(delay)
      }
      const origHit = r.handleHit.bind(r)
      r.handleHit = function (e) {
        window.__log.push({ ev: "handleHit", idx: r.currentShotIndex + 1, left: r.shots.length })
        return origHit(e)
      }
      const origSt = r.handleStationary.bind(r)
      r.handleStationary = function (e) {
        window.__log.push({
          ev: "stationary", idx: r.currentShotIndex, left: r.shots.length,
          timer: r.timer !== undefined, tt: +window.container.table.time.toFixed(0),
        })
        return origSt(e)
      }
      // v1.5.8 #90：追踪 seekToFraction 内部行为（终局跳转是否触发、定位到哪一杆）
      const origSeek = r.seekToFraction.bind(r)
      r.seekToFraction = function (frac) {
        const before = r.currentShotIndex
        const qlenBefore = r.shots.length
        const metaLen = r.shotMeta.length
        const out = origSeek(frac)
        window.__log.push({
          ev: "seek", frac, before, after: r.currentShotIndex, metaLen,
          qlenBefore, qlenAfter: r.shots.length,
        })
        return out
      }
    })
    await clickPause(page, false)
    await setSeekExact(page, 0)
    await clickPause(page, false)
    const t0 = Date.now()
    let done = false
    let pollErr = null
    let lastLog = []
    let lastState = null
    while (Date.now() - t0 < 150000) {
      let s
      try {
        s = await tmo(page.evaluate(() => {
          const c = window.container
          return {
            paused: !!c.replayPaused,
            idx: c.controller.currentShotIndex,
            left: c.controller.shots.length,
            log: window.__log,
            url: globalThis.location.href,
          }
        }), 8000, "d3")
      } catch (e) {
        pollErr = e
        break
      }
      lastLog = s.log || []
      lastState = { paused: s.paused, idx: s.idx, left: s.left }
      if (s.paused && s.left === 0) { done = true; break }
      await sleep(500)
    }
    if (pollErr) {
      console.log("  轮询失败:", pollErr.message)
      try { console.log("  当前 URL:", page.url()) } catch {}
      console.log("  页面事件:", JSON.stringify(navLog))
    }
    console.log("  末态快照:", JSON.stringify(lastState), "日志条数:", lastLog.length)
    const log = lastLog
    const g = await tmo(page.evaluate(G), 8000, "d3g").catch((e) => ({ err: e.message }))
    console.log("  播完:", done, "| 末态:", JSON.stringify(g))
    console.log("  事件序列(allShots 尾部 10):", JSON.stringify(await tmo(page.evaluate(() => window.container.controller.allShots.slice(-10).map((e) => e?.type)), 8000, "d3t").catch((e) => `ERR:${e.message}`)))
    console.log("  调度日志全量", log.length, "条:")
    for (const l of log) console.log("   ", JSON.stringify(l))
    await browser.close()
    return
  }

  // ---- DIAG2：自然播放全程追踪（查「自然播完停在倒数第二杆」）----
  if (process.env.DIAG2) {
    console.log("[DIAG2] 自然播放全程追踪…")
    for (let i = 0; i < 5; i++) {
      const lab = await tmo(page.evaluate(() => document.getElementById("replaySpeedBtn")?.textContent || ""), 8000, "spd")
      if (lab.trim() === "4x") break
      await tmo(page.evaluate(() => document.getElementById("replaySpeedBtn")?.click()), 8000, "spdClick")
      await sleep(200)
    }
    await clickPause(page, false)
    await setSeekExact(page, 0)
    await clickPause(page, false)
    const rows = []
    const t0 = Date.now()
    while (Date.now() - t0 < 200000) {
      const s = await tmo(page.evaluate(() => {
        const c = window.container
        const r = c.controller
        const i = r.currentShotIndex
        return {
          i,
          tt: +c.table.time.toFixed(0),
          dur: i >= 0 ? +(r.shotMeta[i]?.duration ?? -1).toFixed(0) : -1,
          left: r.shots.length,
          timer: r.timer !== undefined,
          mv: c.table.balls.filter((b) => b.inMotion()).length,
          seek: +document.getElementById("replaySeek").value,
          paused: !!c.replayPaused,
          metaLen: r.shotMeta.length,
        }
      }), 8000, "d2")
      rows.push(s)
      if (s.i === s.metaLen - 1 && s.mv === 0 && !s.timer && s.left === 0) break
      await sleep(400)
    }
    console.log("  采样条数", rows.length, "耗时秒", +((Date.now() - t0) / 1000).toFixed(1))
    let prev = -999
    const changes = []
    for (const r of rows) { if (r.i !== prev) { changes.push(r); prev = r.i } }
    console.log("  idx 变化点:", JSON.stringify(changes))
    console.log("  末尾 12 条:", JSON.stringify(rows.slice(-12)))
    const durs = await tmo(page.evaluate(() => window.container.controller.shotMeta.map((m) => +m.duration.toFixed(0))), 8000, "dur")
    console.log("  各杆 duration:", JSON.stringify(durs))
    const types = await tmo(page.evaluate(() => window.container.controller.allShots.map((e) => e?.type)), 8000, "ty")
    console.log("  allShots 事件类型序列:", JSON.stringify(types))
    const offs = await tmo(page.evaluate(() => window.container.controller.shotEventOffsets?.length), 8000, "off")
    console.log("  shotEventOffsets 数:", offs, " metaLen:", rows[rows.length - 1]?.metaLen)
    await browser.close()
    return
  }

  // ---- R3 seek 往返（先暂停：消除「采样期间仍在播放」这个混淆变量）----
  console.log("[4] R3 落点路径无关性 + 同档位往返（已暂停）…")
  await clickPause(page, true)

  // R3 = #80 的本质：落点只由松手位置决定，与拖动路径无关。
  // 路径 A：从 0.10 一路拖到 0.35；路径 B：先拖到 0.80，再从 0.80 拖回 0.35。
  // 修复前吸附写在 onSeekInput 里、每帧回写 value，落点依赖路径（实测 249 vs 231）。
  await dragSeekTo(page, 0.10)
  await dragSeekTo(page, 0.35)
  const pA = await tmo(page.evaluate(G), 8000, "pA")
  await dragSeekTo(page, 0.80)
  await dragSeekTo(page, 0.35)
  const pB = await tmo(page.evaluate(G), 8000, "pB")
  const pathGap = Math.abs(pA.seek - pB.seek)
  ok("R3_落点只由松手位置决定(与路径无关)", pathGap <= 3, {
    路径A落点: pA.seek, 路径B落点: pB.seek, 差档: pathGap,
    容忍口径: "鼠标坐标 ±1px ≈ ±3 档（轨道约 300px / 1000 档），属输入精度",
  })

  // R3b：暂停状态下精确对齐同一档位，台面必须逐球一致（确定性重跑的硬判据）
  const SEEK_A = 350
  await setSeekExact(page, SEEK_A, 700, true)
  const b1 = await tmo(page.evaluate(G), 8000, "b1g")
  const bb1 = await tmo(page.evaluate(BOARD), 8000, "b1")
  await setSeekExact(page, 120)
  await setSeekExact(page, 800)
  await setSeekExact(page, SEEK_A, 700, true)
  const b2 = await tmo(page.evaluate(G), 8000, "b2g")
  const bb2 = await tmo(page.evaluate(BOARD), 8000, "b2")
  const bdiff = boardDiff(bb1, bb2)
  /**
   * v1.6.0 判据修正：原为 `b1.seek === SEEK_A`（精确相等），与产品规格冲突。
   *
   * 松手（change/pointerup）时产品会**有意**把落点吸附到 2.5% 内的进球点
   * （v1.5.6 #80 的 SEEK_SNAP_FRAC，正是为了修「滑回原位置时间点对不上」）。
   * 而本探针每轮**新录一局随机对局**，进球点位置随之变化 —— 采样点 350
   * 有时恰好落在某个进球点的吸附窗口内（实测 0.3558 → 358、0.374 → 374），
   * 有时不在（350 精确命中）。于是同一个未改动的构建会在三轮里 FAIL/PASS
   * 反复横跳，失败时「球位移差」恒为 0、两次 T 与 idx 完全相同 ——
   * 说明确定性往返本身没坏，红的是断言口径。
   *
   * 现判据 = 往返状态一致（位移差 + 两次落点相等）+ 落点必须落在
   * 「请求值 ± 吸附窗口」内（不是任意漂移）。
   */
  const snapWindow = 25 // = SEEK_SNAP_FRAC 0.025 × 1000
  ok("R3b_同档位往返画面一致", bdiff <= 0.02 && b1.seek === b2.seek && Math.abs(b1.seek - SEEK_A) <= snapWindow + 1, {
    最大球位移差: bdiff, 对齐档位: SEEK_A, b1seek: b1.seek, b2seek: b2.seek, b1T: b1.globalT, b2T: b2.globalT,
  })

  // ---- R3c 真实操作序列：拖 → 播 3s → 拖 → 播 3s → 拖回（播放中不冻结）----
  // 这里故意不暂停：用户就是边看边拖。判据仍是「对齐到同一档位后画面一致」，
  // 对齐动作放在每次拖定之后立刻执行，把播放推进的窗口压到最小。
  console.log("[4b] R3c 播放中往返（拖→播→拖→播→拖回）…")
  await clickPause(page, false)
  const SEEK_C = 280
  /**
   * v1.6.0：播放态下的「对齐」必须用**闭环**，且 G 与 BOARD 必须原子读取。
   *
   * 播放态没有冻结，注入落点与读取之间隔着一次 evaluate 往返（swiftshader
   * 下数百毫秒 ≈ 3 档）。原实现直接「注入 280 → 分两次读 G/BOARD」，于是
   * 读到 283、且球位与读数来自不同时刻，量出 0.016m 的假位移。
   *
   * 闭环：读回实际落点，把误差反馈进下一次注入值，迭代到落点精确等于
   * 目标档位（≤1 档）为止；GC 一次取回读数 + 球位，保证两者同一时刻。
   */
  const alignPlaying = async (target) => {
    let off = 0
    for (let i = 0; i < 6; i++) {
      await setSeekExact(page, target - off, 0, true)
      const st = await tmo(page.evaluate(GC), 8000, "gc")
      if (!st) return null
      const err = st.seek - target
      if (Math.abs(err) <= 1) return st
      off += err
    }
    return null
  }
  await dragSeekTo(page, 0.28)
  const c1raw = await tmo(page.evaluate(G), 8000, "c1raw")
  const c1 = await alignPlaying(SEEK_C)
  if (!c1) throw new Error("R3c 闭环对齐失败（第一次）")
  const cb1 = c1.board
  await sleep(3000) // 播放一段，制造「从别处拖回来」的真实前提
  await dragSeekTo(page, 0.66)
  await sleep(3000)
  await dragSeekTo(page, 0.28)
  const c2raw = await tmo(page.evaluate(G), 8000, "c2raw")
  const c2 = await alignPlaying(SEEK_C)
  if (!c2) throw new Error("R3c 闭环对齐失败（第二次）")
  const cb2 = c2.board
  console.log(`  取证·鼠标拖到0.28的落点抖动: ${c1raw.seek} vs ${c2raw.seek}（差 ${Math.abs(c1raw.seek - c2raw.seek)} 档）`)
  const cdiff = boardDiff(cb1, cb2)
  ok("R3c_播放后往返画面一致(对齐到同一档位)", cdiff <= 0.02 && Math.abs(c1.seek - c2.seek) <= 1 && Math.abs(c1.seek - SEEK_C) <= 26, {
    最大球位移差: cdiff, 对齐档位: SEEK_C, c1seek: c1.seek, c2seek: c2.seek, c1T: c1.globalT, c2T: c2.globalT,
  })

  // ---- R3d 跨多杆往返：中途拖到另一端并播放，再回到同一档位 ----
  console.log("[4c] R3d 跨杆往返（拖到另一端→播放→拖回同一档）…")
  await clickPause(page, true)
  const SEEK_B = 470
  await setSeekExact(page, SEEK_B, 700, true)
  const d1 = await tmo(page.evaluate(G), 8000, "d1")
  const db1 = await tmo(page.evaluate(BOARD), 8000, "db1")
  await setSeekExact(page, 60)
  await sleep(1500)
  await setSeekExact(page, 900)
  await sleep(1500)
  await dragSeekTo(page, 0.30)
  await setSeekExact(page, SEEK_B, 700, true)
  const d2 = await tmo(page.evaluate(G), 8000, "d2")
  const db2 = await tmo(page.evaluate(BOARD), 8000, "db2")
  const ddiff = boardDiff(db1, db2)
  /**
   * v1.8.1：`d1.seek === d2.seek` 放宽到 ≤2 档。
   *
   * 这条验的是「往返同一档位后画面一致」，而画面一致性由 `ddiff`
   * （球位移最大差，阈值 0.02m）严格保证 —— 实测 ddiff 恒为 0。
   * seek 是**进度条 UI 的量化读数**（0~1000 档），两次 setSeek 之间
   * 只要有一帧播放推进或 1px 落点差异就会差 1~2 档（=0.1~0.2%），
   * 与画面无关。原判据把 UI 抖动当成画面不一致，属于口径过严。
   */
  ok("R3d_跨杆往返画面一致", ddiff <= 0.02 && Math.abs(d1.seek - d2.seek) <= 2 && Math.abs(d1.seek - SEEK_B) <= 26, {
    最大球位移差: ddiff, 对齐档位: SEEK_B, d1T: d1.globalT, d2T: d2.globalT, d1idx: d1.idx, d2idx: d2.idx,
    // v1.6.0：补打实际 seek —— 原判据只写 `d1.seek === SEEK_B` 却不打印实际值，
     // 失败时无法判断是「差几档（实跑短于预演的固有夹取）」还是「真跑偏」。
    d1seek: d1.seek, d2seek: d2.seek,
  })

  // ---- R4c 末端吸附豁免（确定性用例） ----
  // 不能靠随机对局「末尾刚好有进球点」来撞（实测 5 局里只有 1 局出现）。
  // 这里往最后一杆的 pots 里注入一个位于全局 0.99 的假进球点，使末端必然落在
  // 吸附阈值 0.025 之内：旧实现会把拖到 100% 改写成 990，新实现豁免后仍读满。
  // 注：不改物理与时长，只影响吸附候选集合与吸附点渲染。
  console.log("[5] R4c 末端吸附豁免（注入末端进球点）…")
  const injected = await tmo(page.evaluate(() => {
    const r = window.container.controller
    const cum = []
    let acc = 0
    for (const m of r.shotMeta) { cum.push(acc); acc += Math.max(m.duration, 1e-3) }
    const last = r.shotMeta.length - 1
    const meta = r.shotMeta[last]
    const LEAD = 300 // 与探针其余处口径一致（REPLAY_LEAD_MS 近似）
    meta.pots.push({ t: 0.99 * acc - cum[last] + LEAD, ballId: -1, pocketIdx: 0, owner: "player" })
    const cand = +r.snapFraction(1.0).toFixed(4)
    return { potFrac: 0.99, snapCandidateAt1: cand, total: +acc.toFixed(1) }
  }), 8000, "inject")
  console.log("  注入结果:", JSON.stringify(injected))
  await page.evaluate(() => {
    const el = document.getElementById("replaySeek")
    el.value = "1000"
    el.dispatchEvent(new Event("input", { bubbles: true }))
    el.dispatchEvent(new Event("change", { bubbles: true }))
  })
  await sleep(1200)
  const r4cGot = await tmo(page.evaluate(G), 8000, "r4c")
  ok("R4c_末端不被吸附拽回(0.99处有进球点)", r4cGot.seek >= 995, {
    注入进球点: injected.potFrac,
    旧实现会吸附到: injected.snapCandidateAt1,
    实际seek: r4cGot.seek,
  })

  // ---- R4 末尾 ----
  console.log("[5] R4 拖到末尾…")
  // 鼠标拖到轨道右缘因 thumb 宽度补偿只能到 ~985，真实用户/触摸可到 1000。
  // 这里直接用 value=1000 + input/change 事件精确模拟「拖到尽头」。
  await dragSeekTo(page, 1.0)
  await page.evaluate(() => {
    const el = document.getElementById("replaySeek")
    el.value = "1000"
    el.dispatchEvent(new Event("input", { bubbles: true }))
    el.dispatchEvent(new Event("change", { bubbles: true }))
  })
  await sleep(1500)
  const tail = await tmo(page.evaluate(G), 8000, "tail")
  const ratio = tail.total > 0 ? tail.globalT / tail.total : 0
  // 取证：拖到尽头时 seek 停在 979 而不是 1000，是不是被吸附拉回最后一个进球点？
  const snapFracs = await tmo(page.evaluate(() => {
    const c = window.container
    const r = c.controller
    const cum = []
    let acc = 0
    for (const m of r.shotMeta) { cum.push(acc); acc += Math.max(m.duration, 1e-3) }
    const out = []
    r.shotMeta.forEach((m, i) => {
      for (const p of m.pots || []) out.push(+(((cum[i] + (p.t - 300)) / acc)).toFixed(4))
    })
    return { total: +acc.toFixed(1), potFracs: out.sort((a, b) => a - b) }
  }), 8000, "snapfracs")
  console.log("  取证·进球点全局比例:", JSON.stringify(snapFracs))
  // 「对局结束」判据：停在最后一杆 + 台面静止 + 进度条读满。
  // 注：实跑收杆时刻与预演 duration 天然有偏差（实测末杆 3978.5 vs 5210.9ms），
  // 若不做末尾时钟对齐，进度条会停在 98.5% —— 那才正是用户报的「拉到底不是
  // 对局结束时刻」。故此处要求 seek 读满（≥995）。
  ok("R4_末尾=对局结束", tail.idx === tail.metaLen - 1 && tail.seek >= 995, {
    globalT: tail.globalT, total: tail.total, ratio: +ratio.toFixed(3),
    idx: tail.idx, metaLen: tail.metaLen, seek: tail.seek,
  })
  // 末尾台面：应所有球都结束运动（对局终局状态），且停在最后一杆
  const tailBoard = await tmo(page.evaluate(BOARD), 8000, "tb")
  const moving = await tmo(page.evaluate(() => {
    const c = window.container
    return c.table.balls.filter((b) => b.inMotion()).length
  }), 8000, "mv")
  ok("R4b_末尾台面已静止", moving === 0, { 仍在运动的球: moving, 台面: tailBoard.slice(0, 4) })
  await page.screenshot({ path: `${OUT}/replay-tail.png` })

  // ---- R4d 真机拇指拖不到位（v1.5.7 #88）----
  //
  // 上一版把 R4 修好了，但用户仍报「拖到尽头不是对局结束」。真因：R4 用例
  // 是**程序**把 value 直接设成 1000，而真实手指/鼠标拖动受滑块 thumb 宽度
  // 限制，压到轨道最右端时 value 通常只到 97x~98x。落点 0.98 过不了
  // seekToFraction 里 `toEnd = frac >= 0.999` 那一关 —— 既不把末杆推进到
  // 静止、也不做末尾时钟对齐，画面停在「差一点点」的中途。
  // 修复：松手时判定为「想看终局」就直接把落点顶到 1。本用例用 985/980/975
  // 三个真机可达的落点验证这条路径。
  console.log("[6] R4d 真机拇指拖不到位（985/980/975）…")
  for (const v of [985, 980, 975]) {
    // 先拖回中段，保证每次都是从「非末端」重新拖到接近尽头
    await page.evaluate(() => {
      const el = document.getElementById("replaySeek")
      el.value = "400"
      el.dispatchEvent(new Event("input", { bubbles: true }))
      el.dispatchEvent(new Event("change", { bubbles: true }))
    })
    await sleep(600)
    await page.evaluate((val) => {
      const el = document.getElementById("replaySeek")
      el.value = String(val)
      el.dispatchEvent(new Event("input", { bubbles: true }))
      el.dispatchEvent(new Event("change", { bubbles: true }))
    }, v)
    await sleep(1500)
    const g = await tmo(page.evaluate(G), 8000, `r4d-${v}`)
    const mv = await tmo(page.evaluate(() => {
      const c = window.container
      return c.table.balls.filter((b) => b.inMotion()).length
    }), 8000, `r4d-mv-${v}`)
    const gratio = g.total > 0 ? g.globalT / g.total : 0
    ok(`R4d_拖到${v}仍到终局`, g.idx === g.metaLen - 1 && g.seek >= 995 && mv === 0, {
      松手落点: v, 实际seek: g.seek, idx: g.idx, metaLen: g.metaLen,
      进度比: +gratio.toFixed(3), 仍在运动: mv,
    })
  }

  // ---- R6 自然播放到底（不干预）—— 前几版末尾用例只验了「拖到尽头」----
  // 用户报的是「进度条最后依旧不是对局结束」，而 R4/R4c/R4d 全都是「拖」出来的。
  // 「放着让它自己播完」是另一条完全不同的代码路径（不经过 onSeekEnd / toEnd），
  // 必须单独取证：播完后进度条读多少、停在第几杆、球有没有停稳。
  console.log("[7] R6 自然播放到结尾（切 4x，不干预）…")
  for (let i = 0; i < 5; i++) {
    const lab = await tmo(page.evaluate(() => document.getElementById("replaySpeedBtn")?.textContent || ""), 8000, "spd")
    if (lab.trim() === "4x") break
    await tmo(page.evaluate(() => document.getElementById("replaySpeedBtn")?.click()), 8000, "spdClick")
    await sleep(200)
  }
  await clickPause(page, false)
  await setSeekExact(page, 0)
  await clickPause(page, false)
  const natT0 = Date.now()
  let nat = await tmo(page.evaluate(G), 8000, "nat0")
  while (Date.now() - natT0 < 180000) {
    nat = await tmo(page.evaluate(G), 8000, "nat")
    if (nat.seek >= 995) break
    await sleep(500)
  }
  /**
   * v1.8.1：进度条到 995 之后**再等球停稳**（最多 20s）。
   * 软件渲染帧率低时，进度条已经读满、最后一杆的球还在滚，直接查
   * inMotion() 会读到 1 —— 这是采样时机问题，不是终局没到。
   * 判定标准不变：20s 后仍在动就算失败。
   */
  const settleT0 = Date.now()
  while (Date.now() - settleT0 < 20000) {
    const mv = await tmo(page.evaluate(() => window.container.table.balls.filter((b) => b.inMotion()).length), 8000, "natSettle")
    if (mv === 0) break
    await sleep(400)
  }
  const natMv = await tmo(page.evaluate(() => window.container.table.balls.filter((b) => b.inMotion()).length), 8000, "natMv")
  const natBoard = await tmo(page.evaluate(BOARD), 8000, "natBoard")
  await page.screenshot({ path: `${OUT}/r6-natural-end.png` })
  ok("R6_自然播放到结尾=终局", nat.idx === nat.metaLen - 1 && nat.seek >= 995 && natMv === 0, {
    等待秒: +((Date.now() - natT0) / 1000).toFixed(1), seek: nat.seek, idx: nat.idx,
    metaLen: nat.metaLen, 进度比: +(nat.globalT / nat.total).toFixed(3), 仍在运动: natMv, 台面: natBoard.slice(0, 4),
  })

  // ---- R7 拖到尽头后继续播放（松手即恢复播放，落点会不会被拽回去）----
  console.log("[8] R7 拖到尽头后继续播放…")
  await clickPause(page, false)
  await page.evaluate(() => {
    const el = document.getElementById("replaySeek")
    el.value = "400"
    el.dispatchEvent(new Event("input", { bubbles: true }))
    el.dispatchEvent(new Event("change", { bubbles: true }))
  })
  await sleep(600)
  await page.evaluate(() => {
    const el = document.getElementById("replaySeek")
    el.value = "1000"
    el.dispatchEvent(new Event("input", { bubbles: true }))
    el.dispatchEvent(new Event("change", { bubbles: true }))
  })
  const seq7 = []
  for (const d of [300, 1400, 3000]) {
    await sleep(d)
    const g = await tmo(page.evaluate(G), 8000, `r7-${d}`)
    const mv = await tmo(page.evaluate(() => window.container.table.balls.filter((b) => b.inMotion()).length), 8000, `r7mv-${d}`)
    seq7.push({ 松手后ms: seq7.reduce((s, x) => s + x.松手后ms, 0) + d, seek: g.seek, idx: g.idx, metaLen: g.metaLen, 仍在运动: mv })
  }
  await page.screenshot({ path: `${OUT}/r7-after-end.png` })
  ok("R7_拖到尽头后仍保持终局", seq7.every((s) => s.seek >= 995 && s.idx === s.metaLen - 1 && s.仍在运动 === 0), { 时序: seq7 })

  // ---- R8 点轨道最右端（不是拖动：真机上「点一下进度条末尾」也是常见操作）----
  console.log("[9] R8 点击轨道最右端…")
  await page.evaluate(() => {
    const el = document.getElementById("replaySeek")
    el.value = "400"
    el.dispatchEvent(new Event("input", { bubbles: true }))
    el.dispatchEvent(new Event("change", { bubbles: true }))
  })
  await sleep(600)
  const rr = await tmo(page.evaluate(() => {
    const el = document.getElementById("replaySeek")
    const b = el.getBoundingClientRect()
    return { x: b.left, y: b.top, w: b.width, h: b.height }
  }), 8000, "rect2")
  await page.mouse.click(rr.x + rr.w - 1, rr.y + rr.h / 2)
  await sleep(1500)
  const g8 = await tmo(page.evaluate(G), 8000, "r8")
  const mv8 = await tmo(page.evaluate(() => window.container.table.balls.filter((b) => b.inMotion()).length), 8000, "r8mv")
  ok("R8_点最右端=终局", g8.idx === g8.metaLen - 1 && g8.seek >= 995 && mv8 === 0, {
    seek: g8.seek, idx: g8.idx, metaLen: g8.metaLen, 仍在运动: mv8,
  })

  // ---- R9 落点时间序列：seek 到 1000 后 UI 会不会自己回写变小 ----
  console.log("[10] R9 落点 1000 的 UI 回写时序…")
  await clickPause(page, true)
  await page.evaluate(() => {
    const el = document.getElementById("replaySeek")
    el.value = "1000"
    el.dispatchEvent(new Event("input", { bubbles: true }))
    el.dispatchEvent(new Event("change", { bubbles: true }))
  })
  const seq9 = []
  for (let i = 0; i < 6; i++) {
    await sleep(300)
    const g = await tmo(page.evaluate(G), 8000, `r9-${i}`)
    seq9.push(g.seek)
  }
  ok("R9_落点1000不被回写拽回", seq9.every((v) => v >= 995), { 采样序列: seq9 })

  ok("R5_零页面错误", errs.length === 0, { errs: errs.slice(0, 4) })
  await browser.close()
}
main().catch((e) => { console.error("FATAL", e); process.exit(1) })
