/**
 * matoga - 材质贴图对比工具
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 大 CSS 拆分驱动脚本。
 *
 * 用法：node tools/run-split-css.mjs <源文件> <输出目录> <前缀> [maxLines]
 */

import { splitAuto } from './split-css-auto.mjs'

const [, , src, outDir, prefix, maxArg] = process.argv
if (!src || !outDir || !prefix) {
  console.error('用法: node tools/run-split-css.mjs <源文件> <输出目录> <前缀> [maxLines]')
  process.exit(2)
}
const maxLines = maxArg ? Number(maxArg) : 300
try {
  const r = splitAuto(src, outDir, prefix, maxLines)
  console.log(JSON.stringify(r, null, 2))
} catch (e) {
  console.error('拆分失败:', e.message)
  process.exit(1)
}
