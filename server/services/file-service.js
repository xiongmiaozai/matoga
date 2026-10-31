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

function hashCacheKey(p, stat, canonical) {
  return p + '|' + Math.round(stat.mtimeMs) + '|' + stat.size + (canonical ? '|c' : '')
}

function evictHashCache() {
  if (HASH_CACHE.size < HASH_CACHE_MAX) return
  const firstKey = HASH_CACHE.keys().next().value
  HASH_CACHE.delete(firstKey)
}

function canonicalizeJson(obj) {
  if (Array.isArray(obj)) return obj.map(canonicalizeJson)
  if (obj && typeof obj === 'object') {
    const sorted = {}
    for (const k of Object.keys(obj).sort()) sorted[k] = canonicalizeJson(obj[k])
    return sorted
  }
  return obj
}

async function hashFile(p, canonical) {
  let stat
  try { stat = await fs.promises.stat(p) } catch { return null }
  const key = hashCacheKey(p, stat, canonical)
  const cached = HASH_CACHE.get(key)
  if (cached !== undefined) return cached
  if (canonical) {
    try {
      const raw = await fs.promises.readFile(p, 'utf8')
      const obj = JSON.parse(raw)
      const canonicalStr = JSON.stringify(canonicalizeJson(obj))
      const h = crypto.createHash('md5').update(canonicalStr).digest('hex')
      evictHashCache()
      HASH_CACHE.set(key, h)
      return h
    } catch {
      // JSON 解析失败,回退到普通哈希
    }
  }
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
    stream.on('error', () => { stream.destroy(); resolve(null) })
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
  return fs.promises.access(p, fs.constants.F_OK)
    .then(() => ({ success: true, created: false }))
    .catch(() => fs.promises.mkdir(p, { recursive: true })
      .then(() => ({ success: true, created: true }))
      .catch(err => ({ success: false, error: err.message })))
}

/* 感知哈希：与前端 web/src/perceptual-hash.js 保持同步 */
const POPCOUNT = [0, 1, 1, 2, 1, 2, 2, 3, 1, 2, 2, 3, 2, 3, 3, 4]

function _downsampleToGray(rgba, width, height, dstW, dstH) {
  const gray = new Uint8Array(dstW * dstH)
  for (let y = 0; y < dstH; y++) {
    for (let x = 0; x < dstW; x++) {
      const sx = ((x + 0.5) / dstW) * width
      const sy = ((y + 0.5) / dstH) * height
      const ix = Math.min(width - 1, Math.floor(sx))
      const iy = Math.min(height - 1, Math.floor(sy))
      const j = (iy * width + ix) * 4
      gray[y * dstW + x] = (rgba[j] * 0.299 + rgba[j + 1] * 0.587 + rgba[j + 2] * 0.114 + 0.5) | 0
    }
  }
  return gray
}

function computeAHash(rgba, width, height) {
  const size = 8
  const gray = _downsampleToGray(rgba, width, height, size, size)
  let sum = 0
  for (let i = 0; i < gray.length; i++) sum += gray[i]
  const avg = sum / gray.length
  let hex = '', nibble = 0
  for (let i = 0; i < gray.length; i++) {
    nibble = (nibble << 1) | (gray[i] > avg ? 1 : 0)
    if ((i & 3) === 3) { hex += nibble.toString(16); nibble = 0 }
  }
  return hex
}

function computeDHash(rgba, width, height) {
  const dw = 9, dh = 8
  const gray = _downsampleToGray(rgba, width, height, dw, dh)
  let hex = '', nibble = 0, bit = 0
  for (let y = 0; y < dh; y++) {
    for (let x = 0; x < dw - 1; x++) {
      nibble = (nibble << 1) | (gray[y * dw + x + 1] > gray[y * dw + x] ? 1 : 0)
      if (++bit === 4) { hex += nibble.toString(16); nibble = 0; bit = 0 }
    }
  }
  return hex
}

function hammingDistance(h1, h2) {
  if (typeof h1 !== 'string' || typeof h2 !== 'string' || h1.length !== h2.length) return -1
  let dist = 0
  for (let i = 0; i < h1.length; i++) {
    dist += POPCOUNT[parseInt(h1[i], 16) ^ parseInt(h2[i], 16)]
  }
  return dist
}

module.exports = { hashFile, invalidateHash, hashCacheStats, copyFile, backupFile, deleteFile, createFolder, computeAHash, computeDHash, hammingDistance, canonicalizeJson }