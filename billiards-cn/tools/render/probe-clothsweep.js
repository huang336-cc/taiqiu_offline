/**
 * 台呢贴图平铺密度扫描 —— 找出在瞄准视角"能看见织纹但不显噪点"的 repeat。
 *
 * 背景：实测 `cloth` 材质挂了 512² 贴图，但 `repeat=[2,2]` —— 一个贴图单元
 * 覆盖 1.27m × 0.64m 的台面，即 1 像素 = 2.5mm，织纹被放大成一片模糊。
 * 且台呢**没有任何 normalMap / bumpMap / aoMap**，所以完全没有表面起伏。
 *
 * 本脚本保持其它一切不动，只改 repeat，量化两张指标：
 *   · 局部对比度（相邻像素梯度均值）—— 代表"织纹是否看得见"
 *   · 高频能量占比 —— 过高说明出现摩尔纹/噪点
 */
const puppeteer = require("puppeteer-core");
const fs = require("fs");

const OUT = "/root/.codebuddy/artifact/render/shots/clothsweep";
fs.mkdirSync(OUT, { recursive: true });

const REPEATS = [2, 4, 6, 8, 12, 16, 24, 32];
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
    globalThis.__bc.container.view.applyScene(sc);
  }, SCENE);
  await new Promise((r) => setTimeout(r, 4000));

  console.log(`\n台呢平铺密度扫描  (场景 ${SCENE}, 只改 repeat)`);
  console.log("=".repeat(78));
  console.log("  repeat  单元素覆盖   梯度均值   梯度标准差   判定");

  for (const rep of REPEATS) {
    await page.evaluate((r) => {
      const v = globalThis.__bc.container.view;
      v.table.mesh.traverse((o) => {
        if (!o.isMesh || !o.material) return;
        const m = o.material;
        const mat = Array.isArray(m) ? m[0] : m;
        if (mat.name === "cloth" && mat.map) {
          mat.map.repeat.set(r, r);
          mat.map.needsUpdate = true;
          mat.needsUpdate = true;
        }
      });
    }, rep);
    await new Promise((r) => setTimeout(r, 1600));

    const shot = await page.screenshot({ encoding: "base64" });
    fs.writeFileSync(`${OUT}/${SCENE}_r${rep}.png`, Buffer.from(shot, "base64"));

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
      // 只取台呢区域：画面下半部的中间带（避开球、杆、HUD）
      const x0 = Math.floor(cv.width * 0.15);
      const x1 = Math.floor(cv.width * 0.85);
      const y0 = Math.floor(cv.height * 0.58);
      const y1 = Math.floor(cv.height * 0.75);
      const d = ctx.getImageData(0, 0, cv.width, cv.height).data;
      const lum = (x, y) => {
        const i = (y * cv.width + x) * 4;
        return 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      };
      let sum = 0,
        n = 0,
        sum2 = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          // 与右邻 + 下邻的亮度差绝对值，取均值
          const g = (Math.abs(lum(x, y) - lum(x + 1, y)) + Math.abs(lum(x, y) - lum(x, y + 1))) / 2;
          sum += g;
          sum2 += g * g;
          n++;
        }
      }
      const mean = sum / n;
      const sd = Math.sqrt(Math.max(0, sum2 / n - mean * mean));
      return { mean: +mean.toFixed(3), sd: +sd.toFixed(3) };
    }, shot);

    // 判据：梯度均值落在 0.6~3.0 说明织纹可见但不刺眼
    let verdict = "偏平滑（织纹看不见）";
    if (stat.mean >= 0.6 && stat.mean <= 3.0) verdict = "✅ 织纹可见";
    else if (stat.mean > 3.0) verdict = "偏噪（可能摩尔纹）";

    const cov = (2.54 / rep).toFixed(2);
    console.log(
      `  ${String(rep).padStart(3)}    ${cov.padStart(6)}m      ${String(stat.mean).padStart(7)}    ${String(stat.sd).padStart(7)}     ${verdict}`,
    );
  }
  console.log("=".repeat(78));
  console.log(`截图: ${OUT}/`);
  await browser.close();
})().catch((e) => {
  console.error("失败:", e.message);
  process.exit(1);
});
