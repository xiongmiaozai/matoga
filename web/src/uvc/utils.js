/**
 * matoga - UV 编辑器纯工具
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 从 uv-editor-core.js 原样搬出，逻辑未改。
 */

/** UV 数值显示：整数原样，小数保留两位 */
export function fmtUvNum(v) {
  const n = +v
  return Number.isFinite(n) && !Number.isInteger(n) ? Math.round(n * 100) / 100 : n
}

/** File → dataURL */
export function readAsDataURL(file) {
  return new Promise((resolve, reject) => {
    try {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result))
      reader.onerror = () => reject(new Error('read fail'))
      reader.readAsDataURL(file)
    } catch (e) { reject(e) }
  })
}
