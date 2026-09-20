/**
 * 普查场景环境各物体的世界包围盒，回答：
 *   「在瞄准机位（相机高 0.257m）下，屏幕最上边缘只能看到 0.54m 高的东西，
 *     那么场景里到底有多少物件是「够得着」的？」
 *
 * 对每个子物体算世界包围盒，按 z 区间归类，并统计：
 *   · 完全低于 0.54m 的（看得见）
 *   · 跨越 0.54m 的（顶部被裁）
 *   · 完全高于 0.54m 的（完全看不见）
 */
const puppeteer = require("puppeteer-core");
const SCENE = process.argv[2] || "room";
const SIGHT_H = 0.54; // 屏幕最上边缘在该距离处的可见高度

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

  await page.evaluate((sc) => {
    try {
      if (globalThis.__bc.scene) globalThis.__bc.scene(sc);
    } catch (e) {}
  }, SCENE);
  await new Promise((r) => setTimeout(r, 3000));

  const data = await page.evaluate(() => {
    const THREE = globalThis.THREE || null;
    const v = globalThis.__bc.container.view;
    const scene = v.scene || v.threeScene || (v.renderer && v.renderer.scene);
    if (!scene) return { error: "no scene" };

    const out = [];
    scene.traverse((o) => {
      if (!o.isMesh && !o.isPoints && !o.isLine) return;
      const g = o.geometry;
      if (!g) return;
      if (!g.boundingBox) g.computeBoundingBox();
      const bb = g.boundingBox;
      if (!bb) return;
      o.updateWorldMatrix(true, false);
      // 手动变换 8 个角点到世界
      const m = o.matrixWorld.elements;
      const tf = (x, y, z) => [
        m[0] * x + m[4] * y + m[8] * z + m[12],
        m[1] * x + m[5] * y + m[9] * z + m[13],
        m[2] * x + m[6] * y + m[10] * z + m[14],
      ];
      let zmin = Infinity,
        zmax = -Infinity,
        xmin = Infinity,
        xmax = -Infinity,
        ymin = Infinity,
        ymax = -Infinity;
      for (const cx of [bb.min.x, bb.max.x])
        for (const cy of [bb.min.y, bb.max.y])
          for (const cz of [bb.min.z, bb.max.z]) {
            const p = tf(cx, cy, cz);
            zmin = Math.min(zmin, p[2]);
            zmax = Math.max(zmax, p[2]);
            xmin = Math.min(xmin, p[0]);
            xmax = Math.max(xmax, p[0]);
            ymin = Math.min(ymin, p[1]);
            ymax = Math.max(ymax, p[1]);
          }
      const cnt = g.attributes && g.attributes.position ? g.attributes.position.count : 0;
      out.push({
        name: o.name || "(anon)",
        mat: o.material && o.material.type,
        tris: cnt / 3,
        z: [+zmin.toFixed(3), +zmax.toFixed(3)],
        x: [+xmin.toFixed(2), +xmax.toFixed(2)],
        y: [+ymin.toFixed(2), +ymax.toFixed(2)],
      });
    });
    return { meshes: out };
  });

  await browser.close();
  if (data.error) {
    console.error("失败:", data.error);
    process.exit(1);
  }

  const ms = data.meshes;
  console.log(`\n场景 ${SCENE}：共 ${ms.length} 个可渲染物体`);
  console.log("=".repeat(90));
  console.log("瞄准机位（相机高 0.257m）下，屏幕最上边缘只能看到 0.54m 高的东西。");
  console.log(`因此下面按 z 上限分为三类：\n`);

  const seen = ms.filter((m) => m.z[1] <= SIGHT_H);
  const part = ms.filter((m) => m.z[0] < SIGHT_H && m.z[1] > SIGHT_H);
  const blind = ms.filter((m) => m.z[0] >= SIGHT_H);

  console.log(`✅ 完全可见（z 上限 ≤ ${SIGHT_H}m）      ：${seen.length} 个`);
  console.log(`⚠️  只露下半截（跨越 ${SIGHT_H}m）        ：${part.length} 个`);
  console.log(`❌ 完全看不见（z 下限 ≥ ${SIGHT_H}m）    ：${blind.length} 个`);
  console.log("-".repeat(90));

  console.log("\n【完全看不见 — 这些就是我改了半天你却没看到的东西】");
  blind
    .sort((a, b) => a.z[0] - b.z[0])
    .slice(0, 25)
    .forEach((m) =>
      console.log(
        `  ${m.name.padEnd(22)} z=[${String(m.z[0]).padStart(6)},${String(m.z[1]).padStart(6)}]  ${String(Math.round(m.tris)).padStart(6)} tri  ${m.mat || ""}`,
      ),
    );

  console.log("\n【可见 — 这些才是真正入画的部分】");
  seen
    .sort((a, b) => a.z[1] - b.z[1])
    .slice(-20)
    .forEach((m) =>
      console.log(
        `  ${m.name.padEnd(22)} z=[${String(m.z[0]).padStart(6)},${String(m.z[1]).padStart(6)}]  ${String(Math.round(m.tris)).padStart(6)} tri`,
      ),
    );
})().catch((e) => {
  console.error("失败:", e.message);
  process.exit(1);
});
