# Release Notes · v1.3.22

**奥特曼的台球 · 离线版 v1.3.22 · 2026-08-25 14:30:00**

> 英文版未翻译文案批量补全（i18n.ts 升级为双语运行时 + 4 款新球杆 + 6 款新桌布 + in-game 帮助页 + 主菜单操作介绍 + SVG 标签补全 EN）。

---

## 变更亮点

### 🔤 英文版文案全面覆盖

- **`i18n.ts` 升级为双语运行时**：原 `T` 单语表改为 `STRINGS` 双语表 + `t(key)` 函数，按 `Settings.get().language` 实时取值。所有渲染文案（击球 / 摆球 / 犯规 / 球局结束 / 你赢了 / 你输了 / 继续 / 摆白球 / 摆黄球 / 摆红球 / 对战电脑 / 自由练习）随设置即时切换。
- **4 款新球杆主题补 EN 名**：奥特曼 → **Ultraman** / 霓虹脉冲 → **Neon Pulse** / 青竹 → **Bamboo** / 墨玉 → **Black Jade**。
- **6 款新桌布补 EN 名**：黑曜石黑 / 熔岩裂纹 / 霓虹蓝紫 / 朱红鎏金 / 全息银 / 粉色糖果 → **Obsidian Black / Lava Cracks / Neon Blue-Purple / Crimson Gold / Holographic Silver / Pink Candy**。
- **in-game 帮助页（help.html）区块补全**：Touch controls / Power & Stroke / Camera 区块被 `<b>` 拆分的文本节点（左右拖动 / 上下拖动 / 双指捏合 / 击球按钮 / 力度条 / 母球图示 / 「+」按钮 / 复位按钮 / 细微瞄准条 / 视角 / 力度≈60%）逐段加 EN。
- **主菜单操作介绍 + 关于 区块补全**：基本操作 / 加塞与杆法 / 摆球 / 视角切换 / 小技巧 / 关于 等区块的所有 `<b>` 片段与表格表头（开发者 / 版本 / 协议 / 项目源码 / 上游项目）逐段加 EN。
- **SVG 圆盘标签**：高杆 / 低杆 / 左塞 / 右塞 与示意图「力度 ≈ 60%」同步补 EN（高杆→Follow、低杆→Draw、左塞→Left、右塞→Right）。

### 仅文案层改造

未改动任何物理 / 渲染 / 布局。模型、贴图、动画、特效完全保持 v1.3.21 一致。

---

## 下载资源

| 资源 | 说明 | 大小 |
|------|------|------|
| `billiards-cn-v1.3.22.apk` | 安卓安装包（1.8MB，零权限，Android 7.0+） | 1.8 MB |
| `billiards-cn.apk` | 同内容便捷副本（短链接名） | 1.8 MB |
| `taiqiu-v1.3.22-release.zip` | 完整资源包（含 APK + 仓库 bundle + SDK + 源码包 + 迁移明细 + 发布说明 + GitHub 发布指南） | ~136 MB |
| `MIGRATION-v1.3.10-to-v1.3.22.md` | 升级路径与改动明细 | 几 KB |
| `GITHUB-RELEASE-NOTES-v1.3.22.md` | 本发布说明 | 几 KB |
| `GITHUB-PUBLISH-GUIDE-v1.3.22.md` | GitHub 发布流程指南 | 几 KB |

---

## 验证

- ✅ `dist/index.js` webpack 编译通过（430 KiB）
- ✅ `grep -r "T\\.\\w\\+" src/` 计数 0（所有 `T.xxx` 已迁移）
- ✅ `grep -r "refreshEdgeGlow\\|buildRectRing" src/` 计数 0（v1.3.21 删除项未回退）
- ✅ APK 重签通过（1.8MB，零权限，签名有效）
- ✅ 在线链接 `verified: true`

---

## 升级指引

- 老版本覆盖安装即可，**无需清数据**；语言、画质、音量、键位、皮肤选择等全部保留。
- 进游戏前可先在「设置 → 语言」切到 English，验证 i18n 是否生效。
- 如发现未翻译的英文残留，欢迎在 GitHub Issues 反馈（附截图）。

---

## 反馈

- Issues：<https://github.com/huang336-cc/taiqiu_offline/issues>
- 项目：<https://github.com/huang336-cc/taiqiu_offline>
- 上游：<https://github.com/tailuge/billiards>
- 协议：GNU GPL v3.0