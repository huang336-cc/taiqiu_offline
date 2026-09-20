const puppeteer = require("puppeteer-core");
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

  const R = 0.03275;
  const rot = (q, v) => {
    const { x, y, z, w } = q;
    const ix = w * v.x + y * v.z - z * v.y;
    const iy = w * v.y + z * v.x - x * v.z;
    const iz = w * v.z + x * v.y - y * v.x;
    const iw = -x * v.x - y * v.y - z * v.z;
    return {
      x: ix * w + iw * -x + iy * -z - iz * -y,
      y: iy * w + iw * -y + iz * -x - ix * -z,
      z: iz * w + iw * -z + ix * -y - iy * -x,
    };
  };

  for (const k of [9, 13, 18, 22, 26, 30]) {
    await p.evaluate((h) => {
      const v = globalThis.__bc.container.view;
      const cw = v.camera;
      cw.forceMode("aim");
      cw.height = h;
      const orig = cw.aimView.bind(cw);
      cw.update = function (e, a) {
        if (a) orig(a, 1);
      };
    }, R * k);
    await p.evaluate(() => {
      const v = globalThis.__bc.container.view;
      const cw = v.camera;
      const balls = (v.table && v.table.balls) || [];
      const cue = balls.find((b) => b && b.label === 0) || v.table.cueball;
      if (cw.update && cue) cw.update(0, { pos: cue.pos, angle: 0 });
    });
    await new Promise((r) => setTimeout(r, 2200));

    const g = await p.evaluate((rotSrc) => {
      const rot = new Function("q", "v", "return (" + rotSrc + ")(q,v)");
      const v = globalThis.__bc.container.view;
      const c = v.camera.camera;
      c.updateMatrixWorld(true);
      const fov = (c.fov * Math.PI) / 180;
      const tanV = Math.tan(fov / 2);
      const dirs = [];
      for (const ndcY of [1, 0.5, 0, -0.5, -1]) {
        let lv = { x: 0, y: ndcY * tanV, z: -1 };
        const L = Math.hypot(lv.x, lv.y, lv.z);
        lv = { x: lv.x / L, y: lv.y / L, z: lv.z / L };
        const w = rot(c.quaternion, lv);
        dirs.push({
          ndcY,
          elev: +((Math.asin(w.z) * 180) / Math.PI).toFixed(2),
          wz: +w.z.toFixed(4),
        });
      }
      // 上缘射线打到哪
      let lv = { x: 0, y: tanV, z: -1 };
      const L2 = Math.hypot(lv.x, lv.y, lv.z);
      lv = { x: lv.x / L2, y: lv.y / L2, z: lv.z / L2 };
      const uw = rot(c.quaternion, lv);
      let hit = "台面上方无遮挡物";
      if (uw.z < -1e-6) {
        const t = (0 - c.position.z) / uw.z;
        hit = `打到台面 z=0，距相机 ${t.toFixed(3)}m`;
      } else if (uw.z > 1e-6) {
        const t = (2.4 - c.position.z) / uw.z;
        hit = `打到天花板，距相机 ${t.toFixed(3)}m`;
      }
      return {
        camZ: +c.position.z.toFixed(4),
        fov: +c.fov.toFixed(2),
        aspect: +c.aspect.toFixed(3),
        dirs,
        upElev: +((Math.asin(uw.z) * 180) / Math.PI).toFixed(2),
        hit,
      };
    }, rot.toString());

    const dirStr = g.dirs.map((d) => `${d.ndcY}:${d.elev}`).join("  ");
    console.log(`R*${k}  相机z=${g.camZ}m  fov=${g.fov}  aspect=${g.aspect}`);
    console.log(`     上缘射线仰角=${g.upElev}°  → ${g.hit}`);
    console.log(`     NDC行仰角: ${dirStr}`);
  }
  await b.close();
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
