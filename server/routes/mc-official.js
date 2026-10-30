/**
 * matoga - MC 官方材质包路由
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * GET  /api/mc-official/list          列出官方材质包目录下的所有包（含 pack.mcmeta 版本分析 + 贴图统计）
 * GET  /api/mc-official/version-map   pack_format -> MC 版本映射表（供前端/后续开发查询）
 * GET  /api/mc-official/tex-index     扁平收集所有官方包内贴图相对路径（去重），供前端校验模型贴图引用是否由原版提供
 * PUT  /api/mc-official/rename        重命名包 { from, to }（可配合版本分析结果规范命名）
 * GET  /api/mc-official/:name/textures  列出包内贴图（assets/<ns>/textures/**，前 200 张）
 * GET  /api/mc-official/:name/entries   列出包内任意目录的直接子项（文件管理器式浏览）
 * GET  /api/mc-official/:name/raw?path= 读取包内贴图字节（dir 直读 / zip 提取）
 */

const { createPackRouter } = require('./create-pack-router')
const { ok, wrap } = require('../middleware/errors')
const configStore = require('../config/config-store')
const mcmeta = require('../services/mcmeta-service')

const router = createPackRouter(() => configStore.get().officialPacksPath, { versionMap: true })

router.get('/tex-index', wrap(async (req, res) => {
  ok(res, { paths: await mcmeta.listAllTexPaths(configStore.get().officialPacksPath) })
}))

module.exports = router