---
name: billiards-release
description: 台球中文离线版（billiards-cn）发版流水线。当用户要「发版 / 发布新版本 / 迭代版本号 / 打包 APK 与发布压缩包 / 重新生成源码包 / 重新发布在线链接」时使用。自动覆盖：版本号三位一体迭代（menu.html + index.html + APK 内部 AndroidManifest）、webpack 构建、APK 构建、英文翻译校验、源码包/仓库 bundle/发布压缩包打包、提交打 tag、重新发布在线链接。内含历次踩坑清单（见 LESSONS.md）。
allowed-tools: Read, Write, Edit, Bash, Glob, Grep
---

# 台球发版流水线（billiards-release）

把 billiards-cn 的一次完整发版标准化。目标：任何一次发版，用户下载安装后看到的**版本号**、网页显示的**版本**、**源码包**、**发布压缩包**、**在线链接**全部一致且为最新。

> 完整踩坑复盘见同目录 `LESSONS.md`。本文件是可执行的 SOP；`scripts/` 下是配套脚本。

## When to Use

- 用户要「发版 / 发布新版本 / 迭代版本号 / 打包 APK / 重新生成源码包 / 重新打包发布压缩包 / 重新发布在线链接 / 重新发布」。
- 一次功能性改动（修 bug / 加功能 / 翻译补全）完成、要落成正式版本时。

## 关键路径（执行前务必确认存在）

| 用途 | 路径 |
|---|---|
| 前端源码 | `/workspace/repo/billiards-cn`（`src/` TypeScript + `dist/` 构建产物） |
| webpack 构建 | 该目录下 `npm run build` → `dist/index.js` |
| APK 构建 | `/workspace/repo/billiards-apk/build-apk.sh`（需 `ANDROID_SDK=/opt`） |
| 版本号真源 | `dist/menu.html` 的 `__BILLIARDS_VERSION__`（形如 `1.3.22-2608251430`） |
| 在线发布 | `node /root/.codebuddy/skills/发布为应用/scripts/publish.js --dir /workspace/repo/billiards-cn/dist --language static` |
| Playwright | ESM 不读 `NODE_PATH`，用绝对路径 `import pkg from '/root/.nvm/versions/node/v22.13.1/lib/node_modules/playwright/index.js'` |

## 发版标准流程（严格按顺序）

0. **先写 changelog 与文案/翻译修复**（人类或 Agent 完成）。改 `src/` 后必跑 `npm run build`。
1. **版本号三位一体迭代**（核心，见下节）。用 `scripts/bump_version.py` 或手工改。
2. **webpack 构建**：`cd /workspace/repo/billiards-cn && npm run build`
3. **APK 构建**：`cd /workspace/repo/billiards-apk && ANDROID_SDK=/opt bash build-apk.sh` → 输出 `billiards-cn-vNEW.apk`
4. **复制到 dist**：`cp` 到 `dist/billiards-cn-vNEW.apk` 与 `dist/billiards-cn.apk`（前者被 `*.apk` 忽略但磁盘存在供打包；后者入库）
5. **校验 APK 内部版本**（防回归）：`/opt/build-tools/34.0.0/aapt2 dump badging dist/billiards-cn-vNEW.apk | grep '^package:'` 必须显示 `versionName='NEW'`
6. **英文翻译校验**（Playwright，见「校验要点」）：EN 模式下 menu/help/index 无中文泄漏（changelog / 发布页中文除外）
7. **生成源码包 + bundle**（**必须 commit 之后**）：`git archive --format=tar.gz -o dist/source-vNEW.tar.gz HEAD`；`git bundle create dist/repo-vNEW.bundle --all`
8. **打包发布压缩包**：`zip -r dist/taiqiu-vNEW-release.zip dist/billiards-cn-vNEW.apk dist/source-vNEW.tar.gz dist/repo-vNEW.bundle dist/sdk.tar.gz dist/MIGRATION-*.md dist/GITHUB-RELEASE-NOTES-vNEW.md dist/GITHUB-PUBLISH-GUIDE-vNEW.md`（**必须在第 3 步 APK 构建之后**，否则包内 APK 是旧的）
9. **清理旧版产物**：删掉 dist 里上一版本的 `billiards-cn-vOLD.apk` / `source-vOLD.tar.gz` / `repo-vOLD.bundle` / `taiqiu-vOLD-release.zip`，避免发布服务器残留旧版造成混淆
10. **提交 + 打 tag**：`git add` 改动（大体积 tar/zip/bundle 按惯例**不入库**，仅发布）；`git commit`；`git tag -a vNEW -m "..."`
11. **发布在线链接**（需当轮明确授权，不静默发布）：跑 publish.js，`verified:true` 后回 `shareLink`
12. **验收**（见下），全部通过才算发版完成

