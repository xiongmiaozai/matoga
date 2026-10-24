/**
 * matoga - 材质贴图对比工具
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 */

const express = require('express')
const { ok, wrap } = require('../middleware/errors')
const uploadService = require('../services/upload-service')

const router = express.Router()

const MAX_UPLOAD_BYTES = 128 * 1024 * 1024

router.post('/begin', wrap(async (req, res) => {
  ok(res, uploadService.begin())
}))

router.put('/file', wrap(async (req, res) => {
  const uploadId = req.query.uploadId
  const rel = req.query.path
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > MAX_UPLOAD_BYTES) {
      const err = new Error('file too large (max 128MB)')
      err.code = 'ERR_INVALID_PARAM'
      throw err
    }
    chunks.push(chunk)
  }
  ok(res, uploadService.putFile(uploadId, rel, Buffer.concat(chunks)))
}))

router.post('/end', wrap(async (req, res) => {
  ok(res, uploadService.end(req.query.uploadId))
}))

module.exports = router