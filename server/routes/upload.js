/**
 * matoga - 材质贴图对比工具
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 */

const express = require('express')
const { ok, wrap } = require('../middleware/errors')
const uploadService = require('../services/upload-service')

const router = express.Router()

router.post('/begin', wrap(async (req, res) => {
  ok(res, uploadService.begin())
}))

router.put('/file', wrap(async (req, res) => {
  const uploadId = req.query.uploadId
  const rel = req.query.path
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  ok(res, uploadService.putFile(uploadId, rel, Buffer.concat(chunks)))
}))

router.post('/end', wrap(async (req, res) => {
  ok(res, uploadService.end(req.query.uploadId))
}))

module.exports = router