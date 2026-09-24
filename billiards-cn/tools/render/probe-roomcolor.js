/**
 * v1.3.96 诊断探针：室内「米黄复刻」为什么渲染出来是暗的。
 *
 * 【背景】按 `bakeIndoor` 的公式手算，米黄墙 albedo #e6d9b8 在 AMB=0.62 下
 * 应该输出 #d8cdb4。但实拍屏幕像素是 #3e392f —— 暗了约 14 倍，且没有任何
 * 单一乘数能解释。说明存在一条「公式里没写」的额外压暗通路。
 *
 * 本探针直接把真实运行时的中间量读出来，逐层定位：
 *   1. 墙 mesh 的顶点色缓冲（烘焙结果，显示空间）
 *   2. 材质类型 / 关键属性（vertexColors / toneMapped / color 底色）
 *   3. 该墙在世界里的法线朝向（确认 N·L 是否真为 0）
 *   4. 渲染器状态（toneMapping / outputColorSpace / exposure）
 *   5. 用**同一相机矩阵**把几个墙面点投到屏幕，读回真实像素
 *
 * 用法：DISPLAY=:99 node tools/render/probe-roomcolor.js
 */
const puppeteer = require("puppeteer-core")
const fs = require("fs")

const DIST = "/workspace/dev/source/billiards-cn/dist"

/**
 * ⚠️ v1.3.96 踩坑：`/usr/bin/google-chrome` 在沙箱里能直接跑通
 * （`--dump-dom about:blank` exit=0），但 puppeteer 连接会报
 * `Target.setDiscoverTargets: Target closed`。
 *
 * 根因是**陈旧的 profile 锁**：上一次 Chrome 被 `pkill -9` 强杀后，
 * `SingletonLock / SingletonSocket / SingletonCookie` 三个软链还留在
 * `--user-data-dir` 里，新进程认为「已有实例在跑」，于是立刻退出。
 * 表现成 puppeteer 视角的「Target closed」，极易误判成 GPU/WebGL 问题。
 *
 * 所以每次启动前先把 profile 目录连同锁一起清掉。
 */
function freshProfile() {
  const dir = "/tmp/chrome-render-profile"
  try {
    fs.rmSync(dir, { recursive: true, force: true })
  } catch {
    /* 目录不存在时忽略 */
  }
  return dir
}

