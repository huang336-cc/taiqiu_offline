/**
 * 音效库测试入口（v1.3.55）
 *
 * 把 Sound 类暴露为 window.SfxTest.Sound，供 Playwright 在真实浏览器里
 * 验证「加载 → 力度分档 → 变体轮转 → 播放」整条链路。
 *
 * 必须走 ES export 而非手写 window 赋值：webpack 的 library 赋值发生在
 * bundle 末尾，会覆盖 entry 里的手动赋值（踩过：导致 SfxTest.Sound 为 undefined）。
 *
 * 这个 bundle 只用于测试，不参与正式构建（见 tools/sounds/webpack.test.js）。
 */
import { Sound } from "../../src/view/sound"

export { Sound }
