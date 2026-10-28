/**
 * matoga - 制作包服务：文件工具与串行队列
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 从 craft-pack-service.js 按职责搬出，逻辑未改。
 */
const path = require('path')
const crypto = require('crypto')
const { DEFAULT_NAME } = require('./consts')

const fs = require('fs')
const { logger } = require('../../middleware/logger')
const { AppError } = require('../../lib/errors')

/* ── 自选清单持久化 ─────────────────────────────── */

function readRaw(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch (e) {
    if (e.code !== 'ENOENT') logger.warn('craft', 'bad ' + path.basename(file) + ': ' + e.message)
    return {}
  }
}


function atomicWrite(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = file + '.' + crypto.randomUUID() + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2))
  fs.renameSync(tmp, file)
}


/* ── 导出：聚合全部储存 → craftPacksPath 下的真实 MC 资源包 ── */

async function exists(p) {
  return fs.promises.access(p).then(() => true, () => false)
}


/* 导出快照名与当前制作项目目录（DEFAULT_NAME）同名会互相覆盖混淆，自动追加时间戳区分 */
function stamp() {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  return '' + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds())
}


function extOf(name) {
  return (String(name).split('.').pop() || '').toLowerCase()
}

/* 包内 rel 必须形如 assets/<ns>/textures|models/… 且无穿越 */


/* 包内 rel 必须形如 assets/<ns>/textures|models/… 且无穿越 */
function safePackRel(rel) {
  if (typeof rel !== 'string') return null
  if (!/^assets\/[^/]+\/(textures|models)\/[^/].*$/.test(rel)) return null
  if (rel.includes('..') || rel.includes('\\') || rel.includes('\0')) return null
  return rel
}


function uniqueDest(packDir, dest) {
  if (!fs.existsSync(path.join(packDir, dest))) return dest
  const dot = dest.lastIndexOf('.')
  const ext = dot > 0 ? dest.slice(dot) : ''
  const stem = dot > 0 ? dest.slice(0, dot) : dest
  let i = 2
  while (fs.existsSync(path.join(packDir, stem + '-' + i + ext))) i++
  return stem + '-' + i + ext
}

/* 整包（mc/official）：合并复制包内 assets/ 到制作包 assets/（同名加序号不覆盖） */


async function uniquePackName(root, name) {
  let candidate = name
  for (let i = 2; i < 100; i++) {
    if (!(await exists(path.join(root, candidate)))) return candidate
    candidate = name + '-' + i
  }
  throw new AppError('ERR_FS', 'cannot allocate pack dir name')
}

/* 导出快照名与当前制作项目目录（DEFAULT_NAME）同名会互相覆盖混淆，自动追加时间戳区分 */

module.exports = { readRaw, atomicWrite, exists, stamp, extOf, safePackRel, uniqueDest, uniquePackName }