> 想一键跑 2–8 的机械部分，可用 `scripts/release.sh <NEW_VERSION>`（详见脚本内说明与 `--publish` 开关）。

## 版本号三位一体（最重要的一条）

版本号散落三处，必须同步，否则用户看到不一致：

| 位置 | 字段 | 如何设置 |
|---|---|---|
| `dist/menu.html` | `__BILLIARDS_VERSION__` | 手工 / `bump_version.py` |
| `dist/index.html` | title / 链接 / meta | 手工 / `bump_version.py` |
| APK **内部** | `AndroidManifest.xml` versionName / versionCode | **`build-apk.sh` 构建时自动从 `menu.html` 同步**，无需手动改 |

> **血泪教训**：曾经只改了文件名（menu.html）没改 APK 内部版本，导致文件名是 v1.3.22、安装后「设置-应用」里显示的却一直是 v1.3.19（从 v1.3.19 起内部版本再没迭代）。现在 `build-apk.sh` 会在 link 之前用 `sed` 把 manifest 的 versionName/versionCode 改写成 `menu.html` 的版本，从根上杜绝。所以**只要 menu.html 版本对了，APK 内部版本自动对**；第 5 步的 `aapt2` 校验是预防回归的兜底。

## 英文翻译校验要点

- `localize()` 只翻译**整段**文本节点；HTML 里 `<b>` 标签会把中文拆成多段，每段都要在 `TX` 字典单独建条目。
- 校验用 `document.body.textContent`（含隐藏元素），**不要**用 `innerText`（会排除隐藏的定制屏幕，造成「假阴性」误判翻译失败）。
- 沙箱无 WebGL，3D 不可视验证；UI 只走 Playwright / CDP 抓文本。
- Playwright ESM 不读 `NODE_PATH`，用 `import pkg from '/root/.nvm/versions/node/v22.13.1/lib/node_modules/playwright/index.js'`。

## 验收清单（发布前必须全过）

- [ ] `menu.html` `__BILLIARDS_VERSION__` = 新版本
- [ ] `index.html` 所有版本引用 = 新版本
- [ ] APK 内部 `aapt2 dump badging` 显示 `versionName='NEW'`、`versionCode` 单调递增
- [ ] EN 模式：menu/help 关键翻译全在（球杆/桌布英文名、关于页全文、操作指引、UI 标签），无中文泄漏（changelog 除外）
- [ ] `dist/billiards-cn-vNEW.apk` 与发布压缩包内 APK **md5 一致**
- [ ] 源码包 `source-vNEW.tar.gz` 含最新源码 + 本 skill（解包应有 `.codebuddy/skills/billiards-release/`）
- [ ] 服务器旧版 APK / 压缩包已清除（HTTP 404）
- [ ] 在线链接 `verified:true`，其 `index.html` 版本 = NEW

## 历次踩坑（完整版见 `LESSONS.md`）

1. **APK 内部版本卡在 1.3.19**：只同步文件名没同步内部版本 → 已让 `build-apk.sh` 自动同步。
2. **发布压缩包内含旧 APK**：zip 在 APK 重建前就打包了 → 必须先 `build-apk` 再 `zip`，并校验 md5。
3. **英文大量未翻译**：`<b>` 拆分使 `localize` 失效；`i18n.T` 无英文值；新皮肤/球杆无 EN 名；关于页全文缺失 → 双语 `t()` + 补全 `TX` + 动态函数用 `curLang()`。
4. **球桌中央多出矩形**：edge-glow ring 尺寸算错撑满桌面 → 删除该特效代码。
5. **`git checkout` 误丢未提交 TX**：危险操作前先 commit。

## 重要规则

- 每次发版**必须**迭代版本号（用户硬约束）。
- 发布是覆盖式、对所有拿过链接的人立即生效 → 每轮发布需当轮明确授权，不静默发布。
- 大体积 tar/zip/bundle 按惯例**发布但不入库**（git 只存源码 + 普通 `billiards-cn.apk`）。
- 版本号时间戳用 `date +%y%m%d%H%M`（YYMMDDHHMM）；APK `versionCode` = `YYMMDD` + 末位 patch（如 v1.3.22 → `26082522`）。
