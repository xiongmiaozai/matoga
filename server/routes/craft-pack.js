/**
 * matoga - 制作包路由（总资产库 · 我的开发包）
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 制作包 = 用户所有储存（自选清单 + 收藏夹 + 最近使用）的聚合，即用户开发中的资源包。
 * 可聚合导出为 craft-packs 下的真实 MC 资源包（pack.mcmeta + assets/** + hdri/**）；
 * 存入制作包即直接复制单个资产到当前制作包项目目录（craft-packs/我的制作包/，持续累积）。
 *
 * GET    /api/craft-pack             获取自选清单 { items }（条目附加 locatePath：定位用真实文件路径）
 * PUT    /api/craft-pack/items       覆盖保存自选清单 { items: [...] }
 * POST   /api/craft-pack/items       追加条目 { item }（按 key 去重）
 * DELETE /api/craft-pack/items/:key  移除条目（key 需 encodeURIComponent）
 * DELETE /api/craft-pack/items       清空自选清单
 * POST   /api/craft-pack/copy        存入制作包 { item }（直接复制单个资产到当前制作包项目目录）
 * POST   /api/craft-pack/export      聚合导出 { name?, description?, packFormat?, items? }
 *                                    items 缺省 = 自选 + 收藏 + 最近（全部储存）
 * GET    /api/craft-pack/packs       已导出制作包列表（craftPacksPath 下含 matoga-craft.json 的包）
 * GET    /api/craft-pack/current     当前制作包项目（craft-packs/我的制作包/，持续累积，非导出）
 */

const express = require('express')
const { ok, fail, wrap } = require('../middleware/errors')
const craft = require('../services/craft-pack-service')
const configStore = require('../config/config-store')

const router = express.Router()

router.get('/', wrap(async (req, res) => {
  /* 附加 locatePath：craftPath 副本失效时回退虚拟路径解析出的真实文件路径（仅响应，不落盘） */
  const cfg = configStore.get()
  ok(res, { items: craft.getSelection().map(it => ({ ...it, locatePath: craft.locateItem(it, cfg) })) })
}))

router.put('/items', wrap(async (req, res) => {
  const items = (req.body && req.body.items) || []
  const list = await craft.setSelection(items)
  ok(res, { count: list.length })
}))

router.post('/items', wrap(async (req, res) => {
  const item = req.body && req.body.item
  const r = await craft.addItem(item)
  ok(res, r)
}))

router.delete('/items/:key', wrap(async (req, res) => {
  let key
  try { key = decodeURIComponent(req.params.key) } catch { return fail(res, 'ERR_INVALID_PARAM', 'bad key') }
  ok(res, await craft.removeItem(key))
}))

router.delete('/items', wrap(async (req, res) => {
  ok(res, await craft.clearSelection())
}))

router.post('/copy', wrap(async (req, res) => {
  const item = req.body && req.body.item
  ok(res, await craft.copyToCraftPack(item))
}))

router.post('/export', wrap(async (req, res) => {
  const b = req.body || {}
  const r = await craft.exportPack({
    name: b.name,
    description: b.description,
    packFormat: b.packFormat,
    items: b.items,
  })
  ok(res, r)
}))

router.get('/packs', wrap(async (req, res) => {
  ok(res, await craft.listCraftPacks())
}))

router.get('/current', wrap(async (req, res) => {
  ok(res, await craft.getCurrentCraftPack())
}))

module.exports = router