/**
 * matoga - 总资产库路由
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * GET    /api/asset               获取收藏夹与最近使用
 * GET    /api/asset/type/:type    按分类获取（tex/hdri/mc/model/preset）
 * GET    /api/asset/tex           聚合全部贴图（MC 材质包 + 官方包，按包/类别分组）
 * GET    /api/asset/model         聚合全部模型（MC 材质包 + 官方包内 assets/<ns>/models/*.json）
 * GET    /api/asset/model?meta=1  同上，但每个模型文件附加 ns/format/texRefs/animated 元数据
 * GET    /api/asset/model-cross?packs=A,B&source=mc  多包交叉对比（按模型路径聚合，标注每包存在性与大小差异）
 * PUT    /api/asset/favorites     保存收藏夹 { items: [...] }
 * PUT    /api/asset/recent        保存最近使用 { items: [...] }
 * GET    /api/asset/info?path=    获取文件 stat（大小/时间），用于详情面板
 * GET    /api/asset/model-thumb-info?key=&mtime=  模型缩略图缓存查询（虚拟路径键；渲染器版本落后或 mtime 更新 → stale；返回 frameCount/frameDelay 供动画模型轮播）
 * GET    /api/asset/model-thumb?key=&frame=      读取模型缩略图 PNG（多帧动画缩略图按 frame 取帧，缺省帧 0）
 * POST   /api/asset/model-thumb   保存前端离屏渲染的模型缩略图 { key, mtime, dataUrl } 或多帧 { key, mtime, frames: [{ dataUrl, delay }] }（sidecar 记录渲染器版本与帧数）
 */

const express = require('express')
const fs = require('fs')
const path = require('path')
const { ok, fail, wrap } = require('../middleware/errors')
const { guardRead } = require('../middleware/validate')
const store = require('../config/asset-store')
const configStore = require('../config/config-store')
const mcmeta = require('../services/mcmeta-service')
const modelAnalysis = require('../services/model-analysis-service')
const modelThumb = require('../services/model-thumb-service')

const router = express.Router()

router.get(
  '/',
  wrap(async (req, res) => {
    ok(res, store.get())
  })
)

router.get(
  '/type/:type',
  wrap(async (req, res) => {
    const { type } = req.params
    if (!store.VALID_TYPES.has(type)) return fail(res, 'ERR_INVALID_PARAM', 'invalid asset type')
    ok(res, store.getByType(type))
  })
)

/* 聚合 mcPacksPath / officialPacksPath 下的全部包，逐包调用 lister（tex / model） */
async function collectPacks(root, lister) {
  if (!root || typeof root !== 'string') return []
  let names
  try {
    names = await fs.promises.readdir(root, { withFileTypes: true })
  } catch {
    return []
  }
  const packs = []
  for (const d of names) {
    if (d.name.startsWith('.')) continue
    const st = await fs.promises.stat(path.join(root, d.name)).catch(() => null)
    if (!st) continue
    const ext = (d.name.split('.').pop() || '').toLowerCase()
    if (!st.isDirectory() && !mcmeta.ZIP_EXTS.has(ext)) continue
    try {
      packs.push(await lister(root, d.name))
    } catch {}
  }
  packs.sort((a, b) => a.name.localeCompare(b.name, 'zh'))
  return packs
}

/* 聚合 MC 材质包 + 官方材质包的全部贴图：每包按 textures/ 第一级类别分组（无分页） */
router.get(
  '/tex',
  wrap(async (req, res) => {
    const cfg = configStore.get()
    const mc = (await collectPacks(cfg.mcPacksPath, mcmeta.listPackTexGroups)).map(p => ({ ...p, source: 'mc' }))
    const official = (await collectPacks(cfg.officialPacksPath, mcmeta.listPackTexGroups)).map(p => ({
      ...p,
      source: 'official'
    }))
    ok(res, { packs: [...mc, ...official] })
  })
)

