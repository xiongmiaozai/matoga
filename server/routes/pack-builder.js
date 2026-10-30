/**
 * matoga - 资源包自动创建路由
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 */

const express = require('express')
const { ok, wrap } = require('../middleware/errors')
const builder = require('../services/pack-builder-service')

const router = express.Router()

router.get('/formats', wrap(async (req, res) => {
  ok(res, { formats: builder.listFormats() })
}))

router.post('/build', wrap(async (req, res) => {
  const b = req.body || {}
  const result = await builder.buildPack({
    name: b.name,
    description: b.description,
    packFormat: b.packFormat,
    minFormat: b.minFormat,
    maxFormat: b.maxFormat,
    namespace: b.namespace,
    files: b.files,
    items: b.items,
    packPng: b.packPng,
    packPngData: b.packPngData,
    output: b.output,
    destRoot: b.destRoot,
  })
  ok(res, result)
}))

module.exports = router