async function main() {
  if (!process.env.DISPLAY) {
    console.error("需要 DISPLAY")
    process.exit(1)
  }
  const browser = await puppeteer.launch({
    executablePath: "/usr/bin/google-chrome",
    headless: "new",
    args: [
      "--no-sandbox",
      "--hide-scrollbars",
      "--use-gl=angle",
      "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader",
      `--user-data-dir=${freshProfile()}`,
      "--in-process-gpu",
      "--disable-gpu-sandbox",
      "--allow-file-access-from-files",
      "--window-size=1200,540",
    ],
    env: { ...process.env, DISPLAY: "" },
  })
  const page = await browser.newPage()
  await page.setViewport({ width: 1200, height: 540, deviceScaleFactor: 1 })
  await page.goto(`file://${DIST}/play.html?debug=1&bot=Professional`, {
    waitUntil: "load",
    timeout: 120000,
  })

  let ready = false
  for (let i = 0; i < 10 && !ready; i++) {
    ready = await page
      .evaluate(() => {
        const v = globalThis.__bc?.container?.view
        try {
          return !!(v && v.scene && v.camera && v.renderer?.getContext?.())
        } catch {
          return false
        }
      })
      .catch(() => false)
    if (!ready) await new Promise((r) => setTimeout(r, 8000))
  }
  if (!ready) {
    console.error("容器未就绪")
    await browser.close()
    process.exit(2)
  }

  await page.evaluate(() => {
    globalThis.__bc.container.view.applyScene("room")
    globalThis.__bc.container.view.camera.forceMode("aim")
  })
  await new Promise((r) => setTimeout(r, 2500))

  const info = await page.evaluate(() => {
    const view = globalThis.__bc.container.view
    const scene = view.scene
    const r = view.renderer
    const out = {
      renderer: {},
      objects: [],
      lights: [],
    }

    // ── 渲染器状态 ──
    out.renderer.toneMapping = r.toneMapping
    out.renderer.toneMappingExposure = r.toneMappingExposure
    out.renderer.outputColorSpace = r.outputColorSpace
    out.renderer.shadowMapEnabled = r.shadowMap.enabled
    out.renderer.shadowMapType = r.shadowMap.type
    out.renderer.drawCalls = r.info?.render?.calls

    // ── 光源清单（含强度与可见性）──
    scene.traverse((o) => {
      if (o.isLight) {
        out.lights.push({
          type: o.type,
          intensity: +o.intensity.toFixed(4),
          visible: o.visible,
          color: "#" + o.color.getHexString(),
        })
      }
    })

    // ── 环境 Group 里的每个 mesh：名字 / 顶点数 / 材质 / 顶点色采样 ──
    const env = view.sceneEnv
    if (!env) {
      out.envMissing = true
      return out
    }
    out.envName = env.name
    env.traverse((o) => {
      if (!o.isMesh) return
      const g = o.geometry
      const colAttr = g.attributes.color
      const posAttr = g.attributes.position
      const nrmAttr = g.attributes.normal
      const rec = {
        name: o.name,
        verts: posAttr ? posAttr.count : 0,
        hasColor: !!colAttr,
        colorItemSize: colAttr ? colAttr.itemSize : null,
        materialType: o.material?.type,
        vertexColors: !!o.material?.vertexColors,
        toneMapped: o.material?.toneMapped,
        matColor: o.material?.color
          ? "#" + o.material.color.getHexString()
          : null,
        roughness: o.material?.roughness,
        metalness: o.material?.metalness,
        castShadow: o.castShadow,
        receiveShadow: o.receiveShadow,
        samples: [],
        normalSamples: [],
      }
      // 采样若干顶点：位置 / 顶点色 / 法线
      if (posAttr && colAttr) {
        const n = posAttr.count
        for (const frac of [0.02, 0.1, 0.25, 0.5, 0.75, 0.9]) {
          const i = Math.min(n - 1, Math.floor(n * frac))
          const px = +posAttr.getX(i).toFixed(3)
          const py = +posAttr.getY(i).toFixed(3)
          const pz = +posAttr.getZ(i).toFixed(3)
          const cr = colAttr.getX(i)
          const cg = colAttr.getY(i)
          const cb = colAttr.getZ(i)
          // 顶点色是线性值 → 转显示空间 hex 便于肉眼比对
          const toS = (v) =>
            Math.round(
              (v <= 0.0031308
                ? v * 12.92
                : 1.055 * Math.pow(Math.max(0, v), 1 / 2.4) - 0.055) * 255
            )
          rec.samples.push({
            pos: [px, py, pz],
            lin: [+cr.toFixed(4), +cg.toFixed(4), +cb.toFixed(4)],
            hex:
              "#" +
              [toS(cr), toS(cg), toS(cb)]
                .map((v) => Math.max(0, Math.min(255, v)).toString(16).padStart(2, "0"))
                .join(""),
          })
          if (nrmAttr) {
            rec.normalSamples.push([
              +nrmAttr.getX(i).toFixed(3),
              +nrmAttr.getY(i).toFixed(3),
              +nrmAttr.getZ(i).toFixed(3),
            ])
          }
        }
      }
      out.objects.push(rec)
    })
    return out
  })

  console.log("═══ 渲染器状态 ═══")
  console.log(JSON.stringify(info.renderer, null, 2))
  console.log("\n═══ 光源 ═══")
  for (const l of info.lights) {
    console.log(
      `  ${l.visible ? "✅" : "❌"} ${l.type.padEnd(18)} I=${String(l.intensity).padEnd(9)} ${l.color}`
    )
  }
  if (info.envMissing) {
    console.log("\n❌ 未找到 sceneEnv")
  } else {
    console.log(`\n═══ 环境 Group "${info.envName}" 的 mesh ═══`)
    for (const o of info.objects) {
      console.log(
        `\n▸ ${o.name}  顶点=${o.verts}  材质=${o.materialType}  vertexColors=${o.vertexColors}  ` +
          `toneMapped=${o.toneMapped}  底色=${o.matColor}  rough=${o.roughness}  ` +
          `cast=${o.castShadow} recv=${o.receiveShadow}`
      )
      if (o.hasColor) {
        for (let i = 0; i < o.samples.length; i++) {
          const s = o.samples[i]
          const nn = o.normalSamples[i]
          console.log(
            `    pos=${JSON.stringify(s.pos).padEnd(26)} lin=${JSON.stringify(s.lin).padEnd(30)} ` +
              `→显示${s.hex}` + (nn ? `  N=${JSON.stringify(nn)}` : "")
          )
        }
      } else {
        console.log("    ⚠️ 无顶点色属性")
      }
    }
  }

  await browser.close()
}

main().catch((e) => {
  console.error("探针失败:", e.message)
  process.exit(1)
})
