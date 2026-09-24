/**
 * v1.3.97 黑椭圆二分定位：逐个隐藏场景 group 截图，看黑椭圆何时消失。
 * 变体：a_all(基线) b_noRoom(藏整个房间组) c_noProps(仅藏家具) d_noOther(藏 Room 以外的场景对象)
 */
const path = require("path")
const fs = require("fs")
const puppeteer = require("puppeteer-core")

const DIST = "/workspace/dev/source/billiards-cn/dist"
const OUT = "/root/.codebuddy/artifact/room-v1397-probe"

async function main() {
  fs.mkdirSync(OUT, { recursive: true })
  const browser = await puppeteer.launch({
    executablePath: "/usr/bin/google-chrome",
    headless: "new",
    args: [
      "--no-sandbox", "--hide-scrollbars", "--disable-dev-shm-usage", "--no-zygote",
      "--ozone-platform=headless", "--use-gl=angle", "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader", "--user-data-dir=/tmp/chrome-probe-hide",
      "--in-process-gpu", "--disable-gpu-sandbox", "--allow-file-access-from-files",
      "--window-size=1280,720",
    ],
    env: { ...process.env, DISPLAY: "" },
  })
  const page = await browser.newPage()
  await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 1 })
  page.on("pageerror", (e) => console.log(`[pageerror] ${e.message}`))
  await page.goto(`file://${DIST}/play.html?debug=1&bot=Professional`, {
    waitUntil: "load",
    timeout: 120000,
  })
  for (let i = 0; i < 6; i++) {
    const ok = await page
      .evaluate(() => {
        const bc = globalThis.__bc
        const v = bc && bc.container && bc.container.view
        return !!(v && v.scene && v.camera && v.renderer)
      })
      .catch(() => false)
    if (ok) break
    await new Promise((r) => setTimeout(r, 10000))
  }
  await new Promise((r) => setTimeout(r, 3000))
  await page.evaluate(() => globalThis.__bc.container.view.applyScene("room"))
  await new Promise((r) => setTimeout(r, 900))

  await page.evaluate(() => {
    const v = globalThis.__bc.container.view
    const camWrap = v.camera
    const c = camWrap.camera || camWrap
    camWrap.update = function () {
      c.position.set(0, 3.3, 1.75)
      c.lookAt(0, -0.4, 0.1)
      c.fov = 55
      c.updateProjectionMatrix()
    }
    camWrap.update(0, null)
  })
  await new Promise((r) => setTimeout(r, 700))
  // 关弹窗（与 probe-room1397 相同逻辑）
  for (let round = 0; round < 3; round++) {
    await page.evaluate(() => {
      const re = /知道了|第\s*\d+\s*步|欢迎/
      for (const el of [...document.querySelectorAll("body *")]) {
        if (el.children.length === 0 && re.test(el.textContent || "")) {
          let n = el
          while (n && n !== document.body && n.getBoundingClientRect().width < 260) n = n.parentElement
          if (n && n !== document.body) n.style.display = "none"
        }
      }
    })
    await new Promise((r) => setTimeout(r, 250))
  }

  const names = await page.evaluate(() => {
    const scene = globalThis.__bc.container.view.scene
    return scene.children.map((c) => `${c.name || c.type}(${c.type},visible=${c.visible})`)
  })
  console.log("scene.children:")
  for (const n of names) console.log("  " + n)

  const variants = [
    ["a_all", () => {}],
    [
      "b_noRoom",
      () => {
        const o = globalThis.__bc.container.view.scene.getObjectByName("Room")
        if (o) o.visible = false
      },
    ],
    [
      "c_noProps",
      () => {
        const room = globalThis.__bc.container.view.scene.getObjectByName("Room")
        if (room) room.visible = true
        const p = room && room.getObjectByName("RoomProps")
        if (p) p.visible = false
      },
    ],
    [
      "d_noRest",
      () => {
        // 恢复 RoomProps，隐藏 Room 之外所有一级子对象
        const scene = globalThis.__bc.container.view.scene
        const room = scene.getObjectByName("Room")
        if (room) room.visible = true
        const props = room && room.getObjectByName("RoomProps")
        if (props) props.visible = true
        for (const c of scene.children) {
          if (c !== room) c.visible = false
        }
      },
    ],
  ]
  for (const [name, fn] of variants) {
    await page.evaluate(fn)
    await new Promise((r) => setTimeout(r, 400))
    await page.screenshot({ path: path.join(OUT, `probe_hide_${name}.png`) })
    console.log("shot:", name)
  }
  await browser.close()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
