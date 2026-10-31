#!/usr/bin/env bash
# matoga - 材质贴图对比工具
# Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
# SPDX-License-Identifier: MIT
#
# 构建 Go 后端二进制到 dist-go/，供 Electron 打包与本地运行使用。
#
# 用法：
#   bash scripts/build-go.sh            # 构建当前平台
#   bash scripts/build-go.sh win        # 交叉编译 Windows x64
#   bash scripts/build-go.sh mac-arm    # 交叉编译 macOS arm64
#
# 产物：dist-go/matoga-backend(.exe)

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="$ROOT/dist-go"

TARGET="${1:-native}"
EXT=""

case "$TARGET" in
  native) ;;
  win)
    export GOOS=windows GOARCH=amd64
    EXT=".exe"
    ;;
  mac-arm)
    export GOOS=darwin GOARCH=arm64
    ;;
  mac-intel)
    export GOOS=darwin GOARCH=amd64
    ;;
  linux)
    export GOOS=linux GOARCH=amd64
    ;;
  *)
    echo "未知目标: $TARGET（可用：native / win / mac-arm / mac-intel / linux）" >&2
    exit 2
    ;;
esac

if ! command -v go >/dev/null 2>&1; then
  echo "未找到 go 命令，请先安装 Go 1.26+" >&2
  exit 1
fi

if [ ! -f "$ROOT/backend/go.mod" ]; then
  echo "未找到 backend/go.mod —— Go 后端源码不在当前分支？" >&2
  echo "（Electron 相关的分支可能不含 backend/，请切到含 Go 后端的分支再构建）" >&2
  exit 1
fi

mkdir -p "$OUT"
NAME="matoga-backend$EXT"

echo "==> 构建 Go 后端 ($TARGET) → dist-go/$NAME"

# 用 cd + 相对输出路径：不把绝对路径作为参数传给 go.exe，避免
# Windows 下非 ASCII 路径（如本仓库的“编程”目录）在参数编码上出问题。
cd "$ROOT/backend"

# -trimpath 去掉本机路径；-s -w 减小体积（剥离符号表与调试信息）
CGO_ENABLED=0 go build \
  -trimpath \
  -ldflags "-s -w" \
  -o "../dist-go/$NAME" \
  ./cmd/matoga

SIZE=$(wc -c < "$OUT/$NAME" | tr -d ' ')
echo "==> 完成：dist-go/$NAME（$((SIZE / 1024 / 1024)) MB）"
echo ""
echo "Electron 启动时会优先使用该二进制；不存在则回退到 Node 服务。"
