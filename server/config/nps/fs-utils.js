/**
 * matoga - 节点项目存储：文件工具与串行队列
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 从 node-project-store.js 按职责搬出，逻辑未改。
 */
const fs = require('fs'), path = require('path'), crypto = require('crypto')
const { MAX_NAME, IMG_EXT_RE, MAX_TEXTURE_BYTES, DIR } = require('./consts')

let writeQueue = Promise.resolve()

function atomicWrite(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = file + '.' + crypto.randomUUID() + '.tmp'
  fs.writeFileSync(tmp, data)
  fs.renameSync(tmp, file)
}

function sanitizeName(name) {
  if (typeof name !== 'string') return null
  const s = name.trim().replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, ' ')
  if (!s || s === '.' || s === '..' || s.length > MAX_NAME) return null
  return s
}

function safeTextureName(name, i) {
  const base = typeof name === 'string' && name.trim()
    ? name.trim().replace(/[\\/:*?"<>|\s]/g, '_').slice(0, 64)
    : ''
  const ext = base && IMG_EXT_RE.test(base) ? '' : '.png'
  const safe = base || ('texture_' + i)
  return i + '-' + safe + ext
}

function decodeDataUrl(dataUrl) {
  if (typeof dataUrl !== 'string') return null
  const m = /^data:([^;]+);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl)
  if (!m) return null
  const buf = Buffer.from(m[2], 'base64')
  if (!buf.length || buf.length > MAX_TEXTURE_BYTES) return null
  return { mime: m[1], buf }
}

function projectDir(id) {
  return path.join(DIR, id + '.mtgp')
}

function projectFile(id) {
  return path.join(projectDir(id), 'project.json')
}

function newId() {
  return 'p' + Date.now().toString(36) + crypto.randomBytes(3).toString('hex')
}


/* 串行写队列：所有原子写依次排队，避免并发 rename 冲突。
   队列状态被多个调用方使用且需要重新赋值，故封装在本模块内部，
   外部通过 enqueue(run) 提交任务、拿到该任务的 promise。 */
function enqueue(run) {
  writeQueue = writeQueue.then(run, run)
  return writeQueue
}

module.exports = { atomicWrite, sanitizeName, safeTextureName, decodeDataUrl, projectDir, projectFile, newId, enqueue }
