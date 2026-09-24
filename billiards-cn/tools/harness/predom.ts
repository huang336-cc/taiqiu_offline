// 在导入任何 view 模块之前，桩掉浏览器全局，让 Cue / CueMesh 等能在 node 里构造
//
// v1.3.94：程序化贴图工厂（interiortexturefactory / beachtexturefactory /
// courttexturefactory …）需要真实的 canvas 2D 上下文，否则 `getContext()`
// 返回 null 直接崩溃 —— 环境场景探针（envcheck）因此完全跑不起来。
//
// ⚠️ 但真实 canvas **不能无条件开启**：贴图工厂里普遍用 `Math.random()`
// 生成噪声（木纹、沙纹、混凝土颗粒），换成真正的 canvas 会改变这些工厂
// 的 RNG 消耗序列，进而影响棋盘/球桌初始化路径，AI 对局探针的结果会漂移
// （实测 botmatch 由可复现的 100% 变成抛 Depth exceeded、汇总不打印）。
//
// 因此改为**显式按需开启**：只有需要贴图的探针在导入本模块前设置
// `BILLIARDS_REAL_CANVAS=1`。默认（含全部 AI / 网络 / 回放探针）保持
// 原来的 Proxy 桩，行为与 v1.3.93 逐位一致。
const noop = () => {}

/**
 * canvas 按需加载（**惰性**）。
 *
 * 为什么惰性：ES module 的 import 会被提升到模块顶部，探针里写
 * `process.env.BILLIARDS_REAL_CANVAS = "1"` 再 `import "./predom"` 时，
 * predom 实际**先**执行完，读不到刚设的变量。改成在 `createElement("canvas")`
 * 真正被调用时才读环境变量并加载 node-canvas，时序问题即消失。
 */
function getNodeCanvas(): any {
  if (typeof process === "undefined" || process.env.BILLIARDS_REAL_CANVAS !== "1") {
    return null
  }
  try {
    return require("canvas")
  } catch {
    return null
  }
}

let canvasAnnounced = false

const el: any = new Proxy(
  {
    style: {},
    classList: { add: noop, remove: noop, toggle: noop, contains: () => false },
    setAttribute: noop,
    getAttribute: () => null,
    appendChild: noop,
    removeChild: noop,
    addEventListener: noop,
    removeEventListener: noop,
    querySelector: () => null,
    querySelectorAll: () => [],
    getContext: () => null,
    append: noop,
    remove: noop,
   focus: noop,
    width: 0,
    height: 0,
  },
  { get: (t: any, p) => (p in t ? t[p] : noop) }
)

function makeElement(tag: string): any {
  if (tag === "canvas") {
    const nc = getNodeCanvas()
    if (nc && nc.createCanvas) {
      if (!canvasAnnounced) {
        canvasAnnounced = true
        console.log("[predom] canvas: real")
      }
      return nc.createCanvas(1, 1)
    }
  }
  return el
}

;(globalThis as any).document = {
  getElementById: () => null,
  createElement: (tag: string) => makeElement(tag),
  querySelector: () => null,
  querySelectorAll: () => [],
  addEventListener: noop,
  removeEventListener: noop,
  body: el,
}
;(globalThis as any).window = {
  devicePixelRatio: 1,
  addEventListener: noop,
  removeEventListener: noop,
  location: { href: "", search: "" },
  matchMedia: () => ({ matches: false, addEventListener: noop, removeEventListener: noop }),
  navigator: { userAgent: "node" },
}
;(globalThis as any).requestAnimationFrame = noop
console.log("[predom] document/window stubbed")
