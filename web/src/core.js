/**
 * matoga - 材质贴图对比工具
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 */

import { t as _t } from './i18n.js'

export const state = {
  leftPath: null,
  rightPath: null,
  leftEntries: [],
  rightEntries: [],
  result: [],
  counts: null,
  sortKey: 'status',
  sortDir: 'asc',
  searchText: '',
  selected: null,
  expandedKeys: new Set(),
  viewMode: 'all',
  collapsedFolders: new Set(),
  statusFilter: 'all',
  history: [],
  renderLimit: 200
}

export const $ = (id) => document.getElementById(id)

export const leftBtn = $('leftBtn')
export const rightBtn = $('rightBtn')

export const exportBtn = $('exportBtn')
export const exportHtmlBtn = $('exportHtmlBtn')

export const clearMemBtn = $('clearMemBtn')
export const batchRightBtn = $('batchRightBtn')
export const batchLeftBtn = $('batchLeftBtn')
export const undoBtn = $('undoBtn')
export const compareBtn2 = $('compareBtn2')
export const swapBtn2 = $('swapBtn2')
export const recursiveChk = $('recursiveChk')
export const onlyMissingChk = $('onlyMissingChk')
export const hashChk = $('hashChk')
export const ignoreChk = $('ignoreChk')
export const ignoreInput = $('ignoreInput')
export const searchInput = $('searchInput')

export const leftPathEl = $('leftPath')
export const rightPathEl = $('rightPath')
export const leftStatEl = $('leftStat')
export const rightStatEl = $('rightStat')
export const leftListEl = $('leftList')
export const rightListEl = $('rightList')
export const summaryEl = $('summary')
export const resultBody = $('resultBody')
export const leftCard = $('leftCard')
export const rightCard = $('rightCard')

export const IMG_EXTS = new Set(['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'svg', 'ico', 'tif', 'tiff', 'avif'])
export const TEX_SUFFIXES = [['_n', 'normal'], ['_s', 'specular']]
export const ROLES = ['main', 'normal', 'specular']
export const STATUS_ORDER = { miss: 0, partial: 1, diff: 2, extra: 3, have: 4 }

export function roleLabel(role) {
  const labels = { main: 'preview.roleMain', normal: 'preview.roleNormal', specular: 'preview.roleSpecular' }
  return _t(labels[role] || role)
}

export function kindText(kind) {
  const labels = { have: 'status.have', diff: 'status.diff', partial: 'status.partial', miss: 'status.miss', extra: 'status.extra' }
  return _t(labels[kind] || kind)
}

export const ROLE_LABEL = new Proxy({}, { get: (_, k) => roleLabel(k) })
export const KIND_TEXT = new Proxy({}, { get: (_, k) => kindText(k) })

export function showToast(msg) {
  const t = $('toast')
  if (!t) return
  t.textContent = msg
  t.classList.add('show')
  clearTimeout(showToast._timer)
  showToast._timer = setTimeout(() => t.classList.remove('show'), 2000)
}