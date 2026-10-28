/**
 * matoga - 资源包元数据：常量与版本映射
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 从 mcmeta-service.js 按职责搬出，逻辑未改。
 */

const path = require('path')

const ZIP_EXTS = new Set(['zip', 'mcpack', 'resourcepack'])

const MCMETA_NAME = 'pack.mcmeta'

const VERSION_JSON_NAME = 'version.json'

const ASSETS_PREFIX = 'assets/'

/* 包内贴图：assets/<ns>/textures/** 下的图片文件 */

/* 包内贴图：assets/<ns>/textures/** 下的图片文件 */
const IMG_EXT_RE = /\.(png|jpe?g|webp|gif|bmp|tiff?|avif)$/i

const TEX_DIR_RE = /^assets\/[^/]+\/textures\//
/* 包内模型：assets/<ns>/models/** 下的 JSON 文件 + 1.21.4+ 物品模型定义 assets/<ns>/items/*.json */

/* 包内模型：assets/<ns>/models/** 下的 JSON 文件 + 1.21.4+ 物品模型定义 assets/<ns>/items/*.json */
const MODEL_DIR_RE = /^assets\/[^/]+\/(models|items)\//

const MODEL_EXT_RE = /\.json$/i

const MIME_BY_EXT = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp',
  gif: 'image/gif', bmp: 'image/bmp', tif: 'image/tiff', tiff: 'image/tiff', avif: 'image/avif',
}

const MAX_TEX_WALK = 20000

const MAX_TEX_RETURN = 200

const MAX_MODEL_WALK = 20000

// pack_format -> Minecraft 版本范围（资源包格式，Java 版）

// pack_format -> Minecraft 版本范围（资源包格式，Java 版）
const PACK_FORMAT_VERSIONS = [
  { format: 1,  versions: '1.6.1 – 1.8.9' },
  { format: 2,  versions: '1.9 – 1.10.2' },
  { format: 3,  versions: '1.11 – 1.12.2' },
  { format: 4,  versions: '1.13 – 1.14.4' },
  { format: 5,  versions: '1.15 – 1.16.1' },
  { format: 6,  versions: '1.16.2 – 1.16.5' },
  { format: 7,  versions: '1.17 – 1.17.1' },
  { format: 8,  versions: '1.18 – 1.18.2' },
  { format: 9,  versions: '1.19 – 1.19.2' },
  { format: 12, versions: '1.19.3' },
  { format: 13, versions: '1.19.4' },
  { format: 15, versions: '1.20 – 1.20.1' },
  { format: 18, versions: '1.20.2' },
  { format: 22, versions: '1.20.3 – 1.20.4' },
  { format: 32, versions: '1.20.5 – 1.20.6' },
  { format: 34, versions: '1.21 – 1.21.1' },
  { format: 42, versions: '1.21.2 – 1.21.3' },
  { format: 46, versions: '1.21.4' },
  { format: 55, versions: '1.21.5' },
  { format: 63, versions: '1.21.6' },
  { format: 64, versions: '1.21.7 – 1.21.8' },
  { format: 97, versions: '26.3' },
]

const FORMAT_INDEX = new Map(PACK_FORMAT_VERSIONS.map(e => [e.format, e.versions]))

function formatToVersions(format) {
  if (!Number.isFinite(format)) return ''
  return FORMAT_INDEX.get(format) || ''
}

/* ── 最小 zip 解析（仅读取 central directory 与指定条目）──── */

module.exports = { ZIP_EXTS, MCMETA_NAME, VERSION_JSON_NAME, ASSETS_PREFIX, IMG_EXT_RE, TEX_DIR_RE, MODEL_DIR_RE, MODEL_EXT_RE, MIME_BY_EXT, MAX_TEX_WALK, MAX_TEX_RETURN, MAX_MODEL_WALK, PACK_FORMAT_VERSIONS, FORMAT_INDEX, formatToVersions }
