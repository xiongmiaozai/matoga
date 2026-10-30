/**
 * matoga - 中文译名映射路由
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * GET /api/lang/zh        返回贴图名↔中文译名映射表（byTexName/byTexKey/byZh）
 * GET /api/lang/zh?refresh=1   强制重建缓存
 */

const express = require('express')
const { ok, wrap } = require('../middleware/errors')
const configStore = require('../config/config-store')
const langService = require('../services/lang-service')

const router = express.Router()

router.get(
  '/zh',
  wrap(async (req, res) => {
    if (req.query.refresh === '1') langService.clearCache()
    const cfg = configStore.get()
    const maps = await langService.getMaps([cfg.officialPacksPath, cfg.mcPacksPath])
    ok(res, maps)
  })
)

module.exports = router
