/**
 * matoga - 导入模型路由（用户主动导入的 .bbmodel / MC .json）
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * GET    /api/imported-models/location     专属本地目录
 * GET    /api/imported-models              列出已导入模型
 * POST   /api/imported-models              导入模型 { id?, name, data, ext? }
 * GET    /api/imported-models/:id          读取模型 { id, raw, json }
 * PUT    /api/imported-models/:id          覆盖更新模型 { data }
 * DELETE /api/imported-models/:id          删除模型
 */

const path = require('path')
const express = require('express')
const { ok, fail, wrap } = require('../middleware/errors')
const svc = require('../services/imported-model-service')
const modelThumb = require('../services/model-thumb-service')

const router = express.Router()

router.get('/location', wrap(async (req, res) => ok(res, { dir: svc.IMPORTED_MODELS_DIR, name: path.basename(svc.IMPORTED_MODELS_DIR) })))

router.get('/', wrap(async (req, res) => ok(res, { models: await svc.listModels() })))

router.post('/', wrap(async (req, res) => {
  const b = req.body || {}
  if (!b.data) return fail(res, 'ERR_INVALID_PARAM', 'data required')
  ok(res, await svc.saveModel({ id: b.id, name: b.name, data: b.data, ext: b.ext }))
}))

router.get('/:id', wrap(async (req, res) => ok(res, await svc.loadModel(req.params.id))))

router.put('/:id', wrap(async (req, res) => {
  const b = req.body || {}
  if (!b.data) return fail(res, 'ERR_INVALID_PARAM', 'data required')
  ok(res, await svc.updateModel(req.params.id, b.data))
}))

router.delete('/:id', wrap(async (req, res) => {
  const r = await svc.deleteModel(req.params.id)
  modelThumb.invalidate('im:' + req.params.id)
  ok(res, r)
}))

module.exports = router