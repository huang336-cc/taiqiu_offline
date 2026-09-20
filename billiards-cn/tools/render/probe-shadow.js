/**
 * 阴影诊断：查为什么「球桌没有在地面投下阴影」。
 *
 * 逐项核对：
 *   1. renderer.shadowMap.enabled / type
 *   2. 每盏 DirectionalLight 的 castShadow / visible
 *   3. 球桌 mesh 的 castShadow / receiveShadow
 *   4. 地面 mesh 的 receiveShadow
 *   5. 阴影相机 frustum 与光源位置
 *   6. 关键：**光源位置是否落在阴影相机视野内**
 */
const puppeteer = require("puppeteer-core");
const SCENE = process.argv[2] || "room";

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
    // 必须调 view.applyScene() —— 这才是页面真正切场景的入口，
    // 它内部会重建 sceneEnv 并重设光照/雾/阴影总开关。
    const view = globalThis.__bc.container.view;
    if (typeof view.applyScene === "function") view.applyScene(sc);
  }, SCENE);
  await new Promise((r) => setTimeout(r, 3000));

  const info = await page.evaluate(() => {
    const v = globalThis.__bc.container.view;
    const renderer = v.renderer;
    const scene = v.scene;
    const out = {
      shadowMap: renderer
        ? { enabled: renderer.shadowMap.enabled, type: renderer.shadowMap.type }
        : null,
      lights: [],
      table: null,
      floor: null,
      castCount: 0,
      receiveCount: 0,
      meshes: 0,
    };

    scene.traverse((o) => {
      if (o.isLight) {
        const sh = o.shadow
          ? {
              castShadow: o.castShadow,
              mapSize: o.shadow.mapSize
                ? [o.shadow.mapSize.x, o.shadow.mapSize.y]
                : null,
              camera: o.shadow.camera
                ? {
                    near: o.shadow.camera.near,
                    far: o.shadow.camera.far,
                    left: o.shadow.camera.left,
                    right: o.shadow.camera.right,
                    top: o.shadow.camera.top,
                    bottom: o.shadow.camera.bottom,
                  }
                : null,
              hasMap: !!o.shadow.map,
            }
          : null;
        out.lights.push({
          type: o.type,
          visible: o.visible,
          intensity: o.intensity,
          pos: [o.position.x, o.position.y, o.position.z].map((n) => +n.toFixed(3)),
          tgt: o.target
            ? [o.target.position.x, o.target.position.y, o.target.position.z].map(
                (n) => +n.toFixed(3),
              )
            : null,
          shadow: sh,
        });
      }
      if (o.isMesh) {
        out.meshes++;
        if (o.castShadow) out.castCount++;
        if (o.receiveShadow) out.receiveCount++;
        const n = o.name || "";
        if (n === "IndoorFloor") out.floor = { name: n, receive: o.receiveShadow, cast: o.castShadow };
        if (/table|Table/i.test(n) && !out.table)
          out.table = { name: n, cast: o.castShadow, receive: o.receiveShadow };
      }
    });
    return out;
  });

  await browser.close();

  console.log(`\n场景 ${SCENE}`);
  console.log("=".repeat(70));
  console.log("renderer.shadowMap:", JSON.stringify(info.shadowMap));
  console.log(`\nMesh 总数 ${info.meshes}：castShadow ${info.castCount} 个，receiveShadow ${info.receiveCount} 个`);
  console.log("地面:", JSON.stringify(info.floor));
  console.log("球桌:", JSON.stringify(info.table));

  console.log("\n光源明细：");
  info.lights.forEach((L) => {
    console.log(
      `  ${L.type.padEnd(18)} vis=${String(L.visible).padEnd(5)} I=${String(L.intensity).padEnd(8)} pos=[${L.pos}]`,
    );
    if (L.shadow) {
      console.log(
        `      castShadow=${L.shadow.castShadow} mapSize=${L.shadow.mapSize} hasMap=${L.shadow.hasMap}`,
      );
      console.log(`      camera=${JSON.stringify(L.shadow.camera)}`);
    }
  });
})().catch((e) => {
  console.error("失败:", e.message);
  process.exit(1);
});
