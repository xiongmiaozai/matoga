/**
 * matoga - 材质贴图对比工具
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 */

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { logger } = require('../middleware/logger')
const { DATA_ROOT } = require('../paths')

const DATA_DIR = path.join(DATA_ROOT, 'data')
const DIR = path.join(DATA_DIR, 'workspaces')
const INDEX_FILE = path.join(DIR, 'index.json')
const LEGACY_FILE = path.join(DATA_DIR, 'workspaces.json')
const LEGACY_BAK = path.join(DATA_DIR, 'workspaces.json.bak')

let writeQueue = Promise.resolve()

function safeName(name) {
  let s = String(name)
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/^[\s.]+|[\s.]+$/g, '')
  if (!s) s = 'unnamed'
  return s
}

function allocFilename(name, items, excludeName) {
  const base = safeName(name)
  let filename = base + '.json'
  let n = 1
  while (true) {
    const clash = Object.entries(items || {})
      .find(([nm, fn]) => fn === filename && nm !== excludeName)
    if (!clash) return filename
    filename = `${base}.${n}.json`
    n++
  }
}

function readIndex() {
  try {
    const idx = JSON.parse(fs.readFileSync(INDEX_FILE, 'utf8'))
    return {
      version: idx.version || 1,
      active: idx.active || null,
      items: idx.items && typeof idx.items === 'object' ? idx.items : {}
    }
  } catch (e) {
    if (e.code !== 'ENOENT') logger.warn('workspace', 'bad index.json: ' + e.message)
    return { version: 1, active: null, items: {} }
  }
}

function writeIndexAtomic(idx) {
  fs.mkdirSync(DIR, { recursive: true })
  const tmp = INDEX_FILE + '.' + crypto.randomUUID() + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify(idx, null, 2))
  fs.renameSync(tmp, INDEX_FILE)
}

function writePresetFileAtomic(filename, payload) {
  fs.mkdirSync(DIR, { recursive: true })
  const fp = path.join(DIR, filename)
  const tmp = fp + '.' + crypto.randomUUID() + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify(payload, null, 2))
  fs.renameSync(tmp, fp)
}

function readPresetFile(filename) {
  try {
    return JSON.parse(fs.readFileSync(path.join(DIR, filename), 'utf8'))
  } catch (e) {
    if (e.code !== 'ENOENT') logger.warn('workspace', 'bad preset file ' + filename + ': ' + e.message)
    return null
  }
}

function migrateIfNeeded() {
  if (fs.existsSync(DIR)) return
  if (!fs.existsSync(LEGACY_FILE)) return
  try {
    const raw = JSON.parse(fs.readFileSync(LEGACY_FILE, 'utf8'))
    const presets = raw.presets || {}
    const items = {}
    fs.mkdirSync(DIR, { recursive: true })
    for (const [name, preset] of Object.entries(presets)) {
      const filename = allocFilename(name, items, null)
      writePresetFileAtomic(filename, {
        name,
        config: preset.config,

        updatedAt: preset.updatedAt || Date.now()
      })
      items[name] = filename
    }
    writeIndexAtomic({ version: 1, active: raw.active || null, items })
    try { fs.renameSync(LEGACY_FILE, LEGACY_BAK) }
    catch (e) { logger.warn('workspace', 'rename legacy bak failed: ' + e.message) }
    logger.info('workspace', 'migrated ' + Object.keys(items).length + ' presets to multi-file storage')
  } catch (e) {
    logger.error('workspace', 'migration failed: ' + e.message)
  }
}

function get() {
  migrateIfNeeded()
  const idx = readIndex()
  const presets = {}
  for (const [name, filename] of Object.entries(idx.items)) {
    const p = readPresetFile(filename)
    if (p && p.config !== undefined) {
      presets[name] = { config: p.config, updatedAt: p.updatedAt || null }
    }
  }
  return { presets, active: idx.active || null }
}

function savePreset(name, config) {
  if (!name || typeof name !== 'string') throw new Error('ERR_INVALID_PARAM')
  migrateIfNeeded()
  writeQueue = writeQueue.then(() => {
    try {
      const idx = readIndex()
      const filename = allocFilename(name, idx.items, name)
      writePresetFileAtomic(filename, { name, config, updatedAt: Date.now() })
      idx.items[name] = filename
      writeIndexAtomic(idx)
    } catch (e) { logger.error('workspace', 'savePreset failed: ' + e.message) }
  })
  return writeQueue
}

function deletePreset(name) {
  migrateIfNeeded()
  writeQueue = writeQueue.then(() => {
    try {
      const idx = readIndex()
      const filename = idx.items[name]
      if (!filename) return

      try { fs.rmSync(path.join(DIR, filename), { force: true }) } catch {}
      delete idx.items[name]
      if (idx.active === name) idx.active = null
      writeIndexAtomic(idx)
    } catch (e) { logger.error('workspace', 'deletePreset failed: ' + e.message) }
  })
  return writeQueue
}

function renamePreset(oldName, newName) {
  if (!newName || typeof newName !== 'string') throw new Error('ERR_INVALID_PARAM')
  migrateIfNeeded()
  writeQueue = writeQueue.then(() => {
    try {
      const idx = readIndex()
      const oldFilename = idx.items[oldName]
      if (!oldFilename) return
      const oldPreset = readPresetFile(oldFilename)
      if (!oldPreset) return
      const newFilename = allocFilename(newName, idx.items, oldName)
      if (idx.items[newName] && newName !== oldName && idx.items[newName] !== newFilename) {
        try { fs.rmSync(path.join(DIR, idx.items[newName]), { force: true }) } catch {}
      }
      writePresetFileAtomic(newFilename, {
        name: newName,
        config: oldPreset.config,

        updatedAt: oldPreset.updatedAt || Date.now()
      })
      if (newFilename !== oldFilename) {
        try { fs.rmSync(path.join(DIR, oldFilename), { force: true }) } catch {}
      }
      delete idx.items[oldName]
      idx.items[newName] = newFilename
      if (idx.active === oldName) idx.active = newName
      writeIndexAtomic(idx)
    } catch (e) { logger.error('workspace', 'renamePreset failed: ' + e.message) }
  })
  return writeQueue
}

function setActive(name) {
  migrateIfNeeded()
  writeQueue = writeQueue.then(() => {
    try {
      const idx = readIndex()
      idx.active = name || null
      writeIndexAtomic(idx)
    } catch (e) { logger.error('workspace', 'setActive failed: ' + e.message) }
  })
  return writeQueue
}

module.exports = { get, savePreset, deletePreset, renamePreset, setActive, DIR, INDEX_FILE, LEGACY_FILE, LEGACY_BAK, migrateIfNeeded }