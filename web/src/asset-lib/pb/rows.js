/**
 * matoga - 总资产库：包内浏览（文件夹卡片与文件行）
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 从 pack-browser.js 按职责搬出，逻辑未改。
 */
import { state, IMG_EXTS, showToast } from '../../core.js'
import { fileUrl, formatSize, formatDate, escAttr, apiUrl, setTexDragData, contentKindOfPath } from '../../utils.js'
import { t, onLocaleChange } from '../../i18n.js'
import { el, shade, loadList, saveList } from '../dom.js'
import { tryActivateModelViewport, viewMcModelAsset, viewImportedModelAsset } from '../model-view.js'
import { addPackTextureToCanvas, officialBadge } from '../sections-official.js'
import { pushRecent } from '../items.js'
import { browseEntryPath, setBrowseStatus } from './head.js'
import { browseTo } from './nav.js'
import { isAddableAssetPath, isModelBrowsePath, packEntryRawUrl } from './urls.js'

export function buildBrowseFolderCard(d) {
  const f = el('div', 'pb-folder')
  f.innerHTML = '<svg class="ico"><use href="#i-folder"/></svg>'
  f.appendChild(el('span', 'fn', d.name))
  f.appendChild(el('span', 'pb-farrow', '<svg class="ico"><use href="#i-chevron-right"/></svg>'))
  const dir = browseEntryPath(d.name)
  f.title = dir
  f.addEventListener('dblclick', (e) => { e.preventDefault(); browseTo(dir) })
  f.addEventListener('click', () => {
    document.querySelectorAll('.pack-browser .pb-folder.sel').forEach(x => x.classList.remove('sel'))
    document.querySelectorAll('.pack-browser .pb-file.sel').forEach(x => x.classList.remove('sel'))
    f.classList.add('sel')
    setBrowseStatus(dir + ' · ' + t('asset.officialKindDir'))
  })
  return f
}

export function buildBrowseFileRow(item, pack, file, grid) {
  const rel = browseEntryPath(file.name)
  const isImgFile = IMG_EXTS.has((file.name.split('.').pop() || '').toLowerCase())
  const isModelFile = isModelBrowsePath(rel)
  const addable = (isImgFile || isModelFile) && isAddableAssetPath(rel)
  const row = el('div', 'pb-file' + (grid ? ' card' : ''))
  const th = el('div', 'pf-thumb')
  if (isImgFile) {
    const img = el('img')
    img.loading = 'lazy'
    img.alt = ''
    img.src = packEntryRawUrl(item.name, rel)
    img.addEventListener('error', () => { th.innerHTML = '<svg class="ico"><use href="#i-file"/></svg>' })
    th.appendChild(img)
  } else if (isModelFile) {
    th.classList.add('model')
    th.innerHTML = '<svg class="ico"><use href="#i-cube"/></svg>'
  } else {
    th.innerHTML = '<svg class="ico"><use href="#i-file"/></svg>'
  }
  row.appendChild(th)
  row.appendChild(el('span', 'fn', file.name))
  row.appendChild(el('span', 'fs', file.size ? formatSize(file.size) : ''))
  const addHint = isModelFile ? t('asset.browseAddModel') : t('asset.browseAddTex')
  row.title = rel + (file.size ? ' · ' + formatSize(file.size) : '') + (addable ? ' · ' + addHint : '')

  if (addable) {
    const add = el('button', 'pf-add', '<svg class="ico"><use href="#i-plus"/></svg>')
    add.title = addHint
    add.addEventListener('click', (e) => {
      e.stopPropagation()
      if (isModelFile) {
        pushRecent(item)
        viewMcModelAsset(item.type, item.name, rel, file.name)
        return
      }
      const p = pack || { name: item.name }
      pushRecent(item)
      addPackTextureToCanvas(item, p, { path: rel, name: file.name })
    })
    row.appendChild(add)
  }
  row.addEventListener('click', () => {
    document.querySelectorAll('.pack-browser .pb-folder.sel').forEach(x => x.classList.remove('sel'))
    document.querySelectorAll('.pack-browser .pb-file.sel').forEach(x => x.classList.remove('sel'))
    row.classList.add('sel')
    setBrowseStatus(row.title)
  })
  row.addEventListener('dblclick', (e) => {
    e.preventDefault()
    if (isModelFile && isAddableAssetPath(rel)) {
      pushRecent(item)
      viewMcModelAsset(item.type, item.name, rel, file.name)
      return
    }
    if (!isImgFile || !isAddableAssetPath(rel)) {
      showToast(t('asset.toastFileNotAddable'))
      return
    }
    const p = pack || { name: item.name }
    pushRecent(item)
    addPackTextureToCanvas(item, p, { path: rel, name: file.name })
  })
  return row
}

