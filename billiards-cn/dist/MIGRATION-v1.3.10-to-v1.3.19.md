# 迁移明细：v1.3.10 → v1.3.19

> 本文档说明从 **v1.3.10** 升级到 **v1.3.19** 的全部代码改动、设计决策与验证数据，供开发者、二次开发方与想了解差异的用户参考。**v1.3.10 → v1.3.11** 的细粒度改动见文档主体（结构延续自 v1.3.11 文档）；**v1.3.12 → v1.3.19** 的各版本增量见文末「附录 A：v1.3.12 → v1.3.19 增量改动索引」。

---

> **v1.3.14 补充（2026-08-22）**：外观定制双端均默认展开。v1.3.11 在 `menu-cn.js` 的 `init()` 起始判 `html.in-app` 后强设 `customDetails.open=false`，把 APP 端外观定制收成折叠态；v1.3.14 删除了这段折叠逻辑，`<details open>` 在网页端与 APP 端（billiards.local 虚拟域名）均保持展开。其余双端分化不变（APP 仍回退 v1.3.4 baseline 贴底、网页端仍 `html:not(.in-app)` 单独优化撑满中段）。versionCode `26082212` / versionName `1.3.12` / tag `v1.3.14`。发布说明见 `GITHUB-RELEASE-NOTES-v1.3.14.md`。

## 0. 元信息

| 项 | 值 |
|----|----|
| 版本跨度 | 1.3.10 → 1.3.11 |
| 发布日期 | 2026-08-22 |
| 改动类型 | 主菜单布局修复 + Web/APP 双端分化 |
| 改动文件数 | 4 |
| 净代码变更 | +119 / −148 行 |
| versionName | 1.3.11 |
| versionCode | 26082211 |
| git tag | v1.3.11 |

---

## 1. 背景与用户诉求

v1.3.10 把主菜单重做成「`home-hero` 标题 + `home-footer` 版本行视觉锚点 + 底部 `toolbar` grid + 折叠态 `customCurrent` 摘要」的形态，但带来三类问题：

1. **网页版外观定制默认折叠**，与用户预期不符；
2. **底排按钮被改成一行 toolbar grid**，原有布局被改动；
3. **网页版中段/底部出现黑缝（留空）**，视觉上不饱满。

用户据此提出 **5 点明确诉求**：

| # | 诉求 | 归属端 |
|---|------|--------|
| 1 | 不要折叠外观定制 | 网页端 → 默认展开 |
| 2 | 不要改动底排按钮布局 | 两端统一 → 回退 v1.3.6 普通块 |
| 3 | 网页版底下不要留空 | 网页端 |
| 4 | 网页端主菜单可单独优化 | 网页端差异化 |
| 5 | APP 端回退之前正常的铺满版本 | APP 端 |

---

## 2. 双端分化策略总览

核心机制：APP 端通过虚拟域名 `billiards.local` 注入 `html.in-app` 类；网页端为 `html:not(.in-app)`。所有分化规则以该类选择器区分，互不污染。

| 维度 | 网页端 `html:not(.in-app)` | APP 端 `html.in-app` |
|------|---------------------------|----------------------|
| 外观定制 | 默认**展开**（`<details open>`） | **折叠**（JS 在 `init()` 强设 `open=false`） |
| 底部按钮 | v1.3.6 普通块（开始游戏单行 + 三按钮单行） | 同左，完全一致 |
| 中段玩法卡 | `flex:1` 撑满中段、`grid-auto-rows:1fr` 拉伸卡片 | 自然高度（`flex:0 0 auto`） |
| 操作按钮 | `actions` 紧贴视口底 | 同左，完全一致 |
| 设计取向 | 单独优化、填满留白 | 回退至用户已接受的 v1.3.4 baseline |

---

## 3. 逐文件改动明细

### 3.1 `menu.html`（HTML 结构，+27/− 行）

- **删除** `<header class="home-hero">…</header>` 与 `<footer class="home-footer">v1.3.10 · 离线版</footer>`。
- `<details class="section sec-custom">` 改为 `<details class="section sec-custom" id="customDetails" open>`（默认展开，由 JS 按端态收回）。
- summary 改为 `<summary class="section-title custom-summary">外观定制 <span class="custom-caret">▸</span></summary>`，删除折叠态 `.custom-current` 摘要 span。
- `versionCell` 文本 `1.3.10` → `1.3.11`。
- 变更履历新增 v1.3.11 条目（置顶）。

### 3.2 `menu-cn.css`（样式，核心，+/?/− 行，净 1303 行 → 1256 行）

