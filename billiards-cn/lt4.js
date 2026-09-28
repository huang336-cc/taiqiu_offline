const puppeteer = require("puppeteer-core")
const fs=require("fs"); fs.rmSync("/tmp/ct4",{recursive:true,force:true})
const variants = [
  {name:"no-DISPLAY + swiftshader", env:{}, extra:[]},
  {name:"ozone-headless + swiftshader", env:{}, extra:["--ozone-platform=headless"]},
  {name:"use-gl=swiftshader (legacy)", env:{}, extra:["--use-gl=swiftshader"]},
]
;(async()=>{
 for(const v of variants){
  const e={...process.env, ...v.env}; delete e.DISPLAY
  try{
   const b=await puppeteer.launch({executablePath:"/usr/bin/google-chrome",headless:"new",
    args:["--no-sandbox","--hide-scrollbars","--disable-dev-shm-usage","--no-zygote",
      "--use-gl=angle","--use-angle=swiftshader","--enable-unsafe-swiftshader",
      "--user-data-dir=/tmp/ct4","--in-process-gpu","--disable-gpu-sandbox",
      "--allow-file-access-from-files","--window-size=400,300",...v.extra],
    env:e})
   const p=await b.newPage(); await p.goto("about:blank")
   const gl=await p.evaluate(()=>{const c=document.createElement("canvas");const g=c.getContext("webgl2")||c.getContext("webgl");return g?g.getParameter(g.VERSION):"NO WEBGL"})
   console.log("✅",v.name,"=> WEBGL:",gl)
   await b.close()
  }catch(err){ console.log("❌",v.name,"=>",err.message.split("\n")[0]) }
 }
})()
