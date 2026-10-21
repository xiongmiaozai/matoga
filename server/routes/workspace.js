/**
 * matoga - 材质贴图对比工具
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 */

const express = require('express')
const { ok, fail, wrap } = require('../middleware/errors')
const ws = require('../config/workspace-store')

const router = express.Router()

router.get('/', wrap(async (req, res) => {
  ok(res, ws.get())
}))

router.put('/preset', wrap(async (req, res) => {
  const { name, config } = req.body || {}
  if (!name) return fail(res, 'ERR_INVALID_PARAM', 'name required')
  await ws.savePreset(name, config)
  ok(res, {})
}))

router.delete('/preset', wrap(async (req, res) => {
  const name = req.query.name
  if (!name) return fail(res, 'ERR_INVALID_PARAM', 'name required')
  await ws.deletePreset(name)
  ok(res, {})
}))

router.put('/rename', wrap(async (req, res) => {
  const { oldName, newName } = req.body || {}
  if (!oldName || !newName) return fail(res, 'ERR_INVALID_PARAM', 'oldName and newName required')
  await ws.renamePreset(oldName, newName)
  ok(res, {})
}))

router.put('/active', wrap(async (req, res) => {
  const { name } = req.body || {}
  await ws.setActive(name)
  ok(res, {})
}))

module.exports = router