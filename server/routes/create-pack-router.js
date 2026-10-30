/**
 * matoga - MC 资源包路由工厂（mc-packs / mc-official 共用装配）
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 同一 mcmeta-service 上针对不同根目录（用户包 / 官方材质包）的平行薄路由：
 *   GET  /list                    列出 root 下所有包（pack.mcmeta 版本分析 + 贴图统计）
 *   GET  /version-map             （可选）pack_format -> MC 版本映射表
 *   PUT  /rename                  重命名包 { from, to }
 *   GET  /:name/textures          列出包内贴图（assets/<ns>/textures/**，分页）
 *   GET  /:name/entries           列出包内任意目录直接子项（文件管理器式浏览）
 *   GET  /:name/raw?path=         读取包内贴图字节（dir 直读 / zip 提取）
 */

const path = require('path')
const express = require('express')
const { ok, fail, wrap } = require('../middleware/errors')
const { guardRead, guardWrite } = require('../middleware/validate')
const mcmeta = require('../services/mcmeta-service')
const packBuilder = require('../services/pack-builder-service')

function createPackRouter(rootOf, { versionMap = false } = {}) {
  const router = express.Router()

  router.get('/list', wrap(async (req, res) => {
    ok(res, await mcmeta.listOfficialPacks(rootOf()))
  }))

  if (versionMap) {
    router.get('/version-map', wrap(async (req, res) => {
      ok(res, { map: mcmeta.PACK_FORMAT_VERSIONS })
    }))
  }

  router.put('/rename', wrap(async (req, res) => {
    const b = req.body || {}
    const root = rootOf()
    guardWrite(path.join(root, String(b.from || '')))
    guardWrite(path.join(root, String(b.to || '')))
    ok(res, await mcmeta.renamePack(root, b.from, b.to))
  }))

  router.get('/:name/textures', wrap(async (req, res) => {
    ok(res, await mcmeta.listPackTextures(rootOf(), req.params.name, {
      dir: req.query.dir,
      offset: req.query.offset,
      limit: req.query.limit,
    }))
  }))

  router.get('/:name/entries', wrap(async (req, res) => {
    ok(res, await mcmeta.listPackEntries(rootOf(), req.params.name, { dir: req.query.dir }))
  }))

  router.get('/:name/raw', wrap(async (req, res) => {
    const { buf, mime } = await mcmeta.readPackFile(rootOf(), req.params.name, req.query.path, { anyExt: req.query.any === '1' })
    res.setHeader('Content-Type', mime)
    res.setHeader('Cache-Control', 'private, max-age=3600')
    res.end(buf)
  }))

  router.post('/export-batch', wrap(async (req, res) => {
    const root = rootOf()
    const b = req.body || {}
    const names = Array.isArray(b.names) ? b.names : []
    if (!names.length) return fail(res, 'ERR_INVALID_PARAM', 'no packs selected')
    for (const n of names) guardRead(path.join(root, String(n)))
    const opts = { skipPackPng: !!b.skipPackPng, noCompress: !!b.noCompress }
    const { buf, zipName } = await packBuilder.archivePacks(root, names, opts)
    res.setHeader('Content-Type', 'application/zip')
    res.setHeader('Content-Disposition', 'attachment; filename="' + encodeURIComponent(zipName) + '"')
    res.end(buf)
  }))

  router.delete('/:name', wrap(async (req, res) => {
    const root = rootOf()
    guardWrite(path.join(root, String(req.params.name)))
    ok(res, await mcmeta.deletePack(root, req.params.name))
  }))

  router.post('/:name/export', wrap(async (req, res) => {
    const root = rootOf()
    guardRead(path.join(root, String(req.params.name)))
    const b = req.body || {}
    const opts = { skipPackPng: !!b.skipPackPng, noCompress: !!b.noCompress }
    const { buf, zipName } = await packBuilder.archivePack(root, req.params.name, opts)
    res.setHeader('Content-Type', 'application/zip')
    res.setHeader('Content-Disposition', 'attachment; filename="' + encodeURIComponent(zipName) + '"')
    res.end(buf)
  }))

  return router
}

module.exports = { createPackRouter }