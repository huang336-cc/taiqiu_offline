/**
 * 定位「纯黑匿名 Mesh」的真实身份 —— 输出世界坐标 / 父链 / 几何类型 / 材质类型。
 *
 * 背景：probe-darkmass2.js 发现 4 个 #000000、各 23 顶点的匿名 Mesh，
 *       每个隐藏后画面差异约 8000 像素，怀疑是「占画面 30% 的黑色桌身」。
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

  const info = await page.evaluate(() => {
    const THREE = globalThis.__bc.THREE || null;
    const v = globalThis.__bc.container.view;
    const out = [];
    const box = new (globalThis.__bc.THREE ? globalThis.__bc.THREE.Box3 : Object)();
    v.scene.traverse((o) => {
      if (!o.isMesh) return;
      const g = o.geometry;
      if (!g || !g.attributes || !g.attributes.position) return;
      const col = o.material && o.material.color ? o.material.color.getHex() : -1;
      if (col !== 0x000000) return;
      if (!g.boundingBox) g.computeBoundingBox();
      const bb = g.boundingBox;
      // 世界包围盒
      o.updateWorldMatrix(true, false);
      const wb = { min: [1e9, 1e9, 1e9], max: [-1e9, -1e9, -1e9] };
      const pts = [
        [bb.min.x, bb.min.y, bb.min.z],
        [bb.max.x, bb.max.y, bb.max.z],
      ];
      for (const p of pts) {
        const e = o.matrixWorld.elements;
        const x = e[0] * p[0] + e[4] * p[1] + e[8] * p[2] + e[12];
        const y = e[1] * p[0] + e[5] * p[1] + e[9] * p[2] + e[13];
        const z = e[2] * p[0] + e[6] * p[1] + e[10] * p[2] + e[14];
        wb.min[0] = Math.min(wb.min[0], x);
        wb.min[1] = Math.min(wb.min[1], y);
        wb.min[2] = Math.min(wb.min[2], z);
        wb.max[0] = Math.max(wb.max[0], x);
        wb.max[1] = Math.max(wb.max[1], y);
        wb.max[2] = Math.max(wb.max[2], z);
      }

      // 父链
      const chain = [];
      let p = o.parent;
      while (p) {
        chain.push(`${p.name || "(anon)"}[${p.type}]`);
        p = p.parent;
      }

      out.push({
        id: o.id,
        name: o.name || "(anon)",
        geo: g.type,
        matType: o.material ? o.material.type : "-",
        matName: o.material && o.material.name ? o.material.name : "(无名)",
        verts: g.attributes.position.count,
        localSize: [
          +(bb.max.x - bb.min.x).toFixed(3),
          +(bb.max.y - bb.min.y).toFixed(3),
          +(bb.max.z - bb.min.z).toFixed(3),
        ],
        worldPos: [+o.position.x.toFixed(3), +o.position.y.toFixed(3), +o.position.z.toFixed(3)],
        worldBox: [
          wb.min.map((n) => +n.toFixed(2)),
          wb.max.map((n) => +n.toFixed(2)),
        ],
        chain: chain.join(" < "),
        castShadow: o.castShadow,
        receiveShadow: o.receiveShadow,
      });
    });
    return out;
  });

  console.log("\n纯黑 (#000000) Mesh 普查");
  console.log("=".repeat(96));
  for (const t of info) {
    console.log(`id=${t.id}  "${t.name}"  geo=${t.geo}  verts=${t.verts}`);
    console.log(`   材质: ${t.matType} / ${t.matName}`);
    console.log(`   本地尺寸: ${JSON.stringify(t.localSize)}`);
    console.log(`   世界位置: ${JSON.stringify(t.worldPos)}`);
    console.log(`   世界包围盒: ${JSON.stringify(t.worldBox)}`);
    console.log(`   父链: ${t.chain}`);
    console.log(`   阴影: cast=${t.castShadow} receive=${t.receiveShadow}`);
    console.log("-".repeat(96));
  }
  console.log(`合计 ${info.length} 个纯黑 Mesh`);

  await browser.close();
})().catch((e) => {
  console.error("失败:", e.message);
  process.exit(1);
});
