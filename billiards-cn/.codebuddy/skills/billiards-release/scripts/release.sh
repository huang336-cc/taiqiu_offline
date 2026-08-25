#!/usr/bin/env bash
#
# billiards-release · 发版编排脚本（机械部分）
#
# 在「版本号已用 bump_version.py 迭代、源码改动已完成、npm run build 前的所有准备工作就绪」
# 之后调用，自动跑完：webpack 构建 → APK 构建 → 复制 → 内部版本校验 → 清理旧版 →
# 提交 → 生成源码包/bundle → 打包发布压缩包 →（可选）打 tag →（可选）发布在线链接。
#
# 用法：
#   bash release.sh [NEW_VERSION] [--publish] [--yes] [--tag]
#     NEW_VERSION  缺省从 dist/menu.html 的 __BILLIARDS_VERSION__ 读取
#     --publish    跑完打包后调用 publish.js 发布在线链接（默认不发布）
#     --yes        真正执行发布（与 --publish 同时才生效；否则只打印命令）
#     --tag        发布后打 git tag v<NEW_VERSION>
#
# 设计原则（见 SKILL.md / LESSONS.md）：
#   - 必须先 build-apk 再 zip（否则压缩包内 APK 是旧的）
#   - APK 内部版本由 build-apk.sh 自动同步 menu.html；aapt2 校验兜底
#   - 大体积 tar/zip/bundle 按惯例发布但不入库
#   - 发布是覆盖式、对所有拿过链接的人立即生效 → 需显式 --publish --yes 授权

set -euo pipefail

REPO="/workspace/repo/billiards-cn"
APK="/workspace/repo/billiards-apk"
ROOT="/workspace/repo"
PUBLISH_JS="/root/.codebuddy/skills/发布为应用/scripts/publish.js"
AAPT2="${ANDROID_SDK:-/opt}/build-tools/34.0.0/aapt2"
ANDROID_SDK="${ANDROID_SDK:-/opt}"

NEW=""
DO_PUBLISH=0
DO_YES=0
DO_TAG=0
for a in "$@"; do
  case "$a" in
    --publish) DO_PUBLISH=1 ;;
    --yes)     DO_YES=1 ;;
    --tag)     DO_TAG=1 ;;
    -*)        echo "未知参数: $a"; exit 1 ;;
    *)         [ -z "$NEW" ] && NEW="$a" ;;
  esac
done

