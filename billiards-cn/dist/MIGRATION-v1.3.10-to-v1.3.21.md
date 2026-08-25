# 迁移明细：v1.3.10 → v1.3.21

> 本文档说明从 **v1.3.10** 升级到 **v1.3.21** 的全部代码改动、设计决策与验证数据，供开发者、二次开发方与想了解差异的用户参考。v1.3.10 → v1.3.19 的细粒度改动见 `MIGRATION-v1.3.10-to-v1.3.19.md`（历史归档）。本文档聚焦 **v1.3.20** 与 **v1.3.21** 两个增量版本。

---

## 元信息

| 项 | 值 |
|----|----|
| 版本跨度 | v1.3.19 → v1.3.21 |
| 发布日期 | 2026-08-24 |
| 改动类型 | 新增 6 款台球桌特效皮肤 + 外观设置合并 + 样式 bug 修复 + 版本号迭代 |

---

## 附录 A：v1.3.20 增量改动（新增 6 款台球桌皮肤）

**1 项新功能**：外观定制「台球桌皮肤」新增 6 款程序化特效皮肤：

| # | 皮肤 ID | 名称 | 效果 |
|---|---------|------|------|
| 1 | `obsidian` | 黑曜石黑 | 黑台呢 + 玻璃反光纹理 + 暗红发光桌框，神秘 |
| 2 | `lava` | 熔岩裂纹 | 黑红渐变 + 熔岩裂纹 + 橙红发光边，狂暴 |
| 3 | `neon` | 霓虹蓝紫 | 蓝紫渐变 + 霓虹光条，赛博朋克 |
| 4 | `crimsonGold` | 朱红鎏金 | 红黑 + 金色祥云纹，国风华贵 |
| 5 | `holo` | 全息银 | 银灰 + 彩虹全息膜，未来感 |
| 6 | `candy` | 粉色糖果 | 粉白渐变 + 果冻质感，可爱 |

- **新增文件** `src/view/tableskinfactory.ts`：用 Canvas 程序化生成台呢 / 桌框纹理（`getClothTexture` / `getFrameTexture`），无需外部素材。
- **`src/utils/settings.ts`**：`TABLE_SKINS` 数组扩展 6 条（cloth/cushion/frame 色 + emissive 发光 + 边缘发光特效）。
- **`src/view/assets.ts`**：`tableCustomizationFor` / `paintTable` / `recolorTable` 支持按皮肤 ID 上色并贴纹理；`refreshEdgeGlow` 用 `buildRectRing`（BufferGeometry 矩形环）绘制纯装饰发光边。
- **约束**：仅改台呢 / 桌框 / 纹理 / 边缘发光，不改动球杆、球模型与任何物理。

---

## 附录 B：v1.3.21 增量改动（外观设置合并 + 末行卡片修复 + 版本号）

**2 项优化**：

1. **「台球桌颜色」(5 款经典原木配色) 与「台球桌皮肤」(6 款特效皮肤) 合并为单一「台球桌外观」设置**
   - `src/utils/settings.ts`：`TABLE_SKINS` 由原本 6 条扩展为 11 条，原 5 款经典配色（`classic` / `emerald` / `crimson` / `sapphire` / `golden`，`clothTexture:"none"`、无发光）prepend 到特效皮肤之前；默认 `tableSkin` 改为 `"classic"`。
   - `dist/menu.html`：`screen-tableskin` 由 6 卡改为 11 卡（`#tableSkinCards .skin-card`，含 `data-c1`/`data-c2` 双色样本）；主菜单外观定制仅保留一行「台球桌外观」（`data-target="tableskin"`）。
   - `dist/menu-cn.js`：`initTableAppearances()` 统一处理 11 卡；`NAME_OF.tableskin()` 全量映射 11 个 ID；设置面板 `<select id="setTableSkin">` 含全部 11 项。
   - `src/view/cuemesh.ts`：球杆 `auto` 主题改为跟随当前台球桌外观的台呢色（杆身 `shade(+0.12)` / 杆尾 `shade(-0.28)`），切换台面即时联动球杆配色。

2. **修复外观卡片最后一行孤卡被拉伸到整行宽度**
   - 根因：`.skin-card { flex: 1 1 calc(20% - 7px); }` 五列布局，11 卡排成 5+5+1，末行孤卡因 `flex-grow:1` 撑满整行。
   - 修复：`dist/css/menu-cn.css` 增加 `max-width: calc(20% - 7px)` 上限，孤卡保持与其他卡等宽、右侧留白。

3. **版本号迭代**
   - `dist/menu.html`：`window.__BILLIARDS_VERSION__ = "1.3.21-2608241747"`。
   - `dist/index.html`：标题 / ver / 资源包链接 / 版本信息全部由 `v1.3.19` 改为 `v1.3.21`，追加 v1.3.20 + v1.3.21 变更履历。

---

## 验证摘要

- Webpack 构建通过（`npm run build`），产物 `dist/index.js` 429 KiB。
- APK 重签打包通过（1.8MB，零权限，resources.arsc Stored，4 字节对齐，签名有效）。
- 菜单 11 张卡片布局验证：末行孤卡不再拉伸（Playwright Chromium 加载 + 卡片宽度断言）。
- 变更履历顶部新增 v1.3.20 / v1.3.21 条目，`__BILLIARDS_VERSION__` 显示 v1.3.21。

---

## 升级指引

1. 拉取代码至 `v1.3.21` tag。
2. `cd billiards-cn && npm run build`。
3. `cd ../billiards-apk && ANDROID_SDK=/opt bash build-apk.sh` 重新打包 APK。
4. `dist/billiards-cn.apk` 即 v1.3.21 安装包；`dist/taiqiu-v1.3.21-release.zip` 为完整资源包。
