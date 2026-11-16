/* v1.8.2 全桌机位自由化实机探针：真实 pointer / wheel 手势 + 串扰断言 */
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
      '--enable-unsafe-swiftshader', '--user-data-dir=/tmp/chrome-v182-farcam' + Date.now(),
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
    setInterval(() => { const c = globalThis.__bc?.container; if (c) c.lastEventTime = performance.now() }, 400)
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
  await sleep(5000)

  const state = () => p.evaluate(() => {
    const c = globalThis.__bc.container
    const cam = c.view.camera
    const three = cam.camera
    return {
      mode: String(cam.mode?.name || '').replace('bound ', ''),
      pos: [three.position.x, three.position.y, three.position.z].map((n) => +n.toFixed(3)),
      fov: +three.fov.toFixed(1),
      farCam: {
        yaw: +cam.farCam.yaw.toFixed(4),
        pitch: +cam.farCam.pitch.toFixed(4),
        dist: +cam.farCam.dist.toFixed(4),
      },
      aim: +c.table.cue.aim.angle.toFixed(6),
      power: +c.table.cue.aim.power.toFixed(6),
      hasReturn: !!c.view.scene.getObjectByName('BallReturn'),
    }
  })

  // 进入全桌机位：aim → topView → farView
  await p.evaluate(() => document.getElementById('camera')?.click())
  await sleep(6500)
  await p.evaluate(() => document.getElementById('camera')?.click())
  await sleep(6500)
  const s0 = await state()
  ok('S1_进入全桌机位且首屏构图与 v1.8.1 一致',
    s0.mode === 'farView' && s0.hasReturn &&
    Math.abs(s0.pos[0] - 2.35) < 0.02 && Math.abs(s0.pos[1] + 2.85) < 0.02 &&
    Math.abs(s0.pos[2] - 1.92) < 0.02, s0)
  await p.screenshot({ path: `${OUT}/far-default.png` })

  const aim0 = s0.aim, power0 = s0.power

  // 单指/鼠标拖动旋转：向右 120px、向下 40px
  const cx = box.x + box.w * 0.5, cy = box.y + box.h * 0.5
  await p.mouse.move(cx, cy)
  await p.mouse.down()
  for (let i = 1; i <= 6; i++) {
    await p.mouse.move(cx + i * 20, cy + i * 7)
    await sleep(120)
  }
  await p.mouse.up()
  await sleep(2500)
  const s1 = await state()
  const rotated = Math.abs(s1.farCam.yaw - s0.farCam.yaw) > 0.2 &&
                 Math.abs(s1.farCam.pitch - s0.farCam.pitch) > 0.05 &&
                 Math.hypot(s1.pos[0] - s0.pos[0], s1.pos[1] - s0.pos[1], s1.pos[2] - s0.pos[2]) > 0.3
  ok('S2_拖动真的改变了机位', rotated, { s0: s0.pos, s1: s1.pos, farCam: s1.farCam })
  await p.screenshot({ path: `${OUT}/far-rotated.png` })

  // 滚轮缩放（拉远）：document 级 wheel 不该改力度
  await p.mouse.move(cx, cy)
  for (let i = 0; i < 4; i++) {
    await p.mouse.wheel({ deltaY: 120 })
    await sleep(250)
  }
  await sleep(2200)
  const s2 = await state()
  ok('S3_滚轮缩放且力度不被串改',
    s2.farCam.dist > s1.farCam.dist * 1.15 && Math.abs(s2.power - power0) < 1e-9,
    { distBefore: s1.farCam.dist, distAfter: s2.farCam.dist, power: [power0, s2.power] })

  // 串扰：拖屏不改瞄准角
  ok('S4_拖屏不改瞄准角', Math.abs(s1.aim - aim0) < 1e-9 && Math.abs(s2.aim - aim0) < 1e-9,
    { aim0, aim1: s1.aim, aim2: s2.aim })

  // 夹限：疯狂缩放 / 俯仰，pitch 与 dist 必须留在区间内
  await p.evaluate(() => {
    const cam = globalThis.__bc.container.view.camera
    for (let i = 0; i < 100; i++) cam.zoomFarBy(0.5)
    for (let i = 0; i < 100; i++) cam.orbitFarBy(0, -100)
  })
  await sleep(1500)
  const s3 = await state()
  ok('S5_缩放与俯仰夹限生效',
    s3.farCam.dist >= 0.03275 * 14 - 1e-6 && s3.farCam.pitch <= 1.45 + 1e-6,
    { dist: s3.farCam.dist, pitch: s3.farCam.pitch })

  // 切走再切回保留用户机位
  await p.evaluate(() => document.getElementById('camera')?.click())
  await sleep(5500)
  await p.evaluate(() => document.getElementById('camera')?.click())
  await sleep(5500)
  await p.evaluate(() => document.getElementById('camera')?.click())
  await sleep(5500)
  const s4 = await state()
  ok('S6_切走再切回保留机位',
    s4.mode === 'farView' && Math.abs(s4.farCam.yaw - s3.farCam.yaw) < 1e-6 &&
    Math.abs(s4.farCam.dist - s3.farCam.dist) < 1e-6,
    { mode: s4.mode, farCam: s4.farCam })

  ok('S7_零页面错误', errs.length === 0, { errs })
  const passed = results.filter((r) => r.cond).length
  console.log(`\n合计：${passed}/${results.length}`)
  await b.close()
  process.exit(passed === results.length ? 0 : 1)
})().catch((e) => { console.error('FATAL', e); process.exit(2) })
