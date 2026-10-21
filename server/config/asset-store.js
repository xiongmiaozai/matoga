/**
 * matoga - 总资产库持久化存储
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 将资产库的收藏夹与最近使用列表持久化到 data/asset-library/ 子目录，
 * 收藏夹与最近使用分别存储为 favorites.json / recent.json，读写互不干扰。
 * 供前端跨会话/跨设备同步。采用原子写入 + 串行化队列，与 config/workspace 一致。
 */

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { logger } = require('../middleware/logger')
const { DATA_ROOT } = require('../paths')

const DATA_DIR = path.join(DATA_ROOT, 'data')
const DIR = path.join(DATA_DIR, 'asset-library')
const FAV_FILE = path.join(DIR, 'favorites.json')
const RECENT_FILE = path.join(DIR, 'recent.json')
const LEGACY_FILE = path.join(DATA_DIR, 'assets.json')

const VALID_TYPES = new Set(['tex', 'hdri', 'mc', 'official', 'preset', 'project'])
const MAX_FAV = 500
const MAX_RECENT = 50

let writeQueue = Promise.resolve()

function readRaw(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch (e) {
    if (e.code !== 'ENOENT') logger.warn('asset', 'bad ' + path.basename(file) + ': ' + e.message)
    return {}
  }
}

function atomicWrite(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = file + '.' + crypto.randomUUID() + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2))
  fs.renameSync(tmp, file)
}

function detectType(key) {
  if (typeof key !== 'string' || !key) return null
  const idx = key.indexOf(':')
  if (idx <= 0) return null
  const prefix = key.slice(0, idx)
  return VALID_TYPES.has(prefix) ? prefix : null
}

function isValidKey(key) {
  return detectType(key) !== null
}

function classifyByType(items) {
  const groups = { tex: [], hdri: [], mc: [], official: [], preset: [], project: [] }
  for (const it of items) {
    const s = sanitizeItem(it)
    if (!s) continue
    groups[s.type].push(s)
  }
  return groups
}

function sanitizeItem(item) {
  if (!item || typeof item !== 'object') return null
  if (typeof item.key !== 'string' || !item.key) return null
  const detected = detectType(item.key)
  if (!detected) return null
  if (item.type && !VALID_TYPES.has(item.type)) return null
  const type = item.type || detected
  if (type !== detected) return null
  const clean = {
    key: item.key,
    name: typeof item.name === 'string' ? item.name : '',
    thumb: typeof item.thumb === 'string' ? item.thumb : null,
    type,
    path: typeof item.path === 'string' ? item.path : null,
    mtime: typeof item.mtime === 'number' ? item.mtime : 0,
  }
  if (typeof item.role === 'string') clean.role = item.role
  if (typeof item.color === 'string') clean.color = item.color
  if (typeof item.badge === 'string') clean.badge = item.badge
  return clean
}

function sanitizeList(arr, max) {
  if (!Array.isArray(arr)) return []
  const seen = new Set()
  const out = []
  for (const it of arr) {
    const s = sanitizeItem(it)
    if (!s || seen.has(s.key)) continue
    seen.add(s.key)
    out.push(s)
    if (out.length >= max) break
  }
  return out
}

function migrateLegacy() {
  if (!fs.existsSync(LEGACY_FILE)) return
  if (fs.existsSync(FAV_FILE) || fs.existsSync(RECENT_FILE)) return
  try {
    const raw = JSON.parse(fs.readFileSync(LEGACY_FILE, 'utf8'))
    const fav = sanitizeList(raw.favorites, MAX_FAV)
    const rec = sanitizeList(raw.recent, MAX_RECENT)
    if (fav.length) atomicWrite(FAV_FILE, { favorites: fav })
    if (rec.length) atomicWrite(RECENT_FILE, { recent: rec })
    logger.info('asset', 'migrated legacy assets.json -> asset-library/')
  } catch (e) {
    logger.warn('asset', 'legacy migration skipped: ' + e.message)
  }
}

try { migrateLegacy() } catch (e) { logger.warn('asset', 'migration error: ' + e.message) }

function getFavorites() {
  return sanitizeList(readRaw(FAV_FILE).favorites, MAX_FAV)
}

function getRecent() {
  return sanitizeList(readRaw(RECENT_FILE).recent, MAX_RECENT)
}

function get() {
  return { favorites: getFavorites(), recent: getRecent() }
}

function getByType(type) {
  if (!VALID_TYPES.has(type)) return { favorites: [], recent: [] }
  const fav = getFavorites().filter(it => it.type === type)
  const rec = getRecent().filter(it => it.type === type)
  return { favorites: fav, recent: rec }
}

function setFavorites(items) {
  const clean = sanitizeList(items, MAX_FAV)
  writeQueue = writeQueue.then(() => {
    try { atomicWrite(FAV_FILE, { favorites: clean }) }
    catch (e) { logger.error('asset', 'setFavorites failed: ' + e.message) }
  })
  return writeQueue
}

function setRecent(items) {
  const clean = sanitizeList(items, MAX_RECENT)
  writeQueue = writeQueue.then(() => {
    try { atomicWrite(RECENT_FILE, { recent: clean }) }
    catch (e) { logger.error('asset', 'setRecent failed: ' + e.message) }
  })
  return writeQueue
}

module.exports = {
  get, getFavorites, getRecent, getByType,
  setFavorites, setRecent,
  classifyByType, detectType, isValidKey,
  DIR, FAV_FILE, RECENT_FILE, LEGACY_FILE,
  VALID_TYPES, MAX_FAV, MAX_RECENT,
}