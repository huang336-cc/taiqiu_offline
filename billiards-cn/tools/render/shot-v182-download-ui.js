/* 截取 v1.8.2 发布页下载区域的三种状态：初始 / 下载中 / 完成 */
const puppeteer = require('/workspace/dev/source/billiards-cn/node_modules/puppeteer-core')
const fs = require('fs')
const OUT = '/root/.codebuddy/artifact/render/v182-dl'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const BASE = 'https://a7b9dc0cd0da80587.app.workbuddy.host'
const SC = 'I67DJCFW6E'

;(async () => {
  fs.mkdirSync(OUT, { recursive: true })
  const b = await puppeteer.launch({
    executablePath: '/usr/bin/google-chrome',
    headless: 'new',
    args: ['--no-sandbox', '--user-data-dir=/tmp/chrome-dlshot' + Date.now()],
    defaultViewport: { width: 1080, height: 1000, deviceScaleFactor: 2 },
  })
  const p = await b.newPage()
  const errs = []
  p.on('pageerror', (e) => errs.push(String(e.message).slice(0, 160)))
  await p.goto(`${BASE}/?sharecode=${SC}`, { waitUntil: 'load', timeout: 60000 })
  await sleep(700)

  // 定位「下载安装」卡片（每次重算，因为下载完成后卡片会变高）
  const getBox = () =>
    p.evaluate(() => {
      const cards = Array.from(document.querySelectorAll('.card'))
      const c = cards.find((x) => (x.textContent || '').includes('下载安装'))
      if (!c) return null
      const r = c.getBoundingClientRect()
      return { x: r.x, y: r.y, width: r.width, height: r.height }
    })

  const toClip = (b) => ({
    x: Math.max(0, b.x - 10),
    y: Math.max(0, b.y - 10),
    width: Math.min(1080, b.width + 20),
    height: b.height + 20,
  })

  const box = await getBox()
  if (!box) throw new Error('找不到下载卡片')
  const clip = toClip(box)

  await p.screenshot({ path: `${OUT}/dl-1-initial.png`, clip })
  console.log('shot: initial', JSON.stringify(clip))

  // 点击 APK，抓下载中状态
  await p.click('a.dl[data-file="billiards-cn-v1.8.2.apk"]')
  let captured = false
  const t0 = Date.now()
  while (Date.now() - t0 < 60000) {
    const st = await p.evaluate(() => {
      const a = document.querySelector('a.dl[data-file="billiards-cn-v1.8.2.apk"]')
      const w = parseFloat(((a.querySelector('.bar > i') || {}).style || {}).width) || 0
      return { w, cls: a.className, text: (a.querySelector('.st') || {}).textContent }
    })
    if (!captured && st.w >= 30 && st.w <= 88) {
      await p.screenshot({ path: `${OUT}/dl-2-progress.png`, clip })
      console.log('shot: progress', JSON.stringify(st))
      captured = true
    }
    if (st.cls.includes('ok') || st.cls.includes('err')) break
    await sleep(80)
  }
  await sleep(600)
  const box3 = await getBox()
  await p.screenshot({ path: `${OUT}/dl-3-done.png`, clip: box3 ? toClip(box3) : clip })
  console.log('shot: done')

  console.log('errs=', JSON.stringify(errs))
  await b.close()
})().catch((e) => {
  console.error('FATAL', e)
  process.exit(2)
})
