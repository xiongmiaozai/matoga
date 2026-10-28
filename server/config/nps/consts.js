/**
 * matoga - 节点项目存储：常量
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 从 node-project-store.js 按职责搬出，逻辑未改。
 */
const path = require('path')
const { DATA_ROOT } = require('../../paths')

const DIR = path.join(DATA_ROOT, 'data', 'node-projects')
const FORMAT = 'matoga-node-project'
const VERSION = 1
const MAX_NAME = 100
const MAX_PROJECTS = 500
const MAX_THUMB_BYTES = 4 * 1024 * 1024
const MAX_TEXTURE_BYTES = 24 * 1024 * 1024

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/
const IMG_EXT_RE = /\.(png|jpe?g|webp|gif|bmp|tiff?|avif|svg|ico)$/i

module.exports = { DIR, FORMAT, VERSION, MAX_NAME, MAX_PROJECTS, MAX_THUMB_BYTES, MAX_TEXTURE_BYTES, ID_RE, IMG_EXT_RE }