**删除 v1.3.10 全部残留：**
- `.home-hero` / `.home-footer` 整段；
- `.custom-summary .custom-current` 摘要样式；
- `#screen-home .actions` 的 `toolbar` grid 整段（含 `grid-template-columns` 一行三按钮布局）；
- `@media (max-height:720px)` 中隐藏 hero/footer 的规则；
- `@media (max-height:560px)` 里 `grid-template-rows:44px` 的 toolbar 子规则。

**恢复基线（两端共用）：**
- `#screen-home` 恢复 v1.3.6 baseline：`overflow-y:auto; scrollbar-width:none; gap:7px; justify-content:center`。
- `#screen-home .actions` 采用 v1.3.4 推底方案：`margin-top:auto; padding-top:2px; flex:0 0 auto`。
- `.sec-mode` 恢复 v1.3.6：`flex:0 0 auto`、卡片 `min-height:130px`、`mode-icon 60px`、`mode-name 15px`。

**新增 `html:not(.in-app)` 网页端分化规则：**
```css
html:not(.in-app) #screen-home { height: 100%; justify-content: flex-start; gap: 10px; }
html:not(.in-app) .sec-mode { flex: 1 1 auto; min-height: 0; }
html:not(.in-app) .sec-mode .mode-grid { flex: 1 1 auto; grid-auto-rows: 1fr; }
html:not(.in-app) .sec-mode .mode-card { min-height: 0; padding: 14px 6px 16px; gap: 8px; }
html:not(.in-app) .sec-mode .mode-icon { width: 72px; height: 72px; }
html:not(.in-app) .sec-mode .mode-name { font-size: 17px; }
```

**安全阀（防极端视口失真）：**
```css
@media (min-aspect-ratio: 16/9) { html:not(.in-app) .sec-mode { max-height: 60vh; } }
@media (max-aspect-ratio: 9/14) {
  html:not(.in-app) .sec-mode { flex: 0 0 auto; }
  html:not(.in-app) .sec-mode .mode-card { min-height: 130px; }
  html:not(.in-app) .sec-mode .mode-icon { width: 60px; height: 60px; }
  html:not(.in-app) .sec-mode .mode-name { font-size: 15px; }
}
```

### 3.3 `menu-cn.js`（行为，+21/− 行）

- `init()` 起始新增双端判定：
  ```js
  var htmlEl = document.documentElement
  var inApp = htmlEl.classList.contains("in-app")
  var customDetails = document.getElementById("customDetails")
  if (customDetails && inApp) { customDetails.open = false }
  ```
  → APP 端收回折叠态，网页端保持 `<details open>` 展开。
- 删除 `refreshCustomRows()` 末尾的 `customCurrent` 写入块（约 898–907 行）。

### 3.4 `AndroidManifest.xml`（版本号）

- `android:versionCode="26082207"` → `"26082211"`
- `android:versionName="1.3.10"` → `"1.3.11"`

---

## 4. v1.3.10 残留清理清单（已删除项）

| 残留项 | 位置 | 清理动作 |
|--------|------|----------|
| `.home-hero` | CSS + HTML | 整段删除 |
| `.home-footer` | CSS + HTML | 整段删除 |
| `.custom-summary .custom-current` | CSS + HTML | 整段删除 |
| `#screen-home .actions` toolbar grid | CSS | 整段删除 |
| `@media (max-height:720px)` 隐藏 hero/footer | CSS | 删除 |
| `@media (max-height:560px)` 的 `grid-template-rows:44px` | CSS | 删除对应子规则 |
| `customCurrent` JS 写入块 | JS | 删除 |

> grep 验证：`home-hero` / `home-footer` / `toolbar` / `customCurrent` 在 CSS/HTML/JS 中计数均为 **0**，无残留。

---

## 5. 新增规则清单

- 网页端 `#screen-home { height:100% }` + `justify-content:flex-start`（顶部对齐、撑满容器）。
- 网页端 `.sec-mode { flex:1 1 auto }` 让玩法区段吸收中段剩余空间。
- 网页端 `.mode-grid { grid-auto-rows:1fr }` 把 4 张卡 stretch 到完整行高。
- 网页端 `.actions { margin-top:auto }` 推底，消除底部留空。
- 双端安全阀：`min-aspect-ratio:16/9` 限高 `60vh`、`max-aspect-ratio:9/14` 回退自然高度。
- 双端折叠控制：HTML `<details open>` + JS 仅 APP 端收回。

---

## 6. 量化验证（`getBoundingClientRect` 探针，单位 px）

