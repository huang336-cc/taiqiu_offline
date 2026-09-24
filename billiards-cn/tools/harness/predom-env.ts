// 环境场景探针专用前置：开启真实 canvas 之后，再加载浏览器全局桩。
//
// 为什么单独一个文件：ES module 的 import 会被提升，在测试文件正文里写
// `process.env.X = ...` 再 `import "./predom"` 是**无效**的 —— predom 已经
// 先执行完了。把「设环境变量 → 再 import predom」放进同一个模块，由模块
// 内的语句顺序保证时序。
process.env.BILLIARDS_REAL_CANVAS = "1"
import "./predom"
export {}
