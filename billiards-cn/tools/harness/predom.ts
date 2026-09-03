// 在导入任何 view 模块之前，桩掉浏览器全局，让 Cue / CueMesh 等能在 node 里构造
const noop = () => {}
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
;(globalThis as any).document = {
  getElementById: () => null,
  createElement: () => el,
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
