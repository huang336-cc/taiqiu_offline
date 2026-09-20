/**
 * 台呢贴图与 UV 深查 —— 为什么挂上了 512² 贴图却看不出纹理。
 *
 * 三种可能：
 *   A. 台呢几何没有 uv 属性（贴图采样恒为 (0,0) → 整块纯色）
 *   B. uv 存在但范围极小 / 退化（同样导致采样近似常量）
 *   C. 贴图内容本身对比度太低（渐变幅度太小 + 噪点太淡）
 */
const puppeteer = require("puppeteer-core");
const fs = require("fs");

const OUT = "/root/.codebuddy/artifact/render/shots";
fs.mkdirSync(OUT, { recursive: true });

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
  });
  const p = await b.newPage();
  await p.setViewport({ width: 540, height: 960 });
  await p.goto(
    "file:///workspace/project/source/billiards-cn/dist/play.html?debug=1&bot=Professional",
    { waitUntil: "networkidle2", timeout: 60000 },
  );
  await p.waitForFunction(
    () => globalThis.__bc && globalThis.__bc.container && globalThis.__bc.container.view,
    { timeout: 60000 },
  );
  await new Promise((r) => setTimeout(r, 2500));
  await p.evaluate(() => {
    globalThis.__bc.container.view.applyScene("room");
  });
  await new Promise((r) => setTimeout(r, 4000));

  const g = await p.evaluate(() => {
    const v = globalThis.__bc.container.view;
    const res = [];
    v.table.mesh.traverse((o) => {
      if (!o.isMesh || !o.material) return;
      const m = o.material;
      const mat = Array.isArray(m) ? m[0] : m;
      if (mat.name !== "cloth" && mat.name !== "clothshade") return;
      const geo = o.geometry;
      const attrs = geo.attributes || {};
      const uv = attrs.uv;
      let uvInfo = null;
      if (uv) {
        let minU = 1e9,
          maxU = -1e9,
          minV = 1e9,
          maxV = -1e9;
        const n = Math.min(uv.count, 400);
        for (let i = 0; i < n; i++) {
          const u = uv.getX(i);
          const vv = uv.getY(i);
          minU = Math.min(minU, u);
          maxU = Math.max(maxU, u);
          minV = Math.min(minV, vv);
          maxV = Math.max(maxV, vv);
        }
        uvInfo = {
          count: uv.count,
          itemSize: uv.itemSize,
          uRange: [+minU.toFixed(4), +maxU.toFixed(4)],
          vRange: [+minV.toFixed(4), +maxV.toFixed(4)],
          uSpan: +(maxU - minU).toFixed(4),
          vSpan: +(maxV - minV).toFixed(4),
        };
      }

      // 采样贴图画布，统计其自身对比度
      let texStats = null;
      if (mat.map && mat.map.image) {
        const im = mat.map.image;
        const cv = document.createElement("canvas");
        cv.width = im.width;
        cv.height = im.height;
        const ctx = cv.getContext("2d");
        ctx.drawImage(im, 0, 0);
        const d = ctx.getImageData(0, 0, im.width, im.height).data;
        let mn = 255,
          mx = 0,
          sum = 0,
          cnt = 0;
        for (let i = 0; i < d.length; i += 4) {
          const L = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
          mn = Math.min(mn, L);
          mx = Math.max(mx, L);
          sum += L;
          cnt++;
        }
        // 相邻像素梯度
        let gsum = 0,
          gn = 0;
        for (let y = 0; y < im.height; y++) {
          for (let x = 0; x < im.width - 1; x++) {
            const i = (y * im.width + x) * 4;
            const j = (y * im.width + x + 1) * 4;
            const L1 = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
            const L2 = 0.299 * d[j] + 0.587 * d[j + 1] + 0.114 * d[j + 2];
            gsum += Math.abs(L1 - L2);
            gn++;
          }
        }
        texStats = {
          size: [im.width, im.height],
          lumMin: +mn.toFixed(1),
          lumMax: +mx.toFixed(1),
          lumMean: +(sum / cnt).toFixed(1),
          contrast: +(mx - mn).toFixed(1),
          gradMean: +(gsum / gn).toFixed(3),
          repeat: [mat.map.repeat.x, mat.map.repeat.y],
          wrapS: mat.map.wrapS,
          wrapT: mat.map.wrapT,
          colorSpace: mat.map.colorSpace,
        };
      }
      res.push({ name: o.name, matName: mat.name, hasUv: !!uv, uvInfo, texStats });
    });
    return res;
  });

  console.log("\n台呢几何 UV 与贴图内容深查");
  console.log("=".repeat(92));
  for (const r of g) {
    console.log(`【${r.name}】 材质=${r.matName}  有 uv=${r.hasUv}`);
    if (r.uvInfo) {
      console.log(
        `   UV: count=${r.uvInfo.count} itemSize=${r.uvInfo.itemSize}  ` +
          `u∈${JSON.stringify(r.uvInfo.uRange)} v∈${JSON.stringify(r.uvInfo.vRange)}  ` +
          `跨度 u=${r.uvInfo.uSpan} v=${r.uvInfo.vSpan}`,
      );
    } else {
      console.log("   ⚠️ 无 uv 属性 —— 贴图会全部采样到 (0,0)，等于没用");
    }
    if (r.texStats) {
      const t = r.texStats;
      console.log(
        `   贴图: ${JSON.stringify(t.size)} 亮度 ${t.lumMin}~${t.lumMax}（均值 ${t.lumMean}，对比度 ${t.contrast}）`,
      );
      console.log(
        `        相邻像素梯度均值=${t.gradMean}  repeat=${JSON.stringify(t.repeat)}  wrap=${t.wrapS}/${t.wrapT}  cs=${t.colorSpace}`,
      );
    } else {
      console.log("   贴图: 无");
    }
    console.log("-".repeat(92));
  }
  await b.close();
})().catch((e) => {
  console.error("失败:", e.message);
  process.exit(1);
});
