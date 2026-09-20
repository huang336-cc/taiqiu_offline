/**
 * 台呢贴图「对比度」实测 —— v1.3.87 的第二层问题。
 *
 * 背景：v1.3.86 修好 UV 后，台呢贴图终于能被采样了，但肉眼仍几乎看不出
 * 纹理。本探针直接在浏览器里取**真实生成的那张 512² 贴图**的像素数据，
 * 量化其对比度，并给出与「纯色」的差异度。
 *
 * 与 python 预测的区别：这里跑的是打包产物里真正执行的算法，
 * 包含 sRGB 色彩空间与 Canvas API 的真实行为，不是纸面推演。
 *
 * 用法：
 *   node tools/render/probe-clothcontrast.js
 */
const puppeteer = require("puppeteer-core");
const fs = require("fs");

const OUT = "/root/.codebuddy/artifact/render/shots";
fs.mkdirSync(OUT, { recursive: true });

// 与 render.js 保持一致：本沙箱里 Chrome 必须有 DISPLAY（Xvfb :99），
// 且需要显式传 env —— 否则启动即崩（Target closed）。
if (!process.env.DISPLAY) {
  console.error("错误：未设置 DISPLAY。请先启动 Xvfb：");
  console.error("  Xvfb :99 -screen 0 1280x720x24 -nolisten tcp &");
  console.error("  DISPLAY=:99 node tools/render/probe-clothcontrast.js");
  process.exit(1);
}

(async () => {
  const b = await puppeteer.launch({
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
    env: { ...process.env },
  });
  const p = await b.newPage();
  await p.setViewport({ width: 540, height: 960 });
  await p.goto(
    "file:///workspace/project/source/billiards-cn/dist/play.html?debug=1&bot=Professional",
    { waitUntil: "networkidle2", timeout: 60000 },
  );
  await p.waitForFunction(
    () =>
      globalThis.__bc &&
      globalThis.__bc.container &&
      globalThis.__bc.container.view,
    { timeout: 60000 },
  );
  await new Promise((r) => setTimeout(r, 2500));
  await p.evaluate(() => {
    globalThis.__bc.container.view.applyScene("room");
  });
  await new Promise((r) => setTimeout(r, 3000));

  const report = await p.evaluate(() => {
    const v = globalThis.__bc.container.view;
    const out = [];
    const seen = new Map();

    v.table.mesh.traverse((o) => {
      if (!o.isMesh) return;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) {
        if (!m || !m.map) continue;
        const img = m.map.image;
        if (!img || !img.width) continue;
        if (seen.has(img)) continue;
        seen.set(img, true);

        // 把贴图画到离屏 canvas 上取像素
        const cv = document.createElement("canvas");
        cv.width = img.width;
        cv.height = img.height;
        const cx = cv.getContext("2d");
        cx.drawImage(img, 0, 0);
        const data = cx.getImageData(0, 0, cv.width, cv.height).data;

        // 逐像素亮度（Rec.709）
        const lum = [];
        for (let i = 0; i < data.length; i += 4) {
          lum.push(
            0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]
          );
        }
        const n = lum.length;
        const mean = lum.reduce((a, b) => a + b, 0) / n;
        const std = Math.sqrt(
          lum.reduce((a, b) => a + (b - mean) * (b - mean), 0) / n
        );
        let mn = Infinity;
        let mx = -Infinity;
        for (const l of lum) {
          if (l < mn) mn = l;
          if (l > mx) mx = l;
        }
        // 不考虑噪点的「结构性对比」：4x4 分块求均值后再统计，
        // 这样 1px 噪点会被平均掉，只留下真正的纹理起伏
        const BS = 16;
        const blocks = [];
        for (let by = 0; by + BS <= cv.height; by += BS) {
          for (let bx = 0; bx + BS <= cv.width; bx += BS) {
            let s = 0;
            for (let yy = 0; yy < BS; yy++) {
              for (let xx = 0; xx < BS; xx++) {
                s += lum[(by + yy) * cv.width + (bx + xx)];
              }
            }
            blocks.push(s / (BS * BS));
          }
        }
        const bmean = blocks.reduce((a, b) => a + b, 0) / blocks.length;
        const bstd = Math.sqrt(
          blocks.reduce((a, b) => a + (b - bmean) * (b - bmean), 0) /
            blocks.length
        );
        let bmn = Infinity;
        let bmx = -Infinity;
        for (const l of blocks) {
          if (l < bmn) bmn = l;
          if (l > bmx) bmx = l;
        }

        out.push({
          name: m.name,
          mesh: o.name,
          size: [img.width, img.height],
          mean: Number(mean.toFixed(2)),
          std: Number(std.toFixed(2)),
          min: Number(mn.toFixed(1)),
          max: Number(mx.toFixed(1)),
          range: Number((mx - mn).toFixed(1)),
          // 16px 分块（滤掉噪点）后的结构性指标 —— 这才是「肉眼能否分辨」的关键
          blockStd: Number(bstd.toFixed(2)),
          blockMin: Number(bmn.toFixed(1)),
          blockMax: Number(bmx.toFixed(1)),
          blockRange: Number((bmx - bmn).toFixed(1)),
        });
      }
    });
    return out;
  });

  console.log("\n台呢/桌框贴图对比度实测（v1.3.87 新参数）");
  console.log("=".repeat(98));
  console.log(
    "  注：blockStd / blockRange 是 16×16 分块均值后的统计，已滤掉 1px 噪点，"
  );
  console.log(
    "      反映的是**结构纹理**的强度 —— 这直接决定肉眼看得出看不出。\n"
  );
  for (const r of report) {
    console.log(`  材质 ${r.name}  (mesh=${r.mesh})  ${r.size[0]}x${r.size[1]}`);
    console.log(
      `    逐像素   mean=${String(r.mean).padStart(6)}  std=${String(
        r.std
      ).padStart(6)}  min=${String(r.min).padStart(5)}  max=${String(
        r.max
      ).padStart(5)}  range=${String(r.range).padStart(5)}`
    );
    console.log(
      `    分块(16) mean=${String(r.blockMin).padStart(5)}~${String(
        r.blockMax
      ).padStart(5)}  range=${String(r.blockRange).padStart(5)}  std=${String(
        r.blockStd
      ).padStart(5)}   <-- 结构纹理强度`
    );
    console.log("");
  }

  fs.writeFileSync(
    "/root/.codebuddy/artifact/clothcontrast.json",
    JSON.stringify(report, null, 2)
  );
  await b.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
