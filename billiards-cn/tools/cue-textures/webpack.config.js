/**
 * 球杆预览「复用游戏内资源」的独立打包配置（v1.3.54）。
 *
 * 产出 dist/cue-texture-factory.js —— 挂 window.CueGameCue，
 * 供 dist/cue-preview-3d.js（手写 ES5、不进 webpack）直接取用游戏内的
 * 程序化贴图工厂与真实球杆尺寸。
 *
 * 关键点：
 * - three 走 external→window.THREE：包内不含 three（dist 里已有
 *   three.standalone.js），且产出的 CanvasTexture 与预览同属一个 THREE 实例。
 * - 与 webpack.config.js 完全独立，不影响主包 index.js 的构建。
 */
const path = require("node:path")
const webpack = require("webpack")
const TerserPlugin = require("terser-webpack-plugin")

module.exports = {
  entry: path.resolve(__dirname, "entry.ts"),
  output: {
    path: path.resolve(__dirname, "../../dist"),
    filename: "cue-texture-factory.js",
    // 挂到 window.CueGameCue（预览脚本读这个名字）
    library: { name: "CueGameCue", type: "window" },
    iife: true,
  },
  // three 走外部依赖：包内不含 three（dist 已有 three.standalone.js），
  // 产出的 CanvasTexture 与预览同属一个 THREE 实例，可直接赋给 material.map。
  // 注意：webpack 会把外部模块提升成 `let a = window.THREE` 的模块级常量，
  // 因此本文件必须在 three.standalone.js 之后加载（见 menu-cn.js 的注入链）。
  // 顶部加了守卫，一旦顺序错了会抛出可读错误而不是难以定位的 undefined 崩溃。
  externalsType: "window",
  externals: { three: "THREE" },
  module: {
    rules: [
      {
        use: {
          loader: "swc-loader",
          options: {
            jsc: {
              parser: { syntax: "typescript", tsx: false },
            },
            env: { targets: { ios: "12" } },
          },
        },
        exclude: /node_modules/,
      },
    ],
  },
  resolve: { extensions: [".ts", ".js"] },
  plugins: [
    // 加载顺序守卫：见上方 externals 注释
    new webpack.BannerPlugin({
      raw: true,
      banner:
        'if(!window.THREE){throw new Error("[cue-texture-factory] three.standalone.js 必须先于本文件加载")}',
    }),
  ],
  performance: { hints: false },
  mode: "production",
  optimization: {
    minimize: true,
    // 库构建：关掉 tree-shaking，保证导出的 API 与内部主题绘制分支全部保留
    usedExports: false,
    sideEffects: false,
    minimizer: [
      new TerserPlugin({
        minify: TerserPlugin.swcMinify,
        extractComments: false,
        terserOptions: {
          compress: { unused: true, dead_code: true },
          mangle: { keepClassNames: true, keepFnNames: true },
          safari10: true,
        },
      }),
    ],
  },
  // 独立产物，禁用持久缓存，避免改动后拿到旧包
  cache: false,
  stats: { errorDetails: true },
}
