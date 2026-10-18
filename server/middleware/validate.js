/**
 * matoga - 材质贴图对比工具
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 */

const path = require('path')
const { AppError } = require('../../shared/errors')

const trustedRoots = new Set()

function normalize(p) {
  if (typeof p !== 'string' || !p.trim() || p.includes('\0')) {
    throw new AppError('ERR_INVALID_PARAM', 'invalid path')
  }
  return path.normalize(p)
}

function guardRead(p) {
  const n = normalize(p)
  if (!path.isAbsolute(n)) throw new AppError('ERR_INVALID_PARAM', 'absolute path required')
  return n
}

function trust(root) {
  if (root) trustedRoots.add(path.normalize(root).replace(/[\\/]+$/, ''))
}

function getTrustedRoots() { return [...trustedRoots] }

function guardWrite(p) {
  const n = guardRead(p)
  const lower = process.platform === 'win32' ? n.toLowerCase() : n
  for (const root of trustedRoots) {
    let r = path.normalize(root).replace(/[\\/]+$/, '')
    if (process.platform === 'win32') r = r.toLowerCase()
    if (lower === r || lower.startsWith(r + path.sep) || lower.startsWith(r + '/')) return n
  }
  throw new AppError('ERR_PATH_DENIED', 'path outside trusted roots')
}

module.exports = { guardRead, guardWrite, trust, getTrustedRoots, normalize }