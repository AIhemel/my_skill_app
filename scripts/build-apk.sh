#!/usr/bin/env bash
# Builds dist/SkillBoost.apk without Gradle or the full Android SDK.
#
# Needs (Ubuntu/Debian):  sudo apt-get install aapt apksigner zipalign dalvik-exchange zip openjdk-17-jdk
# and an Android platform jar (API 34), e.g.
#   curl -o /opt/android-platform/android-34.jar \
#     https://raw.githubusercontent.com/Sable/android-platforms/master/android-34/android.jar
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ANDROID_JAR="${ANDROID_JAR:-/opt/android-platform/android-34.jar}"
VERSION_NAME="$(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' "$ROOT/web/version.json")"
VERSION_CODE="$(sed -n 's/.*"code": *\([0-9]*\).*/\1/p' "$ROOT/web/version.json")"
# Signing key: kept out of git (see .gitignore). Updates must be signed with the same key.
KEYSTORE="${KEYSTORE:-$ROOT/android/skillboost.keystore}"
: "${KEYSTORE_PASS:?Set KEYSTORE_PASS to the signing key password (a new key is created on the first build)}"
export KEYSTORE_PASS
OUT="$ROOT/build/apk"
DIST="$ROOT/dist"

[ -f "$ANDROID_JAR" ] || { echo "Missing $ANDROID_JAR (set ANDROID_JAR)"; exit 1; }
for tool in aapt2 javac dalvik-exchange zipalign apksigner zip; do
  command -v "$tool" >/dev/null || { echo "Missing tool: $tool"; exit 1; }
done

rm -rf "$OUT"
mkdir -p "$OUT/compiled" "$OUT/gen" "$OUT/classes" "$OUT/assets/www" "$DIST"

echo "==> Copying web app into assets"
cp -r "$ROOT/web/." "$OUT/assets/www/"

echo "==> Compiling resources"
aapt2 compile --dir "$ROOT/android/res" -o "$OUT/compiled/res.zip"
aapt2 link -o "$OUT/base.apk" \
  -I "$ANDROID_JAR" \
  --manifest "$ROOT/android/AndroidManifest.xml" \
  --min-sdk-version 24 --target-sdk-version 34 \
  --version-code "$VERSION_CODE" --version-name "$VERSION_NAME" \
  -A "$OUT/assets" \
  --java "$OUT/gen" \
  "$OUT/compiled/res.zip"

echo "==> Compiling Java"
javac -nowarn -Xlint:-options -source 8 -target 8 -encoding UTF-8 \
  -bootclasspath "$ANDROID_JAR" \
  -d "$OUT/classes" \
  $(find "$ROOT/android/src" "$OUT/gen" -name '*.java')

echo "==> Dexing"
dalvik-exchange --dex --min-sdk-version=24 --output="$OUT/classes.dex" "$OUT/classes"

echo "==> Packaging"
cp "$OUT/base.apk" "$OUT/unsigned.apk"
(cd "$OUT" && zip -q -j unsigned.apk classes.dex)
zipalign -p -f 4 "$OUT/unsigned.apk" "$OUT/aligned.apk"

if [ ! -f "$KEYSTORE" ]; then
  echo "==> Creating signing key (keep this file: updates must use the same key)"
  keytool -genkeypair -keystore "$KEYSTORE" -alias skillboost -keyalg RSA -keysize 2048 \
    -validity 36500 -storepass:env KEYSTORE_PASS -keypass:env KEYSTORE_PASS -dname "CN=SkillBoost" >/dev/null 2>&1
fi

echo "==> Signing"
apksigner sign --ks "$KEYSTORE" --ks-key-alias skillboost \
  --ks-pass env:KEYSTORE_PASS --key-pass env:KEYSTORE_PASS \
  --out "$DIST/SkillBoost.apk" "$OUT/aligned.apk"
apksigner verify "$DIST/SkillBoost.apk"
rm -f "$DIST/SkillBoost.apk.idsig"

echo "==> Built $DIST/SkillBoost.apk (v$VERSION_NAME, code $VERSION_CODE, $(du -h "$DIST/SkillBoost.apk" | cut -f1))"
