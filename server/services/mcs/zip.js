/**
 * matoga - 资源包元数据：最小 zip 解析
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 从 mcmeta-service.js 按职责搬出，逻辑未改。
 */

const zlib = require('zlib')
const { MCMETA_NAME, ASSETS_PREFIX, TEX_DIR_RE, MIME_BY_EXT } = require('./consts')

const fs = require('fs')
const { AppError } = require('../../lib/errors')

/* ── 最小 zip 解析（仅读取 central directory 与指定条目）──── */

function parseZipCentralDirectory(buf) {
  let eocd = -1
  const minPos = Math.max(0, buf.length - 22 - 65536)
  for (let i = buf.length - 22; i >= minPos; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break }
  }
  if (eocd < 0) throw new AppError('ERR_MC_NOT_ZIP', 'zip EOCD not found')
  const count = buf.readUInt16LE(eocd + 10)
  const cdOffset = buf.readUInt32LE(eocd + 16)
  if (count === 0xffff || cdOffset === 0xffffffff) {
    throw new AppError('ERR_MC_NOT_ZIP', 'zip64 archives are not supported')
  }
  const entries = []
  let p = cdOffset
  for (let i = 0; i < count; i++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) break
    const method = buf.readUInt16LE(p + 10)
    const csize = buf.readUInt32LE(p + 20)
    const usize = buf.readUInt32LE(p + 24)
    const nameLen = buf.readUInt16LE(p + 28)
    const extraLen = buf.readUInt16LE(p + 30)
    const commentLen = buf.readUInt16LE(p + 32)
    const localOffset = buf.readUInt32LE(p + 42)
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen)
    if (!name.endsWith('/')) entries.push({ name, method, csize, usize, localOffset })
    p += 46 + nameLen + extraLen + commentLen
  }
  return entries
}

function readZipEntry(buf, entry) {
  const p = entry.localOffset
  if (p + 30 > buf.length || buf.readUInt32LE(p) !== 0x04034b50) {
    throw new AppError('ERR_MC_NOT_ZIP', 'bad zip local header')
  }
  const nameLen = buf.readUInt16LE(p + 26)
  const extraLen = buf.readUInt16LE(p + 28)
  const dataStart = p + 30 + nameLen + extraLen
  const raw = buf.subarray(dataStart, dataStart + entry.csize)
  if (entry.method === 0) return Buffer.from(raw)
  if (entry.method === 8) return zlib.inflateRawSync(raw)
  throw new AppError('ERR_MC_NOT_ZIP', 'unsupported zip compression method: ' + entry.method)
}

function pickMcmetaEntry(entries) {
  const exact = entries.find(e => e.name === MCMETA_NAME)
  if (exact) return exact
  const nested = entries
    .filter(e => e.name.endsWith('/' + MCMETA_NAME))
    .sort((a, b) => a.name.split('/').length - b.name.split('/').length)
  return nested[0] || null
}

/* 图片扩展名变体集合（模糊匹配：模型引用 .png 而包内实为 .jpg 等的社区包） */

/* 图片扩展名变体集合（模糊匹配：模型引用 .png 而包内实为 .jpg 等的社区包） */
const IMG_EXT_LIST = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'tif', 'tiff', 'avif']

const MCMETA_SUFFIX = '.mcmeta'

/* 请求路径（小写）→ 同 stem 的图片扩展名候选集合；非图片扩展名返回 null。
   动画元数据（.mcmeta 结尾）剥掉后缀再取 stem：stone.png.mcmeta → { stone.png, stone.jpg, … } */

function imgVariantKeys(relL) {
  const isMeta = relL.endsWith(MCMETA_SUFFIX)
  const base = isMeta ? relL.slice(0, -MCMETA_SUFFIX.length) : relL
  const dot = base.lastIndexOf('.')
  if (dot <= base.lastIndexOf('/')) return null
  if (!IMG_EXT_LIST.includes(base.slice(dot + 1))) return null
  const stem = base.slice(0, dot)
  return new Set(IMG_EXT_LIST.map(e => stem + '.' + e))
}

