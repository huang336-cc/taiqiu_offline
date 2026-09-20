/**
 * 离线验证专用打包配置（不参与 APK 构建）。
 *
 * 把「场景构建 + 贴图工厂」打成 CJS，绕开应用入口 index.ts
 * （它会立刻碰 DOM / WebGL）。沙箱里 WebGL 全 NO-GL，这是唯一
 * 能在本地验证几何体健康度与贴图像素数据的通道。
 *
 *   npx webpack --config webpack.verify.js
 *   node /root/.codebuddy/artifact/verify84j.js
 */
const path = require("node:path")
module.exports = {
  mode: "development",
  devtool: false,
  entry: { verify: "./verify-entry.ts" },
  target: "node",
  output: {
    path: path.resolve(__dirname, "dist"),
    filename: "verify84j.bundle.js",
    library: { type: "commonjs2" },
  },
  module: {
    rules: [
      {
        use: {
          loader: "swc-loader",
          options: { jsc: { parser: { syntax: "typescript", tsx: false } } },
        },
        exclude: /node_modules\/(?!(three|jsoncrush))/,
      },
    ],
  },
  resolve: { extensions: [".ts", ".js"] },
  performance: { hints: false },
  optimization: { minimize: false },
}
