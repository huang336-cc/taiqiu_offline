const puppeteer = require("puppeteer-core");
(async () => {
  const b = await puppeteer.launch({
    executablePath: "/usr/bin/google-chrome", headless: "new",
    args: ["--no-sandbox","--hide-scrollbars","--use-gl=angle","--use-angle=swiftshader",
      "--enable-unsafe-swiftshader","--user-data-dir=/tmp/chrome-render-profile",
      "--in-process-gpu","--disable-gpu-sandbox","--allow-file-access-from-files"],
  });
  const p = await b.newPage();
  await p.setViewport({ width: 540, height: 960 });
  await p.goto("file:///workspace/project/source/billiards-cn/dist/play.html?debug=1&bot=Professional", { waitUntil: "networkidle2", timeout: 60000 });
  await p.waitForFunction(() => globalThis.__bc && globalThis.__bc.container && globalThis.__bc.container.view, { timeout: 60000 });
  await new Promise((r) => setTimeout(r, 2500));
  await p.evaluate(() => { globalThis.__bc.container.view.applyScene("room"); });
  await new Promise((r) => setTimeout(r, 4000));
  const g = await p.evaluate(() => {
    const v = globalThis.__bc.container.view;
    const rows = [];
    v.table.mesh.traverse((o) => {
      if (!o.isMesh || !o.material) return;
      const m = o.material;
      const mat = Array.isArray(m) ? m[0] : m;
      const g2 = o.geometry;
      const uv = g2.attributes && g2.attributes.uv;
      let span = null;
      if (uv) {
        let mu = 1e9, xu = -1e9, mv = 1e9, xv = -1e9;
        for (let i = 0; i < uv.count; i++) {
          mu = Math.min(mu, uv.getX(i)); xu = Math.max(xu, uv.getX(i));
          mv = Math.min(mv, uv.getY(i)); xv = Math.max(xv, uv.getY(i));
        }
        span = { u: +(xu - mu).toFixed(3), v: +(xv - mv).toFixed(3) };
      }
      rows.push({
        name: o.name || "(anon)",
        mat: mat.name || "(无名)",
        hasMap: !!mat.map,
        hasUv: !!uv,
        uvCount: uv ? uv.count : 0,
        span,
      });
    });
    return rows;
  });
  console.log("\n球桌各材质 UV × 贴图 交叉核对");
  console.log("=".repeat(84));
  console.log("  对象          材质              有贴图  有UV   UV顶点数  UV跨度(u,v)   判定");
  for (const r of g) {
    let ok = "—";
    if (r.hasMap && r.hasUv && r.span && (r.span.u > 0.01 || r.span.v > 0.01)) ok = "✅ 贴图可用";
    else if (r.hasMap && !r.hasUv) ok = "❌ 有贴图无UV（采样恒为0,0）";
    else if (r.hasMap && r.span && r.span.u < 0.01 && r.span.v < 0.01) ok = "❌ UV 塌缩";
    else if (!r.hasMap) ok = "无贴图（纯色，正常）";
    console.log(
      "  " + String(r.name).padEnd(13) + " " + String(r.mat).padEnd(16) + " " +
      (r.hasMap ? " 是  " : " 否  ") + "     " + (r.hasUv ? "是" : "否") + "    " +
      String(r.uvCount).padStart(6) + "   " + (r.span ? JSON.stringify(r.span) : "-").padEnd(18) + " " + ok
    );
  }
  console.log("=".repeat(84));
  await b.close();
})().catch((e) => { console.error("失败:", e.message); process.exit(1); });
