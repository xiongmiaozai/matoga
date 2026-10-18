/**
 * matoga - 材质贴图对比工具
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 */

const fs = require('fs')
const path = require('path')
const { DATA_ROOT } = require('../paths')

const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 }

const state = {
  minLevel: LEVELS[process.env.MATOGA_LOG_LEVEL] !== undefined ? LEVELS[process.env.MATOGA_LOG_LEVEL] : LEVELS.info,
  logDir: path.join(DATA_ROOT, 'data', 'logs'),
  stream: null
}

function pad(n) { return String(n).padStart(2, '0') }

function dayFile() {
  const d = new Date()
  return `matoga-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}.log`
}

function ensureStream() {
  try {
    fs.mkdirSync(state.logDir, { recursive: true })
    const file = path.join(state.logDir, dayFile())
    if (!state.stream || state.stream.path !== file) {
      if (state.stream) state.stream.end()
      state.stream = fs.createWriteStream(file, { flags: 'a' })
    }
  } catch { state.stream = null }
}

function write(level, tag, msg) {
  if (LEVELS[level] < state.minLevel) return
  const line = `[${new Date().toISOString()}] [${level.toUpperCase()}] [${tag}] ${msg}`
  console.log(line)
  ensureStream()
  if (state.stream) state.stream.write(line + '\n')
}

const logger = {
  debug: (tag, msg) => write('debug', tag, msg),
  info: (tag, msg) => write('info', tag, msg),
  warn: (tag, msg) => write('warn', tag, msg),
  error: (tag, msg) => write('error', tag, msg)
}

module.exports = { logger }