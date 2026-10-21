/**
 * matoga - 材质贴图对比工具
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 */

const syncService = require('./services/sync-service')
const uploadService = require('./services/upload-service')
const { logger, close: closeLogger } = require('./middleware/logger')

let closing = false

function gracefulShutdown({ server, wss, signal, exit = false, timeoutMs = 5000 }) {
  if (closing) return
  closing = true
  logger.info('server', signal ? `received ${signal}, shutting down` : 'shutting down')
  try { syncService.cancelAll() } catch {}
  if (wss) { try { wss.close() } catch {} }
  let finished = false
  const finish = () => {
    if (finished) return
    finished = true
    try { uploadService.cleanup() } catch {}
    try { closeLogger() } catch {}
    if (exit) process.exit(0)
  }
  if (server) {
    try {
      server.close(() => finish())
    } catch { finish() }
  } else {
    finish()
  }
  if (exit) {
    setTimeout(() => {
      try { logger.error('server', 'shutdown timeout, forcing exit') } catch {}
      process.exit(1)
    }, timeoutMs).unref()
  }
}

function isShuttingDown() { return closing }

module.exports = { gracefulShutdown, isShuttingDown }