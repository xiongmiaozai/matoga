/**
 * matoga - 总资产库：pack-browser
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 从 asset-library.js 原样搬出，逻辑未改。
 */
import { state, IMG_EXTS, showToast } from '../core.js'
import { fileUrl, formatSize, formatDate, escAttr, apiUrl, setTexDragData, contentKindOfPath } from '../utils.js'
import { t, onLocaleChange } from '../i18n.js'
import { el, shade, loadList, saveList } from './dom.js'
import { tryActivateModelViewport, viewMcModelAsset, viewImportedModelAsset } from './model-view.js'
import { S, BROWSE_CLICK_DELAY } from './store.js'
import { rebuild } from './filters.js'
import { addPackTextureToCanvas, officialBadge } from './sections-official.js'
import { pushRecent } from './items.js'
import { assetApiCall } from './api.js'

import { pbLoadView } from './pb/persist.js'
import { buildBrowseHead, buildBrowseToolbar } from './pb/head.js'
import { fillBrowseError, fillBrowseView } from './pb/fill.js'

/* 返回上一级：原文件即从本模块导出（asset-library.js 的面板返回按钮依赖）。 */
export { browseUp } from './pb/nav.js'

export function openPackBrowser(item) {
  const list = item.type === 'mc' ? S.mcEntries : (item.type === 'official' ? S.officialEntries : null)
  const pack = item.pack || (list || []).find(p => p.fullPath === item.path) || null
  S.browse = { item, pack, dir: null, view: pbLoadView(), filter: '', data: null, api: packApiFor(item.type) }
  renderBrowse()
}

export async function renderBrowse() {
  const body = document.getElementById('assetLibraryBody')
  if (!body || !S.browse) return
  const search = document.getElementById('assetLibSearch')
  if (search) search.disabled = true
  const toolbar = document.getElementById('assetLibToolbar')
  if (toolbar) toolbar.classList.add('pb-off')
  const seq = ++S.browseSeq
  const { item, pack, dir, api } = S.browse

  body.scrollTop = 0
  body.innerHTML = ''
  const view = el('div', 'pack-browser')
  view.appendChild(buildBrowseHead(item, pack, null))
  view.appendChild(buildBrowseToolbar())
  const list = el('div', 'pb-list')
  list.appendChild(el('div', 'pb-loading', t('asset.browseLoading')))
  view.appendChild(list)
  view.appendChild(el('div', 'pb-status', t('asset.browseLoading')))
  body.appendChild(view)

  let data
  try {
    const q = dir ? '?dir=' + encodeURIComponent(dir) : ''
    data = await assetApiCall('GET', api + '/' + encodeURIComponent(item.name) + '/entries' + q)
  } catch (e) {
    if (seq === S.browseSeq && S.browse) fillBrowseError(item, pack, e.message)
    return
  }
  if (seq !== S.browseSeq || !S.browse) return
  S.browse.data = data
  fillBrowseView(item, pack, data)
}

