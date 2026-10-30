/**
 * matoga - 导入模型路由（用户主动导入的 .bbmodel / MC .json）
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * GET    /api/imported-models/location            专属本地目录
 * GET    /api/imported-models                     列出已导入模型
 * POST   /api/imported-models                     导入模型 { id?, name, data, ext?, textures? }
 * GET    /api/imported-models/:id                 读取模型 { id, raw, json, texDir }
 * PUT    /api/imported-models/:id                 覆盖更新模型 { data }
 * DELETE /api/imported-models/:id                 删除模型（含贴图）
 * GET    /api/imported-models/:id/textures        列出该模型的贴图
 * POST   /api/imported-models/:id/textures        批量上传贴图 { textures: { relPath: dataUrl } }
 * DELETE /api/imported-models/:id/textures        删除单张贴图 { path }
 */

const path = require('path')
const express = require('express')
const { ok, fail, wrap } = require('../middleware/errors')
const svc = require('../services/imported-model-service')
const modelThumb = require('../services/model-thumb-service')
const syncPack = require('../services/sync-pack-service')

const router = express.Router()

router.get(
  '/location',
  wrap(async (req, res) => ok(res, { dir: svc.importedDir(), name: path.basename(svc.importedDir()) }))
)

router.get(
  '/',
  wrap(async (req, res) => ok(res, { models: await svc.listModels() }))
)

router.post(
  '/',
  wrap(async (req, res) => {
    const b = req.body || {}
    if (!b.data) return fail(res, 'ERR_INVALID_PARAM', 'data required')
    ok(res, await svc.saveModel({ id: b.id, name: b.name, data: b.data, ext: b.ext, textures: b.textures }))
  })
)

router.get(
  '/:id/textures',
  wrap(async (req, res) => ok(res, { textures: await svc.listTextures(req.params.id) }))
)

router.post(
  '/:id/textures',
  wrap(async (req, res) => {
    const b = req.body || {}
    const map = b.textures
    if (!map || typeof map !== 'object') return fail(res, 'ERR_INVALID_PARAM', 'textures map required')
    ok(res, await svc.saveTextures(req.params.id, map))
  })
)

router.delete(
  '/:id/textures',
  wrap(async (req, res) => {
    const p = (req.body && req.body.path) || req.query.path
    if (!p) return fail(res, 'ERR_INVALID_PARAM', 'path required')
    ok(res, await svc.deleteTexture(req.params.id, p))
  })
)

router.get(
  '/:id',
  wrap(async (req, res) => ok(res, await svc.loadModel(req.params.id)))
)

router.put(
  '/:id',
  wrap(async (req, res) => {
    const b = req.body || {}
    if (!b.data) return fail(res, 'ERR_INVALID_PARAM', 'data required')
    ok(res, await svc.updateModel(req.params.id, b.data))
  })
)

router.delete(
  '/:id',
  wrap(async (req, res) => {
    const r = await svc.deleteModel(req.params.id)
    modelThumb.invalidate('im:' + req.params.id)
    ok(res, r)
  })
)

router.post(
  '/:id/sync-pack',
  wrap(async (req, res) => {
    const { json } = await svc.loadModel(req.params.id)
    if (!json) return fail(res, 'ERR_NOT_FOUND', 'model json not found')
    const b = req.body || {}
    if (!b.packName) return fail(res, 'ERR_INVALID_PARAM', 'packName required')
    if (!b.relPath) return fail(res, 'ERR_INVALID_PARAM', 'relPath required')
    const result = await syncPack.syncModelJson({ packName: b.packName, relPath: b.relPath, json })
    ok(res, result)
  })
)

module.exports = router
