/**
 * 台呢材质普查 —— 贴图是否真的挂上、repeat 多少、材质类型与光照响应。
 */
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

  const g = await p.evaluate(() => {
    const v = globalThis.__bc.container.view;
    const out = [];
    v.table.mesh.traverse((o) => {
      if (!o.isMesh || !o.material) return;
      const m = o.material;
      const mat = Array.isArray(m) ? m[0] : m;
      out.push({
        name: o.name || "(anon)",
        matName: mat.name || "(无名)",
        type: mat.type,
        color: mat.color ? "#" + mat.color.getHexString() : "-",
        hasMap: !!mat.map,
        mapRepeat: mat.map ? [mat.map.repeat.x, mat.map.repeat.y] : null,
        mapImg:
          mat.map && mat.map.image
            ? [mat.map.image.width, mat.map.image.height]
            : null,
        flatShading: mat.flatShading,
        roughness: mat.roughness !== undefined ? mat.roughness : null,
        shininess: mat.shininess !== undefined ? mat.shininess : null,
        specular: mat.specular ? "#" + mat.specular.getHexString() : null,
        normalMap: !!mat.normalMap,
        bumpMap: !!mat.bumpMap,
        aoMap: !!mat.aoMap,
        emissive: mat.emissive ? "#" + mat.emissive.getHexString() : null,
      });
    });
    return { mats: out };
  });

  console.log("\n球桌材质普查");
  console.log("=".repeat(100));
  for (const m of g.mats) {
    const nm = String(m.name).padEnd(12);
    const mn = String(m.matName).padEnd(14);
    const tp = String(m.type).padEnd(20);
    console.log(`${nm} 材质=${mn} ${tp} 色=${m.color}`);
    console.log(
      `    map=${m.hasMap}  repeat=${JSON.stringify(m.mapRepeat)}  画布=${JSON.stringify(m.mapImg)}  flat=${m.flatShading}`,
    );
    console.log(
      `    normalMap=${m.normalMap}  bump=${m.bumpMap}  ao=${m.aoMap}  shininess=${m.shininess}  specular=${m.specular}  emissive=${m.emissive}`,
    );
  }
  console.log("=".repeat(100));
  await b.close();
})().catch((e) => {
  console.error("失败:", e.message);
  process.exit(1);
});