# 读 NEW（menu.html 真源）
if [ -z "$NEW" ]; then
  NEW="$(grep -oE '__BILLIARDS_VERSION__\s*=\s*"[^"]+"' "$REPO/dist/menu.html" | head -1 | sed -E 's/.*"([0-9.]+).*/\1/')"
fi
[ -z "$NEW" ] && { echo "无法解析版本号，请传 NEW_VERSION 或检查 menu.html"; exit 1; }
echo "==> 发版目标版本: v$NEW"

# 探测上一个版本（用于清理旧产物）
OLD_APK="$(ls "$REPO/dist"/billiards-cn-v*.apk 2>/dev/null | grep -v "billiards-cn-v$NEW.apk" | head -1 || true)"
OLD=""
if [ -n "$OLD_APK" ]; then
  OLD="$(basename "$OLD_APK" | sed -E 's/billiards-cn-v([0-9.]+)\.apk/\1/')"
fi
echo "==> 上一个版本: ${OLD:-（无）}"

# ---------- 1. webpack 构建 ----------
echo "[1/8] webpack 构建"
( cd "$REPO" && npm run build ) || { echo "webpack 构建失败"; exit 1; }

# ---------- 2. APK 构建（内部版本自动同步 menu.html）----------
echo "[2/8] APK 构建"
( cd "$APK" && ANDROID_SDK="$ANDROID_SDK" bash build-apk.sh ) || { echo "APK 构建失败"; exit 1; }

# ---------- 3. 复制到 dist ----------
echo "[3/8] 复制 APK 到 dist"
cp "$APK/billiards-cn-v$NEW.apk" "$REPO/dist/billiards-cn-v$NEW.apk"
cp "$APK/billiards-cn-v$NEW.apk" "$REPO/dist/billiards-cn.apk"

# ---------- 4. 校验 APK 内部版本 ----------
echo "[4/8] 校验 APK 内部版本 (aapt2)"
PKG="$($AAPT2 dump badging "$REPO/dist/billiards-cn-v$NEW.apk" 2>/dev/null | grep '^package:')"
echo "    $PKG"
if ! echo "$PKG" | grep -q "versionName='$NEW'"; then
  echo "!! APK 内部 versionName 不是 $NEW，版本同步失败，停止发布"; exit 1
fi

# ---------- 5. 清理旧版产物 ----------
echo "[5/8] 清理旧版产物"
if [ -n "$OLD" ]; then
  rm -f "$REPO/dist/billiards-cn-v$OLD.apk" \
        "$REPO/dist/source-v$OLD.tar.gz" \
        "$REPO/dist/repo-v$OLD.bundle" \
        "$REPO/dist/taiqiu-v$OLD-release.zip"
  echo "    已删除 v$OLD 的旧产物"
fi

# ---------- 6. 提交（大体积产物不入库）----------
echo "[6/8] git 提交"
( cd "$ROOT" && \
  git add -u && \
  git add "$REPO/billiards-cn.apk" "$REPO/.codebuddy" "$REPO/dist/"*.md && \
  git commit -q -m "v$NEW: 发版（见 changelog）" ) || echo "    （无改动可提交或提交跳过）"

# ---------- 7. 生成源码包 + bundle（必须在 commit 之后）----------
echo "[7/8] 生成源码包 / 仓库 bundle"
( cd "$ROOT" && \
  git archive --format=tar.gz -o "$REPO/dist/source-v$NEW.tar.gz" HEAD && \
  git bundle create "$REPO/dist/repo-v$NEW.bundle" --all )
echo "    source-v$NEW.tar.gz / repo-v$NEW.bundle 已生成"

# ---------- 8. 打包发布压缩包（必须在 APK 构建之后）----------
echo "[8/8] 打包发布压缩包"
rm -f "$REPO/dist/taiqiu-v$NEW-release.zip"
( cd "$ROOT" && zip -r -q "$REPO/dist/taiqiu-v$NEW-release.zip" \
    "$REPO/dist/billiards-cn-v$NEW.apk" \
    "$REPO/dist/source-v$NEW.tar.gz" \
    "$REPO/dist/repo-v$NEW.bundle" \
    "$REPO/dist/sdk.tar.gz" \
    "$REPO/dist/MIGRATION-v1.3.10-to-v$NEW.md" \
    "$REPO/dist/GITHUB-RELEASE-NOTES-v$NEW.md" \
    "$REPO/dist/GITHUB-PUBLISH-GUIDE-v$NEW.md" )
# 校验压缩包内 APK == 当前 APK
TMP="$(mktemp -d)"
( cd "$TMP" && unzip -o -q "$REPO/dist/taiqiu-v$NEW-release.zip" "$REPO/dist/billiards-cn-v$NEW.apk" )
if ! cmp -s "$TMP/$REPO/dist/billiards-cn-v$NEW.apk" "$REPO/dist/billiards-cn-v$NEW.apk"; then
  echo "!! 压缩包内 APK 与当前 APK 不一致，停止"; rm -rf "$TMP"; exit 1
fi
rm -rf "$TMP"
echo "    taiqiu-v$NEW-release.zip 已打包并通过 APK 一致性校验"

# ---------- 可选：打 tag ----------
if [ "$DO_TAG" = "1" ]; then
  ( cd "$ROOT" && git tag -a "v$NEW" -m "v$NEW" ) && echo "==> 已打 tag v$NEW"
fi

# ---------- 可选：发布在线链接 ----------
if [ "$DO_PUBLISH" = "1" ]; then
  if [ "$DO_YES" = "1" ]; then
    echo "==> 发布在线链接（已授权）"
    node "$PUBLISH_JS" --dir "$REPO/dist" --language static
  else
    echo "==> 未加 --yes，仅打印发布命令（不实际发布）："
    echo "    node $PUBLISH_JS --dir $REPO/dist --language static"
  fi
else
  echo "==> 未指定 --publish，跳过在线发布。需要发布时加 --publish --yes"
fi

echo "发版流水线完成：v$NEW"
