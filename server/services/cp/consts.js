/**
 * matoga - 制作包服务：常量
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 从 craft-pack-service.js 按职责搬出，逻辑未改。
 */
const { DATA_ROOT } = require('../../paths')

const path = require('path')

const DIR = path.join(DATA_ROOT, 'data', 'craft-pack')

const SELECTION_FILE = path.join(DIR, 'selection.json')

const MARKER_FILE = 'matoga-craft.json'

const MARKER_FORMAT = 'matoga-craft-pack'

const MARKER_VERSION = 1

const MAX_ITEMS = 500

const MAX_EXPORT_ITEMS = 2000

const MAX_FILE_BYTES = 256 * 1024 * 1024


const IMG_EXTS = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'tga', 'tif', 'tiff'])

const MODEL_EXTS = new Set(['json', 'bbmodel'])

const HDRI_EXTS = new Set(['hdr', 'exr'])

const DEFAULT_NAME = '我的制作包'

const DEFAULT_PACK_FORMAT = 64 /* 1.21.7 – 1.21.8 */


let writeQueue = Promise.resolve()

/* ── 自选清单持久化 ─────────────────────────────── */


/* 串行写队列：选取写入依次排队。队列状态被多处使用且需重新赋值，
   封装在本模块内部，外部通过 enqueue(run) 提交任务拿 promise。 */
function enqueue(run) {
  writeQueue = writeQueue.then(run, run)
  return writeQueue
}

module.exports = { DIR, SELECTION_FILE, MARKER_FILE, MARKER_FORMAT, MARKER_VERSION, MAX_ITEMS, MAX_EXPORT_ITEMS, MAX_FILE_BYTES, IMG_EXTS, MODEL_EXTS, HDRI_EXTS, DEFAULT_NAME, DEFAULT_PACK_FORMAT, enqueue }
