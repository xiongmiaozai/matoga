/**
 * matoga - 自定义模型路由（从模板创建 MC 模型）
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * GET    /api/custom-models/templates    可用模板列表
 * GET    /api/custom-models/location     专属本地目录
 * GET    /api/custom-models              已创建模型列表
 * POST   /api/custom-models              从模板创建 { template, name, namespace? }
 * GET    /api/custom-models/:id          读取模型记录
 * GET    /api/custom-models/:id/raw      读取模型 JSON（model 字段）
 * PUT    /api/custom-models/:id          更新 { model?, name? }
 * DELETE /api/custom-models/:id          删除模型
 */

const path = require('path')
const express = require('express')
const { ok, fail, wrap } = require('../middleware/errors')
const svc = require('../services/custom-model-service')
const modelThumb = require('../services/model-thumb-service')

const router = express.Router()

router.get('/templates', wrap(async (req, res) => ok(res, { templates: svc.listTemplates() })))

router.get('/location', wrap(async (req, res) => ok(res, { dir: svc.CUSTOM_MODELS_DIR, name: path.basename(svc.CUSTOM_MODELS_DIR) })))

router.get('/', wrap(async (req, res) => ok(res, { models: await svc.listModels() })))

router.post('/', wrap(async (req, res) => {
  const b = req.body || {}
  if (!b.template) return fail(res, 'ERR_INVALID_PARAM', 'template required')
  if (!b.name) return fail(res, 'ERR_INVALID_PARAM', 'name required')
  ok(res, await svc.createModel({ template: b.template, name: b.name, namespace: b.namespace }))
}))

router.get('/:id', wrap(async (req, res) => ok(res, await svc.loadModel(req.params.id))))

router.get('/:id/raw', wrap(async (req, res) => {
  const { json } = await svc.loadModel(req.params.id)
  if (!json || !json.model) return fail(res, 'ERR_NOT_FOUND', 'model json not found')
  ok(res, json.model)
}))

router.put('/:id', wrap(async (req, res) => {
  const b = req.body || {}
  if (b.model === undefined && b.name === undefined) return fail(res, 'ERR_INVALID_PARAM', 'model or name required')
  ok(res, await svc.updateModel(req.params.id, { model: b.model, name: b.name }))
}))

router.delete('/:id', wrap(async (req, res) => {
  const r = await svc.deleteModel(req.params.id)
  modelThumb.invalidate('cm:' + req.params.id)
  ok(res, r)
}))

module.exports = router