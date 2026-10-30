#!/bin/bash
# matoga Windows 构建脚本（在 macOS 上交叉编译）
# 用法: bash scripts/build-win.sh
# 产物: dist-electron/matoga Setup 3.2.0.exe（NSIS 安装包）
set -e

ELECTRON_MIRROR_URL="https://mirrors.huaweicloud.com/electron/"
BUILDER_MIRROR_URL="https://mirrors.huaweicloud.com/electron-builder-binaries/"

echo "=== matoga Windows 构建 ==="

# 0. 前置检查
echo "0. 前置检查..."
[ -d node_modules ] || { echo "请先 npm install" >&2; exit 1; }
df -h / | tail -1
echo ""

# 1. 清理旧产物
echo "1. 清理旧产物..."
rm -rf dist-electron/win-unpacked dist-electron/win-arm64-unpacked dist-electron/*.exe dist-electron/*.exe.blockmap
echo ""

# 2. 构建 NSIS 安装包（x64）
echo "2. 构建 Windows x64 NSIS 安装包（用华为云镜像加速）..."
ELECTRON_MIRROR=$ELECTRON_MIRROR_URL \
ELECTRON_BUILDER_BINARIES_MIRROR=$BUILDER_MIRROR_URL \
npx electron-builder --win --x64
echo ""

echo "=== 构建完成 ==="
echo "产物:"
ls -lh dist-electron/*.exe 2>/dev/null || echo "未生成 exe，检查日志"