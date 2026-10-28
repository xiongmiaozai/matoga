/**
 * matoga - 资源包元数据：包内模型与贴图遍历
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 从 mcmeta-service.js 按职责搬出，逻辑未改。
 */

const fs = require('fs')
const path = require('path')
const { resolveDirPack, walkDirTextures, zipTextureEntries } = require('./analyze')
const { ZIP_EXTS, VERSION_JSON_NAME, MODEL_DIR_RE, MODEL_EXT_RE, MAX_MODEL_WALK, formatToVersions } = require('./consts')
const { parseMcmetaText, parseVersionJson } = require('./mcmeta')
const { parseZipCentralDirectory, readZipEntry, pickMcmetaEntry, findZipEntry, collectNamespaces } = require('./zip')

/* ── 包内模型（assets/<ns>/models/** 与 1.21.4+ 物品定义 assets/<ns>/items/*.json）── */

/* zip 条目名 → 归一化模型路径：容忍包内容套一层根文件夹（<root>/assets/...） */
function normalizeZipModelName(name) {
  if (MODEL_DIR_RE.test(name)) return name
  const m = /^[^/]+\/(assets\/[^/]+\/(models|items)\/.+)$/.exec(name)
  return m ? m[1] : null
}

/* 解析模型路径：models/** 返回 { ns, rest }；items/** 返回 { ns, rest, kind: 'item' } */

/* 解析模型路径：models/** 返回 { ns, rest }；items/** 返回 { ns, rest, kind: 'item' } */
function parseModelPath(p) {
  let m = /^assets\/([^/]+)\/models\/(.+)$/.exec(p)
  if (m) return { ns: m[1], rest: m[2] }
  m = /^assets\/([^/]+)\/items\/([^/]+\.json)$/.exec(p)
  if (m) return { ns: m[1], rest: m[2], kind: 'item' }
  return null
}

/* 递归收集包内模型（相对包根的 assets/... 路径，带上限防大包卡死） */

/* 递归收集包内模型（相对包根的 assets/... 路径，带上限防大包卡死） */
async function walkDirModels(packRoot) {
  const found = []
  async function walk(abs, rel) {
    if (found.length >= MAX_MODEL_WALK) return
    let ents
    try { ents = await fs.promises.readdir(abs, { withFileTypes: true }) } catch { return }
    for (const e of ents) {
      if (e.name.startsWith('.')) continue
      const r = rel ? rel + '/' + e.name : e.name
      if (e.isDirectory()) await walk(path.join(abs, e.name), r)
      else if (MODEL_DIR_RE.test(r) && MODEL_EXT_RE.test(e.name)) {
        found.push({ path: r, size: 0 })
        if (found.length >= MAX_MODEL_WALK) return
      }
    }
  }
  await walk(packRoot, '')
  return found
}

/* zip 包内模型条目：路径限定 assets/<ns>/models/ 或 assets/<ns>/items/ 且扩展名 .json（blockstates 等其他 json 排除） */

/* zip 包内模型条目：路径限定 assets/<ns>/models/ 或 assets/<ns>/items/ 且扩展名 .json（blockstates 等其他 json 排除） */
function zipModelEntries(entries) {
  const out = []
  for (const e of entries) {
    const p = normalizeZipModelName(e.name)
    if (p && MODEL_EXT_RE.test(e.name)) out.push({ path: p, size: e.usize })
  }
  out.sort((a, b) => a.path.localeCompare(b.path))
  return out
}

async function readDirNamespaces(dir) {
  try {
    const entries = await fs.promises.readdir(path.join(dir, 'assets'), { withFileTypes: true })
    return entries.filter(e => e.isDirectory() && !e.name.startsWith('.')).map(e => e.name)
  } catch { return [] }
}

async function analyzePack(fullPath, stat) {
  const entry = {
    name: path.basename(fullPath),
    fullPath,
    isDirectory: stat.isDirectory(),
    size: stat.isDirectory() ? 0 : stat.size,
    mtime: stat.mtimeMs,
    kind: stat.isDirectory() ? 'dir' : 'file',
    valid: false,
    format: null, minFormat: null, maxFormat: null, formatLabel: null,
    formatRange: '', description: '', namespaces: [],
    textureCount: 0, firstTexture: null,
    error: '',
  }
  let text = null
  try {
    if (stat.isDirectory()) {
      const r = await resolveDirPack(fullPath)
      if (!r) {
        entry.error = 'pack.mcmeta not found'
        return entry
      }
      entry.namespaces = r.namespaces
      text = r.text
      entry.versionInfo = r.versionInfo || null
      const hasIcon = await fs.promises.access(path.join(r.root, 'pack.png')).then(() => true, () => false)
      const texs = await walkDirTextures(r.root)
      entry.textureCount = texs.length
      entry.firstTexture = hasIcon ? 'pack.png' : (texs.length ? texs[0].path : null)
      if (!text) entry.error = 'pack.mcmeta not found'
    } else {
      const ext = (entry.name.split('.').pop() || '').toLowerCase()
      if (!ZIP_EXTS.has(ext)) {
        entry.error = 'not a resource pack (folder or .zip)'
        return entry
      }
      entry.kind = 'zip'
      const buf = await fs.promises.readFile(fullPath)
      const entries = parseZipCentralDirectory(buf)
      const mc = pickMcmetaEntry(entries)
      entry.namespaces = collectNamespaces(entries)
      const texs = zipTextureEntries(entries)
      entry.textureCount = texs.length
      const icon = findZipEntry(entries, 'pack.png')
      entry.firstTexture = icon ? 'pack.png' : (texs.length ? texs[0].path : null)
      if (!mc) {
        entry.error = 'pack.mcmeta not found in archive'
        const vj = findZipEntry(entries, VERSION_JSON_NAME)
        entry.versionInfo = vj ? parseVersionJson(readZipEntry(buf, vj).toString('utf8')) : null
      }
      text = mc ? readZipEntry(buf, mc).toString('utf8') : null
    }
    if (text === null) {
      // 缺 pack.mcmeta：回退 version.json（原版 / Fabric 客户端 jar 布局）还原版本
      const vi = entry.versionInfo
      if (vi && (vi.format != null || vi.versionRange)) {
        entry.format = vi.format
        entry.formatLabel = vi.formatLabel
        entry.formatRange = vi.versionRange
        entry.valid = true
        entry.error = ''
      }
      delete entry.versionInfo
      return entry
    }
    const meta = parseMcmetaText(text)
    entry.format = meta.format
    entry.minFormat = meta.minFormat
    entry.maxFormat = meta.maxFormat
    entry.description = meta.description
    entry.formatRange = buildFormatRange(meta)
    entry.valid = true
  } catch (e) {
    entry.error = (e && e.message) || 'analyze failed'
  }
  return entry
}

function buildFormatRange(meta) {
  if (meta.minFormat != null || meta.maxFormat != null) {
    const min = meta.minFormat != null ? formatToVersions(meta.minFormat) : ''
    const max = meta.maxFormat != null ? formatToVersions(meta.maxFormat) : ''
    if (min && max) return min === max ? min : min + ' – ' + max
    return min || max || `pack_format ${meta.minFormat ?? meta.maxFormat}`
  }
  if (meta.format != null) return formatToVersions(meta.format)
  return ''
}

/* ── 目录级操作 ──────────────────────────────── */

module.exports = { normalizeZipModelName, parseModelPath, walkDirModels, zipModelEntries, readDirNamespaces, analyzePack, buildFormatRange }
