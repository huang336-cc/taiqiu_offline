# 奥特曼的台球 · 中文离线版 — v1.3.19 发布说明

> 发布日期：2026-08-24
> 版本：versionName 1.3.19 · versionCode 26082419 · git tag `v1.3.19`
> 一键在线玩：https://a8bf01e5f1e8b47ce.bj9.agentos-app.net

## 变更亮点

### 1. 设置中新增语言切换（中文 / English）

主菜单「设置」面板与游戏内「设置」覆盖层（help.html）均新增语言分段控件（中文 / English），选择持久化到 localStorage（沿用 `billiards_cn_settings_v1`）。

**中英文案全面覆盖**：

- **主菜单**：画质档位 / 辅助线档位 / 各模式规则弹窗 / 外观定制皮肤·球杆·场景名 / 设置联动提示 / 操作反馈 toast
- **游戏内设置覆盖层**：设置面板全部条目（语言 / 画质 / 辅助线 / 音量 / 操作介绍）
- **游戏内 HUD**：比分栏（玩家 / 对手 / 电脑）、击球 / 摆球 / 切换视角 / 设置按钮、白球击球点 / 击球力度 / 回放进度等标签、横屏遮罩、加载提示

实现采用**全局中文→英文映射字典 + `localize(root)` 树遍历翻译**（TreeWalker 翻译 text 节点 + title/aria-label/placeholder/alt 属性，节点 `__zh` / `__zh_<attr>` 记录原文以便回切），缺失项优雅降级保持中文。

### 2. 比分栏随语言根治

`src/view/hud.ts` 构造函数读取 `billiards_cn_settings_v1.language` 决定标签写入（玩家/对手/电脑 → You/Opponent/CPU）。`index.html` 内联脚本保留 `MutationObserver` 兜底监听切换消息（`type: "billiards-language"`），确保**对局开始瞬间**与**对局中切换**都即时正确。

### 3. 落地页 / 游戏页结构分离

游戏对局页 `index.html` 更名为 `play.html`，发布落地页 `download.html` 更名为 `index.html`，使**站点根 `/` 直接显示本发布页**（含在线模式 / 安卓 APK / 完整资源包 / 迁移明细 / 发布说明五块入口）。游戏内导航全量同步改引用；APP 端 `MainActivity.java` 游戏内页面返回拦截判断同步改为 `/play.html`。

### 双端一致

语言设置对所有端一致呈现，**纯文案 / 逻辑层改造，未改动任何布局**；APP 端通过 APK 重签打 v1.3.19 一并生效。

## 下载资源表

| 文件 | 说明 | 大小 |
|---|---|---|
| `play.html` | 网页端游戏入口（从发布页「在线模式」进入） | 23 KB |
| `billiards-cn.apk` | 安卓安装包，零权限 | 1.8 MB |
| `taiqiu-v1.3.19-release.zip` | 完整资源包（APK + bundle + SDK + 源码包 + 迁移明细 + 发布说明 + GitHub 发布指南） | 147 MB |
| `repo-v1.3.19.bundle` | git 仓库 bundle，可 `git clone` | 53 MB |
| `sdk.tar.gz` | Android SDK 构建链（build-tools/34 + platform android-34） | 27 MB |
| `source-v1.3.19.tar.gz` | 源码包（含已构建 dist/） | 64 MB |
| `MIGRATION-v1.3.10-to-v1.3.19.md` | 迁移明细（v1.3.10→v1.3.19） | — |
| `GITHUB-RELEASE-NOTES-v1.3.19.md` | 本说明 | — |
| `GITHUB-PUBLISH-GUIDE.md` | GitHub Release 发布指南 | — |

## 验证（chromium 真实加载 + CDP 驱动）

| 项 | 结果 |
|---|---|
| 菜单 / help zh↔en 可见文本 | ✅ 全部正确互换 |
| 游戏内界面 bodyText zh↔en | ✅ 「九球/八球/斯诺克/三库开伦/开始游戏/玩家/电脑」↔「9-Ball/8-Ball/Snooker/3-Cushion/Start Game/You/CPU」 |
| 比分栏 en+bot | ✅ `You / CPU` |
| 比分栏 zh+pvp | ✅ `玩家 / 对手` |
| 对局中切换语言 | ✅ `postMessage({type:"billiards-language"})` 触发后即时覆盖 |
| 落地页入口 | ✅ 根 `/` → `index.html` 发布页，五块入口齐全 |
| APK / 压缩包 / play.html / 迁移文档 / 发布说明 下载链接 | ✅ 全部 HTTP 200 |
| APK 构建 | ✅ 重签 1.8MB，零权限，resources.arsc Stored，4 字节对齐 |

## 升级指引

- **网页端**：链接不变，刷新即得 v1.3.19（缓存用户可硬刷新 Ctrl/Cmd+Shift+R）。
- **APK**：卸载/覆盖安装 `billiards-cn.apk`（versionCode 26082419 > 26082418，可直接覆盖）。
- **开发者**：`git clone repo-v1.3.19.bundle` 后参阅 `GITHUB-PUBLISH-GUIDE.md`；构建 APK 见 `billiards-apk/build-apk.sh`（需 `export ANDROID_SDK=/tmp/sdk`）。

## 双端分化约束（重申）

所有针对网页端的修复**仅**作用于 `html:not(.in-app)` 选择器；APP 端（`html.in-app`，由 billiards.local 虚拟域名注入）完全不受影响，继续走 v1.3.4 baseline。本版语言切换对所有端一致呈现，纯文案 / 逻辑层改造，**未改动任何布局**。