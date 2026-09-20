const puppeteer = require("puppeteer-core");
(async () => {
  const b = await puppeteer.launch({
    executablePath: "/usr/bin/google-chrome",
    headless: "new",
    args: ["--no-sandbox","--hide-scrollbars","--user-data-dir=/tmp/chrome-render-profile","--allow-file-access-from-files"],
  });
  const p = await b.newPage();
  await p.setViewport({ width: 900, height: 1400, deviceScaleFactor: 1 });
  await p.goto("http://localhost:8899/index.html", { waitUntil: "networkidle2", timeout: 60000 });
  await new Promise((r) => setTimeout(r, 1500));
  await p.screenshot({ path: "/root/.codebuddy/artifact/render/shots/publish1386.png", fullPage: true });
  console.log("页面截图完成");
  await b.close();
})().catch((e) => { console.error(e.message); process.exit(1); });
