/**
 * matoga - 资源包元数据：包内文件浏览与读取
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 从 mcmeta-service.js 按职责搬出，逻辑未改。
 */

const { statPack } = require('./shared')

const fs = require('fs')
const path = require('path')
const { AppError } = require('../../lib/errors')
const { assertValidRelPath } = require('./aggregate')
const { resolveDirPack } = require('./analyze')
const { parseZipCentralDirectory, readZipEntry, MCMETA_SUFFIX, imgVariantKeys, fuzzyVariantKey, findZipEntry, mimeOf } = require('./zip')

/* ── 包内文件浏览（文件管理器式：任意目录的直接子项） ── */

const BROWSE_MAX_ENTRIES = 4000

/* 浏览路径：null/''（包根）或安全相对路径（禁止绝对路径 / 穿越 / 反斜杠） */

/* 浏览路径：null/''（包根）或安全相对路径（禁止绝对路径 / 穿越 / 反斜杠） */
function assertBrowsePath(dir) {
  if (dir == null || dir === '') return null
  if (typeof dir !== 'string' || dir.startsWith('/') || dir.endsWith('/') ||
      dir.includes('\\') || dir.includes('..') || dir.includes('\0')) {
    throw new AppError('ERR_INVALID_PARAM', 'invalid browse path')
  }
  return dir
}

/* zip 条目名 → 包根相对路径：assets/META-INF 直排保留；套层根（<root>/assets/…、<root>/pack.mcmeta 等包根文件）剥离前缀 */

/* zip 条目名 → 包根相对路径：assets/META-INF 直排保留；套层根（<root>/assets/…、<root>/pack.mcmeta 等包根文件）剥离前缀 */
function normalizeZipBrowseName(name) {
  if (name.startsWith('assets/') || name.startsWith('META-INF/')) return name
  const m = /^[^/]+\/(assets\/.+|META-INF\/.+|pack\.mcmeta|pack\.png|version\.json|credits\.txt|LICENSE|README[^/]*)$/i.exec(name)
  return m ? m[1] : name
}

function browseBreadcrumbs(dir) {
  const crumbs = [{ name: 'root', dir: null }]
  if (!dir) return crumbs
  const segs = dir.split('/')
  segs.forEach((s, i) => crumbs.push({ name: s, dir: segs.slice(0, i + 1).join('/') }))
  return crumbs
}

async function listPackEntries(root, name, opts = {}) {
  const st = await statPack(root, name)
  const full = path.join(root, name)
  const dir = assertBrowsePath(opts.dir)
  const parent = dir ? (dir.split('/').slice(0, -1).join('/') || null) : null
  let dirs = []
  let files = []

  if (st.isDirectory()) {
    const r = await resolveDirPack(full)
    const base = path.resolve(r ? r.root : full)
    const abs = dir ? path.resolve(base, dir) : base
    if (abs !== base && !abs.startsWith(base + path.sep)) {
      throw new AppError('ERR_INVALID_PARAM', 'invalid browse path')
    }
    const ents = await fs.promises.readdir(abs, { withFileTypes: true }).catch(() => null)
    if (!ents) throw new AppError('ERR_FS_NOT_FOUND', 'directory not found: ' + (dir || '.'))
    for (const e of ents) {
      if (e.name.startsWith('.')) continue
      if (e.isDirectory()) dirs.push({ name: e.name })
      else if (e.isFile()) {
        const s = await fs.promises.stat(path.join(abs, e.name)).catch(() => null)
        files.push({ name: e.name, size: s ? s.size : 0, mtime: s ? s.mtimeMs : 0 })
      }
    }
  } else {
    const entries = parseZipCentralDirectory(await fs.promises.readFile(full))
    const dirPrefix = dir ? dir + '/' : ''
    const dirSet = new Map()
    for (const e of entries) {
      const n = normalizeZipBrowseName(e.name)
      if (!n) continue
      let rest = n
      if (dir) {
        if (!n.startsWith(dirPrefix)) continue
        rest = n.slice(dirPrefix.length)
      }
      const seg = rest.split('/')
      if (seg.length >= 2) {
        if (!dirSet.has(seg[0])) dirSet.set(seg[0], { name: seg[0] })
      } else if (seg[0]) {
        files.push({ name: seg[0], size: e.usize, mtime: 0 })
      }
    }
    dirs = [...dirSet.values()]
  }

  dirs.sort((a, b) => a.name.localeCompare(b.name))
  files.sort((a, b) => a.name.localeCompare(b.name))

  const total = dirs.length + files.length
  let truncated = false
  if (total > BROWSE_MAX_ENTRIES) {
    truncated = true
    if (dirs.length > BROWSE_MAX_ENTRIES) dirs = dirs.slice(0, BROWSE_MAX_ENTRIES)
    files = files.slice(0, Math.max(0, BROWSE_MAX_ENTRIES - dirs.length))
  }

  return {
    name, kind: st.isDirectory() ? 'dir' : 'zip', dir, parent,
    breadcrumbs: browseBreadcrumbs(dir), dirs, files,
    total, truncated,
  }
}

