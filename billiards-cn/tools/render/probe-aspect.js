/**
 * 验证注视点抬升在不同宽高比下都成立（竖屏 0.607 / 方形 1.0 / 宽屏 1.78）。
 * 因为 adaptiveFov 在 aspect>=0.8 时会收窄纵向 FOV，需要确认不会把房间挤出去。
 */
const puppeteer = require("puppeteer-core");
const fs = require("fs");
const OUT = "/root/.codebuddy/artifact/render/shots/aspect";
fs.mkdirSync(OUT, { recursive: true });

const CASES = [
  { name: "portrait", w: 540, h: 960 },
  { name: "square", w: 800, h: 800 },
  { name: "landscape", w: 960, h: 540 },
];

(async () => {
  const browser = await puppeteer.launch({
    executablePath: "/usr/bin/google-chrome",
    headless: "new",
    args: [
      "--no-sandbox",
      "--hide-scrollbars",
      "--use-gl=angle",
      "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader",
      "--user-data-dir=/tmp/chrome-render-profile",
      "--in-process-gpu",
      "--disable-gpu-sandbox",
      "--allow-file-access-from-files",
    ],
  });

  console.log("\n注视点抬升在不同宽高比下的表现（场景 room）");
  console.log("=".repeat(72));
  console.log("  视口        宽高比   fov°   台呢占比%   环境占比%");

  for (const c of CASES) {
    const page = await browser.newPage();
    await page.setViewport({ width: c.w, height: c.h, deviceScaleFactor: 1 });
    await page.goto(
      "file:///workspace/project/source/billiards-cn/dist/play.html?debug=1&bot=Professional",
      { waitUntil: "networkidle2", timeout: 60000 },
    );
    await page.waitForFunction(
      () =>
        globalThis.__bc &&
        globalThis.__bc.container &&
        globalThis.__bc.container.view,
      { timeout: 60000 },
    );
    await new Promise((r) => setTimeout(r, 2500));
    await page.evaluate(() => {
      globalThis.__bc.container.view.applyScene("room");
    });
    await new Promise((r) => setTimeout(r, 4500));

    const shot = await page.screenshot({ encoding: "base64" });
    fs.writeFileSync(`${OUT}/room_${c.name}.png`, Buffer.from(shot, "base64"));

    const stat = await page.evaluate(async (b64) => {
      const im = await new Promise((res) => {
        const i = new Image();
        i.onload = () => res(i);
        i.src = "data:image/png;base64," + b64;
      });
      const cv = document.createElement("canvas");
      cv.width = im.width;
      cv.height = im.height;
      const ctx = cv.getContext("2d");
      ctx.drawImage(im, 0, 0);
      const d = ctx.getImageData(0, 0, cv.width, cv.height).data;
      const y0 = Math.floor(cv.height * 0.09);
      const y1 = Math.floor(cv.height * 0.86);
      let cloth = 0;
      let total = 0;
      for (let y = y0; y < y1; y++)
        for (let x = 0; x < cv.width; x++) {
          const i = (y * cv.width + x) * 4;
          const r = d[i];
          const g = d[i + 1];
          const b = d[i + 2];
          total++;
          if (g > r + 8 && g > b + 8 && g > 60 && g < 190) cloth++;
        }
      return {
        clothPct: +((cloth / total) * 100).toFixed(1),
        envPct: +(((total - cloth) / total) * 100).toFixed(1),
      };
    }, shot);

    const cam = await page.evaluate(() => {
      const cc = globalThis.__bc.container.view.camera.camera;
      return { fov: +cc.fov.toFixed(2), aspect: +cc.aspect.toFixed(3) };
    });

    const nm = c.name.padEnd(11);
    const asp = String(cam.aspect).padStart(6);
    const fv = String(cam.fov).padStart(6);
    const cp = String(stat.clothPct).padStart(8);
    const ep = String(stat.envPct).padStart(8);
    console.log(`  ${nm} ${asp}  ${fv}  ${cp}  ${ep}`);

    await page.close();
  }
  console.log("=".repeat(72));
  console.log(`截图: ${OUT}/`);
  await browser.close();
})().catch((e) => {
  console.error("失败:", e.message);
  process.exit(1);
});
