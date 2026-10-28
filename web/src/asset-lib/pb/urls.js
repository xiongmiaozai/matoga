/**
 * matoga - 总资产库：包内浏览（路径与 URL 判定）
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 从 pack-browser.js 按职责搬出，逻辑未改。
 */

import { packRawUrl, MODEL_DIR_PATH_RE, MODEL_JSON_RE } from '../helpers.js'

import { S, BROWSE_CLICK_DELAY } from '../store.js'

export function packEntryRawUrl(packName, relPath) {
  return packRawUrl(S.browse ? S.browse.api : MC_OFFICIAL_API, packName, relPath)
}

export function isAddableAssetPath(p) {
  return p === 'pack.png' || p.startsWith('assets/')
}

/* 包浏览中的模型文件判定：assets/<ns>/models/** 下的 .json */
export function isModelBrowsePath(rel) {
  return typeof rel === 'string' && MODEL_DIR_PATH_RE.test(rel) && MODEL_JSON_RE.test(rel)
}

