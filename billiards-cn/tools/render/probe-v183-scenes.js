/* v1.8.3 场景验证：
 * S1 菜单只剩 6 个场景（football/basketball/ufc 已下线）
 * S2 选中「中式茶室」后写入 localStorage
 * S3 重新加载菜单后仍保留（持久化，不再回落雪山）
 * S4 进入游戏（play.html）不报错且沿用该场景
 * S5 退出游戏回菜单后场景仍保留（往返一次）
 * S6 旧存档 scene=football → 自动回落 snow（不再有已下线场景）
 */
const puppeteer = require('/workspace/dev/source/billiards-cn/node_modules/puppeteer-core')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const BASE = process.env.BASE || 'http://127.0.0.1:8190'
const KEY = 'billiards_cn_settings_v1'

const results = []
const ok = (n, c, i) => {
  results.push({ n, c })
  console.log(`${c ? 'PASS' : 'FAIL'}  ${n}  ${JSON.stringify(i === undefined ? {} : i)}`)
}

;(async () => {
  const b = await puppeteer.launch({
    executablePath: '/usr/bin/google-chrome',
    headless: 'new',
    args: ['--no-sandbox', '--user-data-dir=/tmp/chrome-v183sc' + Date.now(), '--window-size=1280,900'],
    defaultViewport: { width: 1280, height: 900 },
  })
  const p = await b.newPage()
  const errs = []
  p.on('pageerror', (e) => errs.push(String(e.message).slice(0, 160)))

  await p.goto(`${BASE}/menu.html`, { waitUntil: 'load', timeout: 60000 })
  await sleep(1200)

  // S1 卡片清单
  const scenes = await p.evaluate(() =>
    Array.from(document.querySelectorAll('#sceneCards .skin-card')).map((c) => c.getAttribute('data-scene'))
  )
  ok(
    'S1_菜单只剩 6 个场景且不含已下线项',
    scenes.length === 6 && !['football', 'basketball', 'ufc'].some((x) => scenes.includes(x)),
    { scenes }
  )

  // S2 选茶室
  await p.evaluate(() => {
    const c = document.querySelector('#sceneCards .skin-card[data-scene="tea"]')
    if (c) c.click()
  })
  await sleep(500)
  const saved = await p.evaluate((k) => {
    try { return JSON.parse(localStorage.getItem(k) || '{}').scene } catch (e) { return null }
  }, KEY)
  ok('S2_选中茶室已写入本地存档', saved === 'tea', { saved })

  // S3 重载后仍保留
  await p.reload({ waitUntil: 'load' })
  await sleep(1200)
  const afterReload = await p.evaluate(
    (k) => ({
      scene: (() => { try { return JSON.parse(localStorage.getItem(k) || '{}').scene } catch (e) { return null } })(),
      active: (document.querySelector('#sceneCards .skin-card.active') || {}).getAttribute
        ? document.querySelector('#sceneCards .skin-card.active').getAttribute('data-scene')
        : null,
    }),
    KEY
  )
  ok('S3_重新加载菜单后场景仍为茶室（持久化生效）', afterReload.scene === 'tea', afterReload)

  // S4 进入游戏，不报错
  const p2 = await b.newPage()
  const errs2 = []
  p2.on('pageerror', (e) => errs2.push(String(e.message).slice(0, 160)))
  await p2.goto(`${BASE}/play.html?debug=1&bot=Professional`, { waitUntil: 'load', timeout: 120000 })
  await p2.waitForFunction(
    () => { const v = globalThis.__bc?.container?.view; return !!(v && v.renderer) },
    { timeout: 90000 }
  )
  await sleep(3000)
  const inGame = await p2.evaluate((k) => {
    let s = {}
    try { s = JSON.parse(localStorage.getItem(k) || '{}') } catch (e) {}
    const v = globalThis.__bc?.container?.view
    return {
      scene: s.scene,
      envName: v?.sceneEnv?.name ?? null,
      error: null,
    }
  }, KEY)
  ok('S4_进入游戏沿用茶室且无异常', inGame.scene === 'tea' && errs2.length === 0, { ...inGame, errs: errs2 })
  await p2.close()

  // S5 退出游戏回菜单（一次往返）
  await p.goto(`${BASE}/menu.html`, { waitUntil: 'load', timeout: 60000 })
  await sleep(1000)
  const back = await p.evaluate((k) => {
    let s = {}
    try { s = JSON.parse(localStorage.getItem(k) || '{}') } catch (e) {}
    const active = document.querySelector('#sceneCards .skin-card.active')
    return { scene: s.scene, active: active ? active.getAttribute('data-scene') : null }
  }, KEY)
  ok('S5_退出游戏回菜单后仍是茶室（不再恢复雪山）', back.scene === 'tea' && back.active === 'tea', back)

  // S6 旧存档含已下线场景 → 回落雪山
  await p.evaluate((k) => {
    const s = JSON.parse(localStorage.getItem(k) || '{}')
    s.scene = 'football'
    localStorage.setItem(k, JSON.stringify(s))
  }, KEY)
  await p.reload({ waitUntil: 'load' })
  await sleep(1200)
  const fallback = await p.evaluate((k) => {
    let s = {}
    try { s = JSON.parse(localStorage.getItem(k) || '{}') } catch (e) {}
    return { scene: s.scene }
  }, KEY)
  ok('S6_旧存档 football 自动回落雪山', fallback.scene === 'snow', fallback)

  ok('S7_零页面错误', errs.length === 0, { errs })

  await b.close()
  const pass = results.filter((r) => r.c).length
  console.log(`\n合计：${pass}/${results.length}`)
  process.exit(pass === results.length ? 0 : 1)
})().catch((e) => {
  console.error('FATAL', e.message.slice(0, 300))
  process.exit(2)
})
