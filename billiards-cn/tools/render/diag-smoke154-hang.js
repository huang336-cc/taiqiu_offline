/** 诊断：附着到正在跑的冒烟探针浏览器，查 play.html 卡在哪一步。只读不改。 */
const puppeteer = require("puppeteer-core")

async function safeEval(page, fn, ...args) {
  return Promise.race([
    page.evaluate(fn, ...args),
    new Promise((r) => setTimeout(() => r("<<EVAL_TIMEOUT_8s>>"), 8000)),
  ])
}

async function main() {
  const browser = await puppeteer.connect({
    browserURL: "http://127.0.0.1:32817",
    defaultViewport: null,
  })
  const pages = await browser.pages()
  for (const p of pages) {
    const url = p.url()
    console.log("页面:", url.slice(0, 90))
    if (!url.includes("play.html")) continue
    const st = await safeEval(p, () => {
      const c = document.querySelector("#viewP1 canvas")
      const l = document.getElementById("view3dLoading")
      return {
        readyState: document.readyState,
        hasCanvas: !!c,
        canvasW: c ? c.width : -1,
        loadingHidden: l ? getComputedStyle(l).display === "none" : "no-el",
        loadingText: l ? l.textContent.slice(0, 60) : "no-el",
        visibleCanvases: Array.from(document.querySelectorAll("canvas"))
          .filter((x) => x.width > 0)
          .map((x) => x.id || x.parentElement?.id || "anon")
          .slice(0, 5),
        bodyChildCount: document.body ? document.body.childElementCount : -1,
        cueBallTrigger: !!document.getElementById("cueBallTrigger"),
      }
    })
    console.log("场景状态:", JSON.stringify(st))
    // 主线程活跃度：50ms 定时器实际延迟
    const lag = await safeEval(
      p,
      () =>
        new Promise((res) => {
          const t0 = performance.now()
          setTimeout(() => res(Math.round(performance.now() - t0)), 50)
        })
    )
    console.log("主线程 50ms 定时器实际延迟:", lag, "ms")
    // RAF 是否在推进（headless + SwiftShader 可能不产帧）
    const raf = await safeEval(
      p,
      () =>
        new Promise((res) => {
          let n = 0
          const t0 = performance.now()
          const tick = () => {
            n++
            if (performance.now() - t0 < 1000) requestAnimationFrame(tick)
            else res(n)
          }
          requestAnimationFrame(tick)
          setTimeout(() => res(-n || -1), 3000)
        })
    )
    console.log("1 秒内 RAF 帧数:", raf)
    // 游戏控制器与 WebGL 上下文
    const gm = await safeEval(p, () => {
      const c = document.querySelector("#viewP1 canvas")
      const gl = c ? (c.getContext("webgl2") || c.getContext("webgl")) : null
      return {
        glCtxLost: gl ? gl.isContextLost() : "no-gl",
        container: typeof window.container !== "undefined" ? "window.container" : "not-on-window",
        gameKey: typeof window.__GAME__ !== "undefined" ? "y" : "n",
      }
    })
    console.log("渲染上下文:", JSON.stringify(gm))
  }
  browser.disconnect()
}

main().catch((e) => {
  console.error("诊断失败:", e.message)
  process.exit(1)
})
