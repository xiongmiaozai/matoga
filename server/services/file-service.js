/**
 * matoga - 材质贴图对比工具
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 */

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

const HASH_CACHE = new Map()
const HASH_CACHE_MAX = 2000

function hashCacheKey(p, stat) {
  return p + '|' + Math.round(stat.mtimeMs) + '|' + stat.size
}

function evictHashCache() {
  if (HASH_CACHE.size < HASH_CACHE_MAX) return
  const firstKey = HASH_CACHE.keys().next().value
  HASH_CACHE.delete(firstKey)
}

async function hashFile(p) {
  let stat
  try { stat = await fs.promises.stat(p) } catch { return null }
  const key = hashCacheKey(p, stat)
  const cached = HASH_CACHE.get(key)
  if (cached !== undefined) return cached
  return new Promise((resolve) => {
    const hash = crypto.createHash('md5')
    const stream = fs.createReadStream(p)
    stream.on('data', d => hash.update(d))
    stream.on('end', () => {
      const h = hash.digest('hex')
      evictHashCache()
      HASH_CACHE.set(key, h)
      resolve(h)
    })
    stream.on('error', () => resolve(null))
  })
}

function invalidateHash(p) {
  if (!p) { HASH_CACHE.clear(); return }
  const prefix = p + '|'
  for (const k of HASH_CACHE.keys()) {
    if (k.startsWith(prefix)) HASH_CACHE.delete(k)
  }
}

function hashCacheStats() {
  return { size: HASH_CACHE.size, max: HASH_CACHE_MAX }
}

function copyFile(src, dest) {
  return fs.promises.mkdir(path.dirname(dest), { recursive: true })
    .then(() => fs.promises.copyFile(src, dest))
    .then(() => ({ success: true }))
    .catch(err => ({ success: false, error: err.message }))
}

function backupFile(filePath) {
  const dir = path.dirname(filePath)
  const ext = path.extname(filePath)
  const base = path.basename(filePath, ext)
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const backupPath = path.join(dir, `${base}_backup_${ts}${ext}`)
  return fs.promises.copyFile(filePath, backupPath)
    .then(() => ({ success: true, backupPath }))
    .catch(err => ({ success: false, error: err.message }))
}

function deleteFile(p) {
  return fs.promises.unlink(p)
    .then(() => ({ success: true }))
    .catch(err => ({ success: false, error: err.message }))
}

function createFolder(p) {
  return fs.promises.mkdir(p, { recursive: true })
    .then(() => ({ success: true }))
    .catch(err => ({ success: false, error: err.message }))
}

module.exports = { hashFile, invalidateHash, hashCacheStats, copyFile, backupFile, deleteFile, createFolder }