用 chromium headless `--dump-dom --virtual-time-budget=2000` 注入探针，量化各 section 的 `y/h/bottom`：

| 视口 | 端 | actions bottom | 是否贴底 | 关键表现 |
|------|----|----------------|----------|----------|
| 1280×720 | Web | 630 ≈ vh 633 | ✅ | 4 卡 h=296 撑满中段 |
| 390×844 | Web | 690 ≈ vh 757 | ✅ | max-aspect 安全阀生效，卡片不撑大 |
| 1920×1080 | Web | 924 ≈ vh 993 | ✅ | max-height:60vh 生效，卡片 596px 不超高 |
| 1280×720 | APP | 630 ≈ vh 633 | ✅ | detailsOpen=false 折叠态，内容顶部对齐 |
| 390×844 | APP | 634 ≈ vh 757 | ✅ | detailsOpen=false 折叠态 |

结论：**两端操作按钮均紧贴视口底，网页端无黑缝，APP 端回退铺满版**。

---

## 7. 回退与兼容性说明

- **APP 端**回退到 **v1.3.4 baseline** 视觉：折叠态 + 普通 `actions` 块 + 贴底，中段无大黑缝。
- **网页端**单独优化：展开外观定制 + 4 卡撑满中段 + 贴底。
- 两端**底部按钮布局完全一致**，均尊重 v1.3.6 普通块（开始游戏单行 / 三按钮单行）。
- 本次改动**仅涉及主菜单呈现层**，不影响游戏逻辑、回放、设置、计分等其它功能。
- 游戏资源（`play/`）、APK 能力、零权限策略均保持不变。

---

## 8. 开发者升级指引

- 若基于 v1.3.10 二次开发：
  - `#screen-home` 已移除 `home-hero` / `home-footer`，依赖这两个锚点的定制需自行补回。
  - 外观定制折叠改由 JS 控制（`html.in-app` 判定），不再由 CSS `details[open]` 单独决定。
  - 自定义主菜单样式时，注意 `html.in-app` 与 `html:not(.in-app)` 两条分支，避免一端改动泄漏到另一端。
- 重新签名 APK 时，`versionCode` 必须单调递增（本版 `26082211` = YYMMDDNN）；`versionName` PATCH 递增。
- 资源包 `taiqiu-v1.3.14-release.zip` 含 7 项：APK、仓库 bundle、SDK、源码包、迁移明细（本文档）、发布说明、GitHub 发布指南（`GITHUB-PUBLISH-GUIDE.md`）。完整清单见 `GITHUB-RELEASE-NOTES-v1.3.14.md`。

---

## 9. 版本信息

- versionName：**1.3.19**
- versionCode：**26082419**
- git tag：**v1.3.19**
- 发布日期：2026-08-24

---

## 附录 A：v1.3.12 → v1.3.19 增量改动索引

> 自 v1.3.11 之后共迭代 7 个版本，本节按版本倒序列出关键改动与对应发布说明链接。
> 详细逐文件 diff / 量化验证数据见各版本对应的 `GITHUB-RELEASE-NOTES-vX.Y.Z.md`。

### v1.3.19 · 2026-08-24（versionCode 26082419）
**新功能**：设置中增加语言切换（中文 / English）。
- `src/utils/settings.ts`：GameSettings 接口与 DEFAULTS 新增 `language: "zh" | "en"` 字段。
- `src/view/hud.ts`：比分栏标签按 localStorage.language 国际化（玩家/对手/电脑 → You/Opponent/CPU）。
- 三界面 i18n 引擎：menu.html / help.html / index.html 各内置 `TX` 字典 + `localize(root)` 树遍历翻译（TreeWalker 翻译 text 节点 + title/aria-label/placeholder/alt 属性，节点 ` `__zh` ` / ` `__zh_<attr>` ` 记录原文以便回切），缺失项优雅降级保持中文。
- index.html 内联脚本：load 事件 + postMessage(billiards-language) 监听即时覆盖比分栏。
- 落地页/游戏页分离：游戏 `index.html` → `play.html`，发布 `download.html` → `index.html`，根 `/` 直接显示发布页（含在线模式 / APK / 资源包 / 迁移明细 / 发布说明五块入口）；全量更新游戏内导航引用，APP 端 MainActivity.java 游戏内页面返回拦截判断 → `/play.html`。
- 双端一致：纯文案 / 逻辑层改造，不改动任何布局；APP 端 APK 重签打 v1.3.19 一并生效。

