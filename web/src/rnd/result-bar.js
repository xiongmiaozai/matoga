/**
 * matoga - 对比结果：分类栏与分页
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 从 result.js 按职责搬出，逻辑未改。
 */
import {
  state, $, ROLE_LABEL, KIND_TEXT, STATUS_ORDER,
  leftBtn, rightBtn, onlyMissingChk, summaryEl, resultBody,
  leftPathEl, rightPathEl
} from '../core.js'
import {
  formatSize, formatDate, isImageFile, fileUrl, escAttr,
  folderOf, mainEntryOf, hasAny, leftRoles, rightRoles, subKind,
  openPreview, relPath, joinPath, modelTypeOf, modelBaseNameOf,
  groupTypeOf, groupContentKind, groupTagOf
} from '../utils.js'
import { replaceWithExternalFile, deleteTexture, handleAction, showPixelDiff, copySingleToRight, addTextureToRight, createBlankTextureToRight, saveOptions } from '../actions.js'
import { observeThumbs } from '../thumb-loader.js'
import { observeModelThumbs } from '../model-thumb.js'
import { parseModelText, buildModelSummary, diffLines, escHtml, isModelEntry } from '../model-diff.js'
import { t, onLocaleChange } from '../i18n.js'
import { _filteredCache, _lastBaseSet, _renderedCount, _rowMap, setFilteredCache, setRenderedCount, setLastBaseSet } from './state.js'
import { appendGroupRows } from './rows.js'
import { renderResult } from './result.js'

export function _showMoreHandler() {
  state.renderLimit += 200
  if (state.viewMode !== 'byFolder' && _filteredCache) {
    const moreRow = resultBody.querySelector('.show-more-row')
    if (moreRow) moreRow.remove()
    const frag = document.createDocumentFragment()
    const start = _renderedCount
    let added = 0
    let truncated = false
    for (let i = start; i < _filteredCache.length; i++) {
      if (added >= 200) { truncated = true; break }
      appendGroupRows(frag, _filteredCache[i]); added++
    }
    setRenderedCount(_renderedCount + added)
    for (const r of frag.children) if (r._group) _rowMap.set(r._group.key, r)
    resultBody.appendChild(frag)
    if (truncated) {
      const newMoreRow = document.createElement('tr')
      newMoreRow.className = 'show-more-row'
      newMoreRow.innerHTML = `<td colspan="8" style="text-align:center;padding:8px;"><button class="btn btn-ghost btn-sm">${t('render.showMore', { rendered: _renderedCount, total: _filteredCache.length })}</button></td>`
      newMoreRow.querySelector('button').addEventListener('click', _showMoreHandler)
      resultBody.appendChild(newMoreRow)
    }
    observeThumbs(resultBody)
    observeModelThumbs(resultBody)
  } else {
    renderResult()
  }
}


onLocaleChange(() => {
  leftPathEl.textContent = state.leftPath || t('common.empty')
  rightPathEl.textContent = state.rightPath || t('common.empty')
  renderCategoryBar(_lastBaseSet)
})

export function applyCategoryFilter(arr) {
  const f = state.categoryFilter
  if (!f) return arr
  const out = []
  for (const g of arr) {
    if (f.type !== 'all' && groupTypeOf(g) !== f.type) continue
    if (f.content !== 'all') {
      const ck = groupContentKind(g)
      if (f.content === 'other' ? ck !== null : ck !== f.content) continue
    }
    if (f.status !== 'all' && g.kind !== f.status) continue
    if (f.folder !== 'all' && folderOf(g) !== f.folder) continue
    if (f.tag !== 'all') {
      const tg = groupTagOf(g, state.customTags)
      if (f.tag === 'none' ? tg !== null : tg !== f.tag) continue
    }
    out.push(g)
  }
  return out
}

