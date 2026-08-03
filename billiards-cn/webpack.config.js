const path = require("node:path")
const TerserPlugin = require("terser-webpack-plugin")
module.exports = {
  // 离线单机版只需要主游戏入口，其余诊断/图解页面已移除
  entry: {
    index: "./src/index.ts",
  },
  module: {
    rules: [
      {
        use: {
          loader: "swc-loader",
          options: {
            jsc: {
              parser: {
                syntax: "typescript",
                tsx: false,
              },
            },
            env: {
              targets: {
                ios: "12",
              },
            },
          },
        },
        exclude: /node_modules\/(?!(three|jsoncrush))/,
      },
    ],
  },
  resolve: {
    extensions: [".ts", ".js"],
  },
  devServer: {
    static: {
      directory: path.join(__dirname, "dist"),
    },
    allowedHosts: [".gitpod.io"],
    host: "localhost",
    compress: true,
    port: 8080,
    client: {
      progress: true,
    },
  },
  performance: { hints: false },
  mode: "production",
  optimization: {
    minimize: true,
    minimizer: [
      new TerserPlugin({
        minify: TerserPlugin.swcMinify,
        extractComments: false,
        terserOptions: {
          compress: {
            unused: true,
            dead_code: true,
          },
          mangle: {
            keepClassNames: true,
            keepFnNames: true,
          },
          safari10: true,
        },
      }),
    ],
    usedExports: true,
    sideEffects: true,
    innerGraph: true,
    splitChunks: {
      cacheGroups: {
        three_core: {
          test: /[\\/]node_modules[\\/]three[\\/]build[\\/]three\.core\.js/,
          name: "three_core",
          chunks: (chunk) => chunk.name !== "worker",
          priority: 30,
        },
        three_module: {
          test: /[\\/]node_modules[\\/]three[\\/]build[\\/]three\.module\.js/,
          name: "three_module",
          chunks: (chunk) => chunk.name !== "worker",
          priority: 30,
        },
        three_examples: {
          test: /[\\/]node_modules[\\/]three[\\/]examples[\\/]jsm[\\/]/,
          name: "three_examples",
          chunks: (chunk) => chunk.name !== "worker",
          priority: 30,
        },
      },
    },
    moduleIds: "named",
  },
  stats: {
    errorDetails: true,
  },
  cache: {
    type: "filesystem",
  },
}
