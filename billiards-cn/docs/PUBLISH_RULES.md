# 奥特曼的台球 · 发布约束（Publish Rules）

> 本文件为每次「改完代码 + 构建 APK + 发布」的**强制检查清单**。
> 任何一次发布都必须先满足下方全部条目，否则视为发布不完整（尤其是版本号遗漏迭代）。

---

## 一、版本号必须迭代（核心约束）

软件对外暴露的**所有版本标识**必须在每次发布时同步升号。遗漏任何一处都会导致
「安卓设置里显示的版本、游戏内关于页版本、发布页版本」三处对不上，或停滞在旧值。

### 版本标识载体清单

| 载体 | 文件 | 字段 / 位置 | 当前值（v1.3.39） | 来源 |
|------|------|------------|------------------|------|
| 构建戳（内部） | `src/utils/version.ts` | `export const VERSION` | `260827.13` | 手动升号 |
| 显示版本（注入） | `dist/menu.html` | `window.__BILLIARDS_VERSION__` | `1.3.39-26082713` | 手动升号 |
| APK 版本名 | `billiards-apk/AndroidManifest.xml` | `android:versionName` | `1.3.39` | **由 build-apk.sh 自动从 `menu.html` 的 `__BILLIARDS_VERSION__` 反推写入** |
| APK 版本码 | `billiards-apk/AndroidManifest.xml` | `android:versionCode` | `26082713` | build-apk.sh：`日期(260827)+末位(13)` |
| 发布页标题/卡片 | `dist/index.html` | `vX.Y.Z` 文本 | `v1.3.39` | 手动升号（sed） |
| 游戏内变更履历 | `dist/menu.html` `#screen-changelog` | `<h3>vX.Y.Z …</h3>` 条目 | `v1.3.39` | 手动新增条目 |
| 发版说明 | `docs/RELEASE_NOTES.md` | 下载表 + 更新日志 | `v1.3.39` | 手动新增条目 |

### 升号规则

1. **语义版本** `vX.Y.Z`：按本次改动性质升主/次/修订号（如新增功能升 `v1.3.24 → v1.3.25`）。
2. **构建戳** `version.ts`：日期 `YYMMDD` + 当日序号，如 `260826.04`（当天第 2 次构建）。
   - 仅改末位序号即可，**保持前 6 位 `260826` 不变**，以免破坏 `uid` 等依赖该前缀的逻辑。
3. **`__BILLIARDS_VERSION__`**：格式 `语义版本-构建戳无点`，如 `1.3.27-26082604`。
   - **这是 APK 版本号的唯一真相源**：`build-apk.sh` 读此值自动写 AndroidManifest，
     因此改它就等于改 APK 版本号，**绝不可遗忘**（曾长期卡在 1.3.23）。
4. **versionCode**：`build-apk.sh` 自动算 `YYMMDD(260826) + 语义版本末位(25)` = `26082627`，无需手填。

### ⚠️ 最容易漏的两处

- `dist/menu.html` 里的 `window.__BILLIARDS_VERSION__` —— **硬编码字符串，webpack 不自动注入**，
  必须手动改成最新值，否则 APK 的 versionName/versionCode 不会迭代。
- `src/utils/version.ts` 的 `VERSION` 戳 —— 改了功能但忘了升戳，会导致构建产物标识陈旧。

---

## 二、变更履历必须同步更新（三处）

每次发布前，以下三处都必须补上本次变更的条目（含版本号、日期、要点）：

1. **游戏内「变更履历」**：`dist/menu.html` 的 `#screen-changelog`，在列表**最顶部**插入新 `<div class="setting-group">`，
   标题形如 `<h3>v1.3.25 · 2026-08-26 16:23:00</h3>`。
2. **发布中心**：`dist/index.html` 的「当前版本」`<details class="ver-item current">` 描述。
3. **发版说明**：`docs/RELEASE_NOTES.md` 的「下载」表 + 「更新日志」段。

仅外观类改动（如球杆皮肤）须在其中注明「未改动物理 / 挥杆动画 / 碰撞参数」。

---

## 三、发布前 Checklist（必须逐项打勾）

```
[ ] 1. src/utils/version.ts 的 VERSION 戳已升号（保持前 6 位 YYMMDD 不变）
[ ] 2. dist/menu.html 的 window.__BILLIARDS_VERSION__ 已升号（格式 X.Y.Z-YYMMDDNN）
[ ] 3. dist/index.html 所有 vX.Y.Z 文本已升号（标题 / 卡片 / 当前版本描述）
[ ] 4. 游戏内变更履历（#screen-changelog）已新增本次版本条目
[ ] 5. 发布中心当前版本描述已更新
[ ] 6. docs/RELEASE_NOTES.md 下载表 + 更新日志已更新
[ ] 7. 重新执行 release.sh：构建 APK 时确认日志显示
        「将 AndroidManifest 的 versionName/versionCode 同步为 X.Y.Z / 2608xxxx」
[ ] 8. 发布后在线页验证：
        · 发布页标题为最新 vX.Y.Z
        · 游戏内变更履历含最新条目
        · 解包 APK（或 aapt dump badging）确认 versionName/versionCode 为最新值
[ ] 9. release 压缩包仅含：source/ + sdk/ + *.apk + RELEASE_NOTES.md + PUBLISH_RULES.md + BUILDING.md + published.html
[ ] 10. **把新 APK / ZIP 放进网关真正服务的目录**（见第五节），否则下载链接必然 404
```

