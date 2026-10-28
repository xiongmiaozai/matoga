/**
 * matoga - 制作包服务：自选清单
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 从 craft-pack-service.js 按职责搬出，逻辑未改。
 */
const { atomicWrite, readRaw } = require('./fs-utils')

const fs = require('fs')
const path = require('path')
const { SELECTION_FILE, MAX_ITEMS, MAX_EXPORT_ITEMS, enqueue } = require('./consts')

const { logger } = require('../../middleware/logger')
const { AppError } = require('../../lib/errors')
const assetStore = require('../../config/asset-store')

function sanitizeItem(item) {
  if (!item || typeof item !== 'object') return null
  if (typeof item.key !== 'string' || !item.key) return null
  const detected = assetStore.detectType(item.key)
  if (!detected) return null
  if (item.type && !assetStore.VALID_TYPES.has(item.type)) return null
  const type = item.type || detected
  if (type !== detected) return null
  return {
    key: item.key,
    name: typeof item.name === 'string' ? item.name : '',
    thumb: typeof item.thumb === 'string' ? item.thumb : null,
    type,
    path: typeof item.path === 'string' ? item.path : null,
    craftPath: typeof item.craftPath === 'string' ? item.craftPath : undefined,
    mtime: typeof item.mtime === 'number' ? item.mtime : 0,
    role: typeof item.role === 'string' ? item.role : undefined,
    color: typeof item.color === 'string' ? item.color : undefined,
    badge: typeof item.badge === 'string' ? item.badge : undefined,
  }
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


function getSelection() {
  return sanitizeList(readRaw(SELECTION_FILE).items, MAX_ITEMS)
}


function setSelection(items) {
  const clean = sanitizeList(items, MAX_ITEMS)
  const result = enqueue(() => {
    atomicWrite(SELECTION_FILE, { items: clean })
    return clean
  })
  result.catch((e) => { logger.error('craft', 'setSelection failed: ' + e.message) })
  return result
}


function addItem(item) {
  const cur = getSelection()
  const s = sanitizeItem(item)
  if (!s) throw new AppError('ERR_INVALID_PARAM', 'invalid craft item')
  const exists = cur.some(it => it.key === s.key)
  if (exists) return { added: false, count: cur.length }
  if (cur.length >= MAX_ITEMS) throw new AppError('ERR_INVALID_PARAM', 'craft pack full: ' + MAX_ITEMS)
  cur.push(s)
  return setSelection(cur).then(list => ({ added: true, count: list.length }))
}


function removeItem(key) {
  const cur = getSelection()
  const next = cur.filter(it => it.key !== key)
  if (next.length === cur.length) return Promise.resolve({ removed: false, count: cur.length })
  return setSelection(next).then(list => ({ removed: true, count: list.length }))
}


function clearSelection() {
  return setSelection([]).then(list => ({ cleared: true, count: list.length }))
}

/* ── 储存聚合：自选 + 收藏 + 最近（key 去重，前者优先） ── */


/* ── 储存聚合：自选 + 收藏 + 最近（key 去重，前者优先） ── */

function aggregateStorage() {
  const sel = getSelection()
  const fav = assetStore.getFavorites()
  const rec = assetStore.getRecent()
  const seen = new Set()
  const out = []
  for (const it of [...sel, ...fav, ...rec]) {
    if (seen.has(it.key)) continue
    seen.add(it.key)
    out.push(it)
  }
  return {
    items: out.slice(0, MAX_EXPORT_ITEMS),
    totals: { selection: sel.length, favorites: fav.length, recent: rec.length, aggregate: out.length },
  }
}

/* ── 资产解析：item → 目标相对路径 + 字节 ────────── */

module.exports = { sanitizeItem, sanitizeList, getSelection, setSelection, addItem, removeItem, clearSelection, aggregateStorage }