export function buildCatRow(dim, labelKey, items, currentVal, scrollable) {
  const label = `<span class="cat-row-label" data-i18n="${labelKey}">${t(labelKey)}</span>`
  const btns = items.map(([val, textKey, count, rawText]) => {
    const text = rawText != null ? escHtml(rawText) : `<span data-i18n="${textKey}">${t(textKey)}</span>`
    const active = currentVal === val ? ' active' : ''
    const cnt = count != null ? `<span class="cat-cnt">${count}</span>` : ''
    return `<button class="cat-btn${active}" data-dim="${dim}" data-val="${escAttr(val)}"><span class="cat-name">${text}</span>${cnt}</button>`
  }).join('')
  return `<div class="cat-row${scrollable ? ' cat-row-scroll' : ''}">${label}<div class="cat-btns">${btns}</div></div>`
}

export function renderCategoryBar(baseSet) {
  setLastBaseSet(baseSet || [])
  const bar = $('categoryBar')
  if (!bar) return
  const f = state.categoryFilter || { type: 'all', content: 'all', status: 'all', folder: 'all', tag: 'all' }
  const total = _lastBaseSet.length
  if (total === 0) { bar.innerHTML = ''; return }

  const typeCounts = { material: 0, model: 0, dir: 0, file: 0 }
  const contentCounts = { block: 0, item: 0, other: 0 }
  const statusCounts = { have: 0, diff: 0, partial: 0, miss: 0, extra: 0 }
  const folderCounts = new Map()
  const tagCounts = new Map()
  let hasCustomTag = false
  for (const g of _lastBaseSet) {
    typeCounts[groupTypeOf(g)]++
    const ck = groupContentKind(g)
    if (ck === 'block') contentCounts.block++
    else if (ck === 'item') contentCounts.item++
    else contentCounts.other++
    statusCounts[g.kind]++
    const fo = folderOf(g)
    folderCounts.set(fo, (folderCounts.get(fo) || 0) + 1)
    const tg = groupTagOf(g, state.customTags)
    if (tg) { tagCounts.set(tg, (tagCounts.get(tg) || 0) + 1); hasCustomTag = true }
  }

  const rows = []
  rows.push(buildCatRow('type', 'category.typeLabel', [
    ['all', 'common.all', total],
    ['material', 'type.material', typeCounts.material],
    ['model', 'type.model', typeCounts.model],
    ['dir', 'type.folder', typeCounts.dir],
    ['file', 'type.file', typeCounts.file],
  ], f.type))
  if (contentCounts.block || contentCounts.item) {
    rows.push(buildCatRow('content', 'category.contentLabel', [
      ['all', 'common.all', total],
      ['block', 'category.block', contentCounts.block],
      ['item', 'category.item', contentCounts.item],
      ['other', 'category.other', contentCounts.other],
    ], f.content))
  }
  rows.push(buildCatRow('status', 'category.statusLabel', [
    ['all', 'common.all', total],
    ['have', 'status.haveShort', statusCounts.have],
    ['diff', 'status.diffShort', statusCounts.diff],
    ['partial', 'status.partialShort', statusCounts.partial],
    ['miss', 'status.missShort', statusCounts.miss],
    ['extra', 'status.extraShort', statusCounts.extra],
  ], f.status))
  if (folderCounts.size > 1) {
    const items = [['all', 'common.all', total]]
    const folders = [...folderCounts.keys()].sort((a, b) => a.localeCompare(b, 'zh'))
    for (const fo of folders) items.push([fo, null, folderCounts.get(fo), fo])
    rows.push(buildCatRow('folder', 'category.folderLabel', items, f.folder, true))
  }
  if (hasCustomTag) {
    let tagged = 0
    for (const v of tagCounts.values()) tagged += v
    const noneCount = total - tagged
    const items = [['all', 'common.all', total], ['none', 'category.untagged', noneCount]]
    const tags = [...tagCounts.keys()].sort((a, b) => a.localeCompare(b, 'zh'))
    for (const tg of tags) items.push([tg, null, tagCounts.get(tg), tg])
    rows.push(buildCatRow('tag', 'category.tagLabel', items, f.tag, true))
  }

  bar.innerHTML = rows.join('')
  bar.querySelectorAll('.cat-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const dim = btn.dataset.dim, val = btn.dataset.val
      if (state.categoryFilter[dim] === val) return
      state.categoryFilter[dim] = val
      state.renderLimit = 200
      saveOptions()
      renderResult()
    })
  })
}

