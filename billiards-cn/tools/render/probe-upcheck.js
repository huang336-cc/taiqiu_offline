const puppeteer = require("puppeteer-core");
(async () => {
  const b = await puppeteer.launch({executablePath:"/usr/bin/google-chrome",headless:"new",args:["--no-sandbox","--hide-scrollbars","--use-gl=angle","--use-angle=swiftshader","--enable-unsafe-swiftshader","--user-data-dir=/tmp/chrome-render-profile","--in-process-gpu","--disable-gpu-sandbox","--allow-file-access-from-files"]});
  const p = await b.newPage(); await p.setViewport({width:540,height:960});
  await p.goto("file:///workspace/project/source/billiards-cn/dist/play.html?debug=1&bot=Professional",{waitUntil:"networkidle2",timeout:60000});
  await p.waitForFunction(()=>globalThis.__bc&&globalThis.__bc.container&&globalThis.__bc.container.view,{timeout:60000});
  await new Promise(r=>setTimeout(r,2500));
  await p.evaluate(()=>{globalThis.__bc.container.view.applyScene("room");});
  await new Promise(r=>setTimeout(r,4000));
  await p.evaluate(()=>{
    const v=globalThis.__bc.container.view, cw=v.camera;
    cw.forceMode("aim");
    const orig=cw.aimView.bind(cw);
    cw.update=function(e,a){ if(a) orig(a,1); };
    const balls=(v.table&&v.table.balls)||[];
    const cue=balls.find(b=>b&&b.label===0)||v.table.cueball;
    cw.update(0,{pos:cue.pos,angle:0});
  });
  await new Promise(r=>setTimeout(r,2500));
  const g = await p.evaluate(()=>{
    const v=globalThis.__bc.container.view, c=v.camera.camera;
    c.updateMatrixWorld(true);
    const e=c.matrixWorld.elements;
    // 相机本地 +X/+Y/+Z 在世界中的方向
    const col=(i)=>[e[i],e[i+1],e[i+2]];
    return {
      camPos:[+c.position.x.toFixed(3),+c.position.y.toFixed(3),+c.position.z.toFixed(3)],
      localRight: col(0).map(n=>+n.toFixed(3)),
      localUp:    col(4).map(n=>+n.toFixed(3)),
      localBack:  col(8).map(n=>+n.toFixed(3)),
      camUpField: c.up.toArray().map(n=>+n.toFixed(3)),
      sceneUp: globalThis.__bc.container.view.scene.up ? null : null,
    };
  });
  console.log(JSON.stringify(g,null,2));
  console.log("\n判读:");
  console.log("  本地 +Y（画面「上」方向）在世界中的朝向 =", JSON.stringify(g.localUp));
  if (g.localUp[2] > 0.9) console.log("  => +Y 近乎指向世界 +Z ✅ 正常（画面上方=世界上方）");
  else if (g.localUp[2] < -0.9) console.log("  => +Y 指向世界 -Z ❌ 相机上下颠倒！");
  else console.log("  => +Y 有竖直分量 z=", g.localUp[2], "（倾斜）");
  await b.close();
})().catch(e=>{console.error(e.message);process.exit(1)});
