/**
 * matoga - 材质贴图对比工具
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 */

const crypto = require('crypto')

let lanToken = null

function init() {
  lanToken = crypto.randomBytes(16).toString('hex')
  return lanToken
}

function middleware(req, res, next) {
  if (!lanToken) return next()
  if (req.method === 'GET' && /\.js$/i.test(req.path)) return next()
  const t = req.query.token || req.headers['x-matoga-token']
  if (t && t === lanToken) return next()
  res.status(401).json({ ok: false, code: 'ERR_UNAUTHORIZED', msg: 'invalid token' })
}

function requireLocal(req, res, next) {
  if (lanToken) {
    return res.status(403).json({ ok: false, code: 'ERR_LAN_FORBIDDEN', msg: 'shell API is disabled in LAN mode' })
  }
  next()
}

function getToken() { return lanToken }

module.exports = { init, middleware, requireLocal, getToken }