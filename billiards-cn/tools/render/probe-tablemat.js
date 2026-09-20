/**
 * 球桌材质普查：列出球桌每个 Mesh 的材质名、颜色、是否有贴图。
 *
 * 目的：那块「纯黑桌身」到底对应哪个材质？我改了 frameColor（材质名含 wood）
 * 但画面毫无变化，说明黑块**不是 wood 材质**。
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
    const out = [];
    const hex = (c) =>
      "#" + (c.getHex() >>> 0).toString(16).padStart(6, "0").slice(-6);

    // 找球桌子树：view.table.mesh
    const root = (v.table && v.table.mesh) || null;
    if (!root) return [{ err: "找不到 view.table.mesh" }];

    root.traverse((o) => {
      if (!o.isMesh) return;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) {
        if (!m) continue;
        out.push({
          mesh: o.name || "(anon)",
          matName: m.name || "(无名)",
          type: m.type,
          color: m.color ? hex(m.color) : null,
          map: !!m.map,
          emissive: m.emissive ? hex(m.emissive) : null,
          vertexColors: !!m.vertexColors,
          visible: o.visible,
          // 顶点数（判断哪块面积大）
          verts: o.geometry && o.geometry.attributes.position
            ? o.geometry.attributes.position.count
            : 0,
        });
      }
    });
    return out;
  });

  await browser.close();

  if (rows[0] && rows[0].err) {
    console.error(rows[0].err);
    process.exit(1);
  }

  console.log(`\n球桌材质普查：共 ${rows.length} 条`);
  console.log("=".repeat(100));
  console.log(
    "  Mesh名".padEnd(22) +
      "材质名".padEnd(20) +
      "类型".padEnd(20) +
      "color".padEnd(10) +
      "map  emissive  顶点",
  );
  console.log("-".repeat(100));
  for (const r of rows) {
    console.log(
      "  " +
        String(r.mesh).padEnd(20) +
        String(r.matName).padEnd(18) +
        String(r.type).padEnd(20) +
        String(r.color).padEnd(10) +
        (r.map ? "有  " : "无  ") +
        String(r.emissive || "-").padEnd(10) +
        String(r.verts),
    );
  }
})().catch((e) => {
  console.error("失败:", e.message);
  process.exit(1);
});
