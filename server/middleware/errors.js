/**
 * matoga - 材质贴图对比工具
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 */

const { AppError, CODES } = require('../lib/errors')
const { logger } = require('./logger')

const STATUS_BY_CODE = {
  ERR_INVALID_PARAM: 400,
  ERR_PATH_DENIED: 403,
  ERR_FS_NOT_FOUND: 404,
  ERR_NOT_FOUND: 404,
  ERR_ALREADY_EXISTS: 409,
  ERR_LAN_FORBIDDEN: 403,
  ERR_UNAUTHORIZED: 401,
  ERR_CANCELLED: 499,
  ERR_UNKNOWN: 500
}

function ok(res, data) {
  res.json({ ok: true, data })
}

function fail(res, code, msg) {
  const status = STATUS_BY_CODE[code] || 500
  res.status(status).json({ ok: false, code, msg: msg || code })
}

function wrap(handler) {
  return async (req, res) => {
    try {
      await handler(req, res)
    } catch (e) {
      if (res.headersSent) { logger.error('http', `headersSent ${req.method} ${req.originalUrl} — ${e.stack || e.message}`); return }
      if (e instanceof AppError || (e && CODES[e.code])) {
        fail(res, e.code, e.message)
      } else {
        logger.error('http', `${req.method} ${req.originalUrl} — ${e.stack || e.message}`)
        fail(res, 'ERR_UNKNOWN', 'internal error')
      }
    }
  }
}

module.exports = { ok, fail, wrap }