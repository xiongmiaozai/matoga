/**
 * matoga - MC 资源包路由（用户包媒体库）
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * mc-packs 目录下的资源包以「包媒体」形式管理：整包储存、点开浏览包内贴图。
 * 复用 mcmeta-service（与官方材质包同一套 pack.mcmeta 解析 / 包内浏览 / 原图读取）。
 *
 * GET  /api/mc-packs/list           列出 mcPacksPath 下所有包（pack.mcmeta 版本分析 + 贴图统计）
 * PUT  /api/mc-packs/rename         重命名包 { from, to }
 * GET  /api/mc-packs/:name/textures 列出包内贴图（assets/<ns>/textures/**，分页）
 * GET  /api/mc-packs/:name/entries  列出包内任意目录直接子项（文件管理器式浏览）
 * GET  /api/mc-packs/:name/raw?path= 读取包内贴图字节（dir 直读 / zip 提取）
 */

const path = require('path')
const express = require('express')
const { ok, wrap } = require('../middleware/errors')
const { guardWrite } = require('../middleware/validate')
const configStore = require('../config/config-store')
const mcmeta = require('../services/mcmeta-service')

const router = express.Router()

router.get('/list', wrap(async (req, res) => {
  const root = configStore.get().mcPacksPath
  ok(res, await mcmeta.listOfficialPacks(root))
}))

router.put('/rename', wrap(async (req, res) => {
  const b = req.body || {}
  const root = configStore.get().mcPacksPath
  guardWrite(path.join(root, String(b.from || '')))
  guardWrite(path.join(root, String(b.to || '')))
  ok(res, await mcmeta.renamePack(root, b.from, b.to))
}))

router.get('/:name/textures', wrap(async (req, res) => {
  const root = configStore.get().mcPacksPath
  ok(res, await mcmeta.listPackTextures(root, req.params.name, {
    dir: req.query.dir,
    offset: req.query.offset,
    limit: req.query.limit,
  }))
}))

router.get('/:name/entries', wrap(async (req, res) => {
  const root = configStore.get().mcPacksPath
  ok(res, await mcmeta.listPackEntries(root, req.params.name, { dir: req.query.dir }))
}))

router.get('/:name/raw', wrap(async (req, res) => {
  const root = configStore.get().mcPacksPath
  const { buf, mime } = await mcmeta.readPackFile(root, req.params.name, req.query.path, { anyExt: req.query.any === '1' })
  res.setHeader('Content-Type', mime)
  res.setHeader('Cache-Control', 'private, max-age=3600')
  res.end(buf)
}))

module.exports = router