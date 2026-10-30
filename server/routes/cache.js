/**
 * matoga - 材质贴图对比工具
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 缓存管理聚合路由：统一暴露各磁盘/内存缓存的统计与清理。
 *   GET    /api/cache/stats          返回全部缓存统计
 *   POST   /api/cache/clear          { target } 清指定类
 *   POST   /api/cache/clear-all      一键清全部
 *   POST   /api/cache/hdri-orphans   清理 HDRI 孤儿缩略图（源已删除的残留）
 */

const express = require('express')
const { ok, fail, wrap } = require('../middleware/errors')
const thumbService = require('../services/thumb-service')
const modelThumb = require('../services/model-thumb-service')
const hdriService = require('../services/hdri-service')

const langService = require('../services/lang-service')
const fileService = require('../services/file-service')

const router = express.Router()

const CACHES = {
  thumbs: {
    label: '贴图缩略图',
    kind: 'disk',
    stats: () => thumbService.stats(),
    clear: () => thumbService.clearAll()
  },
  'model-thumbs': {
    label: '模型缩略图',
    kind: 'disk',
    stats: () => modelThumb.stats(),
    clear: () => modelThumb.clearAll()
  },
  'hdri-thumbs': {
    label: 'HDRI 缩略图',
    kind: 'disk',
    stats: () => hdriService.stats(),
    clear: () => hdriService.clearAll()
  },

  'hash-mem': {
    label: '文件哈希缓存',
    kind: 'mem',
    stats: () => fileService.hashCacheStats(),
    clear: () => {
      fileService.invalidateHash()
      return fileService.hashCacheStats()
    }
  },
  'lang-mem': {
    label: '译名映射缓存',
    kind: 'mem',
    stats: () => langService.stats(),
    clear: () => {
      langService.clearCache()
      return langService.stats()
    }
  }
}

router.get(
  '/stats',
  wrap(async (req, res) => {
    const out = {}
    for (const [k, c] of Object.entries(CACHES)) {
      out[k] = { kind: c.kind, label: c.label, ...(await c.stats()) }
    }
    ok(res, out)
  })
)

router.post(
  '/clear',
  wrap(async (req, res) => {
    const target = req.body && req.body.target
    const c = CACHES[target]
    if (!c) return fail(res, 'ERR_INVALID_PARAM', 'unknown cache target: ' + target)
    ok(res, { target, result: await c.clear() })
  })
)

router.post(
  '/clear-all',
  wrap(async (req, res) => {
    const results = {}
    for (const [k, c] of Object.entries(CACHES)) results[k] = await c.clear()
    ok(res, results)
  })
)

router.post(
  '/hdri-orphans',
  wrap(async (req, res) => {
    ok(res, await hdriService.cleanupOrphans())
  })
)

module.exports = router
