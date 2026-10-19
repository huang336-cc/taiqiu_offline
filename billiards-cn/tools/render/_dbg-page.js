const puppeteer = require("puppeteer-core")
const BASE = process.env.BASE || "http://127.0.0.1:8181"
;(async () => {
  const b = await puppeteer.launch({
    executablePath: "/usr/bin/google-chrome", headless: true, protocolTimeout: 60000,
    args: ["--no-sandbox","--disable-dev-shm-usage","--use-gl=angle","--use-angle=swiftshader","--enable-unsafe-swiftshader","--user-data-dir=/tmp/chrome-dbg3","--window-size=393,851"],
    env: { ...process.env, DISPLAY: "" },
  })
  const p = await b.newPage()
  await p.setViewport({width:393,height:851})
  p.on("pageerror", e => console.log("PAGEERR:", String(e).slice(0,300)))
  p.on("console", m => { if (m.type()==="error") console.log("CONSOLE-ERR:", m.text().slice(0,200)) })
  await p.goto(`${BASE}/play.html?ruletype=eightball&bot=ClawBreak`, {waitUntil:"domcontentloaded", timeout:60000})
  await new Promise(r=>setTimeout(r,8000))
  console.log(await p.evaluate(() => ({
    hasContainer: !!window.container,
    hasCanvas: !!document.querySelector("#viewP1 canvas"),
    loading: document.getElementById("view3dLoading")?.style.display,
    ctrl: window.container?.controller?.name,
    keys: Object.keys(window).filter(k=>k.startsWith("__")).slice(0,10),
  })))
  await b.close()
})()
