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

const { createPackRouter } = require('./create-pack-router')
const configStore = require('../config/config-store')

module.exports = createPackRouter(() => configStore.get().mcPacksPath)