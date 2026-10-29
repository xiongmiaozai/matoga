/**
 * matoga - 材质贴图对比工具
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 */

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const configStore = require('../config/config-store')
const { DATA_ROOT } = require('../paths')
const { generateThumb } = require('./thumb-encode')

const THUMB_DIR = path.join(DATA_ROOT, 'data', 'hdri-thumbs')
const THUMB_W = 480
const THUMB_H = 240
const THUMB_VERSION = 2

const LIST_CACHE = new Map()

function thumbPathFor(filePath) {
  const hash = crypto.createHash('md5').update(path.normalize(filePath).toLowerCase()).digest('hex')
  return path.join(THUMB_DIR, hash + '.png')
}

async function list() {
  const cfg = configStore.get()
  const dir = cfg.hdriPresetPath
  // 目录可能尚未创建或被移动：视为空列表，不让整个端点 500
  if (!dir || typeof dir !== 'string') return []
  const dirStat = await fs.promises.stat(dir).catch(() => null)
  if (!dirStat) return []
  const dirMtime = Math.round(dirStat.mtimeMs)
  const cached = LIST_CACHE.get(dir)
  if (cached && cached.mtime === dirMtime) return cached.value
  const names = await fs.promises.readdir(dir)
  const entries = []
  for (const name of names) {
    const ext = path.extname(name).toLowerCase()
    if (ext !== '.hdr' && ext !== '.exr') continue
    const fullPath = path.join(dir, name)
    try {
      const stat = await fs.promises.stat(fullPath)
      if (stat.isFile()) entries.push({ name, fullPath, size: stat.size, mtime: stat.mtimeMs })
    } catch {}
  }
  entries.sort((a, b) => a.name.localeCompare(b.name, 'zh'))
  const result = { dir, entries }
  LIST_CACHE.set(dir, { mtime: dirMtime, value: result })
  return result
}

function invalidateList(dir) {
  if (!dir) { LIST_CACHE.clear(); return }
  LIST_CACHE.delete(dir)
}

async function thumbInfo(fullPath) {
  const thumbPath = thumbPathFor(fullPath)
  const metaPath = thumbPath + '.json'
  const hdrStat = await fs.promises.stat(fullPath)
  let exists = false, stale = true, mtime = 0, blurhash = null
  try {
    const tStat = await fs.promises.stat(thumbPath)
    exists = true
    mtime = tStat.mtimeMs
    stale = tStat.mtimeMs < hdrStat.mtimeMs
  } catch {}
  if (exists && !stale) {
    try {
      const meta = JSON.parse(await fs.promises.readFile(metaPath, 'utf8'))
      if (meta.version === THUMB_VERSION) blurhash = meta.blurhash
      else stale = true
    } catch {}
  }
  const thumbUrl = '/api/hdri/thumb?path=' + encodeURIComponent(fullPath)
  return { exists, stale, thumbUrl, mtime, blurhash }
}

async function saveThumb(fullPath, dataUrl) {
  await fs.promises.mkdir(THUMB_DIR, { recursive: true })
  const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1)
  if (!base64 || base64.length > 10 * 1024 * 1024) return { success: false, error: 'invalid thumb data' }
  await fs.promises.writeFile(thumbPathFor(fullPath), Buffer.from(base64, 'base64'))
  const thumbUrl = '/api/hdri/thumb?path=' + encodeURIComponent(fullPath)
  return { success: true, thumbUrl }
}

async function ensureThumb(fullPath) {
  const thumbPath = thumbPathFor(fullPath)
  const metaPath = thumbPath + '.json'
  const hdrStat = await fs.promises.stat(fullPath)
  let needGen = true
  try {
    const tStat = await fs.promises.stat(thumbPath)
    if (tStat.mtimeMs >= hdrStat.mtimeMs) {
      try {
        const meta = JSON.parse(await fs.promises.readFile(metaPath, 'utf8'))
        if (meta.version === THUMB_VERSION) needGen = false
      } catch {}
    }
  } catch {}
  if (needGen) {
    const buf = await fs.promises.readFile(fullPath)
    const ext = path.extname(fullPath).slice(1)
    const { png, blurhash } = generateThumb(buf, ext, THUMB_W, THUMB_H)
    await fs.promises.mkdir(THUMB_DIR, { recursive: true })
    await fs.promises.writeFile(thumbPath, png)
    await fs.promises.writeFile(metaPath, JSON.stringify({ version: THUMB_VERSION, blurhash, mtime: hdrStat.mtimeMs }))
  }
  return thumbPath
}

async function cleanupOrphans() {
  const cfg = configStore.get()
  const dir = cfg.hdriPresetPath
  const valid = new Set()
  try {
    const names = await fs.promises.readdir(dir)
    for (const name of names) {
      const ext = path.extname(name).toLowerCase()
      if (ext === '.hdr' || ext === '.exr') valid.add(path.basename(thumbPathFor(path.join(dir, name))))
    }
  } catch {}
  let removed = 0
  try {
    const files = await fs.promises.readdir(THUMB_DIR)
    for (const f of files) {
      const base = f.endsWith('.json') ? f.slice(0, -5) : f
      if (!valid.has(base)) { await fs.promises.unlink(path.join(THUMB_DIR, f)).catch(() => {}); removed++ }
    }
  } catch {}
  return { removed, valid: valid.size }
}

module.exports = { list, invalidateList, thumbInfo, saveThumb, ensureThumb, cleanupOrphans, thumbPathFor, THUMB_DIR, THUMB_W, THUMB_H }