/**
 * matoga - 制作包媒体路由（craft-packs 目录包浏览）
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * craft-packs 目录下的资源包（当前制作项目「我的制作包」与导出快照）与
 * mc-packs / official-packs 同构：可列出、逐层浏览、读取包内文件。
 * 复用 mcmeta-service（同一套 pack.mcmeta 解析 / 包内浏览 / 原图读取）。
 *
 * GET  /api/craft-packs/list           列出 craftPacksPath 下所有包
 * PUT  /api/craft-packs/rename         重命名包 { from, to }
 * GET  /api/craft-packs/:name/textures 列出包内贴图（分页）
 * GET  /api/craft-packs/:name/entries  列出包内任意目录直接子项（文件管理器式浏览）
 * GET  /api/craft-packs/:name/raw?path= 读取包内文件字节（dir 直读 / zip 提取）
 */

const { createPackRouter } = require('./create-pack-router')
const configStore = require('../config/config-store')

module.exports = createPackRouter(() => configStore.get().craftPacksPath)