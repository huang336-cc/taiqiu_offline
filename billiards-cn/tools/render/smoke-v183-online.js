/* v1.8.3 线上冒烟：发布页 / 菜单场景 / 变更履历 / 进游戏 / 下载链接 */
const puppeteer = require('/workspace/dev/source/billiards-cn/node_modules/puppeteer-core')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const HOST = 'https://a7b9dc0cd0da80587.app.workbuddy.host'
const SC = 'I67DJCFW6E'
const U = (p) => `${HOST}${p}${p.includes('?') ? '&' : '?'}sharecode=${SC}`

const res = []
const ok = (n, c, i) => { res.push(c); console.log(`${c ? 'PASS' : 'FAIL'}  ${n}  ${JSON.stringify(i === undefined ? {} : i)}`) }

;(async () => {
  const b = await puppeteer.launch({
    executablePath: '/usr/bin/google-chrome',
    headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--user-data-dir=/tmp/chrome-v183smoke' + Date.now(), '--window-size=1280,900'],
    defaultViewport: { width: 1280, height: 900 },
  })
  const p = await b.newPage()
  const errs = []
  p.on('pageerror', (e) => errs.push(String(e.message).slice(0, 160)))

  // O1 发布页
  await p.goto(U('/index.html'), { waitUntil: 'load', timeout: 90000 })
  await sleep(800)
  const page = await p.evaluate(() => ({
    title: document.title,
    ver: document.querySelector('.ver')?.textContent?.trim(),
    dl: Array.from(document.querySelectorAll('a.dl')).map((a) => a.dataset.file),
    copies: Array.from(document.querySelectorAll('.copybtn')).map((x) => x.dataset.copy),
    cards: document.querySelectorAll('.card').length,
  }))
  ok('O1_发布页为 v1.8.3 且下载卡指向新文件',
    /v1\.8\.3/.test(page.title) && /v1\.8\.3/.test(page.ver || '') &&
    page.dl.join(',') === 'billiards-cn-v1.8.3.apk,release-v1.8.3.zip' &&
    page.copies.length === 2, page)

  // O2 菜单：6 个场景
  await p.goto(U('/menu.html'), { waitUntil: 'load', timeout: 90000 })
  await sleep(1200)
  const menu = await p.evaluate(() => ({
    ver: window.__BILLIARDS_VERSION__,
    scenes: Array.from(document.querySelectorAll('#sceneCards .skin-card')).map((c) => c.dataset.scene),
  }))
  ok('O2_线上菜单 6 个场景、版本 1.8.3',
    menu.scenes.length === 6 && !['football', 'basketball', 'ufc'].some((x) => menu.scenes.includes(x)) && /^1\.8\.3/.test(menu.ver), menu)

  // O3 变更履历
  const cl = await p.evaluate(async () => {
    const r = await fetch('changelog-data.js', { credentials: 'include' })
    const t = await r.text()
    return { ok: r.ok, len: t.length, has183: t.includes('v1.8.3'), has182: t.includes('v1.8.2') }
  })
  ok('O3_变更履历含 v1.8.3 且保留 v1.8.2', cl.ok && cl.has183 && cl.has182, cl)

  // O4 进游戏
  await p.goto(U('/play.html?debug=1&ruletype=eightball&bot=ClawBreak&practice=true'), { waitUntil: 'domcontentloaded', timeout: 120000 })
  await p.waitForFunction(() => {
    const c = globalThis.__bc?.container
    return !!(c && c.view && c.view.renderer && c.table)
  }, { timeout: 120000 })
  await sleep(3000)
  const game = await p.evaluate(() => {
    const c = globalThis.__bc.container
    return {
      ctrl: c.controller?.name,
      balls: c.table.balls.length,
      ballReturn: !!c.view.scene.getObjectByName('BallReturn'),
      scene: c.settings?.scene || c.settings?.get?.().scene,
      version: window.__BILLIARDS_VERSION__,
    }
  })
  ok('O4_线上进游戏正常、BallReturn 存在、无页面错误',
    !!game.ctrl && game.balls > 0 && game.ballReturn && errs.length === 0, { ...game, errs: errs.slice(0, 4) })

  console.log(`合计：${res.filter(Boolean).length}/${res.length}`)
  await b.close()
})().catch((e) => { console.log('FATAL', String(e.message).slice(0, 200)); process.exit(1) })
