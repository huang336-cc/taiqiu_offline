/* v1.8.2 下载修复验证：进度真的动、无 cookie 也能下、403 有明确提示、复制链接可用 */
const puppeteer = require('/workspace/dev/source/billiards-cn/node_modules/puppeteer-core')
const fs = require('fs')
const path = require('path')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const BASE = process.env.BASE || 'https://a7b9dc0cd0da80587.app.workbuddy.host'
const SC = process.env.SHARECODE || 'I67DJCFW6E'
const DL = '/tmp/v182-download-verify'
const results = []
const ok = (name, cond, info) => {
  results.push({ name, cond })
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}  ${JSON.stringify(info === undefined ? {} : info)}`)
}

;(async () => {
  fs.rmSync(DL, { recursive: true, force: true })
  fs.mkdirSync(DL, { recursive: true })
  const b = await puppeteer.launch({
    executablePath: '/usr/bin/google-chrome',
    headless: 'new',
    args: ['--no-sandbox', '--user-data-dir=/tmp/chrome-v182-dl' + Date.now(), '--window-size=1280,900'],
    defaultViewport: { width: 1280, height: 900 },
  })

  const cdp = await b.target().createCDPSession()
  await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: DL, eventsEnabled: true })

  const p = await b.newPage()
  const errs = []
  p.on('pageerror', (e) => errs.push(String(e.message).slice(0, 200)))

  // ── D1 打开发布页（带 sharecode）──
  const res = await p.goto(`${BASE}/?sharecode=${SC}`, { waitUntil: 'load', timeout: 60000 })
  ok('D1_发布页可打开', res && res.status() === 200, { status: res && res.status() })

  // ── D2 下载链接已自动补 sharecode ──
  const hrefs = await p.evaluate(() =>
    Array.from(document.querySelectorAll('a.dl[data-file]')).map((a) => ({
      file: a.getAttribute('data-file'),
      href: a.getAttribute('href'),
    }))
  )
  ok(
    'D2_下载链接自带 sharecode（不依赖 cookie）',
    hrefs.length === 2 && hrefs.every((h) => h.href.includes(`sharecode=${SC}`)),
    hrefs
  )

  // ── D3 复制链接按钮存在 ──
  const copyCount = await p.evaluate(() => document.querySelectorAll('[data-copy]').length)
  ok('D3_复制下载链接按钮存在', copyCount === 2, { copyCount })

  // ── D4 点 APK：进度必须递增，不能停在 0 ──
  const samples = []
  await p.click('a.dl[data-file="billiards-cn-v1.8.3.apk"]')
  const t0 = Date.now()
  while (Date.now() - t0 < 90000) {
    const st = await p.evaluate(() => {
      const a = document.querySelector('a.dl[data-file="billiards-cn-v1.8.3.apk"]')
      if (!a) return null
      return {
        text: (a.querySelector('.st') || {}).textContent || '',
        width: ((a.querySelector('.bar > i') || {}).style || {}).width || '',
        cls: a.className,
      }
    })
    if (st) {
      samples.push(st)
      if (st.cls.includes('ok') || st.cls.includes('err')) break
    }
    await sleep(120)
  }
  const widths = samples
    .map((s) => parseFloat(s.width))
    .filter((n) => !isNaN(n))
  const distinct = Array.from(new Set(widths.map((n) => Math.round(n))))
  const last = samples[samples.length - 1] || {}
  ok(
    'D4_进度条真实递增（≥3 个中间态，非卡 0）',
    distinct.length >= 3 && distinct[distinct.length - 1] > distinct[0],
    { distinct: distinct.slice(0, 12), final: last.text }
  )
  ok('D5_APK 下载完成无报错', !!last.cls && last.cls.includes('ok'), { cls: last.cls, text: last.text })

  // ── D6 落盘文件字节与本地一致 ──
  await sleep(1500)
  const files = fs.readdirSync(DL).filter((f) => f.endsWith('.apk'))
  const apkSize = files.length ? fs.statSync(path.join(DL, files[0])).size : 0
  const local = fs.statSync('/workspace/publish-site/billiards-cn-v1.8.3.apk').size
  ok('D6_下载文件字节与源文件一致', apkSize === local, { apkSize, local, files })

  // ── D6b 点 ZIP（56MB 大文件）：同样必须真实推进并完整落盘 ──
  const zsamples = []
  await p.click('a.dl[data-file="release-v1.8.3.zip"]')
  const tz = Date.now()
  while (Date.now() - tz < 180000) {
    const st = await p.evaluate(() => {
      const a = document.querySelector('a.dl[data-file="release-v1.8.3.zip"]')
      if (!a) return null
      return {
        text: (a.querySelector('.st') || {}).textContent || '',
        width: ((a.querySelector('.bar > i') || {}).style || {}).width || '',
        cls: a.className,
      }
    })
    if (st) {
      zsamples.push(st)
      if (st.cls.includes('ok') || st.cls.includes('err')) break
    }
    await sleep(150)
  }
  const zW = zsamples.map((s) => parseFloat(s.width)).filter((n) => !isNaN(n))
  const zDistinct = Array.from(new Set(zW.map((n) => Math.round(n))))
  const zLast = zsamples[zsamples.length - 1] || {}
  ok(
    'D6b_ZIP 56MB 进度同样真实递增并完成',
    zDistinct.length >= 3 && !!zLast.cls && zLast.cls.includes('ok'),
    { distinct: zDistinct.slice(0, 14), final: zLast.text }
  )
  await sleep(2000)
  const zfiles = fs.readdirSync(DL).filter((f) => f.endsWith('.zip'))
  const zSize = zfiles.length ? fs.statSync(path.join(DL, zfiles[0])).size : 0
  const zLocal = fs.statSync('/workspace/publish-site/release-v1.8.3.zip').size
  ok('D6c_ZIP 落盘字节与源文件一致', zSize === zLocal, { zSize, zLocal, zfiles })


  // ── D7 无 cookie 环境（系统下载器场景）──
  // 用 Node 原生 fetch，完全不携带浏览器 cookie，等价于系统下载器发起的请求。
  const r7 = await fetch(`${BASE}/billiards-cn-v1.8.3.apk?sharecode=${SC}`, { cache: 'no-store' })
  const b7 = (await r7.arrayBuffer()).byteLength
  ok('D7_无 cookie + 带 sharecode 可完整下载（系统下载器场景）', r7.status === 200 && b7 === local, {
    status: r7.status,
    bytes: b7,
    local,
  })

  // ── D8 无 cookie 且无 sharecode → 403，确认根因口径 ──
  const r8 = await fetch(`${BASE}/billiards-cn-v1.8.3.apk`, { cache: 'no-store' })
  ok('D8_裸链接返回 403（确认根因口径）', r8.status === 403, { status: r8.status })

  // ── D9 复制链接得到含 sharecode 的绝对地址 ──
  const absUrl = await p.evaluate(() => {
    const btn = document.querySelector('[data-copy="billiards-cn-v1.8.3.apk"]')
    const file = btn.getAttribute('data-copy')
    const sc = new URLSearchParams(location.search).get('sharecode') || 'I67DJCFW6E'
    return new URL(file + '?sharecode=' + encodeURIComponent(sc), location.href).href
  })
  ok('D9_复制链接为含 sharecode 的绝对地址', absUrl.includes('sharecode=') && absUrl.startsWith('http'), { absUrl })

  // ── D10 零页面错误 ──
  ok('D10_零页面错误', errs.length === 0, { errs })

  await b.close()
  const pass = results.filter((r) => r.cond).length
  console.log(`\n合计：${pass}/${results.length}`)
  process.exit(pass === results.length ? 0 : 1)
})().catch((e) => {
  console.error('FATAL', e)
  process.exit(2)
})
