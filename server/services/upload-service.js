/**
 * matoga - 材质贴图对比工具
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 */

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { AppError } = require('../../shared/errors')
const { logger } = require('../middleware/logger')
const { DATA_ROOT } = require('../paths')

const UPLOAD_DIR = path.join(DATA_ROOT, 'data', 'tmp', 'uploads')
const TTL_MS = 60 * 60 * 1000

const sessions = new Map()

function cleanup() {
  try {
    fs.rmSync(UPLOAD_DIR, { recursive: true, force: true })
  } catch {}
}

function begin() {
  const now = Date.now()
  for (const [id, s] of sessions) {
    if (now - s.created > TTL_MS) {
      try { fs.rmSync(s.rootPath, { recursive: true, force: true }) } catch {}
      sessions.delete(id)
    }
  }
  const uploadId = crypto.randomUUID()
  const rootPath = path.join(UPLOAD_DIR, uploadId)
  fs.mkdirSync(rootPath, { recursive: true })
  sessions.set(uploadId, { rootPath, created: now })
  return { uploadId, rootPath }
}

function sessionOf(uploadId) {
  const s = sessions.get(uploadId)
  if (!s) throw new AppError('ERR_INVALID_PARAM', 'unknown uploadId')
  return s
}

function safeRel(rel) {
  if (typeof rel !== 'string' || !rel.trim() || rel.includes('\0')) {
    throw new AppError('ERR_INVALID_PARAM', 'invalid relative path')
  }
  const n = path.normalize(rel.replace(/\\/g, '/'))
  if (path.isAbsolute(n) || n.split(path.sep).includes('..') || n.split('/').includes('..')) {
    throw new AppError('ERR_PATH_DENIED', 'path traversal denied')
  }
  return n
}

function putFile(uploadId, rel, buffer) {
  const s = sessionOf(uploadId)
  const dest = path.join(s.rootPath, safeRel(rel))
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  fs.writeFileSync(dest, buffer)
  return { written: true }
}

function end(uploadId) {
  const s = sessionOf(uploadId)
  logger.info('upload', `session ${uploadId} finalized at ${s.rootPath}`)
  return { rootPath: s.rootPath }
}

module.exports = { begin, putFile, end, cleanup, UPLOAD_DIR }