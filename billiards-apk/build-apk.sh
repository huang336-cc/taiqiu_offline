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

OUT_APK="billiards-cn.apk"
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
cp -r "$WEB_DIST" assets/dist

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
mkdir -p obj/dex            # d8 要求输出目录必须已存在
javac -source 1.8 -target 1.8 -nowarn \
  -cp "$PLATFORM" -d obj \
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
echo "=== 权限检查（应为空，本应用零权限）==="
aapt2 dump badging "$OUT_APK" | grep -E "^uses-permission" || echo "  无任何权限声明 ✓"

echo
if [ "$fail" = "0" ]; then
  echo "构建完成：$(pwd)/$OUT_APK  ($(du -h "$OUT_APK" | cut -f1))"
else
  echo "构建产物存在问题，请勿分发。" >&2
  exit 1
fi
