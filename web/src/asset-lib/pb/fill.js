/**
 * matoga - 总资产库：包内浏览（填充浏览视图）
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 从 pack-browser.js 按职责搬出，逻辑未改。
 */
import { t, onLocaleChange } from '../../i18n.js'
import { el, shade, loadList, saveList } from '../dom.js'
import { S, BROWSE_CLICK_DELAY } from '../store.js'
import { setBrowseStatus } from './head.js'
import { buildBrowseFileRow, buildBrowseFolderCard } from './rows.js'
import { renderBrowse } from '../pack-browser.js'

export function fillBrowseError(item, pack, msg) {
  const list = document.querySelector('.pack-browser .pb-list')
  if (!list) return
  list.innerHTML = ''
  const hint = el('div', 'asset-lib-hint error', t('asset.loadFailed', { msg }))
  const retry = el('button', 'asset-lib-sec-btn', t('asset.browseRetry'))
  retry.addEventListener('click', () => renderBrowse())
  hint.appendChild(document.createElement('br'))
  hint.appendChild(retry)
  list.appendChild(hint)
  setBrowseStatus(t('asset.loadFailed', { msg }))
}

export function fillBrowseView(item, pack, data) {
  const list = document.querySelector('.pack-browser .pb-list')
  if (!list) return
  list.innerHTML = ''
  const kindEl = document.querySelector('.pack-browser .pb-kind')
  if (kindEl) kindEl.textContent = data.kind === 'zip' ? 'ZIP' : t('asset.officialKindDir')

  const term = S.browse && S.browse.filter ? S.browse.filter.trim().toLowerCase() : ''
  const match = (name) => !term || String(name).toLowerCase().includes(term)
  const dirs = (data.dirs || []).filter(d => match(d.name))
  const files = (data.files || []).filter(f => match(f.name))
  const total = dirs.length + files.length
  const unfiltered = (data.dirs || []).length + (data.files || []).length

  if (!total) {
    list.appendChild(el('div', 'pb-empty', term ? t('asset.browseNoMatch') : t('asset.browseEmptyDir')))
  } else {
    if (dirs.length) {
      const fg = el('div', 'pb-folders')
      for (const d of dirs) fg.appendChild(buildBrowseFolderCard(d))
      list.appendChild(fg)
    }
    if (files.length) {
      const grid = S.browse && S.browse.view === 'grid'
      const fl = el('div', grid ? 'pb-tex-grid' : 'pb-files')
      for (const f of files) fl.appendChild(buildBrowseFileRow(item, pack, f, grid))
      list.appendChild(fl)
    }
    if (data.truncated) {
      const more = el('div', 'pb-empty', t('asset.browseTruncated', { n: String(data.total) }))
      list.appendChild(more)
    }
  }
  const stat = document.querySelector('.asset-lib-stat')
  if (stat) stat.textContent = t('asset.statTotal', { n: String(total) })

  const parts = []
  if (dirs.length) parts.push(t('asset.browseStatDirs', { n: String(dirs.length) }))
  if (files.length) parts.push(t('asset.browseStatFiles', { n: String(files.length) }))
  let status = parts.join(' · ') || t('asset.browseEmptyDir')
  if (term && total !== unfiltered) {
    status += ' · ' + t('asset.browseFiltered', { n: String(total), total: String(unfiltered) })
  }
  status += ' — ' + t('asset.browseHint')
  setBrowseStatus(status)
}

