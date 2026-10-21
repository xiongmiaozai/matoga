/**
 * matoga - MC 官方材质包路由
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * GET  /api/mc-official/list          列出官方材质包目录下的所有包（含 pack.mcmeta 版本分析 + 贴图统计）
 * GET  /api/mc-official/version-map   pack_format -> MC 版本映射表（供前端/后续开发查询）
 * PUT  /api/mc-official/rename        重命名包 { from, to }（可配合版本分析结果规范命名）
 * GET  /api/mc-official/:name/textures  列出包内贴图（assets/<ns>/textures/**，前 200 张）
 * GET  /api/mc-official/:name/entries   列出包内任意目录的直接子项（文件管理器式浏览）
 * GET  /api/mc-official/:name/raw?path=  读取包内贴图字节（dir 直读 / zip 提取）
 */

const path = require('path')
const express = require('express')
const { ok, wrap } = require('../middleware/errors')
const { guardWrite } = require('../middleware/validate')
const configStore = require('../config/config-store')
const mcmeta = require('../services/mcmeta-service')

const router = express.Router()

router.get('/list', wrap(async (req, res) => {
  const root = configStore.get().officialPacksPath
  ok(res, await mcmeta.listOfficialPacks(root))
}))

router.get('/version-map', wrap(async (req, res) => {
  ok(res, { map: mcmeta.PACK_FORMAT_VERSIONS })
}))

router.put('/rename', wrap(async (req, res) => {
  const b = req.body || {}
  const root = configStore.get().officialPacksPath
  guardWrite(path.join(root, String(b.from || '')))
  guardWrite(path.join(root, String(b.to || '')))
  ok(res, await mcmeta.renamePack(root, b.from, b.to))
}))

router.get('/:name/textures', wrap(async (req, res) => {
  const root = configStore.get().officialPacksPath
  ok(res, await mcmeta.listPackTextures(root, req.params.name, {
    dir: req.query.dir,
    offset: req.query.offset,
    limit: req.query.limit,
  }))
}))

router.get('/:name/entries', wrap(async (req, res) => {
  const root = configStore.get().officialPacksPath
  ok(res, await mcmeta.listPackEntries(root, req.params.name, { dir: req.query.dir }))
}))

router.get('/:name/raw', wrap(async (req, res) => {
  const root = configStore.get().officialPacksPath
  const { buf, mime } = await mcmeta.readPackFile(root, req.params.name, req.query.path)
  res.setHeader('Content-Type', mime)
  res.setHeader('Cache-Control', 'private, max-age=3600')
  res.end(buf)
}))

module.exports = router