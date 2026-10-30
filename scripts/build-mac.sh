#!/bin/bash
# matoga macOS 完整构建脚本
# 用法: bash scripts/build-mac.sh
# 产物: dist-electron/matoga-3.2.0-arm64.dmg（含 Applications 拖拽快捷方式）
set -e

ELECTRON_MIRROR_URL="https://mirrors.huaweicloud.com/electron/"
BUILDER_MIRROR_URL="https://mirrors.huaweicloud.com/electron-builder-binaries/"

echo "=== matoga macOS 构建 ==="

# 0. 前置检查
echo "0. 前置检查..."
[ -d node_modules ] || { echo "请先 npm install" >&2; exit 1; }
df -h / | tail -1
echo ""

# 1. 清理旧产物
echo "1. 清理旧产物..."
rm -rf dist-electron/mac-arm64 dist-electron/*.dmg dist-electron/*.zip dist-electron/*.blockmap
echo ""

# 2. 打包 app（electron-builder --dir，跳过 dmg-builder 的 plist bug）
echo "2. 打包 app（用华为云镜像加速）..."
ELECTRON_MIRROR=$ELECTRON_MIRROR_URL \
ELECTRON_BUILDER_BINARIES_MIRROR=$BUILDER_MIRROR_URL \
npx electron-builder --mac --dir
echo ""

# 3. 生成 dmg（带 Applications 拖拽快捷方式）
echo "3. 生成 dmg..."
bash scripts/build-dmg.sh
echo ""

echo "=== 构建完成 ==="
echo "产物: dist-electron/matoga-3.2.0-arm64.dmg"