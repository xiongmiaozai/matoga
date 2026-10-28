/**
 * matoga - 资源包元数据：包列表与目录级操作
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 从 mcmeta-service.js 按职责搬出，逻辑未改。
 */

const fs = require('fs')
const path = require('path')
const { AppError } = require('../../lib/errors')
const { ZIP_EXTS } = require('./consts')
const { analyzePack } = require('./models')

/* ── 目录级操作 ──────────────────────────────── */

async function listOfficialPacks(root) {
  let names
  try {
    names = await fs.promises.readdir(root, { withFileTypes: true })
  } catch (e) {
    if (e && e.code === 'ENOENT') return { root, exists: false, packs: [] }
    throw new AppError('ERR_FS_NOT_FOUND', e.message)
  }
  const packs = []
  for (const d of names) {
    if (d.name.startsWith('.')) continue
    const full = path.join(root, d.name)
    const st = await fs.promises.stat(full).catch(() => null)
    if (!st) continue
    if (!st.isDirectory() && !ZIP_EXTS.has((d.name.split('.').pop() || '').toLowerCase())) continue
    packs.push(await analyzePack(full, st))
  }
  packs.sort((a, b) => a.name.localeCompare(b.name, 'zh'))
  return { root, exists: true, packs }
}

function validPackName(name) {
  if (typeof name !== 'string') return false
  const n = name
  if (!n || n.length > 255 || n !== n.trim()) return false
  if (n === '.' || n === '..') return false
  if (/[\\/]/.test(n) || n.includes('\0')) return false
  return path.basename(n) === n
}

async function renamePack(root, fromName, toName) {
  if (!validPackName(fromName)) throw new AppError('ERR_INVALID_PARAM', 'invalid source name')
  if (!validPackName(toName)) throw new AppError('ERR_INVALID_PARAM', 'invalid target name')
  const from = path.join(root, fromName)
  const to = path.join(root, toName)
  try {
    await fs.promises.access(from)
  } catch {
    throw new AppError('ERR_FS_NOT_FOUND', 'source pack not found: ' + fromName)
  }
  const targetExists = await fs.promises.access(to).then(() => true, () => false)
  if (targetExists) throw new AppError('ERR_ALREADY_EXISTS', 'target already exists: ' + toName)
  await fs.promises.rename(from, to)
  return { from, to, name: toName }
}

function suggestName(entry) {
  const range = (entry && entry.formatRange) || ''
  if (range) return range.replace(/\s*–\s*/g, '-').replace(/\s*-\s*/g, '-').trim()
  if (entry && entry.format != null) return 'pack_format-' + entry.format
  return (entry && entry.name) || ''
}

/* ── 包内贴图：分类浏览与读取 ─────────────────── */

module.exports = { listOfficialPacks, validPackName, renamePack, suggestName }