/* 模糊比较键（条目名小写）：mcmeta 查询时仅 .mcmeta 条目参与（剥后缀），反向亦然——
   避免「请求 stone.png.mcmeta 误命中普通贴图 stone.png / 请求贴图误命中 .png.mcmeta」 */

function fuzzyVariantKey(nameL, isMetaQuery) {
  const isMetaEntry = nameL.endsWith(MCMETA_SUFFIX)
  if (isMetaQuery) return isMetaEntry ? nameL.slice(0, -MCMETA_SUFFIX.length) : null
  return isMetaEntry ? null : nameL
}

/* 按归一化路径查 zip 条目，匹配层级（前者未命中才进后者）：
   1. 精确（大小写敏感）          2. assets 嵌套归一（剥一层根前缀）
   3. 任意层嵌套根前缀（取最浅）   4. 以上三级的大小写不敏感形态
   5. 图片扩展名变体（.png ↔ .jpg 等，mcmeta 查询剥后缀同 stem 比较）
   模糊层仅兜底原本 404 的请求：zip 实际条目名大小写 / 扩展名与模型引用不一致的场景 */

function findZipEntry(entries, rel) {
  const relL = rel.toLowerCase()
  const isMeta = relL.endsWith(MCMETA_SUFFIX)
  const variants = imgVariantKeys(relL)
  let norm = null, nested = null, nestedDepth = Infinity
  let icExact = null, icNorm = null, icNested = null, icNestedDepth = Infinity, variantHit = null
  for (const e of entries) {
    const n = e.name
    if (n === rel) return e
    const p = normalizeZipTexName(n)
    if (!norm && p === rel) norm = e
    const nL = n.toLowerCase()
    if (!icExact && nL === relL) icExact = e
    if (p && !icNorm && p.toLowerCase() === relL) icNorm = e
    const depth = n.split('/').length
    if (n.endsWith('/' + rel) && depth < nestedDepth) { nested = e; nestedDepth = depth }
    if (nL.endsWith('/' + relL) && depth < icNestedDepth) { icNested = e; icNestedDepth = depth }
    if (!variantHit && variants) {
      const key = fuzzyVariantKey(nL, isMeta)
      if (key != null && variants.has(key)) variantHit = e
    }
  }
  return norm || nested || icExact || icNorm || icNested || variantHit || null
}

function collectNamespaces(entries) {
  const ns = new Set()
  for (const e of entries) {
    if (!e.name.startsWith(ASSETS_PREFIX)) continue
    const rest = e.name.slice(ASSETS_PREFIX.length)
    if (!rest || rest.startsWith('/')) continue
    const first = rest.split('/')[0]
    if (first) ns.add(first)
  }
  return [...ns]
}

/* zip 条目名 → 归一化贴图路径：容忍包内容套一层根文件夹（<root>/assets/...） */

/* zip 条目名 → 归一化贴图路径：容忍包内容套一层根文件夹（<root>/assets/...） */
function normalizeZipTexName(name) {
  if (TEX_DIR_RE.test(name)) return name
  const m = /^[^/]+\/(assets\/[^/]+\/textures\/.+)$/.exec(name)
  return m ? m[1] : null
}

function mimeOf(name) {
  const ext = (name.split('.').pop() || '').toLowerCase()
  return MIME_BY_EXT[ext] || 'application/octet-stream'
}

/* ── pack.mcmeta 解析 ─────────────────────────── */

module.exports = { parseZipCentralDirectory, readZipEntry, pickMcmetaEntry, IMG_EXT_LIST, MCMETA_SUFFIX, imgVariantKeys, fuzzyVariantKey, findZipEntry, collectNamespaces, normalizeZipTexName, mimeOf }