---

## 五、下载目录的真源（v1.8.8 踩坑记录，务必遵守）

对外网关（`*.app.workbuddy.host`）**不是**把 `publish-online/` 或 `publish-site/` 直接挂出去，
而是由 `/workspace/.cloudstudio` 里的 `[[app]] cmd` 决定：

```
cd "/workspace/dev/source/billiards-cn/dist" && python3 -m http.server 3000 ...
```

即 **`dev/source/billiards-cn/dist/` 才是对外可见的 Web 根目录**。`publish-online/`、
`publish-site/` 只是本地留存副本，改它们不影响线上。

由此产生的坑（v1.8.8 真实发生）：`dist/index.html` 已升到 `v1.8.8`，但 `dist/` 下只有
`v1.8.6` / `v1.8.7` 的 apk 与 zip，点下载 → **HTTP 404**。

**每次发布必做**：

1. 把 `billiards-cn-vX.Y.Z.apk`、`release-vX.Y.Z.zip` 复制进 `dist/`；
2. 删掉 `dist/` 里的旧版本 apk / zip（避免误下旧包、也避免链接与实物对不上）；
3. `dist/` 内的 `index.html`、`menu.html`、`play.html`、`index.js`、`css/` 必须是本次构建产物；
4. 用**外网域名**实测（不要只测 localhost）：

```bash
H="https://a7b9dc0cd0da80587.app.workbuddy.host"
SC="I67DJCFW6E"          # 当前有效分享码；分享码换了 403 会变 404 的观感
curl -s -o /dev/null -w "%{http_code} %{size_download}\n" "$H/billiards-cn-vX.Y.Z.apk?sharecode=$SC"
curl -s -o /dev/null -w "%{http_code} %{size_download}\n" "$H/release-vX.Y.Z.zip?sharecode=$SC"
```

期望：`200` 且字节数与本地文件**完全一致**（APK ≈ 14,333,605；ZIP 随版本变化）。

**状态码判读**：

| 现象 | 含义 | 处理 |
|------|------|------|
| `404` | 该路径下文件不存在 | 把包复制进 `dist/`（本节第 1 步） |
| `403` | sharecode 失效 / 被丢 | 页面用 `location.search` 里的码；兜底常量在 `dist/index.html` 的 `SC_FALLBACK` |
| `200` 但进度条 0% | 下载器接管丢了 cookie | 页面已改为 fetch 流式 + URL 带 sharecode，仍异常则用「复制下载链接」 |

---

## 四、压缩包内容约束

`release-vX.Y.Z.zip` **只放必要产物**，不得塞入整个网页目录：

```
release-vX.Y.Z.zip
├── source/                  # 源码
│   ├── billiards-cn/src/    # 前端 TypeScript 源码
│   └── billiards-apk/       # APK 构建脚本与工程（白名单：src/res/renderstub + 构建脚本 + keystore）
├── sdk/                     # Android SDK（build-tools / platforms）
├── billiards-cn-vX.Y.Z.apk  # 已构建签名的安卓安装包（versionName/versionCode 已迭代）
├── RELEASE_NOTES.md         # 发版说明
├── PUBLISH_RULES.md         # 发布约束文件
├── BUILDING.md              # 构建指南（新环境依赖 + 构建步骤）
└── published.html           # 发布中心着陆页（= dist/index.html）
```

> 本约束文件随每次发布一并纳入压缩包，作为团队 / 后续会话的发布纪律依据。

---

## 五、每次发布后必须把在线链接发给用户（核心交付）

**用户明确要求：每次发布都要把在线链接发给他。** 这是发布的最后一步，不得省略。

- 外网发布域名与分享码见第三节（`https://a7b9dc0cd0da80587.app.workbuddy.host` / `SC=I67DJCFW6E`）。
- 交付给用户的必须是**完整链接**（含 `?sharecode=...`），因为网关只认该参数，裸域名会显示「链接不完整」：

```
https://a7b9dc0cd0da80587.app.workbuddy.host/?sharecode=I67DJCFW6E
```

- **转发截断风险**：聊天软件/剪贴板常吞掉 `?` 后的查询串。发给用户时须提醒「整条复制、勿删末尾参数」。若用户要转发给他人，附二维码图片（完整链接编码在图形里，转发图片不会被截断）：二维码生成脚本思路见 `/workspace/billiards-qr-home.png`，分享卡片页 `billiards-share-hub.html`。
- 每次发布答复中：先给出当前版本号与完整在线链接，再附 APK/ZIP 下载直链（同样带 sharecode）。
