/**
 * matoga - 图片扩展名共享常量
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * SCAN_TEX_EXTS：MC 包内贴图扫描（含 avif，不含 tga — MC 资源包不使用 tga）
 * BUILD_TEX_EXTS：材质包构建/导入（含 tga，不含 avif — 用户可导入 tga，MC 不输出 avif）
 */

const SCAN_TEX_EXTS = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'tif', 'tiff', 'avif'])
const SCAN_TEX_EXT_RE = /\.(png|jpe?g|webp|gif|bmp|tiff?|avif)$/i

const BUILD_TEX_EXTS = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'tga', 'tif', 'tiff'])

module.exports = { SCAN_TEX_EXTS, SCAN_TEX_EXT_RE, BUILD_TEX_EXTS }