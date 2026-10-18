/**
 * matoga - 材质贴图对比工具
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 */

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { logger } = require('../middleware/logger')
const { DATA_ROOT, PRESET_ROOT } = require('../paths')

const ROOT = DATA_ROOT
const DATA_DIR = path.join(ROOT, 'data')
const FILE = path.join(DATA_DIR, 'config.json')
const PRESET = PRESET_ROOT

const SCHEMA = {
  locale: 'zh',
  theme: 'light',
  recursive: false,
  hash: false,
  onlyMissing: false,
  ignoreSys: true,
  ignoreCustom: '',
  viewMode: 'all',
  sortKey: 'status',
  sortDir: 'asc',
  statusFilter: 'all'
}

let writeQueue = Promise.resolve()

function readRaw() {
  try {
    return JSON.parse(fs.readFileSync(FILE, 'utf8'))
  } catch (e) {
    if (e.code !== 'ENOENT') logger.warn('config', 'bad config.json: ' + e.message)
    return {}
  }
}

function atomicWrite(cfg) {
  fs.mkdirSync(DATA_DIR, { recursive: true })
  const tmp = FILE + '.' + crypto.randomUUID() + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify(cfg, null, 2))
  fs.renameSync(tmp, FILE)
}

function get() {
  const cfg = { ...SCHEMA, ...readRaw() }
  if (!cfg.hdriPresetPath) cfg.hdriPresetPath = path.join(PRESET, 'HDRI预设')
  if (!cfg.mcPacksPath) cfg.mcPacksPath = path.join(PRESET, '材质包')
  return cfg
}

function put(patch) {
  writeQueue = writeQueue.then(() => {
    try {
      const merged = { ...SCHEMA, ...readRaw() }
      Object.assign(merged, patch || {})
      delete merged.windowBounds
      atomicWrite(merged)
    } catch (e) {
      logger.error('config', 'write failed: ' + e.message)
    }
  })
  return writeQueue
}

function clear() {
  writeQueue = writeQueue.then(() => {
    try { atomicWrite({}) } catch (e) { logger.error('config', 'clear failed: ' + e.message) }
  })
  return writeQueue
}

module.exports = { get, put, clear, FILE, DATA_DIR, ROOT }