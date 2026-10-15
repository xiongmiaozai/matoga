/**
 * matoga - 材质贴图对比工具
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 */

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
export const compareBtn = $('compareBtn')
export const exportBtn = $('exportBtn')
export const exportHtmlBtn = $('exportHtmlBtn')
export const swapBtn = $('swapBtn')
export const clearMemBtn = $('clearMemBtn')
export const batchRightBtn = $('batchRightBtn')
export const batchLeftBtn = $('batchLeftBtn')
export const undoBtn = $('undoBtn')
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
export const ROLE_LABEL = { main: '主贴图', normal: '法线 _n', specular: '高光 _s' }
export const STATUS_ORDER = { miss: 0, partial: 1, diff: 2, extra: 3, have: 4 }
export const KIND_TEXT = { have: '✓ 一致', diff: '≈ 内容不同', partial: '◐ 部分缺失', miss: '✗ 右侧缺失', extra: '＋ 右侧多余' }

export function showToast(msg) {
  const t = $('toast')
  t.textContent = msg
  t.classList.add('show')
  clearTimeout(showToast._timer)
  showToast._timer = setTimeout(() => t.classList.remove('show'), 2000)
}