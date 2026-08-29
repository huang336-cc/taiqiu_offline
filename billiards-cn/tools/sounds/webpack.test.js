/**
 * 音效库测试包构建配置（v1.3.55）
 *
 * 仅用于 QA：把 Sound 类打成 window.SfxTest，在真实浏览器里验证音效链路。
 * 与正式构建（webpack.config.js）完全隔离，不产出到 dist 的发布清单。
 */
const path = require("path")

module.exports = {
  mode: "production",
  entry: path.resolve(__dirname, "test-entry.ts"),
  output: {
    path: path.resolve(__dirname, "../../dist"),
    filename: "sfx-test.js",
    iife: true,
    library: { name: "SfxTest", type: "window" },
  },
  externalsType: "window",
  externals: { three: "THREE" },
  module: {
    rules: [
      {
        test: /\.ts$/,
        exclude: /node_modules/,
        use: {
          loader: "swc-loader",
          options: {
            jsc: {
              parser: { syntax: "typescript", tsx: false },
              target: "es2020",
            },
          },
        },
      },
    ],
  },
  resolve: { extensions: [".ts", ".js"] },
  cache: false,
}
