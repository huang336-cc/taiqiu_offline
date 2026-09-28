const puppeteer = require("puppeteer-core")
const fs = require("fs")
async function main(){
  fs.rmSync("/tmp/ct2", {recursive:true, force:true})
  try{
    const b = await puppeteer.launch({
      executablePath: "/usr/bin/google-chrome",
      headless: "new",
      args:["--no-sandbox","--hide-scrollbars","--use-gl=angle","--use-angle=swiftshader",
            "--enable-unsafe-swiftshader","--user-data-dir=/tmp/ct2",
            "--in-process-gpu","--disable-gpu-sandbox","--allow-file-access-from-files",
            "--window-size=1200,540"],
      env: {...process.env},
      dumpio: true,
    })
    console.log("✅ launch OK, version:", await b.version())
    const p = await b.newPage(); await p.goto("about:blank")
    console.log("✅ newPage OK")
    await b.close()
  }catch(e){ console.log("❌", e.message.split("\n").slice(0,3).join(" | ")) }
}
main()
