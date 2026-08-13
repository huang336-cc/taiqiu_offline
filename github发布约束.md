# 台球大师·中文版 v1.3.2 —— GitHub 发布包（自包含）

> 本 zip 是一个**自包含发布包**。解压后所有文件都在当前目录，
> 你（Agent）只需按下面步骤在**可联网环境**执行，即可把 v1.3.2 完整发布到 GitHub。
>
> 为什么需要你来做：原开发沙箱无法直连 `github.com`（网络被墙 + GitHub 连接器未授权），
> 因此 `git push` 与创建 Release 不能在沙箱内完成，必须由你代为执行。

---

## 一、包内文件

| 文件 | 说明 |
|------|------|
| `billiards-cn-v1.3.2.apk` | 安卓安装包（versionName 1.3.2 / versionCode 26081320，零权限签名） |
| `source-v1.3.2.tar.gz` | 干净源码快照（含已构建 `dist/`），工程可迁移 |
| `sdk.tar.gz` | Android 构建工具链（aapt2/d8/zipalign/apksigner + android-34），本地重打包 APK 用 |
| `repo-v1.3.2.bundle` | **完整 git 仓库包**（含 `main` 分支与全部 tag，从 v1.0.x 到 v1.3.2）。用于把代码推到 GitHub |
| `publish-github.sh` | 一键发布脚本（Linux/macOS，需 `gh` 已登录） |
| 本文件 `github发布约束.md` | 发布说明（即你正在看的这份） |

---

## 二、前置条件（执行 Agent 必须满足）

1. 在一个**能够访问 github.com** 的环境（用户本机或任意可联网机器）操作。
2. 已安装 `git` 与 `gh`，并已 `gh auth login`，对仓库
   `https://github.com/huang336-cc/taiqiu_offline.git` 具有 **push** 权限。
3. 目标仓库当前远程 `main` 仅含到 **v1.1.14**（commit `3c028ab`）；
   本地 bundle 的 `main` 指向 `deef272`（已含 v1.1.15→v1.3.2 共 5 个提交）。

---

## 三、执行步骤

### 步骤 1：从 bundle 取得仓库并推送

```bash
# 1) 从 bundle 克隆出完整仓库（含完整历史与全部 tag）
git clone repo-v1.3.2.bundle taiqiu_offline
cd taiqiu_offline

# 2) 绑定 GitHub 远程（若已存在可跳过；确认指向目标仓库）
git remote -v | grep -q "github.com/huang336-cc/taiqiu_offline" \
  || git remote add github https://github.com/huang336-cc/taiqiu_offline.git

# 3) 推送 main（本地 deef272 是远程 3c028ab(v1.1.14) 的后代，正常推送即可）
git push github main

# 4) 推送标签 v1.3.2（如需补齐历史 tag 用 --tags）
git push github v1.3.2
```

> 若 `git push github main` 因历史不一致被拒，先确认目标仓库当前 `main` 确为 `3c028ab`；
> 仅在确认安全时使用 `git push github main --force`（会覆盖远程，谨慎）。

### 步骤 2：创建 Release 并上传附件

直接用本包内一键脚本（需 `gh` 已登录）：

```bash
# 在本 zip 解压目录执行
bash publish-github.sh "$(pwd)/taiqiu_offline" "$(pwd)"
```

或手动执行：

```bash
gh release create v1.3.2 \
  --repo huang336-cc/taiqiu_offline \
  --title "v1.3.2 同步发布" \
  --notes "台球大师·中文版 v1.3.2：网页版与 APK 版本号统一为 1.3.2；含 v1.3.1(iOS 游戏内底部操作栏避让)、v1.3.2(Android 菜单底部地址栏避让) 在线热修。" \
  billiards-cn-v1.3.2.apk \
  source-v1.3.2.tar.gz \
  sdk.tar.gz
```

不使用 `gh` 时：GitHub 网页 → 该仓库 → **Releases → Draft a new release**，
Tag 选 `v1.3.2`，标题 `v1.3.2 同步发布`，上传上述 3 个文件即可。

### 步骤 3：校验

- 仓库 `main` 含 commit `deef272`（或等价最新提交）；
- Tags 含 `v1.3.2`；
- Release `v1.3.2` 含 3 个附件（APK / 源码包 / SDK）。

---

## 四、约束与注意事项

- **不要依赖原沙箱内的 GitHub 连接器**（未授权 + 网络封锁），请在可联网环境执行。
- 资产体积：APK ≈1.8 MB、源码包 ≈6 MB、SDK ≈27 MB、bundle ≈12 MB，下载/解压注意磁盘空间。
- 版本号现状：网页版与 APK 均为 **1.3.2**（versionCode 26081320）；bundle 内 `main` 指向 `deef272`（提交信息含 v1.3.2）。
- 若目标仓库历史与预期不符（例如远程 main 已不是 `3c028ab`），**先与用户确认**再决定是否强推。
