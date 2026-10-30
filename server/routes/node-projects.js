/**
 * matoga - 节点项目管理路由
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * GET    /api/node-projects            列出项目（data/node-projects/ 下所有 .mtgp）
 * POST   /api/node-projects            保存项目 { id?, name, graph, thumbnail?, textures? }
 * GET    /api/node-projects/:id        读取工程（graph + textures 映射）
 * DELETE /api/node-projects/:id        删除项目
 * PUT    /api/node-projects/:id/rename 重命名 { name }
 * GET    /api/node-projects/:id/thumb  资产图
 */

const fs = require('fs')
const express = require('express')
const { ok, fail, wrap } = require('../middleware/errors')
const store = require('../config/node-project-store')

const router = express.Router()

router.get(
  '/',
  wrap(async (req, res) => {
    ok(res, { projects: store.list(), dir: store.getDir() })
  })
)

router.post(
  '/',
  wrap(async (req, res) => {
    const b = req.body || {}
    const id = await store.save({
      id: b.id,
      name: b.name,
      graph: b.graph,
      thumbnail: b.thumbnail,
      textures: b.textures
    })
    ok(res, { id, dir: store.projectDir(id) })
  })
)

router.get(
  '/:id',
  wrap(async (req, res) => {
    ok(res, store.load(req.params.id))
  })
)

router.delete(
  '/:id',
  wrap(async (req, res) => {
    await store.remove(req.params.id)
    ok(res, { id: req.params.id })
  })
)

router.put(
  '/:id/rename',
  wrap(async (req, res) => {
    ok(res, await store.rename(req.params.id, req.body && req.body.name))
  })
)

router.get(
  '/:id/thumb',
  wrap(async (req, res) => {
    const p = store.thumbPath(req.params.id)
    try {
      await fs.promises.access(p)
    } catch {
      return fail(res, 'ERR_FS_NOT_FOUND', 'thumbnail not found')
    }
    res.sendFile(p, err => {
      if (err && !res.headersSent) fail(res, 'ERR_FS_NOT_FOUND', err.message)
    })
  })
)

module.exports = router
