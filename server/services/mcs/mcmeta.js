/**
 * matoga - 资源包元数据：pack.mcmeta 与 version.json 解析
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 从 mcmeta-service.js 按职责搬出，逻辑未改。
 */

const { VERSION_JSON_NAME } = require('./consts')

const path = require('path')
const fs = require('fs')
const { AppError } = require('../../lib/errors')

/* ── pack.mcmeta 解析 ─────────────────────────── */

function plainDescription(desc) {
  if (typeof desc === 'string') return desc.replace(/§./g, '').trim()
  if (desc && typeof desc === 'object') {
    const s = typeof desc.text === 'string' ? desc.text
      : typeof desc.translate === 'string' ? desc.translate : ''
    return s.replace(/§./g, '').trim()
  }
  return ''
}

function parseMcmetaText(text) {
  let raw
  try { raw = JSON.parse(text) } catch {
    throw new AppError('ERR_MC_BAD_MCMETA', 'pack.mcmeta is not valid JSON')
  }
  const pack = raw && raw.pack
  if (!pack || typeof pack !== 'object') {
    throw new AppError('ERR_MC_BAD_MCMETA', 'pack.mcmeta missing "pack" field')
  }
  const out = {
    format: Number.isFinite(pack.pack_format) ? pack.pack_format : null,
    minFormat: null,
    maxFormat: null,
    description: plainDescription(pack.description),
  }
  const sup = pack.supported_formats
  if (sup && typeof sup === 'object' && !Array.isArray(sup)) {
    if (Number.isFinite(sup.min_format_inclusive)) out.minFormat = sup.min_format_inclusive
    if (Number.isFinite(sup.max_format_inclusive)) out.maxFormat = sup.max_format_inclusive
  } else if (Array.isArray(sup) && sup.length >= 2) {
    if (Number.isFinite(sup[0])) out.minFormat = sup[0]
    if (Number.isFinite(sup[1])) out.maxFormat = sup[1]
  }
  return out
}

/* ── version.json 解析（jar 解包布局的版本回退）──── */

/* 原版 / Fabric 客户端 jar 根部带 version.json：取 id（版本号）与 pack_version.resource（资源包格式 major.minor） */

/* ── version.json 解析（jar 解包布局的版本回退）──── */

/* 原版 / Fabric 客户端 jar 根部带 version.json：取 id（版本号）与 pack_version.resource（资源包格式 major.minor） */
function parseVersionJson(text) {
  let raw
  try { raw = JSON.parse(text) } catch { return null }
  if (!raw || typeof raw !== 'object') return null
  const pv = raw.pack_version && typeof raw.pack_version === 'object' ? raw.pack_version : {}
  const major = Number.isFinite(pv.resource_major) ? pv.resource_major : null
  const minor = Number.isFinite(pv.resource_minor) ? pv.resource_minor : 0
  const id = typeof raw.id === 'string' && raw.id ? raw.id : (typeof raw.name === 'string' ? raw.name : '')
  return {
    format: major,
    formatLabel: major != null ? (minor ? major + '.' + minor : String(major)) : null,
    versionRange: id,
  }
}

async function tryReadVersionJson(root) {
  try {
    return parseVersionJson(await fs.promises.readFile(path.join(root, VERSION_JSON_NAME), 'utf8'))
  } catch { return null }
}

/* ── 单个包分析 ──────────────────────────────── */

/* 定位目录包的包根：pack.mcmeta 所在目录；无 mcmeta 时回退到含 assets/ 的目录（如 Fabric jar 解压布局）。
   返回 { root, text|null, namespaces, versionInfo|null }；text=null 表示缺 mcmeta（可回退 version.json 分析版本，贴图仍可枚举）。 */

module.exports = { plainDescription, parseMcmetaText, parseVersionJson, tryReadVersionJson }
