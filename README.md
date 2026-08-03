# 台球大师 · 中文离线版

[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](https://www.gnu.org/licenses/gpl-3.0)
[![Platform](https://img.shields.io/badge/platform-Android%205.0%2B-brightgreen.svg)](#下载)
[![Permissions](https://img.shields.io/badge/权限-0%20个-success.svg)](#隐私)

一个全中文、纯离线、无广告的安卓台球游戏。基于 three.js 的真实物理引擎，内置本地 AI 对手，**不申请任何系统权限**。

> **修改声明**
> 本作品是开源项目 [tailuge/billiards](https://github.com/tailuge/billiards) 的**衍生作品**，
> 由该项目修改而来，修改日期 **2026 年 8 月 3 日**。
> 原项目版权归 tailuge 及其贡献者所有，依 GNU GPL v3.0 授权。
> 本衍生作品同样依 **GPL-3.0** 发布。

---

## 下载

前往 [Releases](../../releases/latest) 下载最新版 APK。

安装说明与常见问题见 [`docs/安装与使用说明.md`](docs/安装与使用说明.md)。

---

## 特性

| | |
|---|---|
| **纯单机** | 无联网、无账号、无广告、无内购、无统计上报 |
| **零权限** | `AndroidManifest.xml` 未声明任何 `uses-permission`，可用 `aapt2 dump badging` 自行验证 |
| **全中文** | 菜单、玩法、设置、犯规提示、结算文案全部汉化 |
| **真实物理** | 继承原项目的球体碰撞、旋转（塞）、库边反弹与摩擦模型 |
| **本地 AI** | 两档难度对手（稳健 / 激进），全程本地计算 |
| **画质可调** | 六档 LOD 画质系统，自动检测设备性能，低端机也能跑顺 |
| **玩法** | 九球、斯诺克、开伦、练习模式 |

---

## 引用与致谢

| 项目 | [tailuge/billiards](https://github.com/tailuge/billiards) |
|---|---|
| 作者 | tailuge |
| 协议 | GNU General Public License v3.0 |
| 基线版本 | 0.3.1 |

本项目的**物理引擎、渲染管线、规则判定、本地 AI 对手**等核心实现全部来自上述原始项目。
真实的球体碰撞、旋转、库边反弹与摩擦模型均为原作者的成果。在此向 tailuge 及所有贡献者致谢。

完整的开源声明、修改清单与第三方组件列表见 [`开源声明.md`](开源声明.md)。

---

## 主要改动

**中文本地化** — 菜单、玩法说明、设置、操作介绍、击球按钮、得分板、犯规原因、
胜负结算及斯诺克彩球名称全部汉化；新增集中式文案模块 `src/utils/i18n.ts`。

**移除联网功能** — 移除 WebSocket 多人大厅与消息中继（含 `@tailuge/messaging` 依赖）、
分数上传、遥测统计、崩溃上报、Google Fonts 外链、分享外链、局面图导出、在线分析面板。

**移动端适配** — 新增六档 LOD 画质系统（渲染分辨率 / 抗锯齿 / 球体几何精度）、
设备性能自动检测、刘海屏安全区域适配、横屏布局优化、进球与碰撞震动反馈。

**新增功能** — 中文主菜单、内置操作介绍页、内置游戏设置面板（菜单与游戏内实时同步）、
应用内开源许可与致谢页。

**安卓封装** — Android WebView 原生外壳，不申请任何系统权限。

---

## 隐私

这个应用不收集任何数据，因为它**没有能力**收集：

- 未声明 `INTERNET` 权限，进程无法发起任何网络请求
- 未声明存储、位置、电话、相机等任何权限
- 所有资源（three.js、模型、音效）均打包在 APK 内，运行时零外链

装完后可以直接开飞行模式玩。

---

## 目录结构

```
billiards-cn/          游戏本体
  src/                 TypeScript 源码
  dist/                构建产物（可直接用浏览器打开 menu.html 试玩）
  webpack.config.js    打包配置
  LICENSE              GPL-3.0 协议全文

billiards-apk/         安卓封装
  AndroidManifest.xml  应用清单（零权限）
  src/                 MainActivity.java
  res/                 图标与字符串资源
  build-apk.sh         一键构建脚本

docs/                  安装说明与发布说明
开源声明.md             GPL-3.0 衍生声明与第三方组件清单
```

---

## 构建

### 前端

```bash
cd billiards-cn
yarn install
node_modules/.bin/tsc --noEmit      # 类型检查
node_modules/.bin/webpack           # 打包到 dist/
```

产物为 `dist/` 下的 `index.js`、`three_core.js`、`three_module.js`、`three_examples.js`。
直接用浏览器打开 `dist/menu.html` 即可试玩，不需要起服务器。

### 安卓 APK

不依赖 Gradle，使用 Android SDK 底层工具链。需要 `platforms/android-34`、`build-tools/34.0.0` 和 JDK：

```bash
export ANDROID_SDK=/path/to/android-sdk
cd billiards-apk
./build-apk.sh
```

脚本依次执行 `aapt2 compile` → `aapt2 link` → `javac` → `d8` → `zipalign` → `apksigner`，
最后自动校验签名并打印权限清单（应为空）。若目录下没有 `release.keystore`，脚本会自动生成一个自签名调试密钥。

> **构建陷阱**：`aapt2 link` 必须显式传 `--min-sdk-version 21 --target-sdk-version 34`。
> 否则 aapt2 会按旧版兼容规则**隐式追加** `WRITE_EXTERNAL_STORAGE`、`READ_PHONE_STATE`、
> `READ_EXTERNAL_STORAGE` 三个权限，零权限的承诺就破功了。

---

## 协议

本作品依据 **GNU General Public License v3.0** 发布，与原始项目保持一致。
协议全文见 [`LICENSE`](LICENSE)，或访问 <https://www.gnu.org/licenses/gpl-3.0.html>。

你有权自由运行、研究、修改和再分发本作品，但再分发时须遵循同样的 GPL-3.0 条款，
并须提供对应的完整源代码。

本程序不提供任何担保，使用风险由你自行承担。
