/**
 * matoga - 材质贴图对比工具
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 贴图缩略图磁盘缓存。与 model-thumb-service / hdri-service 同构：
 *   <md5>.jpg   缩略图
 *   <md5>.json  sidecar { version, mtime, savedAt }
 * 失效策略：mtime 比较 + THUMB_VERSION 版本号（算法升级 bump 即全量失效）。
 * 无 sidecar 的旧缓存 → stale（前端渐进重新生成并补写 sidecar）。
 */

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { DATA_ROOT } = require('../paths')
const { dirStats, clearDir } = require('./cache-stats')

const THUMB_DIR = path.join(DATA_ROOT, 'data', 'thumbs')
const THUMB_VERSION = 1

function md5Of(filePath) {
  return crypto.createHash('md5').update(path.normalize(filePath).toLowerCase()).digest('hex')
}

function thumbPathFor(filePath) {
  return path.join(THUMB_DIR, md5Of(filePath) + '.jpg')
}

function metaPathFor(filePath) {
  return path.join(THUMB_DIR, md5Of(filePath) + '.json')
}

async function thumbInfo(fullPath) {
  const thumbPath = thumbPathFor(fullPath)
  const srcStat = await fs.promises.stat(fullPath)
  let exists = false,
    stale = true,
    mtime = 0
  try {
    const tStat = await fs.promises.stat(thumbPath)
    exists = true
    mtime = tStat.mtimeMs
    let sidecar = null
    try {
      sidecar = JSON.parse(await fs.promises.readFile(metaPathFor(fullPath), 'utf8'))
    } catch {}
    const outdated = !sidecar || typeof sidecar.version !== 'number' || sidecar.version < THUMB_VERSION
    stale = outdated || tStat.mtimeMs < srcStat.mtimeMs
  } catch {}
  const thumbUrl = '/api/file/thumb?path=' + encodeURIComponent(fullPath)
  return { exists, stale, thumbUrl, mtime, version: THUMB_VERSION }
}

async function saveThumb(fullPath, dataUrl) {
  await fs.promises.mkdir(THUMB_DIR, { recursive: true })
  const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1)
  if (!base64 || base64.length > 10 * 1024 * 1024) return { success: false, error: 'invalid thumb data' }
  await fs.promises.writeFile(thumbPathFor(fullPath), Buffer.from(base64, 'base64'))
  let srcMtime = 0
  try {
    srcMtime = (await fs.promises.stat(fullPath)).mtimeMs
  } catch {}
  await fs.promises.writeFile(
    metaPathFor(fullPath),
    JSON.stringify({ version: THUMB_VERSION, mtime: srcMtime, savedAt: Date.now() })
  )
  const thumbUrl = '/api/file/thumb?path=' + encodeURIComponent(fullPath)
  return { success: true, thumbUrl }
}

function invalidate(fullPath) {
  if (!fullPath) return
  try {
    fs.promises.unlink(thumbPathFor(fullPath)).catch(() => {})
  } catch {}
  try {
    fs.promises.unlink(metaPathFor(fullPath)).catch(() => {})
  } catch {}
}

async function stats() {
  return dirStats(THUMB_DIR)
}

async function clearAll() {
  return clearDir(THUMB_DIR)
}

module.exports = {
  thumbInfo,
  saveThumb,
  thumbPathFor,
  metaPathFor,
  invalidate,
  stats,
  clearAll,
  THUMB_DIR,
  THUMB_VERSION
}
