#!/bin/bash
# 构建带 Applications 快捷方式的 dmg（拖拽安装）
set -e

APP_PATH="dist-electron/mac-arm64/matoga.app"
VERSION=$(node -p "require('./package.json').version")
DMG_PATH="dist-electron/matoga-${VERSION}-arm64.dmg"
VOL_NAME="matoga ${VERSION}"
TMP_DMG="/tmp/matoga-tmp.dmg"
MOUNT="/Volumes/$VOL_NAME"

if [ ! -d "$APP_PATH" ]; then
  echo "错误：$APP_PATH 不存在" >&2
  exit 1
fi

APP_SIZE_MB=$(du -sm "$APP_PATH" | awk '{print $1}')
TMP_SIZE_MB=$((APP_SIZE_MB * 2 + 100))

echo "1. 创建临时读写 dmg（app=${APP_SIZE_MB}MB，临时 dmg=${TMP_SIZE_MB}MB）..."
rm -f "$TMP_DMG"
hdiutil create -size ${TMP_SIZE_MB}m -volname "$VOL_NAME" -fs HFS+ -ov "$TMP_DMG"

echo "2. 挂载（读写模式）..."
hdiutil attach "$TMP_DMG" -nobrowse -readwrite -mountpoint "$MOUNT" -quiet

echo "3. 用 ditto 复制 app，创建 Applications 快捷方式..."
ditto "$APP_PATH" "$MOUNT/matoga.app"
ln -sfh /Applications "$MOUNT/Applications"

echo "4. 卸载..."
hdiutil detach "$MOUNT" -quiet

echo "5. 转换为压缩 dmg..."
rm -f "$DMG_PATH"
hdiutil convert "$TMP_DMG" -format UDZO -imagekey zlib-level=9 -ov -o "$DMG_PATH"
rm -f "$TMP_DMG"

echo "7. 验证..."
hdiutil verify "$DMG_PATH"

echo "完成：$DMG_PATH"
ls -lh "$DMG_PATH"