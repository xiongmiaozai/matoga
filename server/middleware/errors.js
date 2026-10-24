/**
 * matoga - 材质贴图对比工具
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 */

const { AppError, CODES } = require('../../shared/errors')
const { logger } = require('./logger')

function ok(res, data) {
  res.json({ ok: true, data })
}

function fail(res, code, msg) {
  res.json({ ok: false, code, msg: msg || code })
}

function wrap(handler) {
  return async (req, res) => {
    try {
      await handler(req, res)
    } catch (e) {
      if (e instanceof AppError || (e && CODES[e.code])) {
        fail(res, e.code, e.message)
      } else {
        logger.error('http', `${req.method} ${req.originalUrl} — ${e.stack || e.message}`)
        fail(res, 'ERR_UNKNOWN', e.message)
      }
    }
  }
}

module.exports = { ok, fail, wrap }