# 台球游戏 billiards-cn v1.3.0 同步发布

## 版本说明
- 版本号统一为 **1.3.0**，本地(APK)、在线版、源码版本一致。
- 本仓库已包含 v1.2.26–v1.2.34 的累计修复（瞄准视角被击球可见性、iOS 菜单底部工具栏遮挡避让等）。
- 后续在线热修：v1.3.1 补全游戏页 `visualViewport` 适配，解决 iOS Safari 游戏内底部操作栏仍被遮挡；v1.3.2 给菜单页增加 Android Chrome 底部地址栏兜底避让，确保“开始游戏”等按钮不被浏览器地址栏压住。APK 仍为 v1.3.0，无需重发。

## 下载 / 迁移
- `billiards-cn-v1.3.0.apk`：零权限安卓安装包。
- `source-v1.3.0.tar.gz`：完整源码（含已构建 dist/），解压后 `npm install && npm run build` 可复现。
- `sdk.tar.gz`：Android 构建工具链，用于本地重新打包 APK。

## 校验
- APK versionName=1.3.0 / versionCode=26081240
- 仓库主分支最新提交包含 v1.3.0 版本统一改动
