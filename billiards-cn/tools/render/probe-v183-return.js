/* v1.8.3 落袋回球验证（对应用户三条反馈）：
 * 轮一（2 球）：R1 各从各袋口出发；R2 中袋不从底袋入口进
 * 轮二（6 球）：R3 终态落在模型自带集球槽；R4 不重叠；R5 自然铺开；R2b 沿框架层滚
 * R6 未新增通道/集球盘几何；R7 复位清空；R8 零页面错误
 */
const puppeteer = require('/workspace/dev/source/billiards-cn/node_modules/puppeteer-core')
const fs = require('fs')
const OUT = '/root/.codebuddy/artifact/render/v183'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const R = 0.03275

const results = []
const ok = (n, c, i) => {
  results.push({ n, c })
  console.log(`${c ? 'PASS' : 'FAIL'}  ${n}  ${JSON.stringify(i === undefined ? {} : i)}`)
}

;(async () => {
  fs.mkdirSync(OUT, { recursive: true })
  const b = await puppeteer.launch({
    executablePath: '/usr/bin/google-chrome',
    headless: 'new',
    args: [
      '--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader', '--user-data-dir=/tmp/chrome-v183ret' + Date.now(),
      '--in-process-gpu', '--disable-gpu-sandbox', '--window-size=1280,900',
    ],
    defaultViewport: { width: 1280, height: 900 },
  })
  const p = await b.newPage()
  const errs = []
  p.on('pageerror', (e) => errs.push(String(e.message).slice(0, 160)))
  await p.goto('http://127.0.0.1:8190/play.html?debug=1&bot=Professional', {
    waitUntil: 'load', timeout: 120000,
  })
  await p.waitForFunction(
    () => { const v = globalThis.__bc?.container?.view; return !!(v && v.renderer && v.assets) },
    { timeout: 90000 }
  )
  await p.evaluate(() => {
    setInterval(() => { const c = globalThis.__bc?.container; if (c) c.lastEventTime = performance.now() }, 300)
    document.querySelectorAll('[data-tut-ack="1"]').forEach((e) => e.click())
    document.querySelectorAll('.tutorial-banner,.tutorial,.guide-banner,.modal-backdrop,.overlay')
      .forEach((e) => { e.style.display = 'none' })
  })
  await sleep(6000)

  const box = await p.evaluate(() => {
    const r = globalThis.__bc.container.view.element.getBoundingClientRect()
    return { x: r.x, y: r.y, w: r.width, h: r.height }
  })
  await p.mouse.click(box.x + box.w * 0.62, box.y + box.h * 0.42)
  await sleep(400)
  await p.evaluate(() => document.getElementById('cueHit')?.click())
  await sleep(2000)
  await p.evaluate(() => globalThis.__bc.container.view.applyScene('room'))
  await sleep(3500)

  // 把 table 的落袋/复位能力封成页面内函数，两轮复用
  await p.evaluate(() => {
    const c = globalThis.__bc.container
    const t = c.table
    globalThis.__v183 = {
      /** 指定袋口让 n 个球落袋，并重登记动画 */
      drop(spots) {
        // 先全部复位
        t.balls.forEach((x) => { x.state = 'Stationary' })
        c.ballReturn.update(0.001, t.balls, false)
        const pocketed = t.balls.filter((x) => !x.isCue).slice(0, spots.length)
        pocketed.forEach((ball, i) => {
          ball.pos.set(spots[i][0], spots[i][1], -0.16)
          ball.vel.set(0, 0, 0)
          ball.rvel.set(0, 0, 0)
          ball.pocket = undefined
          ball.state = 'InPocket'
        })
        c.ballReturn.update(0.001, t.balls, false)
        return pocketed.length
      },
      /** 推进 n 步（每步 50ms），返回逐帧快照 */
      step(n, record) {
        const g = c.view.scene.getObjectByName('BallReturn')
        const frames = []
        for (let i = 0; i < n; i++) {
          c.ballReturn.update(0.05, t.balls, false)
          if (record) {
            frames.push(
              (g?.children || [])
                .filter((o) => o.name.startsWith('ReturnBall_') && o.visible)
                .map((o) => ({
                  n: o.name,
                  p: [o.position.x, o.position.y, o.position.z].map((v) => +v.toFixed(3)),
                }))
            )
          }
        }
        c.view.render()
        return frames
      },
      names() {
        const g = c.view.scene.getObjectByName('BallReturn')
        return (g?.children || []).map((o) => o.name)
      },
    }
    globalThis.__savedFrame = c.frame
    c.frame = () => {}
  })

  // ══════════ 轮一：2 球（中袋 N + 底袋 SE），验证「各走各的袋口」 ══════════
  const spots2 = [
    [0, 0.766],       // N 中袋
    [1.461, -0.740],  // SE 底袋
  ]
  await p.evaluate((s) => globalThis.__v183.drop(s), spots2)
  const early = await p.evaluate(() => globalThis.__v183.step(3, true)) // t≈0.15
  const f0 = early[early.length - 1] || []
  const ownPocket = f0.every((o) => {
    const d = spots2.reduce((m, s) => Math.min(m, Math.hypot(o.p[0] - s[0], o.p[1] - s[1])), 1e9)
    return d < 0.16
  })
  ok('R1_两球各自从自己的袋口出发（不共用入口）', f0.length === 2 && ownPocket, { f0 })

  const midBall = f0.find((o) => Math.abs(o.p[0]) < 0.2)
  ok('R2_中袋球仍在中袋下方（未瞬移到底袋入口 x≈1.46）', !!midBall, { f0 })

  // 继续跑到入槽，取中段是否贴框架层
  const mid = await p.evaluate(() => globalThis.__v183.step(20, true))
  const midAll = mid.flat()
  const railHits = midAll.filter((o) => Math.abs(Math.abs(o.p[1]) - 0.715) < 0.07 && o.p[2] < -0.15).length
  ok('R2b_沿模型金色框架层滚动（|y|≈0.715, z≈−0.3）', railHits >= 4, { railHits })

  // ══════════ 轮二：6 球，验证集球槽内的分布 ══════════
  const spots6 = [
    [-1.461, 0.740], [0, 0.766], [1.461, 0.740],
    [-1.461, -0.740], [0, -0.766], [1.461, -0.740],
  ]
  await p.evaluate((s) => globalThis.__v183.drop(s), spots6)
  const names = await p.evaluate(() => globalThis.__v183.names())
  ok('R6_未新增通道或集球盘几何（BallReturn 内只有代理球）',
    names.every((n) => n.startsWith('ReturnBall_')),
    { names })

  const samples = []
  const phases = [
    { steps: 10, tag: 'r1-sink' },
    { steps: 26, tag: 'r2-rail' },
    { steps: 26, tag: 'r3-turn' },
    { steps: 80, tag: 'r4-tray' },
  ]
  for (const ph of phases) {
    const fr = await p.evaluate((n) => globalThis.__v183.step(n, true), ph.steps)
    for (const f of fr) samples.push(f)
    await p.evaluate(() =>
      document.querySelectorAll('.tutorial-banner').forEach((e) => (e.style.display = 'none'))
    )
    await p.screenshot({ path: `${OUT}/return-${ph.tag}.png` })
  }

  const last = samples[samples.length - 1] || []
  const inTray = last.length >= 6 &&
    last.every((o) => o.p[0] >= -1.52 && o.p[0] <= -1.30 && Math.abs(o.p[1]) <= 0.67)
  ok('R3_终态全部落在模型自带集球槽内', inTray, { last: last.map((o) => o.p) })

  let minGap = 1e9
  for (let i = 0; i < last.length; i++) {
    for (let j = i + 1; j < last.length; j++) {
      minGap = Math.min(minGap, Math.hypot(last[i].p[0] - last[j].p[0], last[i].p[1] - last[j].p[1]))
    }
  }
  ok('R4_槽内球互不重叠（间距 ≥ 1.9R）', last.length >= 2 && minGap >= 1.9 * R, {
    minGap: +minGap.toFixed(4),
    need: +(1.9 * R).toFixed(4),
  })

  const ys = last.map((o) => o.p[1])
  const xs = last.map((o) => o.p[0])
  const ySpan = Math.max(...ys) - Math.min(...ys)
  const xSpan = Math.max(...xs) - Math.min(...xs)
  ok('R5_槽内球自然铺开、不堆在同一角落', ySpan > 0.10 || xSpan > 0.08, {
    ySpan: +ySpan.toFixed(3),
    xSpan: +xSpan.toFixed(3),
    ys,
  })

  const cleared = await p.evaluate(() => {
    const c = globalThis.__bc.container
    c.table.balls.forEach((x) => { if (x.state === 'InPocket') x.state = 'Stationary' })
    c.ballReturn.update(0.05, c.table.balls, false)
    return globalThis.__v183.names().filter((n) => n.startsWith('ReturnBall_')).length
  })
  await p.evaluate(() => { globalThis.__bc.container.frame = globalThis.__savedFrame })
  ok('R7_复位后代理球清空', cleared === 0, { cleared })
  ok('R8_零页面错误', errs.length === 0, { errs })

  await b.close()
  const pass = results.filter((r) => r.c).length
  console.log(`\n合计：${pass}/${results.length}`)
  process.exit(pass === results.length ? 0 : 1)
})().catch((e) => {
  console.error('FATAL', e.message.slice(0, 300))
  process.exit(2)
})
