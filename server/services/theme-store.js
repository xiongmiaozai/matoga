/**
 * matoga - 主题存储服务
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 内置主题（light / dark / mc / mc-dark）+ 用户自定义主题。
 * 自定义主题保存在本地默认文件夹 data/themes/<id>.json，启动时扫描识别。
 */

const fs = require('fs')
const path = require('path')
const { logger } = require('../middleware/logger')
const { AppError } = require('../lib/errors')
const { atomicWriteJson } = require('../config/atomic-write')
const { DATA_ROOT } = require('../paths')

const THEMES_DIR = path.join(DATA_ROOT, 'data', 'themes')

try {
  fs.mkdirSync(THEMES_DIR, { recursive: true })
} catch (e) {
  logger.warn('themes', 'cannot create themes dir: ' + e.message)
}

const TOKEN_WHITELIST = new Set([
  '--bg',
  '--panel-bg',
  '--panel-2',
  '--panel-3',
  '--border',
  '--border-soft',
  '--text',
  '--text-muted',
  '--text-dim',
  '--primary',
  '--primary-hover',
  '--primary-soft',
  '--accent',
  '--accent-hover',
  '--accent-soft',
  '--danger',
  '--danger-soft',
  '--warn',
  '--warn-soft',
  '--partial',
  '--partial-soft',
  '--extra',
  '--extra-soft',
  '--tag-left-bg',
  '--tag-left-fg',
  '--tag-right-bg',
  '--tag-right-fg',
  '--tag-left-ring',
  '--tag-right-ring',
  '--primary-glow',
  '--row-hover',
  '--zebra',
  '--selected',
  '--checker',
  '--checker-2',
  '--shadow-1',
  '--shadow-2',
  '--shadow-3',
  '--radius-sm',
  '--radius-md',
  '--radius',
  '--radius-lg',
  '--radius-xl',
  '--fs-xs',
  '--fs-sm',
  '--fs-md',
  '--fs-base',
  '--fs-lg',
  '--fs-xl',
  '--fs-2xl',
  '--ease',
  '--mc-grass',
  '--mc-grass-dark',
  '--mc-stone',
  '--mc-stone-dark',
  '--mc-dirt',
  '--mc-dirt-dark',
  '--mc-diamond',
  '--mc-diamond-dark',
  '--mc-dark',
  '--mc-darker',
  '--mc-border-light',
  '--mc-border-dark'
])

const BUILTIN = [
  { id: 'light', name: '浅色', builtin: true, base: null, mode: 'light', tokens: {} },
  { id: 'dark', name: '深色', builtin: true, base: null, mode: 'dark', tokens: {} },
  { id: 'mc', name: 'Minecraft', builtin: true, base: null, mode: 'light', tokens: {} },
  { id: 'mc-dark', name: 'Minecraft 深色', builtin: true, base: null, mode: 'dark', tokens: {} }
]

const BUILTIN_IDS = new Set(BUILTIN.map(t => t.id))

function sanitizeTokens(raw) {
  const out = {}
  if (!raw || typeof raw !== 'object') return out
  for (const [k, v] of Object.entries(raw)) {
    if (TOKEN_WHITELIST.has(k) && typeof v === 'string' && v.length < 256) out[k] = v
  }
  return out
}

function sanitizeId(id) {
  return typeof id === 'string' && /^[a-z0-9][a-z0-9-]{0,62}$/.test(id) ? id : null
}

function readCustomFiles() {
  const out = []
  let entries = []
  try {
    entries = fs.readdirSync(THEMES_DIR, { withFileTypes: true })
  } catch {
    return out
  }
  for (const ent of entries) {
    if (!ent.isFile() || !ent.name.endsWith('.json')) continue
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(THEMES_DIR, ent.name), 'utf8'))
      if (!raw || typeof raw !== 'object') continue
      const id = sanitizeId(raw.id || ent.name.slice(0, -5))
      if (!id || BUILTIN_IDS.has(id)) continue
      out.push({
        id,
        name: typeof raw.name === 'string' ? raw.name.slice(0, 64) : id,
        builtin: false,
        base: BUILTIN_IDS.has(raw.base) ? raw.base : 'light',
        mode: raw.mode === 'dark' ? 'dark' : 'light',
        tokens: sanitizeTokens(raw.tokens)
      })
    } catch (e) {
      logger.warn('themes', 'skip bad file ' + ent.name + ': ' + e.message)
    }
  }
  return out
}

function list() {
  const custom = readCustomFiles()
  return { builtin: BUILTIN, custom }
}

function get(id) {
  if (BUILTIN_IDS.has(id)) return BUILTIN.find(t => t.id === id) || null
  const custom = readCustomFiles()
  return custom.find(t => t.id === id) || null
}

function put(id, def) {
  const cleanId = sanitizeId(id)
  if (!cleanId) throw new AppError('ERR_INVALID_PARAM', 'bad id')
  if (BUILTIN_IDS.has(cleanId)) throw new AppError('ERR_INVALID_PARAM', 'cannot overwrite builtin')
  const rec = {
    id: cleanId,
    name: typeof def.name === 'string' ? def.name.slice(0, 64) : cleanId,
    builtin: false,
    base: BUILTIN_IDS.has(def.base) ? def.base : 'light',
    mode: def.mode === 'dark' ? 'dark' : 'light',
    tokens: sanitizeTokens(def.tokens)
  }
  const file = path.join(THEMES_DIR, cleanId + '.json')
  atomicWriteJson(file, rec)
  return rec
}

function del(id) {
  const cleanId = sanitizeId(id)
  if (!cleanId) throw new AppError('ERR_INVALID_PARAM', 'bad id')
  if (BUILTIN_IDS.has(cleanId)) throw new AppError('ERR_INVALID_PARAM', 'cannot delete builtin')
  const file = path.join(THEMES_DIR, cleanId + '.json')
  try {
    fs.unlinkSync(file)
    return true
  } catch (e) {
    if (e.code === 'ENOENT') return false
    throw e
  }
}

function importTheme(def) {
  const id = sanitizeId(def.id) || 'theme-' + crypto.randomUUID().slice(0, 8)
  return put(id, def)
}

module.exports = { THEMES_DIR, list, get, put, del, importTheme, BUILTIN_IDS, TOKEN_WHITELIST }
