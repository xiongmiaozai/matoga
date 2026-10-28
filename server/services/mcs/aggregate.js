/**
 * matoga - 资源包元数据：总资产库聚合
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 从 mcmeta-service.js 按职责搬出，逻辑未改。
 */

const { validPackName } = require('./packs-lite')

const { parseTexPath } = require('./shared')

const fs = require('fs')
const path = require('path')
const { AppError } = require('../../lib/errors')
const { resolveDirPack, walkDirTextures, zipTextureEntries } = require('./analyze')
const { IMG_EXT_RE } = require('./consts')
const { parseModelPath, walkDirModels, zipModelEntries } = require('./models')
const { parseZipCentralDirectory } = require('./zip')

/* ── 总资产库贴图聚合：包内全部贴图按类别（textures/ 第一级目录）分组，无分页 ── */

/* 目录包补齐 size / mtime（分批 stat，避免大包一次性打满线程池） */
async function statTexMeta(packRoot, texs) {
  const out = new Array(texs.length).fill(null)
  for (let i = 0; i < texs.length; i += 32) {
    await Promise.all(texs.slice(i, i + 32).map((t, k) =>
      fs.promises.stat(path.join(packRoot, t.path))
        .then(s => { out[i + k] = { size: s.size, mtime: s.mtimeMs } })
        .catch(() => {})))
  }
  return out
}

async function listPackTexGroups(root, name) {
  const st = await statPack(root, name)
  const full = path.join(root, name)
  let kind = 'dir'
  let packRoot = null
  let texs = []
  if (st.isDirectory()) {
    const r = await resolveDirPack(full)
    packRoot = r ? r.root : full
    texs = await walkDirTextures(packRoot)
    const metas = await statTexMeta(packRoot, texs)
    texs.forEach((t, i) => { const m = metas[i]; if (m) { t.size = m.size; t.mtime = m.mtime } })
  } else {
    kind = 'zip'
    texs = zipTextureEntries(parseZipCentralDirectory(await fs.promises.readFile(full)))
  }
  const groups = new Map()
  for (const t of texs) {
    const p = parseTexPath(t.path)
    if (!p) continue
    const seg = p.rest.split('/')
    const key = seg.length >= 2 ? seg[0] : ''
    let g = groups.get(key)
    if (!g) { g = { key, count: 0, files: [] }; groups.set(key, g) }
    g.count++
    g.files.push({ path: t.path, name: seg[seg.length - 1], size: t.size || 0, mtime: t.mtime || 0 })
  }
  /* 根级贴图（textures/ 直下）置首，其余按数量降序（与 categories 一致） */
  const sorted = [...groups.values()].sort((a, b) =>
    (a.key === '' ? -1 : b.key === '' ? 1 : b.count - a.count) || a.key.localeCompare(b.key))
  return { name, kind, root: packRoot, total: texs.length, groups: sorted }
}

/* ── 总资产库模型聚合：包内全部模型按类别分组（models/ 第一级目录；items/ 物品定义独立分组），无分页 ── */

/* ── 总资产库模型聚合：包内全部模型按类别分组（models/ 第一级目录；items/ 物品定义独立分组），无分页 ── */

async function listPackModelGroups(root, name) {
  const st = await statPack(root, name)
  const full = path.join(root, name)
  let kind = 'dir'
  let packRoot = null
  let models = []
  if (st.isDirectory()) {
    const r = await resolveDirPack(full)
    packRoot = r ? r.root : full
    models = await walkDirModels(packRoot)
    const metas = await statTexMeta(packRoot, models)
    models.forEach((t, i) => { const m = metas[i]; if (m) { t.size = m.size; t.mtime = m.mtime } })
  } else {
    kind = 'zip'
    models = zipModelEntries(parseZipCentralDirectory(await fs.promises.readFile(full)))
  }
  const groups = new Map()
  for (const t of models) {
    const p = parseModelPath(t.path)
    if (!p) continue
    /* 1.21.4+ 物品模型定义（assets/<ns>/items/*.json）归入独立分组；models/ 按第一级目录分组 */
    const key = p.kind === 'item' ? 'items' : (p.rest.split('/').length >= 2 ? p.rest.split('/')[0] : '')
    let g = groups.get(key)
    if (!g) { g = { key, count: 0, files: [] }; groups.set(key, g) }
    g.count++
    g.files.push({ path: t.path, name: t.path.split('/').pop(), size: t.size || 0, mtime: t.mtime || 0 })
  }
  const sorted = [...groups.values()].sort((a, b) =>
    (a.key === '' ? -1 : b.key === '' ? 1 : b.count - a.count) || a.key.localeCompare(b.key))
  return { name, kind, root: packRoot, total: models.length, groups: sorted }
}

async function statPack(root, name) {
  if (!validPackName(name)) throw new AppError('ERR_INVALID_PARAM', 'invalid pack name')
  const full = path.join(root, name)
  const st = await fs.promises.stat(full).catch(() => null)
  if (!st) throw new AppError('ERR_FS_NOT_FOUND', 'pack not found: ' + name)
  return st
}

function assertValidRelPath(rel, opts = {}) {
  if (rel === 'pack.png') return rel
  if (typeof rel !== 'string' || !rel.startsWith('assets/')) {
    throw new AppError('ERR_INVALID_PARAM', 'texture path must start with assets/')
  }
  if (rel.includes('..') || rel.includes('\\') || rel.includes('\0') || rel.startsWith('/')) {
    throw new AppError('ERR_INVALID_PARAM', 'invalid texture path')
  }
  if (!opts.anyExt && !IMG_EXT_RE.test(rel)) {
    throw new AppError('ERR_INVALID_PARAM', 'not an image texture')
  }
  return rel
}

/* ── 包内文件浏览（文件管理器式：任意目录的直接子项） ── */

module.exports = { statTexMeta, listPackTexGroups, listPackModelGroups, statPack, assertValidRelPath }
