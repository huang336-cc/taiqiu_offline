# GitHub 发布操作指南（给执行 agent）

> 本文件是给**另一个 agent** 的指令，教它如何把「奥特曼的台球」v1.3.16 发布到 GitHub。
> 照步骤执行即可；如环境与本指南不同，按「注意事项」调整。

---

## 0. 目标

| 项 | 值 |
|----|----|
| 目标仓库 | `https://github.com/huang336-cc/taiqiu_offline.git` |
| 分支 | `main` |
| Release tag | `v1.3.16`（本地已打，需推到远程） |
| Release 标题 | `奥特曼的台球 v1.3.16` |
| 发布说明 | 见本目录 `GITHUB-RELEASE-NOTES-v1.3.16.md` |
| 迁移明细 | 见本目录 `MIGRATION-v1.3.10-to-v1.3.16.md` |
| 本地仓库 | `/workspace/repo`（main 分支，已含 v1.3.16 提交） |
| 本地资源目录 | `/workspace/release-v1.3.16-all`（含 apk / zip / 各 md） |

---

## 1. 前置条件（先自检）

```bash
git --version && gh --version
gh auth status        # 应已登录；否则 gh auth login 或设 GH_TOKEN
cd /workspace/repo && git remote -v   # 确认 origin = huang336-cc/taiqiu_offline
git tag | grep v1.3.16                # 确认本地存在 v1.3.16
```

- 若 `gh` 未登录：用 `export GH_TOKEN=<具有 repo 写权限的 token>` 代替交互登录。
- 若本地无 tag：先 `git tag v1.3.16` 再继续。

---

## 2. 推送代码与 tag 到 GitHub

```bash
cd /workspace/repo
git push origin main
git push origin v1.3.16
```

> 若远程已存在同名 tag / Release，需先 `gh release delete v1.3.16 --repo huang336-cc/taiqiu_offline -y` 并 `git push origin :v1.3.16`（删远程 tag）后再重建。

---

## 3. 准备 Release 附件

附件来源有两种方式，**任选其一**：

### 方式 A（推荐，最简单）—— 直接解压现成资源包

```bash
cd /workspace/release-v1.3.16-all
mkdir -p /tmp/gh-assets
unzip -o taiqiu-v1.3.16-release.zip -d /tmp/gh-assets
```

解压后 `/tmp/gh-assets` 内含 7 个文件：
- `billiards-cn-v1.3.16.apk`
- `repo-v1.3.16.bundle`
- `sdk.tar.gz`
- `source-v1.3.16.tar.gz`
- `MIGRATION-v1.3.10-to-v1.3.16.md`
- `GITHUB-RELEASE-NOTES-v1.3.16.md`
- `GITHUB-PUBLISH-GUIDE.md`（本指南自身）

### 方式 B（从源码重新生成，若 zip 不可用）

```bash
cd /workspace/repo
git archive --format=tar.gz -o /tmp/gh-assets/source-v1.3.16.tar.gz v1.3.16
git bundle create /tmp/gh-assets/repo-v1.3.16.bundle v1.3.16
cd /tmp/sdk && tar czf /tmp/gh-assets/sdk.tar.gz .
# apk 与 md 直接复制：
cp /workspace/release-v1.3.16-all/billiards-cn-v1.3.16.apk /tmp/gh-assets/
cp /workspace/release-v1.3.16-all/MIGRATION-v1.3.10-to-v1.3.16.md /tmp/gh-assets/
cp /workspace/release-v1.3.16-all/GITHUB-RELEASE-NOTES-v1.3.16.md /tmp/gh-assets/
cp /workspace/release-v1.3.16-all/GITHUB-PUBLISH-GUIDE.md /tmp/gh-assets/
```

---

## 4. 创建 Release 并上传附件

```bash
cd /workspace/release-v1.3.16-all
gh release create v1.3.16 \
  --repo huang336-cc/taiqiu_offline \
  --title "奥特曼的台球 v1.3.16" \
  --notes-file GITHUB-RELEASE-NOTES-v1.3.16.md \
  billiards-cn-v1.3.16.apk \
  MIGRATION-v1.3.10-to-v1.3.16.md \
  GITHUB-RELEASE-NOTES-v1.3.16.md \
  GITHUB-PUBLISH-GUIDE.md \
  /tmp/gh-assets/repo-v1.3.16.bundle \
  /tmp/gh-assets/sdk.tar.gz \
  /tmp/gh-assets/source-v1.3.16.tar.gz
```

说明：
- `--notes-file` 直接复用本目录的发布说明，无需手写。
- **至少上传** APK + 两个 md；`bundle` / `sdk` / `source` 可选但建议带上，方便开发者本机构建。
- GitHub 会自动生成 `Source code (zip)` 与 `Source code (tar.gz)` 整仓快照，**无需**手传整仓源码包。

---

## 5. 校验

```bash
gh release view v1.3.16 --repo huang336-cc/taiqiu_offline
# 确认：tag 对应 v1.3.16、assets 列表齐全、notes 正常渲染
gh release list --repo huang336-cc/taiqiu_offline | head
```

---

## 6. 注意事项

- **tag 必须已存在**（本地 `v1.3.16` 已打）；Release 不能凭空建在无 tag 的提交上。
- **大文件体积**：`sdk.tar.gz` ≈27MB、`source-v1.3.16.tar.gz` ≈160MB、`repo-v1.3.16.bundle` ≈54MB，上传较慢，但 GitHub 单文件上限 2GB，可正常传。
- **APK 零权限**：`billiards-cn-v1.3.16.apk` 为 v2/v3 签名、零权限声明，无需额外说明。
- **versionCode 单调递增**：当前 `26082211`（=YYMMDDNN）；下次发版必须用更大的 versionCode，否则安装会拒。
- **网络/权限**：若 `gh` 报 4xx，多为 token 缺 `repo` 权限或仓库名拼写错误；检查后重试，不要换策略静默降级。
- **幂等**：重复执行 `gh release create` 同名会报错；需先删旧 Release 与远程 tag（见第 2 步备注）。

---

## 7. 版本信息

- versionName：**1.3.11**
- versionCode：**26082211**
- git tag：**v1.3.16**
- 发布日期：2026-08-22
