/**
 * matoga - 资源包元数据：共享纯函数
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 从 mcmeta-service.js 搬出。这三个函数被多个分节使用且彼此无依赖，
 * 提到最底层以打断 analyze<->models 与 textures<->aggregate 的双向依赖。
 */

const fs = require('fs')
const path = require('path')
const { validPackName } = require('./packs-lite')
const { AppError } = require('../../lib/errors')

async function readDirNamespaces(dir) {
  try {
    const entries = await fs.promises.readdir(path.join(dir, 'assets'), { withFileTypes: true })
    return entries.filter(e => e.isDirectory() && !e.name.startsWith('.')).map(e => e.name)
  } catch { return [] }
}

async function statPack(root, name) {
  if (!validPackName(name)) throw new AppError('ERR_INVALID_PARAM', 'invalid pack name')
  const full = path.join(root, name)
  const st = await fs.promises.stat(full).catch(() => null)
  if (!st) throw new AppError('ERR_FS_NOT_FOUND', 'pack not found: ' + name)
  return st
}

function parseTexPath(p) {
  const m = /^assets\/([^/]+)\/textures\/(.+)$/.exec(p)
  return m ? { ns: m[1], rest: m[2] } : null
}

module.exports = { readDirNamespaces, statPack, parseTexPath }
