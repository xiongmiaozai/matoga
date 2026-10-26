/**
 * matoga - 材质 3D 视口：result
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 从 material3d.js 原样搬出，逻辑未改。
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
import { sortResult } from '../compare.js'
import { replaceWithExternalFile, deleteTexture, handleAction, showPixelDiff, copySingleToRight, addTextureToRight, createBlankTextureToRight, saveOptions } from '../actions.js'
import { observeThumbs } from '../thumb-loader.js'
import { observeModelThumbs } from '../model-thumb.js'
import { parseModelText, buildModelSummary, diffLines, escHtml, isModelEntry } from '../model-diff.js'
import { t, onLocaleChange } from '../i18n.js'
import { renderChart } from './charts.js'
import { renderSidebar } from './sidebar.js'
import { _filteredCache, _lastBaseSet, _renderedCount, _rowMap, setFilteredCache, setRenderedCount, setLastBaseSet } from './state.js'
import { renderThumbPair } from './cells.js'
import { renderModelTypeResult } from './model-result.js'
import { appendGroupRows } from './rows.js'

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

export function renderResult() {
  renderModelTypeResult()
  const result = state.result
  const onlyDiff = onlyMissingChk.checked
  let filtered = onlyDiff ? result.filter(g => g.kind !== 'have') : result.slice()
  filtered = filtered.filter(g => !state.hiddenKeys.has(g.key))
  renderCategoryBar(filtered)
  filtered = applyCategoryFilter(filtered)
  sortResult(filtered)

  const counts = state.counts || { have: 0, diff: 0, partial: 0, miss: 0, extra: 0, leftTex: 0, rightTex: 0, rightMatch: 0, pbrExtra: 0, leftModel: 0, rightModel: 0, modelMatch: 0 }
  const total = counts.have + counts.diff + counts.partial + counts.miss + counts.extra
  const leftGroups = counts.have + counts.diff + counts.partial + counts.miss
  const cov = counts.leftTex > 0 ? counts.rightMatch / counts.leftTex * 100 : 0
  const consist = leftGroups > 0 ? counts.have / leftGroups * 100 : 0
  const missRate = leftGroups > 0 ? counts.miss / leftGroups * 100 : 0
  const diffRate = leftGroups > 0 ? counts.diff / leftGroups * 100 : 0
  const pbrRate = leftGroups > 0 ? counts.pbrExtra / leftGroups * 100 : 0
  const modelRate = counts.leftModel > 0 ? counts.modelMatch / counts.leftModel * 100 : 0

  const dash = $('statsDashboard')
  if (dash) {
    const card = (label, val, unit, pct, sub, cls) =>
      `<div class="stat-card ${cls}"><div class="stat-card-label">${label}</div>` +
      `<div class="stat-card-value">${val}<span class="stat-unit">${unit}</span></div>` +
      `<div class="stat-card-bar"><div class="stat-card-fill" style="width:${Math.min(pct,100)}%"></div></div>` +
      `<div class="stat-card-sub">${sub}</div></div>`
    dash.innerHTML = total === 0 ? '' :
      `<div class="stat-cards">` +
      card(t('render.covTitle'), cov.toFixed(1), '%', cov, t('render.covSub', { match: counts.rightMatch, total: counts.leftTex }), 'stat-cov') +
      card(t('render.consistTitle'), consist.toFixed(1), '%', consist, t('render.consistSub', { have: counts.have, total: leftGroups }), 'stat-consist') +
      card(t('render.missTitle'), missRate.toFixed(1), '%', missRate, t('render.missSub', { n: counts.miss }), 'stat-miss') +
      card(t('render.diffTitle'), diffRate.toFixed(1), '%', diffRate, t('render.diffSub', { n: counts.diff }), 'stat-diff') +
      (counts.leftModel ? card(t('render.modelTitle'), modelRate.toFixed(1), '%', modelRate, t('render.modelSub', { match: counts.modelMatch, total: counts.leftModel }), 'stat-model') : '') +
      (counts.pbrExtra ? card(t('render.pbrTitle'), counts.pbrExtra, '', pbrRate, t('render.pbrSub', { n: counts.pbrExtra }), 'stat-pbr') : '') +
      `</div>`
  }

  summaryEl.innerHTML = total === 0 ? '' : `
    <span class="s-item">${t('render.leftItem')} <span class="s-num">${state.leftEntries.length}</span></span>
    <span class="s-item">${t('render.rightItem')} <span class="s-num">${state.rightEntries.length}</span></span>
    <span class="s-item">${t('render.groupItem')} <span class="s-num">${total}</span></span>
    <span class="s-item s-have">✓ <span class="s-num">${counts.have}</span></span>
    <span class="s-item s-diff">≈ <span class="s-num">${counts.diff}</span></span>
    <span class="s-item s-partial">◐ <span class="s-num">${counts.partial}</span></span>
    <span class="s-item s-miss">✗ <span class="s-num">${counts.miss}</span></span>
    <span class="s-item">＋ <span class="s-num">${counts.extra}</span></span>
  `

  renderChart()

  if (filtered.length === 0) {
    const msg = !state.leftPath || !state.rightPath
      ? t('render.dragHint')
      : result.length === 0 ? t('render.bothEmpty')
      : (onlyDiff ? t('render.allConsistent') : t('render.noData'))
    resultBody.innerHTML = `<tr class="empty-row"><td colspan="8">${msg}</td></tr>`
    return
  }

  const frag = document.createDocumentFragment()
  const limit = state.renderLimit
  let rendered = 0
  let truncated = false

  if (state.viewMode === 'byFolder') {
    const folderMap = new Map()
    for (const g of filtered) {
      const f = folderOf(g)
      if (!folderMap.has(f)) folderMap.set(f, [])
      folderMap.get(f).push(g)
    }
    const folders = [...folderMap.keys()]
    const _sKey = state.sortKey, _sDir = state.sortDir === 'asc' ? 1 : -1
    if (_sKey === 'name' || !_sKey) {
      folders.sort((a, b) => a.localeCompare(b, 'zh') * _sDir)
    } else {
      const fk = new Map()
      for (const f of folders) {
        const items = folderMap.get(f)
        let v
        if (_sKey === 'status') {
          v = Infinity
          for (const g of items) { const s = STATUS_ORDER[g.kind]; if (s < v) v = s }
        } else if (_sKey === 'size') {
          v = 0
          for (const g of items) { const s = mainEntryOf(g)?.size || 0; if (s > v) v = s }
        } else if (_sKey === 'mtime') {
          v = 0
          for (const g of items) { const s = mainEntryOf(g)?.mtime || 0; if (s > v) v = s }
        } else if (_sKey === 'left') {
          v = 1; for (const g of items) if (hasAny(g.left)) { v = 0; break }
        } else if (_sKey === 'right') {
          v = 1; for (const g of items) if (hasAny(g.right)) { v = 0; break }
        } else v = 0
        fk.set(f, v)
      }
      folders.sort((a, b) => {
        let v = fk.get(a) - fk.get(b)
        if (v === 0) v = a.localeCompare(b, 'zh')
        return v * _sDir
      })
    }
    for (const f of folders) {
      if (rendered >= limit) { truncated = true; break }
      const items = folderMap.get(f)
      const collapsed = state.collapsedFolders.has(f)
      const fc = { have: 0, diff: 0, partial: 0, miss: 0, extra: 0 }
      for (const g of items) fc[g.kind]++
      const sp = []
      if (fc.have) sp.push(`<span class="fc fc-have">✓${fc.have}</span>`)
      if (fc.diff) sp.push(`<span class="fc fc-diff">≈${fc.diff}</span>`)
      if (fc.partial) sp.push(`<span class="fc fc-partial">◐${fc.partial}</span>`)
      if (fc.miss) sp.push(`<span class="fc fc-miss">✗${fc.miss}</span>`)
      if (fc.extra) sp.push(`<span class="fc fc-extra">＋${fc.extra}</span>`)
      const ftr = document.createElement('tr')
      ftr.className = 'folder-group-row'
      ftr.innerHTML = `<td colspan="8"><span class="folder-arrow">${collapsed ? '▸' : '▾'}</span><span class="folder-ico">📁</span><span class="folder-name">${f}</span><span class="folder-count">${t('render.folderCount', { n: items.length })}</span><span class="folder-summary">${sp.join(' ')}</span></td>`
      ftr.addEventListener('click', () => {
        const wasCollapsed = state.collapsedFolders.has(f)
        if (wasCollapsed) state.collapsedFolders.delete(f)
        else state.collapsedFolders.add(f)
        const arrow = ftr.querySelector('.folder-arrow')
        if (wasCollapsed) {
          const subFrag = document.createDocumentFragment()
          for (const g of items) appendGroupRows(subFrag, g)
          ftr.after(subFrag)
          for (const r of subFrag.children) if (r._group) _rowMap.set(r._group.key, r)
          observeThumbs(resultBody)
          observeModelThumbs(resultBody)
          if (arrow) arrow.textContent = '▾'
        } else {
          let next = ftr.nextSibling
          while (next && !next.classList.contains('folder-group-row') && !next.classList.contains('show-more-row')) {
            const rm = next; next = next.nextSibling; rm.remove()
          }
          if (arrow) arrow.textContent = '▸'
        }
      })
      frag.appendChild(ftr)
      if (collapsed) continue
      for (const g of items) { if (rendered >= limit) { truncated = true; break }; appendGroupRows(frag, g); rendered++ }
    }

  } else {
    for (const g of filtered) { if (rendered >= limit) { truncated = true; break }; appendGroupRows(frag, g); rendered++ }
  }

  if (truncated) {
    const moreRow = document.createElement('tr')
    moreRow.className = 'show-more-row'
    moreRow.innerHTML = `<td colspan="8" style="text-align:center;padding:8px;"><button class="btn btn-ghost btn-sm">${t('render.showMore', { rendered, total: filtered.length })}</button></td>`
    moreRow.querySelector('button').addEventListener('click', _showMoreHandler)
    frag.appendChild(moreRow)
  }

  resultBody.innerHTML = ''
  resultBody.appendChild(frag)
  _rowMap.clear()
  for (const r of resultBody.children) if (r._group) _rowMap.set(r._group.key, r)
  setFilteredCache(filtered)
  setRenderedCount(rendered)
  observeThumbs(resultBody)
  observeModelThumbs(resultBody)

}



