/**
 * 瞄准机位「相机高度 → 画面内容」对照实验。
 *
 * 背景：真实瞄准机位实测相机 z=0.295m，而台面在 z=0.85m —— **相机在台面之下**，
 * 视线被台呢平面铺满（69%），画面里看不到任何环境。这解释了「改了几十版
 * 场景毫无优化感」：改的东西全在台面之上，物理上进不了画面。
 *
 * 本脚本对若干个相机高度各截一张图，并给出每张图里「非台呢像素」的占比，
 * 量化「能看到多少环境」。
 */
const puppeteer = require("puppeteer-core");
const fs = require("fs");

const OUT = "/root/.codebuddy/artifact/render/shots/aimheight";
fs.mkdirSync(OUT, { recursive: true });

const R = 0.03275;
const HEIGHTS = [9, 13, 18, 22, 26, 30];
const SCENE = process.argv[2] || "room";

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
  const page = await browser.newPage();
  await page.setViewport({ width: 540, height: 960 });
  await page.goto(
    "file:///workspace/project/source/billiards-cn/dist/play.html?debug=1&bot=Professional",
    { waitUntil: "networkidle2", timeout: 60000 },
  );
  await page.waitForFunction(
    () => globalThis.__bc && globalThis.__bc.container && globalThis.__bc.container.view,
    { timeout: 60000 },
  );
  await new Promise((r) => setTimeout(r, 2500));

  await page.evaluate((sc) => {
    const v = globalThis.__bc.container.view;
    if (typeof v.applyScene === "function") v.applyScene(sc);
  }, SCENE);
  await new Promise((r) => setTimeout(r, 4000));

  console.log(`\n瞄准机位高度对照  (场景 ${SCENE}, 台面 z=0.85m, R=${R})`);
  console.log("=".repeat(78));
  console.log("  高度      相机z(m)   台呢占比%   环境占比%   画面上缘可见高度(m)");

  for (const k of HEIGHTS) {
    await page.evaluate(
      (h) => {
        const v = globalThis.__bc.container.view;
        const cw = v.camera;
        // ⚠️ `height` 是私有字段，但 `forceMode(aim)` 会走 restoreSavedDistance
        // 之外的分支；稳妥做法：直接改 `Camera.defaultHeight`（构造时读它）
        // 并同步实例字段，再调 forceMode。
        cw.forceMode("aim");
        cw.height = h;
        // 劫持 update：只保留 aimView 的机位逻辑，禁止其它分支覆盖 height
        const origAim = cw.aimView.bind(cw);
        cw.update = function (elapsed, aim) {
          if (aim) origAim(aim, 1);
        };
        void origAim;
      },
      R * k,
    );
    // 触发一次 update，让新高度进相机
    await page.evaluate(() => {
      const v = globalThis.__bc.container.view;
      const cw = v.camera;
      const table = v.table;
      const balls = (table && table.balls) || [];
      const cue = balls.find((b) => b && b.label === 0) || (table && table.cueball);
      // 构造一个最小 aim 事件：aimView 只用到 pos / angle
      if (cw.update && cue) {
        cw.update(0, { pos: cue.pos, angle: 0 });
      }
    });
    await new Promise((r) => setTimeout(r, 2500));
    const cz = await page.evaluate(() => {
      const v = globalThis.__bc.container.view;
      return +v.camera.camera.position.z.toFixed(4);
    });
    void cz;

    const shot = await page.screenshot({ encoding: "base64" });
    fs.writeFileSync(`${OUT}/${SCENE}_R${k}.png`, Buffer.from(shot, "base64"));

    // 页面内统计：台呢绿 vs 其他
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
      // 只看 3D 视口（排除顶部 HUD 与底部工具栏，约 0~7% / 88~100%）
      const y0 = Math.floor(cv.height * 0.08);
      const y1 = Math.floor(cv.height * 0.87);
      let cloth = 0,
        total = 0;
      // 记录最上一行非台呢像素的 y，用于反推可见高度
      let topNonClothY = -1;
      for (let y = y0; y < y1; y++) {
        let rowNonCloth = 0,
          rowTotal = 0;
        for (let x = 0; x < cv.width; x++) {
          const i = (y * cv.width + x) * 4;
          const r = d[i],
            g = d[i + 1],
            b = d[i + 2];
          total++;
          rowTotal++;
          // 台呢：绿占优且中低亮度
          const isCloth = g > r + 8 && g > b + 8 && g > 60 && g < 190;
          if (isCloth) cloth++;
          else rowNonCloth++;
        }
        if (topNonClothY < 0 && rowNonCloth / rowTotal > 0.15) topNonClothY = y;
      }
      return {
        clothPct: +((cloth / total) * 100).toFixed(1),
        envPct: +(((total - cloth) / total) * 100).toFixed(1),
        topNonClothFrac: +((topNonClothY - y0) / (y1 - y0)).toFixed(4),
      };
    }, shot);

    console.log(
      `  R*${String(k).padEnd(4)}   ${(R * k).toFixed(4)}   相机实测z=${cz.toFixed(4)}   `
        + `台呢 ${String(stat.clothPct).padStart(5)}%   环境 ${String(stat.envPct).padStart(5)}%`,
    );
  }
  console.log("=".repeat(78));
  console.log(`截图输出: ${OUT}/`);

  await browser.close();
})().catch((e) => {
  console.error("失败:", e.message);
  process.exit(1);
});
