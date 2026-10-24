/**
 * matoga - 材质贴图对比工具
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 */

const express = require('express')
const fs = require('fs')
const path = require('path')
const { ok, fail, wrap } = require('../middleware/errors')
const { guardRead, guardWrite } = require('../middleware/validate')
const fileService = require('../services/file-service')
const thumbService = require('../services/thumb-service')

const router = express.Router()

router.post('/hash', wrap(async (req, res) => {
  const p = guardRead(req.body && req.body.path)
  ok(res, { hash: await fileService.hashFile(p) })
}))

router.post('/copy', wrap(async (req, res) => {
  const { src, dest } = req.body || {}
  const s = guardRead(src)
  const d = guardWrite(dest)
  const r = await fileService.copyFile(s, d)
  fileService.invalidateHash(d)
  ok(res, r)
}))

router.post('/backup', wrap(async (req, res) => {
  const p = guardWrite(req.body && req.body.path)
  ok(res, await fileService.backupFile(p))
}))

router.post('/delete', wrap(async (req, res) => {
  const p = guardWrite(req.body && req.body.path)
  const r = await fileService.deleteFile(p)
  fileService.invalidateHash(p)
  ok(res, r)
}))

router.get('/raw', wrap(async (req, res) => {
  const p = guardRead(req.query.path)
  res.sendFile(p, { dotfiles: 'allow' }, (err) => {
    if (err && !res.headersSent) {
      res.status(404).json({ ok: false, code: 'ERR_FS_NOT_FOUND', msg: err.message })
    }
  })
}))

router.get('/thumb-info', wrap(async (req, res) => {
  const p = guardRead(req.query.path)
  try { ok(res, await thumbService.thumbInfo(p)) }
  catch (e) { fail(res, 'ERR_FS_NOT_FOUND', e.message) }
}))

router.get('/thumb', wrap(async (req, res) => {
  const p = guardRead(req.query.path)
  const info = await thumbService.thumbInfo(p)
  if (!info.exists) return fail(res, 'ERR_FS_NOT_FOUND', 'thumbnail not generated yet')
  res.sendFile(thumbService.thumbPathFor(p))
}))

router.post('/thumb', wrap(async (req, res) => {
  const p = guardRead(req.body && req.body.path)
  const dataUrl = req.body && req.body.dataUrl
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/')) {
    return fail(res, 'ERR_INVALID_PARAM', 'invalid dataUrl')
  }
  ok(res, await thumbService.saveThumb(p, dataUrl))
}))

router.post('/write', wrap(async (req, res) => {
  const p = guardWrite(req.body && req.body.path)
  const dataUrl = req.body && req.body.dataUrl
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/')) {
    return fail(res, 'ERR_INVALID_PARAM', 'invalid dataUrl')
  }
  const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1)
  if (!base64) return fail(res, 'ERR_INVALID_PARAM', 'empty image data')
  const buf = Buffer.from(base64, 'base64')
  await fs.promises.mkdir(path.dirname(p), { recursive: true })
  await fs.promises.writeFile(p, buf)
  fileService.invalidateHash(p)
  ok(res, { path: p, size: buf.length })
}))

module.exports = router