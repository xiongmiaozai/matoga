/**
 * matoga - 材质贴图对比工具
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 */

const express = require('express')
const path = require('path')
const { ok, fail, wrap } = require('../middleware/errors')
const { guardRead } = require('../middleware/validate')
const hdriService = require('../services/hdri-service')

const router = express.Router()

router.get('/list', wrap(async (req, res) => {
  try {
    ok(res, await hdriService.list())
  } catch (e) {
    fail(res, 'ERR_FS', 'HDRI preset dir not readable: ' + e.message)
  }
}))

router.get('/thumb-info', wrap(async (req, res) => {
  const p = guardRead(req.query.path)
  try {
    ok(res, await hdriService.thumbInfo(p))
  } catch (e) {
    fail(res, 'ERR_FS_NOT_FOUND', e.message)
  }
}))

router.get('/thumb', wrap(async (req, res) => {
  const p = guardRead(req.query.path)
  const info = await hdriService.thumbInfo(p)
  if (!info.exists) return fail(res, 'ERR_FS_NOT_FOUND', 'thumbnail not generated yet')
  res.sendFile(hdriService.thumbPathFor(p))
}))

router.post('/thumb', wrap(async (req, res) => {
  const p = guardRead(req.body && req.body.path)
  const dataUrl = req.body && req.body.dataUrl
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/')) {
    return fail(res, 'ERR_INVALID_PARAM', 'invalid dataUrl')
  }
  ok(res, await hdriService.saveThumb(p, dataUrl))
}))

module.exports = router