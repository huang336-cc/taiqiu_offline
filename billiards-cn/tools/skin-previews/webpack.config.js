/**
 * 皮肤缩略图「复用游戏内真实资源」的独立打包配置（v1.3.103）。
 *
 * 产出 dist/skin-factory.js —— 挂 window.CueGameSkin，供
 * dist/skin-preview-3d.js（手写 ES5、不进 webpack）直接取用游戏内的
 * 台球桌贴图工厂与环境场景构建函数。
 *
 * 关键点：
 * - three 走 external→window.THREE：包内不含 three（dist 里已有
 *   three.standalone.js），且产出的 CanvasTexture 与预览同属一个 THREE 实例。
 * - 与 tools/cue-textures/webpack.config.js 完全独立，也不影响主包 index.js。
 */
const path = require("node:path")
const webpack = require("webpack")
const TerserPlugin = require("terser-webpack-plugin")

module.exports = {
  entry: path.resolve(__dirname, "entry.ts"),
  output: {
    path: path.resolve(__dirname, "../../dist"),
    filename: "skin-factory.js",
    // 挂到 window.CueGameSkin（缩略图脚本读这个名字）
    library: { name: "CueGameSkin", type: "window" },
    iife: true,
  },
  // three 走外部依赖：包内不含 three（dist 已有 three.standalone.js），
  // 产出的 CanvasTexture 与预览同属一个 THREE 实例，可直接赋给 material.map。
  // 本文件必须在 three.standalone.js 之后加载（见 menu-cn.js 的注入链），
  // 顶部守卫保证顺序错了会抛可读错误。
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
    new webpack.BannerPlugin({
      raw: true,
      banner:
        'if(!window.THREE){throw new Error("[skin-factory] three.standalone.js 必须先于本文件加载")}',
    }),
  ],
  performance: { hints: false },
  mode: "production",
  optimization: {
    minimize: true,
    // 库构建：关掉 tree-shaking，保证导出的 API 与内部贴图绘制分支全部保留
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
