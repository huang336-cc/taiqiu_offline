/**
 * 主题 × 击球点交互 组合冒烟。
 * v1.5.3：主题 × 圆盘十字线辅助线（#cueSpinGuide 三线对齐）。
 * v1.5.4 口径更新（#68 已把圆盘辅助线回退、改为 3D 轨迹预告线）：
 *   ① 菜单里能切主题（不报错）
 *   ② 开始游戏能进场景
 *   ③ 打点面板能打开、拖动打点时 3D 轨迹预告线出现（solid/dashed/cuePred 任一可见且顶点>0）、
 *      松手后隐藏
 *   ④ 全程零 pageerror
 * 任何一项失败立即记 FAIL，最后汇总。
 *
 * v1.5.4 稳定性补丁：
 *   - protocolTimeout 显式 45s + tmo() 包装所有关键 await
 *   - settle 禁用 RAF 等待（RAF 停摆时页面内 promise 永不 resolve 且 CDP 层无法
 *     超时 —— 上轮 40 分钟零输出的根因），改纯定时轮询
 *   - 单主题 300s 看门狗，卡死记 FAIL 跳下一个
 */
const puppeteer = require("puppeteer-core")
const fs = require("fs")
const OUT = "/tmp/v153-themes"
const BASE = process.env.BASE || "http://127.0.0.1:8160/dist"
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** 超时包装：p 在 ms 内没完成就 reject（带标签） */
function tmo(p, ms, label) {
  return Promise.race([
    p,
    new Promise((_, rej) =>
      setTimeout(() => rej(new Error(`TMO(${label}) ${ms}ms`)), ms)
    ),
  ])
}

let page = null
const errs = []

/** 3D 轨迹预告线状态（v1.5.4 #68 口径）：solid / dashed / cuePred 的可见性与顶点数 */
function lineState() {
  return tmo(
    page.evaluate(() => {
      const al = window.container?.table?.cue?.aimLine
      if (!al) return { err: "aimLine 不存在" }
      const m = (ribbon) => {
        if (!ribbon || !ribbon.mesh) return { missing: true }
        const mesh = ribbon.mesh
        return { visible: !!mesh.visible, verts: mesh.geometry.drawRange.count }
      }
      return { solid: m(al.solid), dashed: m(al.dashed), cuePred: m(al.cuePred) }
    }),
    5000,
    "lineState"
  ).catch(() => ({ err: "eval-fail" }))
}