/* 目录包模糊定位：目标目录内按「大小写不敏感同名 → 图片扩展名变体」匹配实际文件名，
   命中返回实际文件名（mime 按其扩展名），找不到返回 null */

async function resolveDirFileFuzzy(dirAbs, rel) {
  const ents = await fs.promises.readdir(dirAbs).catch(() => null)
  if (!ents) return null
  const want = rel.slice(rel.lastIndexOf('/') + 1).toLowerCase()
  const isMeta = want.endsWith(MCMETA_SUFFIX)
  const variants = imgVariantKeys(want)
  let variantHit = null
  for (const n of ents) {
    const nL = n.toLowerCase()
    if (nL === want) return n
    if (!variants || variantHit) continue
    const key = fuzzyVariantKey(nL, isMeta)
    if (key != null && variants.has(key)) variantHit = n
  }
  return variantHit
}

async function readPackFile(root, name, relPath, opts = {}) {
  const rel = assertValidRelPath(relPath, opts)
  const st = await statPack(root, name)
  const full = path.join(root, name)
  if (st.isDirectory()) {
    const r = await resolveDirPack(full)
    const base = r ? r.root : full
    const file = path.resolve(base, rel)
    if (!file.startsWith(path.resolve(base) + path.sep)) {
      throw new AppError('ERR_INVALID_PARAM', 'invalid texture path')
    }
    try {
      const buf = await fs.promises.readFile(file)
      return { buf, mime: mimeOf(rel) }
    } catch {
      /* 模糊兜底：实际文件名大小写 / 图片扩展名与模型引用不一致（社区包常见） */
      const hit = await resolveDirFileFuzzy(path.dirname(file), rel)
      if (hit) {
        try {
          const buf = await fs.promises.readFile(path.join(path.dirname(file), hit))
          return { buf, mime: mimeOf(hit) }
        } catch {}
      }
      throw new AppError('ERR_FS_NOT_FOUND', 'texture not found: ' + rel)
    }
  }
  const buf = await fs.promises.readFile(full)
  const entries = parseZipCentralDirectory(buf)
  const entry = findZipEntry(entries, rel)
  if (!entry) throw new AppError('ERR_FS_NOT_FOUND', 'texture not found: ' + rel)
  /* mime 按实际命中条目的扩展名（模糊命中 .jpg 等变体时请求扩展名不代表真实类型） */
  return { buf: readZipEntry(buf, entry), mime: mimeOf(entry.name) }
}

module.exports = { BROWSE_MAX_ENTRIES, assertBrowsePath, normalizeZipBrowseName, browseBreadcrumbs, listPackEntries, resolveDirFileFuzzy, readPackFile }
