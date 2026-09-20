/**
 * 全场景「暗色大块」普查 —— 找到画面里那块占 30% 的纯黑桌身。
 *
 * 通过顶点数与包围盒体积排序，列出场景中所有暗色（color 亮度低或无顶点色）
 * 且几何尺寸较大的 Mesh，逐一判断它是不是画面里的黑块。
 */
const puppeteer = require("puppeteer-core");

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

  const rows = await page.evaluate(() => {
    const v = globalThis.__bc.container.view;
    const scene = v.scene;
    const hex = (c) =>
      "#" + (c.getHex() >>> 0).toString(16).padStart(6, "0").slice(-6);
    const out = [];

    scene.traverse((o) => {
      if (!o.isMesh) return;
      const g = o.geometry;
      if (!g || !g.attributes || !g.attributes.position) return;
      if (!g.boundingBox) g.computeBoundingBox();
      const bb = g.boundingBox;
      if (!bb) return;
      o.updateWorldMatrix(true, false);
      const m = o.matrixWorld.elements;
      const tf = (x, y, z) => [
        m[0] * x + m[4] * y + m[8] * z + m[12],
        m[1] * x + m[5] * y + m[9] * z + m[13],
        m[2] * x + m[6] * y + m[10] * z + m[14],
      ];
      let xmin = 1e9, xmax = -1e9, ymin = 1e9, ymax = -1e9, zmin = 1e9, zmax = -1e9;
      for (const cx of [bb.min.x, bb.max.x])
        for (const cy of [bb.min.y, bb.max.y])
          for (const cz of [bb.min.z, bb.max.z]) {
            const p = tf(cx, cy, cz);
            xmin = Math.min(xmin, p[0]); xmax = Math.max(xmax, p[0]);
            ymin = Math.min(ymin, p[1]); ymax = Math.max(ymax, p[1]);
            zmin = Math.min(zmin, p[2]); zmax = Math.max(zmax, p[2]);
          }
      const size = [xmax - xmin, ymax - ymin, zmax - zmin];
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      const m0 = mats[0];
      const pos = o.position || { x: 0, y: 0, z: 0 };
      out.push({
        name: o.name || "(anon)",
        parent: (o.parent && o.parent.name) || "-",
        mat: m0 && m0.name ? m0.name : "(无名)",
        type: m0 ? m0.type : "-",
        color: m0 && m0.color ? hex(m0.color) : null,
        vertexColors: !!(m0 && m0.vertexColors),
        map: !!(m0 && m0.map),
        verts: g.attributes.position.count,
        size: size.map((s) => +s.toFixed(2)),
        bbox: [
          [+xmin.toFixed(2), +xmax.toFixed(2)],
          [+ymin.toFixed(2), +ymax.toFixed(2)],
          [+zmin.toFixed(2), +zmax.toFixed(2)],
        ],
        wp: [+pos.x.toFixed(2), +pos.y.toFixed(2), +pos.z.toFixed(2)],
      });
    });
    return out;
  });

  await browser.close();

  // 按「竖直投影面积」排序（x*y 跨度），找画面里的大块
  const withArea = rows.map((r) => ({
    ...r,
    area: +(r.size[0] * r.size[1]).toFixed(2),
  }));
  withArea.sort((a, b) => b.area - a.area);

  console.log(`\n全场景 Mesh 共 ${rows.length} 个，按「占地投影面积」降序：`);
  console.log("=".repeat(112));
  console.log(
    "  Mesh名".padEnd(20) + "父".padEnd(14) + "材质".padEnd(16) +
    "color".padEnd(10) + "vc  map  顶点".padEnd(12) + "尺寸(x,y,z)".padEnd(22) + "世界z",
  );
  console.log("-".repeat(112));
  for (const r of withArea.slice(0, 22)) {
    console.log(
      "  " + String(r.name).padEnd(18) + String(r.parent).padEnd(12) +
      String(r.mat).padEnd(14) + String(r.color || "-").padEnd(10) +
      (r.vertexColors ? "有  " : "无  ") + (r.map ? "有   " : "无   ") +
      String(r.verts).padEnd(8) +
      `[${r.size.join(",")}]`.padEnd(22) +
      `[${r.bbox[2][0]},${r.bbox[2][1]}]`,
    );
  }
})().catch((e) => {
  console.error("失败:", e.message);
  process.exit(1);
});
