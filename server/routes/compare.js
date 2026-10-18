/**
 * matoga - 材质贴图对比工具
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 */

const express = require('express')
const { ok, wrap } = require('../middleware/errors')
const { guardRead, trust } = require('../middleware/validate')
const { scan } = require('../services/scan-service')
const { logger } = require('../middleware/logger')

const router = express.Router()

router.post('/scan', wrap(async (req, res) => {
  const { path: p, recursive, ignore } = req.body || {}
  const n = guardRead(p)
  const t0 = Date.now()
  const entries = await scan(n, Array.isArray(ignore) ? ignore : null, !!recursive)
  trust(n)
  logger.info('scan', `${n} recursive=${!!recursive} entries=${entries.length} in ${Date.now() - t0}ms`)
  ok(res, { entries })
}))

module.exports = router