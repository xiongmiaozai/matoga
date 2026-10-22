/**
 * matoga - Blockbench 集成路由
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * GET    /api/blockbench/status          安装状态 + 版本
 * POST   /api/blockbench/fetch           触发拉取最新 Web 产物
 * GET    /api/blockbench/models          列出已保存模型
 * POST   /api/blockbench/models          保存模型 { id?, name, data }
 * GET    /api/blockbench/models/:id      读取模型
 * DELETE /api/blockbench/models/:id      删除模型
 * GET    /api/blockbench/inbox           列出收件箱（待应用材质）
 * POST   /api/blockbench/inbox           推送材质到收件箱 { name, dataUrl, meta? }
 * DELETE /api/blockbench/inbox/:id       清除收件箱条目
 */

const express = require('express')
const { ok, fail, wrap } = require('../middleware/errors')
const svc = require('../services/blockbench-service')

const router = express.Router()

router.get('/status', wrap(async (req, res) => ok(res, svc.getStatus())))

router.post('/fetch', wrap(async (req, res) => {
  const log = await svc.fetchLatest()
  ok(res, { ...svc.getStatus(), log })
}))

router.get('/models', wrap(async (req, res) => ok(res, { models: await svc.listModels() })))

router.post('/models', wrap(async (req, res) => {
  const b = req.body || {}
  if (!b.data) return fail(res, 'ERR_INVALID_PARAM', 'data required')
  ok(res, await svc.saveModel({ id: b.id, name: b.name, data: b.data }))
}))

router.get('/models/:id', wrap(async (req, res) => ok(res, await svc.loadModel(req.params.id))))

router.delete('/models/:id', wrap(async (req, res) => ok(res, await svc.deleteModel(req.params.id))))

router.get('/inbox', wrap(async (req, res) => ok(res, { items: await svc.listInbox() })))

router.post('/inbox', wrap(async (req, res) => {
  const b = req.body || {}
  if (!b.dataUrl) return fail(res, 'ERR_INVALID_PARAM', 'dataUrl required')
  ok(res, await svc.pushToInbox({ name: b.name, dataUrl: b.dataUrl, meta: b.meta }))
}))

router.delete('/inbox/:id', wrap(async (req, res) => ok(res, await svc.clearInboxItem(req.params.id))))

module.exports = router