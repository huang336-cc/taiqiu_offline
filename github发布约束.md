# GitHub 发布约束说明（供其他 Agent 执行）

> 本文件用于指导**另一个运行在可联网环境的 Agent** 把本工程发布到 GitHub。
> 当前 CodeBuddy 沙箱**无法直连 github.com**（网络被墙 + GitHub 连接器未授权），
> 因此推送与创建 Release 不能在此沙箱内完成，必须由你（或你的宿主环境）代为执行。

---

## 一、为什么需要这份文档

- 工程在沙箱中开发，沙箱到 `github.com` 的 TLS 握手被掐断、且无可用出网代理；
  GitHub 连接器也未授权，故 **`git push` / 建 Release 在沙箱内做不了**。
- 所有交付物（代码、APK、源码包、Android SDK、完整 git 仓库包）已经备好，
  并由沙箱发布到**在线网页**供下载。
- 目标仓库 `https://github.com/huang336-cc/taiqiu_offline.git`
  当前远程 `main` 仅含到 **v1.1.14**（commit `3c028ab`）。
  本地已领先多个提交：**v1.1.15 → v1.2.11 → v1.3.0 → v1.3.1 → v1.3.2**。

---

## 二、前置条件（执行 Agent 必须满足）

1. 在一个**能够访问 github.com** 的环境（用户本机或任意可联网机器）操作。
2. 已安装 `git`，并已完成 `gh auth login`，对 `huang336-cc/taiqiu_offline`
   仓库具有 **push** 权限（或走 GitHub 网页手动发布）。
3. 已从下方"在线发布网页"下载所需的发布物（见第三节清单）。

---

## 三、文件清单（均来自在线发布网页 `/release/` 路径）

| 文件 | 用途 |
|------|------|
| `repo-v1.3.2.bundle` | **完整 git 仓库包**（含 `main` 分支与全部 tag，从 v1.0.x 到 v1.3.2）。用于对 GitHub 推送代码与标签，绕过"沙箱推不了"的限制 |
| `billiards-cn-v1.3.2.apk` | 安卓安装包（versionName=1.3.2，versionCode=26081320，零权限签名） |
| `source-v1.3.2.tar.gz` | 干净源码快照（含已构建 `dist/`），352 文件，工程可迁移 |
| `sdk.tar.gz` | Android 构建工具链（aapt2/d8/zipalign/apksigner + android-34），本地重打包 APK 用 |
| `github发布约束.md` | 本文件 |

在线发布网页地址（沙箱发布，稳定链接）：
`https://a8bf01e5f1e8b47ce.bj9.agentos-app.net`
发布物位于该域名下的 `/release/` 路径（例如 `/release/billiards-cn-v1.3.2.apk`）。

---

## 四、执行步骤

### 步骤 1：从 bundle 取得仓库并推送到 GitHub

```bash
# 1) 从 bundle 克隆出完整仓库（bundle 内含完整历史与全部 tag）
git clone repo-v1.3.2.bundle taiqiu_offline
cd taiqiu_offline

# 2) 绑定 GitHub 远程（若已存在可跳过；确认指向目标仓库）
git remote -v | grep -q "github.com/huang336-cc/taiqiu_offline" \
  || git remote add github https://github.com/huang336-cc/taiqiu_offline.git

# 3) 推送 main（本地 deef272 是远程 3c028ab(v1.1.14) 的直接后代，正常推送即可）
git push github main

# 4) 推送标签（至少推送 v1.3.2；如需补齐历史 tag 用 --tags）
git push github v1.3.2
```

> 备注：bundle 内含 `refs/remotes/origin/main`（= `3c028ab` v1.1.14）。
> 克隆后本地 `main` 指向 `deef272`。
> 若 `git push github main` 因历史不一致被拒，先确认目标仓库当前 `main` 确为 `3c028ab`；
> 仅在确认安全时使用 `git push github main --force`（会覆盖远程，谨慎）。

### 步骤 2：创建 Release 并上传资产

```bash
# 在任意目录执行，确保 3 个资产文件在本机可达
gh release create v1.3.2 \
  --repo huang336-cc/taiqiu_offline \
  --title "v1.3.2 同步发布" \
  --notes "台球大师·中文版 v1.3.2：网页版与 APK 版本号统一为 1.3.2；含 v1.3.1(iOS 游戏内底部操作栏避让)、v1.3.2(Android 菜单底部地址栏避让) 在线热修。" \
  /本机路径/billiards-cn-v1.3.2.apk \
  /本机路径/source-v1.3.2.tar.gz \
  /本机路径/sdk.tar.gz
```

- 不使用 `gh` 时：GitHub 网页 → 该仓库 → **Releases → Draft a new release**，
  Tag 选 `v1.3.2`，标题 `v1.3.2 同步发布`，上传上述 3 个文件即可。
- 校验标准：
  - 仓库 `main` 含 commit `deef272`；
  - Tags 含 `v1.3.2`；
  - Release `v1.3.2` 含 3 个附件（APK / 源码包 / SDK）。

---

## 五、约束与注意事项

- **不要依赖沙箱内的 GitHub 连接器**（未授权 + 网络封锁），请在可联网环境执行上述步骤。
- 在线发布网页由沙箱发布，发布物位于 `/release/` 路径；网页版游戏本身仍照常可玩。
- 资产体积：APK ≈1.8 MB、源码包 ≈6 MB、SDK ≈27 MB、bundle ≈12 MB，下载注意网络。
- 版本号现状：**网页版与 APK 均为 1.3.2**（versionCode 26081320）；本地 tag `v1.3.2` 指向 `deef272`。
- 若目标仓库历史与预期不符（例如远程 main 已不是 `3c028ab`），**先与用户确认**再决定强推。
