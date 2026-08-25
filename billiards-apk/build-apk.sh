#!/usr/bin/env bash
#
# 台球大师·中文离线版 —— 安卓 APK 构建脚本
#
# 不依赖 Gradle，直接调用 Android SDK 底层工具链（aapt2 / javac / d8 / zipalign / apksigner）。
# 用法：
#   export ANDROID_SDK=/path/to/android-sdk
#   ./build-apk.sh
#
# 前置条件：
#   1. 已安装 Android SDK 的 platforms/android-34 与 build-tools/34.0.0
#   2. 已安装 JDK 17（或 11）
#   3. 已完成前端构建，即 ../billiards-cn/dist/ 存在
#
set -euo pipefail

cd "$(dirname "$0")"

ANDROID_SDK="${ANDROID_SDK:-$HOME/android-sdk}"
BUILD_TOOLS="$ANDROID_SDK/build-tools/34.0.0"
PLATFORM="$ANDROID_SDK/platforms/android-34/android.jar"
PKG_PATH="com/tailuge/billiards/cn"
WEB_DIST="../billiards-cn/dist"

# 从前端产物读取版本号（dist/menu.html 的 __BILLIARDS_VERSION__，形如 1.3.21-2608241747），
# 截掉时间戳后缀得到 1.3.21，输出带版本号的 APK 文件名（如 billiards-cn-v1.3.21.apk）。
VERSION_RAW="$(grep -oE '__BILLIARDS_VERSION__\s*=\s*"[^"]+"' "$WEB_DIST/menu.html" 2>/dev/null | head -1 | sed -E 's/.*"([^"]+)".*/\1/')"
VERSION="${VERSION_RAW%%-*}"
if [ -z "$VERSION" ]; then
  echo "警告：未能从 $WEB_DIST/menu.html 解析版本号，回退使用 billiards-cn.apk"
  OUT_APK="billiards-cn.apk"
else
  OUT_APK="billiards-cn-v${VERSION}.apk"
fi
KEYSTORE="${KEYSTORE:-release.keystore}"
KS_PASS="${KS_PASS:-android}"

# ---------- 环境检查 ----------
[ -d "$BUILD_TOOLS" ] || { echo "找不到 build-tools/34.0.0：$BUILD_TOOLS"; exit 1; }
[ -f "$PLATFORM" ]    || { echo "找不到 android.jar：$PLATFORM"; exit 1; }
[ -d "$WEB_DIST" ]    || { echo "找不到前端产物：$WEB_DIST（请先在 billiards-cn 下执行 webpack）"; exit 1; }
export PATH="$BUILD_TOOLS:$PATH"

# ---------- 0. 清理 ----------
rm -rf compiled obj apk_content assets base.apk unsigned.apk aligned.apk "$OUT_APK"
mkdir -p compiled obj assets

