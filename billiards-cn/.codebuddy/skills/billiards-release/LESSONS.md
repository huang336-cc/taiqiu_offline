# 台球发版历次踩坑复盘（LESSONS）

> 本文件记录 billiards-cn 发版过程中真实发生过的事故与根因，供发版 skill 对照预防。
> 对应可执行 SOP 见同目录 `SKILL.md`。

---

## 1. APK 安装后显示版本号一直是 1.3.19（最严重）

**现象**：发布页文件名、网页显示的版本都已是 v1.3.22，但用户安装 APK 后，安卓「设置-应用」里看到的版本始终是 **1.3.19**。

**根因**：版本号散落三处，只同步了其中一处。
- `dist/menu.html` 的 `__BILLIARDS_VERSION__`（决定 APK **文件名**）→ 每次都改了。
- `dist/index.html`（网页显示的版本）→ 每次都改了。
- APK **内部** `billiards-apk/AndroidManifest.xml` 的 `android:versionName` / `android:versionCode` → **从 v1.3.19 起再没改过**，写死成 `1.3.19` / `26082419`。
- `build-apk.sh` 只用 `menu.html` 的版本号来拼 **OUT_APK 文件名**，完全没碰 manifest 内部版本。

所以文件名是 v1.3.22、内容也是最新的，但安卓读取的内部版本号停留在 1.3.19，用户看到的自然是 1.3.19。

**修复**：
- 让 `build-apk.sh` 在 `aapt2 link` 之前，用 `sed` 把 `AndroidManifest.xml` 的 `versionName` / `versionCode` 自动改写成 `menu.html` 的版本（versionCode = `YYMMDD` + 末位 patch）。从根上保证「menu.html 版本对，APK 内部版本就对」。
- 发版 SOP 增加第 5 步：`aapt2 dump badging` 校验 APK 内部 `versionName='NEW'`，作为回归兜底。

**教训**：版本号是「三位一体」，文件名、网页、APK 内部三者必须一致；任何一处脱节都会让用户看到错版本。

---

## 2. 发布压缩包里装的是旧 APK

**现象**：`taiqiu-v1.3.21-release.zip` 内嵌的 APK md5，和 dist 目录里当前最新的 APK md5 对不上——压缩包是**更早一次 APK 构建**打进去的。

**根因**：打包顺序错了——先 `zip` 打压缩包，后 `build-apk` 重建 APK（或因中间插入了别的修复导致 APK 被重新构建）。压缩包永远比当前 APK 旧。

**修复**：SOP 严格规定「先 `build-apk` 再 `zip`」，且打包后校验「压缩包内 APK 的 md5 == dist 当前 APK 的 md5」。

**教训**：发布压缩包必须在 APK 最终构建**之后**打包；打包即终态，不能再改 APK。

---

## 3. 英文版大量未翻译

**现象**：英文模式下，操作指引、关于页、球杆/桌布英文名、游戏内 HUD/按钮等大量中文未翻。

**根因（分四处）**：
1. `localize()` 只匹配**整段**文本节点做中英映射；HTML 里 `<b>` 标签把中文拆成多段文本节点（如「本游戏为完全离线的单机版本，`<b>`不需要联网`</b>`」），拆分后的片段不在 `TX` 字典里 → 不翻译。
2. `i18n` 里的 `T` 常量只有中文值，JS 动态渲染的 HUD/按钮（击球/摆球/玩家/电脑/犯规提示）永远输出中文。
3. v1.3.21 新增的 4 款球杆 + 6 款桌布皮肤，在 `TX` 字典里没有英文名。
4. 关于页全文、隐私声明、回放空态、计时选项、对手标签等 UI 文案没有英文条目。

**修复**：
- `i18n.ts` 升级为双语 `STRINGS` + 运行时 `t(key)`，JS 渲染文本走 `t()`。
- `TX` 字典补全：把 `<b>` 拆分出的每个片段都单独建 key/value；补齐 4 球杆 + 6 桌布 EN 名、关于页全文、UI 标签。
- 动态写入中文的函数（如 `refreshCustomRows` / `showModeRules`）确认走 `curLang()` 取双语。

**校验要点**：
- 用 `document.body.textContent`（含隐藏元素）判断泄漏，**不要用 `innerText`**——后者会排除 `display:none` 的定制屏幕，把「已翻译」误判成「未翻译」（假阴性）。
- 沙箱无 WebGL，3D 不可视验证，只抓文本。

**教训**：`<b>` 拆分是静态翻译的最大陷阱；校验禁用 `innerText`。

---

## 4. 球桌中央多出一块矩形

**现象**：v1.3.21 加了边缘发光（edge-glow）特效后，球桌正中央出现一个不对劲的矩形色块。

**根因**：`assets.ts` 里的 edge-glow ring 尺寸算错——内/外半径算出来约为桌面尺寸的 2 倍，矩形环被撑到铺满整个桌面中央。

**修复**：直接删除 edge-glow 相关代码（`refreshEdgeGlow` / `buildRectRing` / `edgeGlowMesh` 及调用与 import）。

**教训**：特效尺寸要用相对球桌的参数，且加完要在真机/预览里眼检，不能只信构建通过。

---

## 5. `git checkout` 误丢未提交翻译条目

**现象**：为修复某处 TX 插入出错，执行 `git checkout -- dist/help-cn.js` 想回退，结果把**这一轮还没提交**的 19 条操作指引翻译（#170 的成果）一并丢掉。

**根因**：`git checkout -- <file>` 会用 HEAD 版本**覆盖**工作区，无论改动是否提交。当时 help-cn.js 的新条目尚未 commit。

**修复**：从记忆中重导精确 key 重新生成并插入；从此约定「危险 git 操作前先 commit / 用 `git stash` 而非 `checkout --`」。

**教训**：未提交的成果先用 `git stash` 或先 commit，再用 `checkout`；不要用 `checkout --` 做「丢弃改动」，它不分已提交/未提交。

---

## 横向经验（适用于每次发版）

- **版本号必须迭代**：用户硬约束，每次发版都要 +1，且三位一体一致。
- **发布是覆盖式**：在线链接背后内容对所有拿过链接的人立即生效，每轮发布需当轮明确授权，不静默发布。
- **大体积产物不入库**：`source-*.tar.gz` / `repo-*.bundle` / `taiqiu-*-release.zip` 按惯例只发布、不进 git（git 只存源码 + 普通 `billiards-cn.apk`）。
- **GPL 源码随包**：发布压缩包须含完整对应源码（本 skill 的 `git archive HEAD` 自动纳入 `.codebuddy/skills/billiards-release/`），满足 GPL-3.0 第 6 条。
- **清理旧版**：发版后删掉 dist 里上一版产物，避免发布服务器残留旧 APK/压缩包造成「版本不对」的困惑。
