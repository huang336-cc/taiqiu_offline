/**
 * 瞄准机位「注视点抬升量」参数扫描 —— 唯一目标是让画面里出现房间。
 *
 * 已验证的机位模型（六点实测全部字面吻合）：
 *
 *     上缘仰角 = fov/2 − 俯角
 *     俯角     = atan( (h − lookLift) / distance )
 *
 * 含义：**抬高相机只会让俯角变大、上缘更低** —— 用户批准的「机位抬高到 R*13」
 * 方向上是错的。真正能把房间拉进画面的是**抬高注视点**（lookLift）让它变平。
 *
 * 本脚本对一组 lookLift 值各渲染一帧，量化「台呢占比」，并打印 fov 实际取值。
 */
const puppeteer = require("puppeteer-core");
const fs = require("fs");

const OUT = "/root/.codebuddy/artifact/render/shots/looksweep";
fs.mkdirSync(OUT, { recursive: true });

const R = 0.03275;
const SCENE = process.argv[2] || "room";
// lookLift 以 R 为单位
const LIFTS = [2, 4, 6, 8, 9, 12, 16];

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
  await new Promise((r) => setTimeout(r, 2500));

  await page.evaluate((sc) => {
    globalThis.__bc.container.view.applyScene(sc);
  }, SCENE);
  await new Promise((r) => setTimeout(r, 4000));

  console.log(`\n瞄准机位「注视点抬升」扫描  (场景 ${SCENE}, 相机高度保持 R*9=0.295m)`);
  console.log("=".repeat(84));
  console.log("  lookLift   俯角°   fov°   上缘仰角°   台呢占比%   环境占比%   房间可见");

  for (const lk of LIFTS) {
    // 接管 aimView：复制原逻辑，只改 lookTarget 的抬升量
    await page.evaluate(
      (lift) => {
        const v = globalThis.__bc.container.view;
        const cw = v.camera;
        cw.forceMode("aim");
        const Rv = 0.03275;
        const UPV = cw.camera.up.clone().set(0, 0, 1);
        cw.aimView = function (aim, fraction = 1) {
          const h = this.height;
          const pf = this.camera.aspect < 0.8 ? 3 : 1;
          this.camera.fov = this.adaptiveFov ? this.adaptiveFov(40, 80) : 60;
          if (h < 10 * Rv) {
            const factor = 100 * (10 * Rv - h);
            this.camera.fov -= factor * pf;
          }
          // 相机位置：原逻辑
          const ang = aim.angle;
          const dirvec = { x: Math.cos(ang), y: Math.sin(ang), z: 0 };
          this.target
            .copy(aim.pos)
            .addScaledVector(dirvec, -this.distance);
          this.camera.position.lerp(this.target, fraction);
          this.camera.position.z = h;
          this.camera.up = UPV;
          // ⚠️ 唯一改动：注视点抬升量
          this.lookTarget.copy(aim.pos).addScaledVector(UPV, Rv * lift);
          this.camera.lookAt(this.lookTarget);
        };
        const orig = cw.aimView.bind(cw);
        void orig;
        cw.update = function (e, a) {
          if (a) cw.aimView(a, 1);
        };
      },
      lk,
    );

    await page.evaluate(() => {
      const v = globalThis.__bc.container.view;
      const cw = v.camera;
      const balls = (v.table && v.table.balls) || [];
      const cue = balls.find((b) => b && b.label === 0) || v.table.cueball;
      if (cw.update && cue) cw.update(0, { pos: cue.pos, angle: 0 });
    });
    await new Promise((r) => setTimeout(r, 2500));

    const shot = await page.screenshot({ encoding: "base64" });
    fs.writeFileSync(`${OUT}/${SCENE}_L${lk}.png`, Buffer.from(shot, "base64"));

    const stat = await page.evaluate(async (b64) => {
      const im = await new Promise((res) => {
        const i = new Image();
        i.onload = () => res(i);
        i.src = "data:image/png;base64," + b64;
      });
      const cv = document.createElement("canvas");
      cv.width = im.width;
      cv.height = im.height;
      const ctx = cv.getContext("2d");
      ctx.drawImage(im, 0, 0);
      const d = ctx.getImageData(0, 0, cv.width, cv.height).data;
      const y0 = Math.floor(cv.height * 0.09);
      const y1 = Math.floor(cv.height * 0.86);
      let cloth = 0,
        total = 0;
      for (let y = y0; y < y1; y++)
        for (let x = 0; x < cv.width; x++) {
          const i = (y * cv.width + x) * 4;
          const r = d[i],
            g = d[i + 1],
            b = d[i + 2];
          total++;
          const isCloth = g > r + 8 && g > b + 8 && g > 60 && g < 190;
          if (isCloth) cloth++;
        }
      return {
        clothPct: +((cloth / total) * 100).toFixed(1),
        envPct: +(((total - cloth) / total) * 100).toFixed(1),
      };
    }, shot);

    const cam = await page.evaluate(() => {
      const c = globalThis.__bc.container.view.camera.camera;
      return { fov: +c.fov.toFixed(2), z: +c.position.z.toFixed(4) };
    });

    // 俯角 = atan((h - lookLift)/dist)
    const pitch =
      (Math.atan2(cam.z - lk * 0.03275, 24 * 0.03275) * 180) / Math.PI;
    const top = cam.fov / 2 - pitch;
    const vis = top > 0 ? "✅" : "❌";

    console.log(
      `  ${String(lk).padStart(2)}R      ${pitch.toFixed(1).padStart(5)}  ` +
        `${cam.fov.toFixed(2).padStart(6)}  ${top.toFixed(1).padStart(8)}  ` +
        `${stat.clothPct.toFixed(1).padStart(8)}  ${stat.envPct.toFixed(1).padStart(8)}    ${vis}`,
    );
  }
  console.log("=".repeat(84));
  console.log(`截图: ${OUT}/`);

  await browser.close();
})().catch((e) => {
  console.error("失败:", e.message);
  process.exit(1);
});