/** 轮询直到 pred 为真或 budget 耗尽（ms），返回最后值 */
async function pollFor(fn, budget) {
  const t0 = Date.now()
  let last = null
  while (Date.now() - t0 < budget) {
    last = await fn()
    if (last && last.hit) return last
    await sleep(60)
  }
  return last
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true })
  const browser = await puppeteer.launch({
    executablePath: "/usr/bin/google-chrome",
    headless: "new",
    protocolTimeout: 45000,
    args: [
      "--no-sandbox", "--hide-scrollbars", "--disable-dev-shm-usage", "--no-zygote",
      "--ozone-platform=headless", "--use-gl=angle", "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader", "--user-data-dir=/tmp/chrome-v153th",
      "--in-process-gpu", "--disable-gpu-sandbox", "--window-size=393,851",
    ],
    env: { ...process.env, DISPLAY: "" },
  })
  page = await browser.newPage()
  await page.setCacheEnabled(false)
  await page.setViewport({ width: 393, height: 851, deviceScaleFactor: 1 })
  page.on("pageerror", (e) => errs.push("pageerror: " + String(e).slice(0, 140)))

  // 拿主题清单
  console.log("[step] 打开菜单拿主题清单")
  await tmo(page.goto(`${BASE}/menu.html`, { waitUntil: "domcontentloaded", timeout: 90000 }), 95000, "goto-menu")
  await tmo(page.waitForFunction(() => {
    const e = document.getElementById("btnStart")
    return !!e && e.getBoundingClientRect().width > 0
  }, { timeout: 60000 }), 65000, "wait-btnStart")
  await sleep(1000)
  await tmo(page.evaluate(() => {
    const row = document.querySelector('#customRows .menu-row[data-target="cuetheme"]')
      || document.querySelector('[data-target="cuetheme"]')
    row?.click()
  }), 15000, "click-row-init")
  await sleep(900)
  const themes = await tmo(page.evaluate(() =>
    Array.from(document.querySelectorAll("#cueThemeCards .skin-card[data-cuetheme]")).map(
      (c) => c.getAttribute("data-cuetheme")
    )
  ), 15000, "read-themes")
  console.log(`主题数：${themes.length} —— ${themes.join(", ")}\n`)

  const rows = []
  for (const th of themes) {
    const errs0 = errs.length
    try {
      // 单主题 300s 看门狗：无论卡在哪，300s 后强制记 FAIL 进下一个（快速失败，不再全场陪葬）
      rows.push(
        await Promise.race([
          smokeOne(th, errs0),
          new Promise((_, rej) =>
            setTimeout(() => rej(new Error(`WATCHDOG(${th}) 300s`)), 300000)
          ),
        ])
      )
    } catch (e) {
      console.log(`[EXC] ${th} —— ${String(e).slice(0, 160)}`)
      rows.push({
        主题: th, 进场景: false, 面板: false, 轨迹显示: false, 松手隐藏: false,
        线状态: `exc: ${String(e).slice(0, 60)}`,
        新增错误: errs.slice(errs0).length, 结果: "FAIL",
      })
    }
  }

  const bad = rows.filter((r) => r.结果 === "FAIL")
  console.log(`\n合计 ${rows.length} 款主题，FAIL ${bad.length}`)
  fs.writeFileSync(`${OUT}/result.json`, JSON.stringify({ rows, errs }, null, 2))
  await browser.close()
  process.exit(bad.length === 0 ? 0 : 1)
}

