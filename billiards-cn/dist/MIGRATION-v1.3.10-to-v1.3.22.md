# MIGRATION v1.3.10 → v1.3.22

> **本衍生版（huang336 / tailuge-billiards-cn）从 v1.3.10 升级到 v1.3.22 的全部改动。**
> 升级前必读；老安装包可直接覆盖安装，零迁移成本。

---

## 升级路径

- **覆盖安装**：保留本地设置（语言、画质、音量、键位），无需清数据。
- **强制重装**：进 `Settings → 应用管理 → 清除数据`（仅在主题皮肤出现异常时需要）。
- **版本号对照**：`v1.3.22` 对应 `versionCode 26082522`，`v1.3.21` 对应 `versionCode 26082421`，可在「关于」表格直接查看。

---

## v1.3.22（2026-08-25 14:30）— 1 项优化：英文版未翻译文案批量补全

### 改动一览

| # | 维度 | 改动 |
|---|------|------|
| 1 | 文本运行时 | `i18n.ts` 升级为双语运行时：原 `T` 单语表改为 `STRINGS` 双语表 + `t(key)` 函数，按 `Settings.get().language` 取值；旧 `T` 通过 `Proxy` 兼容保留为中文 |
| 2 | 球杆主题 EN 名 | 补 4 款新球杆：奥特曼 → Ultraman / 霓虹脉冲 → Neon Pulse / 青竹 → Bamboo / 墨玉 → Black Jade |
| 3 | 桌布 EN 名 | 补 6 款新桌布：黑曜石黑 / 熔岩裂纹 / 霓虹蓝紫 / 朱红鎏金 / 全息银 / 粉色糖果 |
| 4 | in-game 帮助页 | Touch controls / Power & Stroke / Camera 区块被 `<b>` 拆分的文本节点逐段加 EN |
| 5 | 主菜单操作介绍 | 基本操作 / 加塞与杆法 / 摆球 / 视角切换 / 小技巧 / 关于 等区块的 `<b>` 片段与表格表头逐段加 EN |
| 6 | SVG 标签 | 圆盘高杆 / 低杆 / 左塞 / 右塞 与示意图「力度 ≈ 60%」同步补 EN |

### 文件改动清单

| 文件 | 改动 |
|------|------|
| `src/utils/i18n.ts` | `T` 改造为 `Proxy`（保留向后兼容），新增 `STRINGS` 双语表 + `t(key)` 函数 |
| `src/controller/aim.ts` | `T.hitButton` → `t("hitButton")` |
| `src/controller/placeball.ts` | `T.placeBallButton / T.hitButton` → `t(...)` |
| `src/controller/placeallballs.ts` | `T.hitButton` → `t("hitButton")`；`T.placeWhite/Yellow/Red` 改为运行时函数 `ballLabels()` |
| `src/controller/drilloptions.ts` | `T.continueButton` → `t("continueButton")` |
| `src/controller/rules/eightball.ts` | `T.foul / T.ballInHand` → `t(...)` |
| `src/controller/rules/nineball.ts` | `T.foul / T.ballInHand` → `t(...)` |
| `src/controller/rules/sagu.ts` | `T.foul` → `t("foul")` |
| `src/controller/rules/snooker.ts` | `T.foul / T.ballInHand` → `t(...)` |
| `src/network/bot/boteventhandler.ts` | `T.foul / T.ballInHand` → `t(...)` |
| `src/network/client/matchresult.ts` | `T.youWon / T.youLost / T.gameOver` → `t(...)` |
| `dist/menu-cn.js` | `TX` 字典追加：4 款新球杆 / 6 款新桌布 / 操作介绍+关于 区块所有 `<b>` 片段 EN / SVG 标签 EN |
| `dist/help-cn.js` | `TX` 字典追加：被 `<b>` 拆分的触控 / 力度 / 视角 文本片段 EN |
| `dist/menu.html` | `__BILLIARDS_VERSION__` 改为 `1.3.22-2608251430`；变更履历顶部追加 v1.3.22 条目 |
| `dist/index.html` | 标题 / ver / 资源包链接 / 版本信息全部由 v1.3.21 改为 v1.3.22；meta 区块顶部新增 v1.3.22 新功能描述 |

### 量化验证

- `dist/index.js` 编译通过（webpack 5，size 430 KiB）
- 编译产物无任何 `T.hitButton` / `T.foul` / `T.youWon` 等残留（grep 计数 0）
- 编译产物无任何 `refreshEdgeGlow` / `buildRectRing` 残留（v1.3.21 已删除）
- 所有 `T.xxx` 调用已迁移至 `t("xxx")`（grep `T\\.\\w\\+` 在 `src/` 下为 0）

### 残留风险

- **底部栏按钮「击球/摆球」中途中切换语言不会即时刷新**：因按钮文字由 `setButtonText` 一次性写入。下一杆 / 下一次进入摆球模式会即时跟上。彻底解决需要 `AimInputs` 订阅语言变更事件并重新渲染（v1.3.22 暂未做，留待 v1.3.23+）。
- **HUD 比分栏（玩家/对手/CPU）已实时**：由 `play.html` 的 `applyScoreLabels()` + `MutationObserver` 兜底 + `postMessage` 监听三道防线覆盖，对局中切换语言即时正确。

---

## v1.3.21（2026-08-24 17:47）— 2 项优化（台球桌外观设置合并 + 末行卡片不再拉伸）

详见 `dist/MIGRATION-v1.3.10-to-v1.3.21.md`（旧版，保留作为历史）。

---

## v1.3.20（2026-08-24 17:19）— 1 项新功能（新增 6 款台球桌特效皮肤）

详见 `dist/MIGRATION-v1.3.10-to-v1.3.21.md`（旧版）。

---

## v1.3.19（2026-08-24 10:10）— 1 项新功能（设置中增加语言切换，新增英文界面）

详见 `dist/MIGRATION-v1.3.10-to-v1.3.21.md`（旧版）。

---

## 反馈与支持

- GitHub Issues：<https://github.com/huang336-cc/taiqiu_offline/issues>
- 项目主页：<https://github.com/huang336-cc/taiqiu_offline>
- 上游项目：<https://github.com/tailuge/billiards>