### v1.3.18 · 2026-08-24（versionCode 26082418）
**Bug 修复**：进球同帧母球进袋时进球数未递增（八球 / 九球规则，玩家端与电脑端）。
- 根因：八球 `handleFoul` 与九球 `handleFoul` 之前只在 v1.3.4 引入的开球杆特例（`!this.firstShotPlayed`）中加分，非开球杆「合法进球 + 母球落袋」犯规时，合法进球被一并剥夺。
- 修复：任何犯规时过滤母球（犯规代价）和黑八/九号球（按规则 respot 不算分），剩余合法进袋球仍计入本方累计比分。
- 电脑端（`boteventhandler.handleFoul`）对称修复。
- 量化验证：玩家 5 / 电脑 6 同帧「打进 11 号 + 母球落袋」时玩家比分仍正确 +1。

### v1.3.17 · 2026-08-24（versionCode 26082417）
**修复**：网页端横屏模式区高度自适应（仅网页端，APP 端零改动）。
- `.sec-mode` `flex: 3 1 0` → `flex: 0 0 auto`；`.mode-grid` `flex: 1 1 0` → `flex: 0 0 auto`；`.mode-card` `justify-content: center` → `flex-start`；`.mode-icon` `max-height/max-width` 48% → 40%；`.mode-card` `padding` `1vh` → `0.6vh`、`gap` `0.8vh` → `0.5vh`。
- 全部在 <code>@media (orientation:landscape)</code> 的 <code>html:not(.in-app)</code> 块内，APP 端零改动。
- 量化：800×273 下 mode-card 212h → 93h（-56%），外观栏 58h → 75h。

### v1.3.16 · 2026-08-24（versionCode 26082416）
**重构**：Web 移动端 flex 布局重构。
- 删除 v1.3.11~v1.3.15 累计的多套固定 px 横屏档，改用干净 <code>@media (orientation:landscape)</code> + <code>html:not(.in-app)</code> 规则。
- 5 大区块齐全：4 球型卡 `grid repeat(4,1fr)` 均分，外观定制三栏 / 难度选择 / 底部三按钮均 `flex:1 1 0` 均分，字号 `clamp(11px,2.2vh,17px)` 自适应。
- 额外修复 web 端 `.app` 过度预留的 `padding-bottom: max(8px,72px)`（那是 APP 地址栏的）。
- APP 端零改动（所有新规则均在 <code>html:not(.in-app)</code> 内）。

### v1.3.15 · 2026-08-23（versionCode 26082315）
**CSS**：横屏 `actions` sticky 兜底 + `fitViewport` 改用 `visualViewport`。
- <code>menu-cn.css</code>：横屏 actions sticky 兜底。
- <code>menu.html</code> `fitViewport`：改用 `window.visualViewport`。

### v1.3.14 · 2026-08-22（versionCode 26082214）
**修复**：外观定制双端均默认展开。
- 删除 v1.3.11 在 `menu-cn.js` 的 `init()` 起始判 `html.in-app` 后强设 `customDetails.open=false` 的折叠逻辑。
- `<details open>` 在网页端与 APP 端（billiards.local 虚拟域名）均保持展开。

### v1.3.12 · 2026-08-22（versionCode 26082212）
**联网 / 入口修复**：
- 在线游戏模式仅保留横屏：删除竖屏可玩模式，游戏页在竖屏显示全屏「请横屏使用」遮罩并屏蔽游戏交互。
- 在线打开链接默认停留主菜单：根目录无游戏 / 回放参数时自动跳转到 menu.html（v1.3.19 改为跳发布页 index.html）。
- iOS Safari 底部适配：window.visualViewport 实时计算 --vv-bottom，整体上移 .panel / 回放进度条 / 白球操作弹窗；iOS Safari 增加 50px 兜底偏移。

---

## 附录 B：v1.3.19 关键指标

- **菜单 / help 文本**：zh↔en 可见文本全部正确互换（chromium 真实加载确认）。
- **游戏内界面**：zh 含「九球/八球/斯诺克/三库开伦/开始游戏/玩家/电脑」；en 含「9-Ball/8-Ball/Snooker/3-Cushion/Start Game/You/CPU」。
- **比分栏**：en+bot → `You / CPU`；zh+pvp → `玩家 / 对手`；对局中 `postMessage` 切换即时覆盖。
- **落地页**：根 `/` → 发布页 5 块入口齐全；APK / 压缩包 / play.html / 迁移文档 / 发布说明均 HTTP 200。
- **APK**：重签 1.8MB，零权限，resources.arsc Stored，4 字节对齐。
