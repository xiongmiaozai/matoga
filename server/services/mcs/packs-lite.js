/**
 * matoga - 资源包元数据：包名校验
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 从 mcmeta-service.js 搬出，供多处复用。
 */

const path = require('path')

function validPackName(name) {
  if (typeof name !== 'string') return false
  const n = name
  if (!n || n.length > 255 || n !== n.trim()) return false
  if (n === '.' || n === '..') return false
  if (/[\\/]/.test(n) || n.includes('\0')) return false
  return path.basename(n) === n
}

module.exports = { validPackName }
