/* v1.8.3 交付图：场景选择区（只剩 6 个场景，茶室已选中） */
const puppeteer = require('/workspace/dev/source/billiards-cn/node_modules/puppeteer-core')
const fs = require('fs')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const BASE = process.env.BASE || 'http://127.0.0.1:8190'
const OUT = '/root/.codebuddy/artifact/render/v183'
const KEY = 'billiards_cn_settings_v1'

;(async () => {
  fs.mkdirSync(OUT, { recursive: true })
  const b = await puppeteer.launch({
    executablePath: '/usr/bin/google-chrome',
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--user-data-dir=/tmp/chrome-v183shot' + Date.now(),
      '--window-size=1280,1000',
    ],
    defaultViewport: { width: 1280, height: 1000, deviceScaleFactor: 2 },
  })
  const p = await b.newPage()
  await p.goto(`${BASE}/menu.html`, { waitUntil: 'load', timeout: 60000 })
  await sleep(1500)

  // 选中茶室，让截图能体现「选了就保留」
  await p.evaluate(
    (k) => {
      const raw = localStorage.getItem(k)
      const s = raw ? JSON.parse(raw) : {}
      s.scene = 'tea'
      localStorage.setItem(k, JSON.stringify(s))
    },
    KEY
  )
  await p.reload({ waitUntil: 'load' })
  await sleep(1600)

  // 打开「环境场景」二级菜单（默认隐藏）
  await p.evaluate(() => document.querySelector('.menu-row[data-target="scene"]')?.click())
  await sleep(900)

  const info = await p.evaluate(() => {
    const cards = Array.from(document.querySelectorAll('#sceneCards .skin-card'))
    const active = cards.filter((c) => /(^|\s)(on|active|selected)(\s|$)/.test(c.className)).map((c) => c.dataset.scene)
    const sec = document.querySelector('#sceneCards')?.closest('section, .setting-group, div')
    const r = (sec || document.querySelector('#sceneCards')).getBoundingClientRect()
    return {
      ids: cards.map((c) => c.dataset.scene),
      active,
      box: { x: Math.max(0, r.x), y: Math.max(0, r.y + window.scrollY - 8), w: r.width, h: r.height + 16 },
    }
  })
  console.log(JSON.stringify(info))

  // 只拍「环境场景」整屏（含标题），避免叠到上一屏按钮
  const sec = await p.$('#screen-scene')
  await sec.screenshot({ path: `${OUT}/v183-scenes-menu.png` })
  console.log('saved', `${OUT}/v183-scenes-menu.png`)
  await b.close()
})()