/* 聚合 MC 材质包 + 官方材质包的全部模型：每包按 models/ 第一级类别分组（无分页） */
router.get(
  '/model',
  wrap(async (req, res) => {
    const cfg = configStore.get()
    const lister = req.query.meta === '1' ? modelAnalysis.enrichModelGroups : mcmeta.listPackModelGroups
    const mc = (await collectPacks(cfg.mcPacksPath, lister)).map(p => ({ ...p, source: 'mc' }))
    const official = (await collectPacks(cfg.officialPacksPath, lister)).map(p => ({ ...p, source: 'official' }))
    ok(res, { packs: [...mc, ...official] })
  })
)

/* 多包交叉对比：对同一 root 下多个包按模型路径聚合，标注每个包存在性与大小差异 */
router.get(
  '/model-cross',
  wrap(async (req, res) => {
    const cfg = configStore.get()
    const root = req.query.source === 'official' ? cfg.officialPacksPath : cfg.mcPacksPath
    if (!root) return fail(res, 'ERR_INVALID_PARAM', 'pack root not configured')
    const packs =
      typeof req.query.packs === 'string'
        ? req.query.packs
            .split(',')
            .map(s => s.trim())
            .filter(Boolean)
        : Array.isArray(req.body)
          ? req.body
          : []
    if (!packs.length) return fail(res, 'ERR_INVALID_PARAM', 'packs parameter required')
    ok(res, await modelAnalysis.crossCompareModels(root, packs))
  })
)

router.put(
  '/favorites',
  wrap(async (req, res) => {
    const items = (req.body && req.body.items) || []
    await store.setFavorites(items)
    ok(res, { count: store.getFavorites().length })
  })
)

router.put(
  '/recent',
  wrap(async (req, res) => {
    const items = (req.body && req.body.items) || []
    await store.setRecent(items)
    ok(res, { count: store.getRecent().length })
  })
)

router.get(
  '/info',
  wrap(async (req, res) => {
    const p = guardRead(req.query.path)
    try {
      const s = await fs.promises.stat(p)
      ok(res, { exists: true, isDirectory: s.isDirectory(), size: s.size, mtime: s.mtimeMs })
    } catch {
      ok(res, { exists: false, isDirectory: false, size: 0, mtime: 0 })
    }
  })
)

/* 模型缩略图（虚拟路径键：packmodel:<source>:<pack>/<rel> / bb:<id> / im:<id> / cm:<id>）：
   key 仅参与 md5（文件名恒为 hex，按类型落入专属子目录），不进入文件系统路径，无目录穿越面 */
const MODEL_THUMB_KEY_RE = /^(packmodel:(mc|official):[^:]+\/.+|bb:.+|im:.+|cm:.+|cmp:.+)$/

function guardModelThumbKey(raw) {
  const key = typeof raw === 'string' ? raw : ''
  if (!key || key.length > 512 || !MODEL_THUMB_KEY_RE.test(key)) return null
  return key
}

router.get(
  '/model-thumb-info',
  wrap(async (req, res) => {
    const key = guardModelThumbKey(req.query.key)
    if (!key) return fail(res, 'ERR_INVALID_PARAM', 'invalid model thumb key')
    ok(res, await modelThumb.thumbInfo(key, req.query.mtime))
  })
)

router.get(
  '/model-thumb',
  wrap(async (req, res) => {
    const key = guardModelThumbKey(req.query.key)
    if (!key) return fail(res, 'ERR_INVALID_PARAM', 'invalid model thumb key')
    try {
      await modelThumb.sendThumb(res, key, req.query.frame)
    } catch {
      fail(res, 'ERR_FS_NOT_FOUND', 'model thumb not generated yet')
    }
  })
)

router.post(
  '/model-thumb',
  wrap(async (req, res) => {
    const key = guardModelThumbKey(req.body && req.body.key)
    if (!key) return fail(res, 'ERR_INVALID_PARAM', 'invalid model thumb key')
    const r = await modelThumb.saveThumb(key, req.body && req.body.mtime, req.body)
    if (!r.success) return fail(res, 'ERR_INVALID_PARAM', r.error)
    ok(res, r)
  })
)

module.exports = router
