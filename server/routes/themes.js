/**
 * matoga - 主题 API
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 主题仅读写 data/themes/*.json，不触碰任何业务数据。
 */

const express = require('express')
const { ok, wrap } = require('../middleware/errors')
const store = require('../services/theme-store')

const router = express.Router()

router.get(
  '/',
  wrap(async (req, res) => {
    ok(res, store.list())
  })
)

router.get(
  '/:id',
  wrap(async (req, res) => {
    const t = store.get(req.params.id)
    if (!t) return ok(res, null)
    ok(res, t)
  })
)

router.put(
  '/:id',
  wrap(async (req, res) => {
    const rec = store.put(req.params.id, req.body || {})
    ok(res, rec)
  })
)

router.delete(
  '/:id',
  wrap(async (req, res) => {
    const removed = store.del(req.params.id)
    ok(res, { removed })
  })
)

router.post(
  '/import',
  wrap(async (req, res) => {
    const rec = store.importTheme(req.body || {})
    ok(res, rec)
  })
)

module.exports = router
