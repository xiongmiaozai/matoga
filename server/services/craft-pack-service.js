/**
 * matoga - 制作包服务（门面）
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 按职责拆入 cp/ 子模块，此处只做 re-export，保持既有 require 路径不变。
 */

const consts_ = require('./cp/consts')
const selection_ = require('./cp/selection')
const export_ = require('./cp/export')
const resolve_ = require('./cp/resolve')

module.exports = {
  DIR: consts_.DIR,
  SELECTION_FILE: consts_.SELECTION_FILE,
  MARKER_FILE: consts_.MARKER_FILE,
  MAX_ITEMS: consts_.MAX_ITEMS,
  DEFAULT_NAME: consts_.DEFAULT_NAME,
  DEFAULT_PACK_FORMAT: consts_.DEFAULT_PACK_FORMAT,
  getSelection: selection_.getSelection,
  setSelection: selection_.setSelection,
  addItem: selection_.addItem,
  removeItem: selection_.removeItem,
  clearSelection: selection_.clearSelection,
  aggregateStorage: selection_.aggregateStorage,
  copyToCraftPack: export_.copyToCraftPack,
  exportPack: export_.exportPack,
  listCraftPacks: export_.listCraftPacks,
  getCurrentCraftPack: export_.getCurrentCraftPack,
  resolveEntry: resolve_.resolveEntry,
  locateItem: resolve_.locateItem,
}
