/**
 * 逐对象隐藏截图 —— 找画面里那块「占 30% 面积的黑色区域」归属。
 *
 * 手法：对每个候选 Mesh 单独设 visible=false 后截图，比对与基准图的差异，
 * 差异大的就是「画面里那块东西」。这是上次抓到摆球器锥体的同一招。
 */
const puppeteer = require("puppeteer-core");
const fs = require("fs");

const OUT = "/root/.codebuddy/artifact/render/shots/probe";
fs.mkdirSync(OUT, { recursive: true });

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
  await new Promise((r) => setTimeout(r, 2000));

  await page.evaluate(() => {
    const v = globalThis.__bc.container.view;
    if (typeof v.applyScene === "function") v.applyScene("room");
  });
  await new Promise((r) => setTimeout(r, 3000));

  // 强制自由视角（与 render.js 的 free 机位一致）
  await page.evaluate(() => {
    const v = globalThis.__bc.container.view;
    const cw = v.camWrap;
    if (!cw) return;
    cw.forceMode("free");
    cw.update = function () {
      const cam = this.camera;
      cam.position.set(0, -7.2, 3.4);
      cam.lookAt(0, 0, 0);
      cam.updateProjectionMatrix();
    };
    cw.update(0, null);
  });
  await new Promise((r) => setTimeout(r, 1200));

  // 基准图
  const base = await page.screenshot({ encoding: "base64" });
  fs.writeFileSync(`${OUT}/base.png`, Buffer.from(base, "base64"));

  // 列出候选对象（大块优先）
  const targets = await page.evaluate(() => {
    const v = globalThis.__bc.container.view;
    const out = [];
    v.scene.traverse((o) => {
      if (!o.isMesh) return;
      const g = o.geometry;
      if (!g || !g.attributes || !g.attributes.position) return;
      if (!g.boundingBox) g.computeBoundingBox();
      const bb = g.boundingBox;
      const sx = bb.max.x - bb.min.x,
        sy = bb.max.y - bb.min.y;
      out.push({
        id: o.id,
        name: o.name || "(anon)",
        mat: o.material && o.material.name ? o.material.name : "(无名)",
        color:
          o.material && o.material.color
            ? "#" + (o.material.color.getHex() >>> 0).toString(16).padStart(6, "0").slice(-6)
            : "-",
        verts: g.attributes.position.count,
        area: +(sx * sy).toFixed(2),
      });
    });
    out.sort((a, b) => b.area - a.area);
    return out.slice(0, 16);
  });

  console.log("\n逐对象隐藏测试（差异像素数越大 = 该物体在画面里占比越大）");
  console.log("=".repeat(84));

  const { PNG } = await (async () => {
    // puppeteer 不自带 PNG 解码；用页面内 canvas 做比对
    return { PNG: null };
  })();

  for (const t of targets) {
    await page.evaluate((id) => {
      const v = globalThis.__bc.container.view;
      v.scene.traverse((o) => {
        if (o.id === id) o.visible = false;
      });
    }, t.id);
    await new Promise((r) => setTimeout(r, 500));

    const shot = await page.screenshot({ encoding: "base64" });
    // 用页面内 canvas 比对
    const diff = await page.evaluate(
      async (b64, b64new) => {
        const load = (s) =>
          new Promise((res) => {
            const im = new Image();
            im.onload = () => res(im);
            im.src = "data:image/png;base64," + s;
          });
        const [a, b] = await Promise.all([load(b64), load(b64new)]);
        const cv = document.createElement("canvas");
        cv.width = a.width;
        cv.height = a.height;
        const ctx = cv.getContext("2d");
        ctx.drawImage(a, 0, 0);
        const da = ctx.getImageData(0, 0, cv.width, cv.height).data;
        ctx.clearRect(0, 0, cv.width, cv.height);
        ctx.drawImage(b, 0, 0);
        const db = ctx.getImageData(0, 0, cv.width, cv.height).data;
        let n = 0,
          maxd = 0;
        for (let i = 0; i < da.length; i += 4) {
          const d = Math.abs(da[i] - db[i]) + Math.abs(da[i + 1] - db[i + 1]) + Math.abs(da[i + 2] - db[i + 2]);
          if (d > 12) n++;
          if (d > maxd) maxd = d;
        }
        return { n, maxd };
      },
      base,
      shot,
    );

    // 恢复
    await page.evaluate((id) => {
      const v = globalThis.__bc.container.view;
      v.scene.traverse((o) => {
        if (o.id === id) o.visible = true;
      });
    }, t.id);

    const flag = diff.n > 3000 ? "  ★★★ 就是它" : diff.n > 500 ? "  ★ 有影响" : "";
    console.log(
      `  ${t.name.padEnd(18)} mat=${String(t.mat).padEnd(16)} ${String(t.color).padEnd(9)} v=${String(t.verts).padStart(5)}  差异像素=${String(diff.n).padStart(6)}${flag}`,
    );
  }

  await browser.close();
})().catch((e) => {
  console.error("失败:", e.message);
  process.exit(1);
});
