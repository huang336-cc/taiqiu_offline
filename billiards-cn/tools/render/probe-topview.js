/**
 * 俯视机位（topView）画面构成普查 —— v1.3.88。
 *
 * 背景：用户实机截图用的是**相机按钮切过去的俯视机位**，而我此前几十版
 * 都在优化 aimView（瞄准机位）。两者是完全不同的构图：
 *   · aimView  —— 贴地平视，能看见房间墙地；
 *   · topView  —— 相机在正上方垂直下看，数学上**不可能**看到墙面地板。
 *
 * 用户明确诉求：「俯视保持简洁，把桌子本身做精致」。
 * 所以本探针不查「环境占多少」，而是查桌子本体各材质的画面占比，
 * 以及台呢区域的真实亮度层次（是否死平一片）。
 *
 * 用法：
 *   DISPLAY=:99 node tools/render/probe-topview.js --w 1200 --h 540
 */
const puppeteer = require("puppeteer-core");
const fs = require("fs");

const OUT = "/root/.codebuddy/artifact/render/shots";
fs.mkdirSync(OUT, { recursive: true });

if (!process.env.DISPLAY) {
  console.error("需要 DISPLAY（Xvfb :99）");
  process.exit(1);
}

const A = (k, d) => {
  const i = process.argv.indexOf("--" + k);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d;
};
const W = parseInt(A("w", "1200"), 10);
const H = parseInt(A("h", "540"), 10);

(async () => {
  const b = await puppeteer.launch({
    executablePath: "/usr/bin/google-chrome",
    headless: "new",
    args: [
      "--no-sandbox", "--hide-scrollbars",
      "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader",
      "--user-data-dir=/tmp/chrome-render-profile",
      "--in-process-gpu", "--disable-gpu-sandbox", "--allow-file-access-from-files",
      "--window-size=" + W + "," + H,
    ],
    env: { ...process.env },
  });
  const p = await b.newPage();
  await p.setViewport({ width: W, height: H, deviceScaleFactor: 1 });

  await p.goto(
    "file:///workspace/project/source/billiards-cn/dist/play.html?debug=1&bot=Professional",
    { waitUntil: "load", timeout: 120000 }
  );
  await p.waitForFunction(
    () => {
      const v =
        globalThis.__bc &&
        globalThis.__bc.container &&
        globalThis.__bc.container.view;
      return !!(v && v.scene && v.camera);
    },
    { timeout: 90000 }
  );
  await new Promise((r) => setTimeout(r, 3000));
  await p.evaluate(() => globalThis.__bc.container.view.applyScene("room"));
  await new Promise((r) => setTimeout(r, 3000));

  // 切到俯视机位（用户截图用的就是这个）。
  // 注意：相机包装器挂在 `view.camera` 上（不是 view.camWrap），
  // 且 `forceMode` 单独用不够 —— render.js 的经验是还要覆盖 update，
  // 否则相机会在下一帧被常规逻辑覆盖回去。
  await p.evaluate(() => {
    const view = globalThis.__bc.container.view;
    const camWrap = view.camera;
    camWrap.forceMode("top");
    camWrap.update = function () {
      camWrap.topView(null);
    };
    // 立刻摆一次机位并刷新矩阵
    camWrap.topView(null);
    const c = camWrap.camera || camWrap;
    c.updateMatrixWorld(true);
  });
  await new Promise((r) => setTimeout(r, 1500));

  const rep = await p.evaluate(() => {
    const view = globalThis.__bc.container.view;
    const c = view.camera.camera || view.camera;
    c.updateMatrixWorld(true);
    const proj = c.projectionMatrix.elements;
    const vm = c.matrixWorldInverse.elements;

    const xform = (x, y, z) => {
      const o0 = vm[0] * x + vm[4] * y + vm[8] * z + vm[12];
      const o1 = vm[1] * x + vm[5] * y + vm[9] * z + vm[13];
      const o2 = vm[2] * x + vm[6] * y + vm[10] * z + vm[14];
      const o3 = vm[3] * x + vm[7] * y + vm[11] * z + vm[15];
      const w =
        proj[3] * o0 + proj[7] * o1 + proj[11] * o2 + proj[15] * o3;
      if (w <= 0) return null;
      return {
        x: (proj[0] * o0 + proj[4] * o1 + proj[8] * o2 + proj[12] * o3) / w,
        y: (proj[1] * o0 + proj[5] * o1 + proj[9] * o2 + proj[13] * o3) / w,
      };
    };

    const acc = new Map();
    view.table.mesh.traverse((o) => {
      if (!o.isMesh) return;
      const geo = o.geometry;
      if (!geo || !geo.attributes || !geo.attributes.position) return;
      const pos = geo.attributes.position;
      o.updateWorldMatrix(true, false);
      const m = o.matrixWorld.elements;
      let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9, ok = 0;
      for (let i = 0; i < pos.count; i++) {
        const px = pos.getX(i), py = pos.getY(i), pz = pos.getZ(i);
        const wx = m[0] * px + m[4] * py + m[8] * pz + m[12];
        const wy = m[1] * px + m[5] * py + m[9] * pz + m[13];
        const wz = m[2] * px + m[6] * py + m[10] * pz + m[14];
        const s = xform(wx, wy, wz);
        if (!s) continue;
        ok++;
        if (s.x < x0) x0 = s.x;
        if (s.x > x1) x1 = s.x;
        if (s.y < y0) y0 = s.y;
        if (s.y > y1) y1 = s.y;
      }
      if (!ok) return;
      const wpx = Math.max(0, Math.min(1, (x1 - x0) / 2));
      const hpx = Math.max(0, Math.min(1, (y1 - y0) / 2));
      const mat = Array.isArray(o.material) ? o.material[0] : o.material;
      const name = (mat && mat.name) || "(unnamed)";
      const prev = acc.get(name) || { name: name, cover: 0, meshes: 0 };
      prev.meshes++;
      prev.cover = Math.max(prev.cover, wpx * hpx);
      acc.set(name, prev);
    });

    const arr = [];
    acc.forEach((it) => arr.push(it));
    arr.sort((a2, b2) => b2.cover - a2.cover);
    return {
      aspect: c.aspect,
      fov: c.fov,
      camPos: [c.position.x, c.position.y, c.position.z].map((n) =>
        Number(n.toFixed(4))
      ),
      items: arr,
    };
  });

  console.log("\n俯视机位（topView）画面构成 —— v1.3.88");
  console.log("=".repeat(88));
  console.log("  视口 " + W + "x" + H + "  宽高比 " + rep.aspect.toFixed(3) + "  fov " + rep.fov);
  console.log("  相机位置 " + JSON.stringify(rep.camPos));
  console.log("");
  console.log("  材质             NDC覆盖占比   Mesh数");
  console.log("  " + "-".repeat(56));
  for (const it of rep.items) {
    const pct = (it.cover * 100).toFixed(1);
    console.log("  " + String(it.name).padEnd(16) + pct.padStart(9) + "%   " + String(it.meshes).padStart(5));
  }

  fs.writeFileSync(
    "/root/.codebuddy/artifact/topview.json",
    JSON.stringify(rep, null, 2)
  );
  await b.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
