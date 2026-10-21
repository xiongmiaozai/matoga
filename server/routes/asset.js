/**
 * matoga - 总资产库路由
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * GET    /api/asset               获取收藏夹与最近使用
 * GET    /api/asset/type/:type    按分类获取（tex/hdri/mc/preset）
 * PUT    /api/asset/favorites     保存收藏夹 { items: [...] }
 * PUT    /api/asset/recent        保存最近使用 { items: [...] }
 * GET    /api/asset/info?path=    获取文件 stat（大小/时间），用于详情面板
 */

const express = require('express')
const fs = require('fs')
const { ok, fail, wrap } = require('../middleware/errors')
const { guardRead } = require('../middleware/validate')
const store = require('../config/asset-store')

const router = express.Router()

router.get('/', wrap(async (req, res) => {
  ok(res, store.get())
}))

router.get('/type/:type', wrap(async (req, res) => {
  const { type } = req.params
  if (!store.VALID_TYPES.has(type)) return fail(res, 'ERR_INVALID_PARAM', 'invalid asset type')
  ok(res, store.getByType(type))
}))

router.put('/favorites', wrap(async (req, res) => {
  const items = (req.body && req.body.items) || []
  await store.setFavorites(items)
  ok(res, { count: store.getFavorites().length })
}))

router.put('/recent', wrap(async (req, res) => {
  const items = (req.body && req.body.items) || []
  await store.setRecent(items)
  ok(res, { count: store.getRecent().length })
}))

router.get('/info', wrap(async (req, res) => {
  const p = guardRead(req.query.path)
  try {
    const s = await fs.promises.stat(p)
    ok(res, { exists: true, isDirectory: s.isDirectory(), size: s.size, mtime: s.mtimeMs })
  } catch {
    ok(res, { exists: false, isDirectory: false, size: 0, mtime: 0 })
  }
}))

module.exports = router