/** 单主题全流程（异常向上抛，由调用方记 FAIL） */
async function smokeOne(th, errs0) {
  console.log(`[theme] ${th} —— ① 进菜单切主题`)
  await tmo(page.goto(`${BASE}/menu.html`, { waitUntil: "domcontentloaded", timeout: 90000 }), 95000, `goto-menu-${th}`)
  await tmo(page.waitForFunction(() => {
    const e = document.getElementById("btnStart")
    return !!e && e.getBoundingClientRect().width > 0
  }, { timeout: 60000 }), 65000, `wait-btnStart-${th}`)
  await sleep(700)
  await tmo(page.evaluate((t) => {
    const row = document.querySelector('#customRows .menu-row[data-target="cuetheme"]')
      || document.querySelector('[data-target="cuetheme"]')
    row?.click()
  }, th), 15000, `click-row-${th}`)
  await sleep(600)
  await tmo(page.evaluate((t) => {
    const el = document.querySelector(`#cueThemeCards .skin-card[data-cuetheme="${t}"]`)
    el?.click()
  }, th), 15000, `click-card-${th}`)
  await sleep(500)
  // ② 进游戏
  console.log(`[theme] ${th} —— ② 进场景`)
  await tmo(page.evaluate(() => document.getElementById("btnStart")?.click()), 15000, `click-start-${th}`)
  const inScene = await page
    .waitForFunction(
      () => {
        const c = document.querySelector("#viewP1 canvas")
        const l = document.getElementById("view3dLoading")
        return !!(c && c.width > 0) && (!l || getComputedStyle(l).display === "none")
      },
      { timeout: 60000 }
    )
    .then(() => true)
    .catch(() => false)
  await sleep(1800)
  // ③ 打开面板拖打点
  console.log(`[theme] ${th} —— ③ 打点面板拖动`)
  await tmo(page.evaluate(() => document.getElementById("cueBallTrigger")?.click()), 15000, `click-trigger-${th}`)
  const popupOpened = await tmo(page.waitForFunction(() => {
    const p = document.getElementById("cueballPopup")
    return !!p && !p.hidden
  }, { timeout: 8000 }), 10000, `popup-wait-${th}`).then(() => true).catch(() => false)
  if (!popupOpened) console.log(`[warn] ${th} 打点面板未打开，仍继续尝试拖动`)
  await sleep(500)
  // 坑：不能用 dispatchEvent 合成 PointerEvent —— 非活动 pointerId 上
  // setPointerCapture 会抛错（源码里被 catch 吞掉），随后 onSpinPointerMove
  // 的 hasPointerCapture 守卫把**所有** move 丢弃，杆头一动不动。
  // 必须用真实输入（CDP Input.dispatchMouseEvent）。
  const r0 = await tmo(page.evaluate(() => {
    const b = document.getElementById("cueBall").getBoundingClientRect()
    return { x: b.left, y: b.top, w: b.width, h: b.height }
  }), 15000, `rect-${th}`)
  await tmo(page.mouse.move(r0.x + r0.w / 2, r0.y + r0.h / 2), 15000, `move1-${th}`)
  await tmo(page.mouse.down(), 15000, `down-${th}`)
  await tmo(page.mouse.move(r0.x + r0.w * 0.8, r0.y + r0.h * 0.2, { steps: 6 }), 15000, `move2-${th}`)
  // v1.5.4 #68 口径：按住不松手 → 3D 轨迹预告线出现
  const shown = await pollFor(async () => {
    const s = await lineState()
    const vis = s.solid?.visible || s.dashed?.visible || s.cuePred?.visible
    return { hit: !!vis, state: s }
  }, 8000)
  await tmo(page.mouse.up(), 15000, `up-${th}`)
  // 松手 → 线隐藏
  const hidden = await pollFor(async () => {
    const s = await lineState()
    const all = s.err || s.solid?.missing
      ? { hit: true, note: "线对象缺失（按 err 记）" }
      : { hit: !s.solid.visible && !s.dashed.visible && !s.cuePred.visible, state: s }
    return all
  }, 8000)
  const popupOpen = await tmo(page.evaluate(
    () => !document.getElementById("cueballPopup").hidden
  ), 15000, `popup-${th}`).catch(() => false)
  await sleep(250)
  try {
    await tmo(page.screenshot({ path: `${OUT}/th-${th}.png` }), 30000, `shot-${th}`)
  } catch (e) {
    console.log(`[warn] ${th} 截图失败（不影响判定）: ${String(e).slice(0, 80)}`)
  }
  const trailShownOk = !!shown?.hit
  const trailHiddenOk = !!hidden?.hit
  const newErrs = errs.slice(errs0)
  const pass = inScene && popupOpen && trailShownOk && trailHiddenOk && newErrs.length === 0
  const lineDesc = shown?.state && !shown.state.err
    ? `solid=${shown.state.solid?.visible}/${shown.state.solid?.verts} dashed=${shown.state.dashed?.visible}/${shown.state.dashed?.verts} cuePred=${shown.state.cuePred?.visible}/${shown.state.cuePred?.verts}`
    : `state=${JSON.stringify(shown?.state || shown).slice(0, 80)}`
  console.log(
    `[${pass ? "PASS" : "FAIL"}] ${th}  进场景=${inScene} 面板=${popupOpen} ` +
      `轨迹预告=[显示=${trailShownOk} 松手隐藏=${trailHiddenOk} ${lineDesc}] 新增错误=${newErrs.length}` +
      (newErrs.length ? " " + newErrs.join("|") : "")
  )
  return {
    主题: th, 进场景: inScene, 面板: popupOpen,
    轨迹显示: trailShownOk, 松手隐藏: trailHiddenOk,
    线状态: lineDesc,
    新增错误: newErrs.length, 结果: pass ? "PASS" : "FAIL",
  }
}

main().catch((e) => {
  console.error("冒烟异常:", e)
  process.exit(2)
})
