/**
 * v1.4.6 循环复现探针：同一浏览器实例内重复
 *   menu → 开始游戏 → 进入 play → 齿轮 → helpOverlay → 返回主菜单(弹窗) → 回 menu
 * 共 N 次，定位「重复几次卡住」的根因。每一步带超时，失败即 dump 现场。
 *
 * 关键：单 page 实例循环导航，复现「同 WebView 内反复进出」的 context 泄漏 /
 * 全局状态污染类问题（headless swiftshader 下 WebGL context 上限更易触发）。
 */
const puppeteer = require("puppeteer-core")

const DIST = "/workspace/dev/source/billiards-cn/dist"
const LOOPS = parseInt(process.env.LOOPS || "5", 10)

async function newBrowser() {
  return puppeteer.launch({
    executablePath: "/usr/bin/google-chrome",
    headless: "new",
    args: [
      "--no-sandbox", "--hide-scrollbars",
      "--disable-dev-shm-usage", "--no-zygote", "--ozone-platform=headless",
      "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader",
      "--user-data-dir=" + (process.env.CHROME_DIR || "/tmp/chrome-loop146"), "--in-process-gpu", "--disable-gpu-sandbox",
      // v1.4.6 诊断：把 WebGL context 上限压到真机量级（Chromium 真机默认 16），
      // 强制复现「反复进出累积到上限后新 context 创建失败 → 卡在 Loading」。
      "--max-active-webgl-contexts=" + (process.env.CTX_LIMIT || "6"),
      "--allow-file-access-from-files", "--window-size=393,851",
    ],
    env: { ...process.env, DISPLAY: "" },
  })
}

async function realTap(page, sel, label) {
  await page.touchscreen.touchStart(5, 5)
  await page.touchscreen.touchEnd()
  await new Promise((r) => setTimeout(r, 60))
  const el = await page.$(sel)
  if (!el) return { ok: false, why: `${sel} 不存在`, label }
  const box = await el.boundingBox()
  if (!box) return { ok: false, why: `${sel} 无 boundingBox`, label }
  await page.touchscreen.touchStart(box.x + box.width / 2, box.y + box.height / 2)
  await page.touchscreen.touchEnd()
  return { ok: true, label, sel, box }
}

function dumpState(page, tag) {
  return page.evaluate((t) => {
    const out = {
      tag: t,
      url: location.href,
      path: location.pathname,
      hasBtnStart: !!document.getElementById("btnStart"),
      btnStartVisible: (() => {
        const e = document.getElementById("btnStart")
        if (!e) return null
        const r = e.getBoundingClientRect()
        return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== "hidden"
      })(),
      viewCanvas: (() => {
        const c = document.querySelector("#viewP1 canvas")
        return c ? { w: c.width, h: c.height, oh: c.offsetHeight } : null
      })(),
      loadingText: (() => {
        const l = document.getElementById("view3dLoading")
        return l ? getComputedStyle(l).display : null
      })(),
      helpOverlayShown: (() => {
        const o = document.getElementById("helpOverlay")
        return !!(o && !o.hasAttribute("hidden") && o.offsetParent !== null)
      })(),
      dialogShown: !!document.getElementById("back-confirm-cn-backdrop"),
      backConfirmInited: window.__backConfirmInited === true,
    }
    return out
  }, tag)
}

