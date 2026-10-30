/**
 * matoga - 材质贴图对比工具
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 */

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { logger } = require('../middleware/logger')
const { atomicWriteJson } = require('./atomic-write')
const { DATA_ROOT, PRESET_ROOT } = require('../paths')

const ROOT = DATA_ROOT
const DATA_DIR = path.join(ROOT, 'data')
const FILE = path.join(DATA_DIR, 'config.json')
const PRESET = PRESET_ROOT

try {
  fs.mkdirSync(DATA_DIR, { recursive: true })
} catch (e) {
  logger.warn('config', 'cannot create data dir: ' + e.message)
}

const SCHEMA = {
  locale: 'zh',
  theme: 'light',
  themeMode: 'auto',
  recursive: false,
  hash: false,
  onlyMissing: false,
  ignoreSys: true,
  ignoreCustom: '',
  viewMode: 'all',
  sortKey: 'status',
  sortDir: 'asc',
  statusFilter: 'all',
  typeFilter: 'all',
  contentFilter: 'all',
  categoryFilter: { type: 'all', content: 'all', status: 'all', folder: 'all', tag: 'all' },
  modelGroupBy: 'type',
  modelGroupRules: [],
  thumbRenderConcurrency: 6,
  thumbMaxInflight: 16,
  thumbObserverMargin: 400
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

function get() {
  const cfg = { ...SCHEMA, ...readRaw() }
  if (!cfg.hdriPresetPath) cfg.hdriPresetPath = path.join(PRESET, 'hdri-presets')
  if (!cfg.mcPacksPath) cfg.mcPacksPath = path.join(PRESET, 'mc-packs')
  if (!cfg.officialPacksPath) cfg.officialPacksPath = path.join(PRESET, 'official-packs')
  if (!cfg.craftPacksPath) cfg.craftPacksPath = path.join(PRESET, 'craft-packs')
  if (!cfg.importedModelsPath) cfg.importedModelsPath = path.join(DATA_DIR, 'imported-models')
  if (!cfg.nodeProjectsPath) cfg.nodeProjectsPath = path.join(DATA_DIR, 'node-projects')

  return cfg
}

function put(patch) {
  writeQueue = writeQueue.then(() => {
    try {
      const merged = { ...SCHEMA, ...readRaw() }
      Object.assign(merged, patch || {})
      delete merged.windowBounds
      atomicWriteJson(FILE, merged)
    } catch (e) {
      logger.error('config', 'write failed: ' + e.message)
    }
  })
  return writeQueue
}

function clear() {
  writeQueue = writeQueue.then(() => {
    try {
      atomicWriteJson(FILE, {})
    } catch (e) {
      logger.error('config', 'clear failed: ' + e.message)
    }
  })
  return writeQueue
}

module.exports = { get, put, clear, FILE, DATA_DIR, ROOT }
