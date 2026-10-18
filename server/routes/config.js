/**
 * matoga - 材质贴图对比工具
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 */

const express = require('express')
const { ok, wrap } = require('../middleware/errors')
const configStore = require('../config/config-store')

const router = express.Router()

router.get('/', wrap(async (req, res) => {
  ok(res, configStore.get())
}))

router.put('/', wrap(async (req, res) => {
  await configStore.put(req.body || {})
  ok(res, {})
}))

router.delete('/', wrap(async (req, res) => {
  await configStore.clear()
  ok(res, {})
}))

module.exports = router