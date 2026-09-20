/**
 * 量化「瞄准视角的画面构成」—— 回答一个问题：
 * 用户在瞄准视角里，屏幕上各个区域分别看到的是什么。
 *
 * 关键手法：**在浏览器内**用 canvas 读像素（不引 PNG 解码依赖），
 * 把屏幕按高度切条，统计每条的「台呢绿」占比与平均亮度。
 *
 * 用法：DISPLAY=:99 node tools/render/probe-framing.js [scene]
 */
const path = require("path");
const puppeteer = require("puppeteer-core");

const SCENE = process.argv[2] || "room";
const URL =
  "file:///workspace/project/source/billiards-cn/dist/play.html?debug=1&bot=Professional";

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

  // 先设场景，再进页面
  await page.goto(URL, { waitUntil: "networkidle2", timeout: 60000 });
  await page.waitForFunction(
    () => globalThis.__bc && globalThis.__bc.container && globalThis.__bc.container.view,
    { timeout: 60000 },
  );
  await new Promise((r) => setTimeout(r, 2000));

  // 切场景
  await page.evaluate((sc) => {
    try {
      const S = globalThis.__bc.container.settings;
      if (S && S.set) S.set({ envScene: sc });
    } catch (e) {}
    try {
      if (globalThis.__bc.scene) globalThis.__bc.scene(sc);
    } catch (e) {}
  }, SCENE);
  await new Promise((r) => setTimeout(r, 2500));

  await page.evaluate(() => {
    const v = globalThis.__bc.container.view;
    if (v.camWrap && v.camWrap.forceMode) v.camWrap.forceMode("aim");
  });
  await new Promise((r) => setTimeout(r, 1500));

  // 浏览器内读像素（WebGL canvas → 2D canvas）
  const stats = await page.evaluate(() => {
    const cv = document.querySelector("canvas");
    if (!cv) return { error: "no canvas" };
    const W = cv.width,
      H = cv.height;
    const tmp = document.createElement("canvas");
    tmp.width = W;
    tmp.height = H;
    const ctx = tmp.getContext("2d");
    ctx.drawImage(cv, 0, 0);
    const img = ctx.getImageData(0, 0, W, H).data;

    const isCloth = (r, g, b) => g > r + 12 && g > b + 12;
    const lum = (r, g, b) => Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b);

    // 全屏台呢占比
    let clothN = 0,
      tot = 0;
    for (let y = 0; y < H; y += 2)
      for (let x = 0; x < W; x += 2) {
        const i = (y * W + x) * 4;
        if (isCloth(img[i], img[i + 1], img[i + 2])) clothN++;
        tot++;
      }

    // 分行（20 条横带）：每带的台呢占比 + 平均亮度
    const BANDS = 20;
    const rows = [];
    for (let b = 0; b < BANDS; b++) {
      const y0 = Math.floor((b * H) / BANDS),
        y1 = Math.floor(((b + 1) * H) / BANDS);
      let cn = 0,
        n = 0,
        lsum = 0;
      for (let y = y0; y < y1; y += 2)
        for (let x = 0; x < W; x += 2) {
          const i = (y * W + x) * 4;
          if (isCloth(img[i], img[i + 1], img[i + 2])) cn++;
          lsum += lum(img[i], img[i + 1], img[i + 2]);
          n++;
        }
      rows.push({
        band: b,
        yMid: Math.round((y0 + y1) / 2),
        pctFromTop: Math.round((((y0 + y1) / 2) / H) * 100),
        clothPct: +((cn / n) * 100).toFixed(1),
        meanLum: Math.round(lsum / n),
      });
    }

    // 相机信息
    const cam = globalThis.__bc.container.view.camWrap;
    const c = cam && cam.camera;
    return {
      W,
      H,
      clothPctAll: +((clothN / tot) * 100).toFixed(1),
      rows,
      camera: c
        ? {
            pos: [c.position.x, c.position.y, c.position.z].map((v) => +v.toFixed(3)),
            fov: c.fov,
          }
        : null,
    };
  });

  await browser.close();

  if (stats.error) {
    console.error("失败:", stats.error);
    process.exit(1);
  }

  const R = 0.028575;
  console.log(`\n场景 ${SCENE}   画布 ${stats.W}x${stats.H}`);
  if (stats.camera)
    console.log(
      `相机位置 [${stats.camera.pos.join(", ")}]  FOV ${stats.camera.fov}°  （R=${R}）`,
    );
  console.log("=".repeat(76));
  console.log("屏幕横带 → 台呢占比 / 平均亮度");
  console.log("-".repeat(76));
  console.log("  屏幕位置    台呢占比   平均亮度   可视化");
  for (const r of stats.rows) {
    const bar = "█".repeat(Math.round(r.clothPct / 4));
    console.log(
      `  ${String(r.pctFromTop).padStart(3)}% (y=${String(r.yMid).padStart(3)})  ${String(r.clothPct).padStart(5)}%   L=${String(r.meanLum).padStart(3)}   ${bar}`,
    );
  }
  console.log("-".repeat(76));
  console.log(`全屏台呢占比：${stats.clothPctAll}%`);

  // 屏幕上边缘对应世界高度
  const camZ = stats.camera ? stats.camera.pos[2] : R * 9;
  const fov = (stats.camera ? stats.camera.fov : 45) * (Math.PI / 180);
  const dist = R * 24;
  console.log(`\n相机高 z=${camZ.toFixed(3)}m，注视前方 ${dist.toFixed(3)}m 处：`);
  for (const frac of [0, 0.15, 0.3, 0.5, 0.75, 1.0]) {
    const ndc = 1 - 2 * frac;
    const ang = Math.atan(ndc * Math.tan(fov / 2));
    const h = camZ + Math.tan(ang) * dist;
    const angDeg = ((ang * 180) / Math.PI).toFixed(2);
    const verb = h > 1.5 ? "能看到墙面/家具上部" : h > 0.6 ? "能看到家具" : "只在地面高度";
    console.log(
      `  屏幕 ${String(Math.round(frac * 100)).padStart(3)}% 行 → 仰角 ${String(angDeg).padStart(6)}° → 世界高度 ${h.toFixed(2).padStart(5)}m   ${verb}`,
    );
  }
})().catch((e) => {
  console.error("失败:", e.message);
  process.exit(1);
});
