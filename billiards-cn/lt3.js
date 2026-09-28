const puppeteer = require("puppeteer-core")
const fs = require("fs")
fs.rmSync("/tmp/ct3", {recursive:true, force:true})
;(async()=>{
 try{
  const b = await puppeteer.launch({
    executablePath:"/usr/bin/google-chrome", headless:"new", dumpio:true,
    args:["--no-sandbox","--hide-scrollbars","--disable-dev-shm-usage","--no-zygote",
      "--use-gl=angle","--use-angle=swiftshader","--enable-unsafe-swiftshader",
      "--user-data-dir=/tmp/ct3","--in-process-gpu","--disable-gpu-sandbox",
      "--allow-file-access-from-files","--window-size=400,300"],
    env:{...process.env},
  })
  console.log("LAUNCH OK", await b.version())
  const p = await b.newPage()
  await p.goto("about:blank")
  const gl = await p.evaluate(()=>{const c=document.createElement("canvas");const g=c.getContext("webgl2")||c.getContext("webgl");return g?g.getParameter(g.VERSION):"NO WEBGL"})
  console.log("WEBGL:", gl)
  await b.close()
 }catch(e){ console.log("ERR:", e.message.split("\n").slice(0,4).join(" | ")) }
})()
