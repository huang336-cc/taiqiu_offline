/* v1.8.2 落袋回球实机探针：代理球沿侧边通道推进 → 停在集球盘 → 复位清空 */
const puppeteer = require('/workspace/dev/source/billiards-cn/node_modules/puppeteer-core')
const fs = require('fs')
const OUT = '/root/.codebuddy/artifact/render/v182'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const results = []
const ok = (name, cond, info) => {
  results.push({ name, cond })
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}  ${JSON.stringify(info)}`)
}

;(async () => {
  fs.mkdirSync(OUT, { recursive: true })
  const b = await puppeteer.launch({
    executablePath: '/usr/bin/google-chrome', headless: 'new',
    args: [
      '--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader', '--user-data-dir=/tmp/chrome-v182-return' + Date.now(),
      '--in-process-gpu', '--disable-gpu-sandbox', '--window-size=1280,720',
    ],
    defaultViewport: { width: 1280, height: 720 },
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
    document.querySelectorAll('.tutorial-banner').forEach((e) => (e.style.display = 'none'))
  })
  await sleep(2500)
  const box = await p.evaluate(() => {
    const r = globalThis.__bc.container.view.element.getBoundingClientRect()
    return { x: r.x, y: r.y, w: r.width, h: r.height }
  })
  await p.mouse.click(box.x + box.w * 0.62, box.y + box.h * 0.42)
  await sleep(500)
  await p.evaluate(() => document.getElementById('cueHit')?.click())
  await sleep(2500)
  await p.evaluate(() => globalThis.__bc.container.view.applyScene('room'))
  await sleep(4500)
  // 切到全桌机位（aim → topView → farView）
  await p.evaluate(() => document.getElementById('camera')?.click())
  await sleep(6500)
  await p.evaluate(() => document.getElementById('camera')?.click())
  await sleep(6500)

  const read = () => p.evaluate(() => {
    const g = globalThis.__bc.container.view.scene.getObjectByName('BallReturn')
    const balls = (g?.children || [])
      .filter((o) => o.name.startsWith('ReturnBall_'))
      .map((o) => ({
        name: o.name,
        visible: o.visible,
        pos: [o.position.x, o.position.y, o.position.z].map((n) => +n.toFixed(3)),
        quat: [o.quaternion.x, o.quaternion.y, o.quaternion.z, o.quaternion.w].map((n) => +n.toFixed(3)),
      }))
    return { exists: !!g, childCount: g?.children.length ?? 0, balls }
  })

  // 三颗球同时落袋（模拟一杆进三球），位置分别靠近三个不同袋口
  await p.evaluate(() => {
    const t = globalThis.__bc.container.table
    const spots = [[1.461, 0.740], [-1.461, -0.740], [0, 0.740]]
    t.balls.filter((x) => !x.isCue).slice(0, 3).forEach((ball, i) => {
      ball.pos.set(spots[i][0], spots[i][1], -0.14)
      ball.vel.set(0, 0, 0); ball.rvel.set(0, 0, 0)
      ball.pocket = undefined
      ball.state = 'InPocket'
    })
  })
  /**
   * SwiftShader 软渲染只有 ~1.3fps，每帧 dt≈0.8s，动画 4 帧就跳完了
   * （实测 3s 内 frame 回调只跑 4 次、累计 dt=3.38s）。真机 60fps 不存在
   * 这个问题，但探针必须能取到中间帧 —— 这里接管 container.frame，
   * 用固定 50ms 步长手动推进，分四段强制渲染并截图取证；之后恢复自动循环
   * 验终态。推进前先把动画复位重登记，保证采样覆盖「袋口 → 通道 → 集球盘」
   * 的完整路径而不是从中段开始。
   */
  const reg = await p.evaluate(() => {
    const c = globalThis.__bc.container
    const t = c.table
    const pocketed = t.balls.filter((x) => x.state === 'InPocket')
    pocketed.forEach((x) => (x.state = 'Stationary'))
    c.ballReturn.update(0.001, t.balls, false) // 自愈清空
    pocketed.forEach((x) => { x.state = 'InPocket'; x.pocket = undefined })
    c.ballReturn.update(0.001, t.balls, false) // 重新登记，t≈0
    window.__savedFarFrame = c.frame
    c.frame = () => {}
    window.__farSeries = []
    const g = c.view.scene.getObjectByName('BallReturn')
    return {
      exists: !!g,
      registered: (g?.children || []).filter((o) => o.name.startsWith('ReturnBall_')).length,
      childCount: g?.children.length ?? 0,
    }
  })
  ok('S1_三颗落袋球都生成了代理球（含低帧率下手动登记）',
    reg.exists && reg.registered === 3, reg)

  // 引导横幅是异步延迟创建的，截图前再藏一次
  const hideBanner = () => p.evaluate(() =>
    document.querySelectorAll('.tutorial-banner').forEach((e) => (e.style.display = 'none')))

  const phases = [
    { steps: 8, tag: 't1-sink' },
    { steps: 16, tag: 't2-channel' },
    { steps: 20, tag: 't3-nearTray' },
    { steps: 30, tag: 't4-tray' },
  ]
  for (const ph of phases) {
    await p.evaluate((n) => {
      const c = globalThis.__bc.container
      const g = c.view.scene.getObjectByName('BallReturn')
      for (let i = 0; i < n; i++) {
        c.ballReturn.update(0.05, c.table.balls, false)
        window.__farSeries.push({
          balls: g.children.filter((o) => o.name.startsWith('ReturnBall_') && o.visible)
            .map((o) => ({
              pos: [o.position.x, o.position.y, o.position.z].map((v) => +v.toFixed(3)),
              q: +o.quaternion.x.toFixed(3),
            })),
        })
      }
      c.view.render()
    }, ph.steps)
    await hideBanner()
    await p.screenshot({ path: `${OUT}/return-${ph.tag}.png` })
  }
  const series = await p.evaluate(() => {
    const c = globalThis.__bc.container
    c.frame = window.__savedFarFrame
    return window.__farSeries
  })

  const channelSamples = series.filter((s) =>
    s.balls.some((x) => Math.abs(x.pos[1] + 0.92) < 0.02 && x.pos[0] < 1.45 && x.pos[0] > -1.24 && x.pos[2] < -0.1))
  ok('S2_球确实沿侧边通道走过（中间帧取样）', channelSamples.length >= 20,
    { samples: channelSamples.length, first: channelSamples[0], last: channelSamples[channelSamples.length - 1] })

  // 推进 + 自转：取同 1 号球在通道上的连续两个采样点
  const track = series.map((s) => s.balls.find((x) => Math.abs(x.pos[1] + 0.92) < 0.02 && x.pos[0] < 1.45 && x.pos[0] > -1.24)).filter(Boolean)
  let advanced = false, spun = false
  for (let i = 1; i < track.length; i++) {
    if (track[i - 1].pos[0] - track[i].pos[0] > 0.01) advanced = true
    if (Math.abs(track[i - 1].q - track[i].q) > 0.001) spun = true
  }
  ok('S3_球沿 −x 推进且带自转', advanced && spun, { track: track.slice(0, 6) })

  // 排队：同一采样时刻通道上任意两球间距 ≥ 2.2R
  const allGaps = []
  for (const s of channelSamples) {
    const on = s.balls.filter((x) => Math.abs(x.pos[1] + 0.92) < 0.02 && x.pos[0] < 1.45 && x.pos[0] > -1.24)
    for (let i = 0; i < on.length; i++) {
      for (let j = i + 1; j < on.length; j++) {
        const a = on[i].pos, c = on[j].pos
        allGaps.push(Math.hypot(a[0] - c[0], a[1] - c[1], a[2] - c[2]))
      }
    }
  }
  ok('S4_通道上多球不叠（间距 ≥ 2.2R）',
    allGaps.length >= 2 && allGaps.every((d) => d >= 0.072 - 0.005),
    { gaps: allGaps.slice(0, 6).map((d) => +d.toFixed(3)) })

  // 终局：恢复自动循环后，球仍停在集球盘槽位且可见
  await sleep(1600)
  const s4 = await read()
  const inTray = s4.balls.filter((x) => x.pos[0] >= -1.64 && x.pos[0] <= -1.22 &&
    x.pos[1] >= -1.04 && x.pos[1] <= -0.80 && Math.abs(x.pos[2] + 0.267) < 0.02)
  ok('S5_球停在集球盘槽里且仍可见', inTray.length === 3 && inTray.every((x) => x.visible), s4)
  await hideBanner()
  await p.screenshot({ path: `${OUT}/return-t4.png` })

  // 逐帧取证（真实渲染循环 + 已停盘的球）
  await p.screenshot({ path: `${OUT}/return-final.png` })

  // 复位：把球状态改回 Stationary（等价 updateFromShortSerialised 的效果）
  await p.evaluate(() => {
    const t = globalThis.__bc.container.table
    t.balls.forEach((x) => { if (x.state === 'InPocket') x.state = 'Stationary' })
  })
  await sleep(1400)
  const s5 = await read()
  ok('S6_复位后代理球清空、通道与集球盘仍在',
    s5.balls.length === 0 && s5.childCount >= 7, s5)
  await p.screenshot({ path: `${OUT}/return-reset.png` })

  // 真实物理落袋（不手工置 State.InPocket）：把 1 号球放到角袋前推进物理，
  // 验证 Pocket.fall → InPocket 这条真实链路也会触发回球动画，且 ball.pocket
  // 存在时袋口定位走的是 Pocket.pos 而不是最近邻兜底。
  const real = await p.evaluate(() => {
    const c = globalThis.__bc.container
    const t = c.table
    const saved = c.frame
    c.frame = () => {}
    const ball = t.balls.find((x) => !x.isCue && x.label === 1)
    // 沿 y 轴直线打中袋（中心 0,0.740，半径 0.0537）：球心到 y=0.688
    // 时距袋口 0.052 已命中，不会先撞库。其余球挪到远侧避免挡路。
    t.balls.filter((x) => x !== ball).forEach((x, i) => {
      x.pos.set(-1.2 + i * 0.075, -0.55, 0)
      x.vel.set(0, 0, 0)
      x.rvel.set(0, 0, 0)
      x.state = 'Stationary'
    })
    ball.state = 'Rolling'
    ball.pos.set(0, 0.48, 0)
    ball.vel.set(0, 2.5, 0)
    ball.rvel.set(0, 0, 0)
    ball.offTable = false
    for (let i = 0; i < 120; i++) t.advance(0.005)
    c.frame = saved
    return { state: ball.state, hasPocket: !!ball.pocket, pos: [ball.pos.x, ball.pos.y, ball.pos.z].map((n) => +n.toFixed(3)) }
  })
  await sleep(1800)
  const s8 = await read()
  ok('S8_真实物理落袋也触发回球动画',
    real.state === 'InPocket' && real.hasPocket && s8.balls.length >= 1,
    { real, balls: s8.balls.map((x) => x.name) })

  ok('S7_零页面错误', errs.length === 0, { errs })
  const passed = results.filter((r) => r.cond).length
  console.log(`\n合计：${passed}/${results.length}`)
  await b.close()
  process.exit(passed === results.length ? 0 : 1)
})().catch((e) => { console.error('FATAL', e); process.exit(2) })
