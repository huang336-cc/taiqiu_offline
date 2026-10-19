const puppeteer = require("puppeteer-core")
const BASE = "http://127.0.0.1:8181"
const sleep = ms => new Promise(r=>setTimeout(r,ms))
;(async () => {
  const b = await puppeteer.launch({ executablePath:"/usr/bin/google-chrome", headless:true, protocolTimeout:120000,
    args:["--no-sandbox","--disable-dev-shm-usage","--use-gl=angle","--use-angle=swiftshader","--enable-unsafe-swiftshader","--user-data-dir=/tmp/chrome-dbg3","--window-size=393,851"],
    env:{...process.env, DISPLAY:""} })
  const p = await b.newPage()
  await p.setViewport({width:393,height:851})
  p.on("pageerror", e=>console.log("PAGEERR:", String(e).slice(0,200)))
  await p.goto(`${BASE}/play.html?ruletype=eightball&bot=ClawBreak`, {waitUntil:"domcontentloaded", timeout:60000})
  for (let i=0;i<12;i++) {
    await sleep(2500)
    const s = await p.evaluate(() => {
      const c = window.container
      return { ctrl: c?.controller?.name, dis: !!c?.table?.cue?.aimInputs?.controlsDisabled,
               q: c?.inputQueue?.length, allowsPlace: (()=>{try{return c?.rules?.allowsPlaceBall()}catch{return "ERR"}})() }
    })
    console.log(i, JSON.stringify(s))
    if (s.ctrl === "PlaceBall" && !s.dis) {
      await p.evaluate(() => { window.container.inputQueue.push({t:1,key:"SpaceUp"}) })
      console.log("   -> pushed SpaceUp")
    }
  }
  await b.close()
})()
