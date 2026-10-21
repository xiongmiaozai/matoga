/**
 * matoga - 总资产库路由
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * GET    /api/asset               获取收藏夹与最近使用
 * GET    /api/asset/type/:type    按分类获取（tex/hdri/mc/preset）
 * GET    /api/asset/tex           聚合全部贴图（MC 材质包 + 官方包，按包/类别分组）
 * PUT    /api/asset/favorites     保存收藏夹 { items: [...] }
 * PUT    /api/asset/recent        保存最近使用 { items: [...] }
 * GET    /api/asset/info?path=    获取文件 stat（大小/时间），用于详情面板
 */

const express = require('express')
const fs = require('fs')
const path = require('path')
const { ok, fail, wrap } = require('../middleware/errors')
const { guardRead } = require('../middleware/validate')
const store = require('../config/asset-store')
const configStore = require('../config/config-store')
const mcmeta = require('../services/mcmeta-service')

const router = express.Router()

router.get('/', wrap(async (req, res) => {
  ok(res, store.get())
}))

router.get('/type/:type', wrap(async (req, res) => {
  const { type } = req.params
  if (!store.VALID_TYPES.has(type)) return fail(res, 'ERR_INVALID_PARAM', 'invalid asset type')
  ok(res, store.getByType(type))
}))

/* 聚合 MC 材质包 + 官方材质包的全部贴图：每包按 textures/ 第一级类别分组（无分页） */
router.get('/tex', wrap(async (req, res) => {
  const cfg = configStore.get()
  async function collect(root) {
    if (!root || typeof root !== 'string') return []
    let names
    try { names = await fs.promises.readdir(root, { withFileTypes: true }) } catch { return [] }
    const packs = []
    for (const d of names) {
      if (d.name.startsWith('.')) continue
      const st = await fs.promises.stat(path.join(root, d.name)).catch(() => null)
      if (!st) continue
      const ext = (d.name.split('.').pop() || '').toLowerCase()
      if (!st.isDirectory() && !mcmeta.ZIP_EXTS.has(ext)) continue
      try { packs.push(await mcmeta.listPackTexGroups(root, d.name)) } catch {}
    }
    packs.sort((a, b) => a.name.localeCompare(b.name, 'zh'))
    return packs
  }
  const mc = (await collect(cfg.mcPacksPath)).map(p => ({ ...p, source: 'mc' }))
  const official = (await collect(cfg.officialPacksPath)).map(p => ({ ...p, source: 'official' }))
  ok(res, { packs: [...mc, ...official] })
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