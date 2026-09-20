/**
 * 真实瞄准机位下「画面里到底有什么」普查。
 *
 * 动机：`render.js --view aim` 是贴地平视的手改机位，不一定等于游戏真实瞄准视角。
 * 本探针**不碰相机**，让页面自己把相机摆到 aiming 态，然后：
 *   1. 记录真实相机位姿（位置 / 朝向 / fov / aspect）
 *   2. 用 THREE.Raycaster 从相机向画面**上/中/下**三行各发一束射线，
 *      报告第一个命中的对象名 —— 这直接回答「屏幕最上面那 30% 是啥」
 *   3. 按「屏幕行 → 视角仰角 → 世界高度」换算，验证 analyse-aim.py 的结论
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
  // 等相机自己收敛到 aiming 态（不劫持 update！）
  await new Promise((r) => setTimeout(r, 5000));

  const report = await page.evaluate(() => {
    const v = globalThis.__bc.container.view;
    const cam = v.camera.camera || v.camera;
    // THREE 没挂在 __bc 上 —— 从已有实例的构造函数里取（稳定且无需 import）
    const THREE = cam.position.constructor
      ? Object.getPrototypeOf(cam.position).constructor
      : null;
    const Ctor3 = cam.position.constructor;
    const makeVec = (x, y, z) => new Ctor3(x, y, z);

    const pos = cam.position.clone();
    const dir = makeVec(0, 0, 0);
    cam.getWorldDirection(dir);
    cam.updateMatrixWorld();

    const out = {
      camPos: pos.toArray().map((n) => +n.toFixed(3)),
      camDir: dir.toArray().map((n) => +n.toFixed(3)),
      fov: +cam.fov.toFixed(2),
      aspect: +cam.aspect.toFixed(3),
      near: +cam.near.toFixed(4),
      far: +cam.far.toFixed(2),
      mode: typeof v.camera.mode === "string" ? v.camera.mode : String(v.camera.mode),
      height: +(v.camera.height ? v.camera.height.toFixed(4) : -1),
      distance: +(v.camera.distance ? v.camera.distance.toFixed(4) : -1),
      rays: [],
    };

    /**
     * 不依赖 THREE.Raycaster（__bc 上没暴露 THREE）—— 改用等效且更直观的
     * 做法：**遍历所有可见 Mesh，用相机矩阵把它的世界包围盒 8 个角投到 NDC**，
     * 看它覆盖了屏幕的哪几行、占多少面积。这正是「画面里那块东西是谁」的正面回答。
     */
    const proj = cam.projectionMatrix.clone();
    const viewM = cam.matrixWorldInverse.clone();

    const ndcOf = (wx, wy, wz) => {
      const e = viewM.elements;
      const cx = e[0] * wx + e[4] * wy + e[8] * wz + e[12];
      const cy = e[1] * wx + e[5] * wy + e[9] * wz + e[13];
      const cz = e[2] * wx + e[6] * wy + e[10] * wz + e[14];
      const p = proj.elements;
      const ax = p[0] * cx + p[4] * cy + p[8] * cz + p[12];
      const ay = p[1] * cx + p[5] * cy + p[9] * cz + p[13];
      const aw = p[3] * cx + p[7] * cy + p[11] * cz + p[15];
      if (aw === 0) return null;
      return [ax / aw, ay / aw, aw];
    };

    const covers = [];
    v.scene.traverse((o) => {
      if (!o.isMesh || !o.visible) return;
      // 祖先不可见则跳过
      let p = o.parent;
      while (p) {
        if (p.visible === false) return;
        p = p.parent;
      }
      const g = o.geometry;
      if (!g || !g.attributes || !g.attributes.position) return;
      if (!g.boundingBox) g.computeBoundingBox();
      const bb = g.boundingBox;
      o.updateWorldMatrix(true, false);
      const e = o.matrixWorld.elements;
      let minX = 1e9,
        maxX = -1e9,
        minY = 1e9,
        maxY = -1e9,
        anyFront = false;
      for (const cx of [bb.min.x, bb.max.x])
        for (const cy of [bb.min.y, bb.max.y])
          for (const cz of [bb.min.z, bb.max.z]) {
            const wx = e[0] * cx + e[4] * cy + e[8] * cz + e[12];
            const wy = e[1] * cx + e[5] * cy + e[9] * cz + e[13];
            const wz = e[2] * cx + e[6] * cy + e[10] * cz + e[14];
            const r = ndcOf(wx, wy, wz);
            if (!r) continue;
            if (r[2] <= 0) continue;
            anyFront = true;
            minX = Math.min(minX, r[0]);
            maxX = Math.max(maxX, r[0]);
            minY = Math.min(minY, r[1]);
            maxY = Math.max(maxY, r[1]);
          }
      if (!anyFront) return;
      // 裁到 NDC 范围内，算屏幕占比
      const x0 = Math.max(-1, minX),
        x1 = Math.min(1, maxX);
      const y0 = Math.max(-1, minY),
        y1 = Math.min(1, maxY);
      const w = Math.max(0, x1 - x0) / 2;
      const h = Math.max(0, y1 - y0) / 2;
      const frac = w * h;
      if (frac < 0.002) return;
      covers.push({
        name: o.name || "(anon)",
        mat: o.material && o.material.name ? o.material.name : "(无名)",
        color:
          o.material && o.material.color
            ? "#" + (o.material.color.getHex() >>> 0).toString(16).padStart(6, "0").slice(-6)
            : "-",
        frac: +(frac * 100).toFixed(1),
        // 屏幕行（0 = 顶）
        rowTop: +(((1 - y1) / 2) * 100).toFixed(1),
        rowBot: +(((1 - y0) / 2) * 100).toFixed(1),
        ndcY: [+y0.toFixed(2), +y1.toFixed(2)],
      });
    });
    covers.sort((a, b) => b.frac - a.frac);
    out.covers = covers.slice(0, 20);
    return out;
  });

  console.log("\n真实瞄准机位诊断");
  console.log("=".repeat(80));
  console.log(`相机位置 : ${JSON.stringify(report.camPos)}`);
  console.log(`视线方向 : ${JSON.stringify(report.camDir)}`);
  console.log(`FOV/aspect/near/far : ${report.fov} / ${report.aspect} / ${report.near} / ${report.far}`);
  console.log(`模式/高度/距离 : ${report.mode} / ${report.height} / ${report.distance}`);
  console.log("-".repeat(80));
  console.log("画面覆盖普查（NDC 矩形裁剪后，按屏幕占比降序）");
  console.log("占比%   上边行%   下边行%   对象                  材质              颜色");
  for (const c of report.covers || []) {
    console.log(
      `${String(c.frac).padStart(6)}  ${String(c.rowTop).padStart(7)}  ${String(c.rowBot).padStart(7)}   ` +
        `${c.name.padEnd(20)} ${String(c.mat).padEnd(15)} ${c.color}`,
    );
  }
  console.log("=".repeat(80));

  await page.screenshot({ path: `${OUT}/realaim.png`, type: "png" });
  console.log(`截图: ${OUT}/realaim.png`);

  await browser.close();
})().catch((e) => {
  console.error("失败:", e.message);
  process.exit(1);
});
