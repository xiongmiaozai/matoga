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

const THUMB_DIR = path.join(DATA_ROOT, 'data', 'hdri-thumbs')

const LIST_CACHE = new Map()

function thumbPathFor(filePath) {
  const hash = crypto.createHash('md5').update(path.normalize(filePath).toLowerCase()).digest('hex')
  return path.join(THUMB_DIR, hash + '.jpg')
}

async function list() {
  const cfg = configStore.get()
  const dir = cfg.hdriPresetPath
  const dirStat = await fs.promises.stat(dir)
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
  const hdrStat = await fs.promises.stat(fullPath)
  let exists = false, stale = true, mtime = 0
  try {
    const tStat = await fs.promises.stat(thumbPath)
    exists = true
    mtime = tStat.mtimeMs
    stale = tStat.mtimeMs < hdrStat.mtimeMs
  } catch {}
  const thumbUrl = '/api/hdri/thumb?path=' + encodeURIComponent(fullPath)
  return { exists, stale, thumbUrl, mtime }
}

async function saveThumb(fullPath, dataUrl) {
  await fs.promises.mkdir(THUMB_DIR, { recursive: true })
  const base64 = dataUrl.replace(/^data:image\/\w+;base64,/, '')
  if (!base64 || base64.length > 10 * 1024 * 1024) return { success: false, error: 'invalid thumb data' }
  await fs.promises.writeFile(thumbPathFor(fullPath), Buffer.from(base64, 'base64'))
  const thumbUrl = '/api/hdri/thumb?path=' + encodeURIComponent(fullPath)
  return { success: true, thumbUrl }
}

module.exports = { list, invalidateList, thumbInfo, saveThumb, thumbPathFor, THUMB_DIR }