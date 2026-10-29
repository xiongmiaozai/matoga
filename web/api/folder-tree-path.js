/**
 * matoga - 目录树选择器：路径工具
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 从 folder-tree.js 原样搬出，逻辑未改。短名显示与路径规范化（处理 Windows
 * 盘符、UNC、尾部斜杠、不可见字符与包裹引号）。
 */

/**
 * 取路径最后一段作为显示名。
 * @param {string} p
 * @returns {string}
 */
function shortName(p) {
  if (!p) return p
  const parts = p.split(/[\\/]/).filter(Boolean)
  return parts[parts.length - 1] || p
}

/**
 * 规范化用户输入的路径：去不可见字符、去首尾空白、去成对包裹的引号。
 * @param {string} p
 * @returns {string}
 */
function cleanPath(p) {
  if (typeof p !== 'string') return p
  const INV = /^[\u200B-\u200D\u2060\u180E\uFEFF]+|[\u200B-\u200D\u2060\u180E\uFEFF]+$/g
  let s = p.replace(INV, '').trim()
  if (s.length >= 2) {
    const a = s[0], b = s[s.length - 1]
    if ((a === '"' && b === '"') || (a === "'" && b === "'") || (a === '`' && b === '`')) s = s.slice(1, -1).replace(INV, '').trim()
  }
  return s
}

export { shortName, cleanPath }