# ---------- 1. 把网页产物塞进 assets ----------
echo "[1/6] 打包网页资源到 assets/dist"
mkdir -p assets/dist
cp -r "$WEB_DIST"/. assets/dist/
# 不要把下载用的 APK 安装包打进 app 的 assets（否则每次构建都会把 dist 里
# 的历史 .apk 一起塞进安装包，体积翻倍且无意义）。
rm -f assets/dist/*.apk
# 同样不要把「发布资产包」打进 app：dist 目录偶尔会残留给 GitHub 出的
# 单一 zip 发布包（如 taiqiu-vX.Y.Z-release.zip），内含 sdk.tar.gz、
# 仓库 bundle、源码等，单包可超 40MB——不排掉会把 APK 撑到 40+MB。
# （v1.3.4 就因漏排此项导致 APK 从 1.8MB 暴涨到 46MB）
rm -f assets/dist/*.zip assets/dist/*.tar.gz assets/dist/*.tar assets/dist/*.bundle

# 兜底：overlayfs 下新建/截断大文件偶发读到 0 字节或截断（导致装到真机黑屏）。
# 关键 JS 用 cp -f 覆盖（复用已有 inode，比 rm+cat 新建更稳），
# 并以字节数校验 + 重试，确保落盘完整。
for f in index.js three_module.js three_core.js three_examples.js; do
  src="$WEB_DIST/$f"
  dst="assets/dist/$f"
  want=$(stat -c %s "$src" 2>/dev/null || echo 0)
  for attempt in 1 2 3 4 5 6; do
    cp -f "$src" "$dst"
    sync
    got=$(stat -c %s "$dst" 2>/dev/null || echo -1)
    if [ "$got" = "$want" ] && [ "$want" -gt 0 ]; then
      break
    fi
    echo "  重拷 $f 校验不符 ($got/$want) 重试[$attempt]"
    sleep 0.3
  done
  got=$(stat -c %s "$dst" 2>/dev/null || echo -1)
  if [ "$got" != "$want" ] || [ "$want" -le 0 ]; then
    echo "!! 关键 JS 复制失败：$f ($got/$want)"
    exit 1
  fi
done
sync

# ---------- 2. 编译资源 ----------
echo "[2/6] aapt2 compile"
aapt2 compile -o compiled/ res/values/strings.xml
for d in res/mipmap-*; do
  aapt2 compile -o compiled/ "$d"/ic_launcher.png
done

# ---------- 3. 链接资源 ----------
# 注意：必须显式传 --min-sdk-version / --target-sdk-version，
# 否则 aapt2 会按旧版兼容规则隐式追加 WRITE_EXTERNAL_STORAGE、READ_PHONE_STATE 等权限。
echo "[3/6] aapt2 link"
aapt2 link -o base.apk \
  -I "$PLATFORM" \
  --manifest AndroidManifest.xml \
  --min-sdk-version 21 \
  --target-sdk-version 34 \
  --java src/ \
  compiled/*.flat

# ---------- 4. 编译 Java 并转 dex ----------
echo "[4/6] javac + d8"

# 编译期 stub：本机 android-34.jar 缺 RenderProcessGoneDetail 类定义，
# 但设备运行时（Android 16）框架自带。这里临时造一个只占位的 .jar 供 javac 解析符号，
# 它不传给 d8，因此不会进最终 dex，运行时由设备框架的真实类接管，零冲突。
if [ ! -f renderstub.jar ]; then
  ( cd renderstub && jar cf ../renderstub.jar android ) 2>/dev/null \
    || jar cf renderstub.jar -C renderstub android
fi
mkdir -p obj/dex            # d8 要求输出目录必须已存在
javac -source 1.8 -target 1.8 -nowarn \
  -cp "$PLATFORM:renderstub.jar" -d obj \
  src/$PKG_PATH/*.java
d8 --release --lib "$PLATFORM" --output obj/dex obj/$PKG_PATH/*.class

# ---------- 5. 组包 ----------
echo "[5/6] 组装 APK"
mkdir -p apk_content
cd apk_content
unzip -oq ../base.apk
cp ../obj/dex/classes.dex .
cp -r ../assets .

# 关键：从 Android 11（API 30）起，resources.arsc 必须以 STORED（不压缩）方式存放
# 且 4 字节对齐，否则安装时报 INSTALL_PARSE_FAILED_RESOURCES_ARSC_COMPRESSED（错误码 -124）。
# zipalign 只做对齐、不会解压，救不回来，所以必须在打包这一步就分开处理。
zip -qr ../unsigned.apk . -x 'resources.arsc' -x '.*'   # 其余文件正常压缩
zip -q -Z store ../unsigned.apk resources.arsc          # resources.arsc 不压缩
cd ..

# ---------- 6. 对齐与签名 ----------
echo "[6/6] zipalign + apksigner"
if [ ! -f "$KEYSTORE" ]; then
  echo "  未找到 $KEYSTORE，自动生成一个自签名调试密钥…"
  keytool -genkeypair -v -keystore "$KEYSTORE" \
    -alias billiards -keyalg RSA -keysize 2048 -validity 10000 \
    -storepass "$KS_PASS" -keypass "$KS_PASS" \
    -dname "CN=Billiards CN, OU=Offline, O=Community, L=-, ST=-, C=CN"
fi

zipalign -f -p 4 unsigned.apk aligned.apk
apksigner sign \
  --ks "$KEYSTORE" --ks-pass "pass:$KS_PASS" --key-pass "pass:$KS_PASS" \
  --min-sdk-version 21 \
  --out "$OUT_APK" aligned.apk

# ---------- 校验 ----------
fail=0

echo
echo "=== resources.arsc 必须未压缩（否则安装报 -124）==="
method=$(unzip -v "$OUT_APK" | awk '$NF=="resources.arsc"{print $2}')
if [ "$method" = "Stored" ]; then
  echo "  Stored ✓"
else
  echo "  $method ✗ —— 该包在 Android 11+ 上无法安装"; fail=1
fi

echo
echo "=== 对齐校验 ==="
if zipalign -c -v 4 "$OUT_APK" >/dev/null 2>&1; then
  echo "  4 字节对齐 ✓"
else
  echo "  对齐失败 ✗"; fail=1
fi

echo
echo "=== 签名校验 ==="
apksigner verify --print-certs "$OUT_APK" | head -5

echo
echo "=== 权限检查（应为零权限，不声明任何敏感权限）==="
if aapt2 dump badging "$OUT_APK" | grep -qE "^uses-permission"; then
  echo "  错误：存在非预期权限声明 ✗"
  fail=1
else
  echo "  零权限 ✓"
fi

echo
if [ "$fail" = "0" ]; then
  echo "构建完成：$(pwd)/$OUT_APK  ($(du -h "$OUT_APK" | cut -f1))"
else
  echo "构建产物存在问题，请勿分发。" >&2
  exit 1
fi