async function main() {
  const browser = await newBrowser()
  const page = await browser.newPage()
  await page.setViewport({ width: 393, height: 851, hasTouch: true, isMobile: true, deviceScaleFactor: 2 })

  const errs = []
  const notFound = new Set()
  page.on("pageerror", (e) => errs.push("[pageerror] " + e.message))
  page.on("response", (r) => { if (r.status() >= 400) notFound.add(r.url()) })
  page.on("console", (m) => {
    if (m.type() !== "error") return
    const t = m.text()
    if (/wave\.jpg|Failed to load resource/.test(t)) return
    errs.push("[console] " + t)
  })

  await page.goto(`file://${DIST}/menu.html`, { waitUntil: "load", timeout: 120000 })
  await new Promise((r) => setTimeout(r, 800))

  let firstFail = null
  for (let i = 1; i <= LOOPS; i++) {
    console.log(`\n===== 第 ${i} 次循环 =====`)
    const step = {}

    // 1) 进入游戏
    const before = errs.length
    const a1 = await realTap(page, "#btnStart", `L${i} 开始游戏`)
    let inPlay = false
    try {
      await page.waitForFunction(() => location.pathname.includes("play.html"), { timeout: 8000 })
      inPlay = true
    } catch {}
    step.enterGame = { ok: a1.ok && inPlay, why: inPlay ? "" : "URL 未变 play.html" }
    if (a1.ok && !inPlay) step.enterGame.why = "btnStart 点了但没跳 play.html"
    if (!a1.ok) step.enterGame.why = a1.why

    if (!inPlay) {
      firstFail = { loop: i, stage: "enterGame", snap: await dumpState(page, `L${i}-enterGame`), errs: errs.slice(before) }
      break
    }

    // 2) 等 canvas 就绪（资源加载完成、WebGL 创建成功）
    let ready = false
    let loadingGone = false
    for (let k = 0; k < 40 && !ready; k++) {
      const st = await page.evaluate(() => {
        const c = document.querySelector("#viewP1 canvas")
        const l = document.getElementById("view3dLoading")
        return {
          canvasOk: !!(c && c.width > 0 && c.offsetHeight > 0),
          loadingHidden: !l || getComputedStyle(l).display === "none",
        }
      }).catch(() => ({ canvasOk: false, loadingHidden: false }))
      ready = st.canvasOk
      loadingGone = st.loadingHidden
      if (!ready) await new Promise((r) => setTimeout(r, 500))
    }
    step.sceneReady = {
      ok: ready,
      why: ready ? "" : (loadingGone ? "canvas 始终未就绪(WebGL?) loading已消失" : "loading 一直转 + canvas 未就绪"),
    }
    if (!ready) {
      firstFail = { loop: i, stage: "sceneReady", snap: await dumpState(page, `L${i}-scene`), errs: errs.slice(before) }
      break
    }
    // 模拟真实游玩：进游戏后停留几秒，让渲染循环真正跑一会儿
    // （WebGL context 的 GPU 资源占用随渲染时长累积，更接近真机触发阈值）
    await new Promise((r) => setTimeout(r, 3000))

    // 3) 齿轮 → helpOverlay
    const b1 = await realTap(page, "#menu", `L${i} 齿轮`)
    let overlay = false
    try {
      await page.waitForFunction(() => {
        const o = document.getElementById("helpOverlay")
        return o && !o.hasAttribute("hidden") && o.offsetParent !== null
      }, { timeout: 5000 })
      overlay = true
    } catch {}
    step.overlay = { ok: b1.ok && overlay, why: overlay ? "" : "helpOverlay 未显示" }

    // 4) #backToMenu → 弹窗
    const b2 = await realTap(page, "#backToMenu", `L${i} 返回主菜单按钮`)
    let dialog = false
    try {
      await page.waitForFunction(() => !!document.getElementById("back-confirm-cn-backdrop"), { timeout: 5000 })
      dialog = true
    } catch {}
    step.dialog = { ok: b2.ok && dialog, why: dialog ? "" : "退出弹窗未出现" }

    // 5) 点弹窗「返回主菜单」→ 回 menu
    const b3 = await realTap(page, "#back-confirm-cn-backdrop .bcbtn.danger", `L${i} 弹窗返回主菜单`)
    let backMenu = false
    try {
      await page.waitForFunction(() => location.pathname.includes("menu.html"), { timeout: 8000 })
      backMenu = true
    } catch {}
    step.backMenu = { ok: b3.ok && backMenu, why: backMenu ? "" : "未跳回 menu.html" }

    const loopOk = step.enterGame.ok && step.sceneReady.ok && step.overlay.ok && step.dialog.ok && step.backMenu.ok
    console.log(`  enterGame=${step.enterGame.ok ? "✓" : "✗"} sceneReady=${step.sceneReady.ok ? "✓" : "✗"} overlay=${step.overlay.ok ? "✓" : "✗"} dialog=${step.dialog.ok ? "✓" : "✗"} backMenu=${step.backMenu.ok ? "✓" : "✗"}`)
    if (!loopOk) {
      firstFail = { loop: i, stage: "loopStep", steps: step, snap: await dumpState(page, `L${i}-fail`), errs: errs.slice(before) }
      break
    }
    await new Promise((r) => setTimeout(r, 400))
  }

  console.log("\n" + "-".repeat(60))
  console.log("页面错误总计:", errs.length)
  if (errs.length) console.log(errs.slice(-10).map((e) => "  " + e.slice(0, 240)).join("\n"))
  const bad404 = [...notFound].filter((u) => !/wave\.jpg/.test(u))
  if (bad404.length) console.log("非 wave 404:", bad404)

  if (firstFail) {
    console.log(`\n!!! 第 ${firstFail.loop} 次循环在第「${firstFail.stage}」阶段卡住`)
    console.log("现场快照:", JSON.stringify(firstFail.snap, null, 2))
    if (firstFail.errs && firstFail.errs.length) {
      console.log("该循环期间错误:")
      console.log(firstFail.errs.map((e) => "  " + e.slice(0, 240)).join("\n"))
    }
    await browser.close()
    process.exit(1)
  } else {
    console.log(`\n✓ 全部 ${LOOPS} 次循环通过`)
    await browser.close()
    process.exit(0)
  }
}

main().catch((e) => { console.error(e); process.exit(2) })
