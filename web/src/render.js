/**
 * matoga - 材质贴图对比工具
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 */

import {
  state, $, ROLE_LABEL, KIND_TEXT, STATUS_ORDER,
  leftBtn, rightBtn, onlyMissingChk, summaryEl, resultBody,
  leftPathEl, rightPathEl
} from './core.js'
import {
  formatSize, formatDate, isImageFile, fileUrl, escAttr,
  folderOf, mainEntryOf, hasAny, leftRoles, rightRoles, subKind,
  openPreview, relPath, joinPath, modelTypeOf, modelBaseNameOf,
  groupTypeOf, groupContentKind, groupTagOf
} from './utils.js'
import { sortResult } from './compare.js'
import { replaceWithExternalFile, deleteTexture, handleAction, showPixelDiff, copySingleToRight, addTextureToRight, createBlankTextureToRight, saveOptions } from './actions.js'
import { initMaterial3D, updateMaterial3D, clearCustomModel } from './material3d.js'
import { enhancePreview } from './preview2d.js'
import { observeThumbs } from './thumb-loader.js'
import { observeModelThumbs } from './model-thumb.js'
import { parseModelText, buildModelSummary, diffLines, escHtml, isModelEntry } from './model-diff.js'
import { viewMcModelPairInViewport, viewMcModelTexCompareInViewport, isViewportVisible, resolveModelTexList, textureAssetPath } from './mc-model-viewer.js'
import { t, onLocaleChange } from './i18n.js'
import { modelPrefixOf } from './model-prefix.js'

import { renderChart } from './rnd/charts.js'
import { appendModelCard, modelThumbSpec, renderModelThumbPair } from './rnd/model-cards.js'
import { renderSidebar } from './rnd/sidebar.js'
const _rowMap = new Map()
let _filteredCache = null
let _renderedCount = 0
let _lastBaseSet = []

function _showMoreHandler() {
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
    _renderedCount += added
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

export function setLoading(side, on) {
  const path = side === 'left' ? leftPathEl : rightPathEl
  const btn = side === 'left' ? leftBtn : rightBtn
  if (on) path.textContent = t('render.loading')
  else path.textContent = (side === 'left' ? state.leftPath : state.rightPath) || t('common.empty')
  btn.disabled = on
}

export function applyEntries(side, folderPath, entries) {
  if (side === 'left') {
    state.leftPath = folderPath; state.leftEntries = entries
    leftPathEl.textContent = folderPath
  } else {
    state.rightPath = folderPath; state.rightEntries = entries
    rightPathEl.textContent = folderPath
  }
}

export function statusBadge(kind) {
  const icons = { have: 'i-check', diff: 'i-alert', partial: 'i-minus', miss: 'i-x', extra: 'i-plus' }
  const labels = { have: t('status.haveShort'), diff: t('status.diffShort'), partial: t('status.partialShort'), miss: t('status.missShort'), extra: t('status.extraShort') }
  return `<span class="status-badge status-${kind}"><svg class="ico"><use href="#${icons[kind]}"/></svg>${labels[kind]}</span>`
}

export function renderThumbPair(le, re) {
  const isImgE = (e) => e && !e.isDirectory && isImageFile(e.name)
  if (!isImgE(le) && !isImgE(re)) return '<span class="cell-empty">—</span>'
  const lt = isImgE(le) ? `<img class="thumb thumb-left" data-thumb="${escAttr(le.fullPath)}" />` : '<span class="thumb-ph thumb-left-ph">L</span>'
  const rt = isImgE(re) ? `<img class="thumb thumb-right" data-thumb="${escAttr(re.fullPath)}" />` : '<span class="thumb-ph thumb-right-ph">R</span>'
  return `<div class="thumb-pair">${lt}${rt}</div>`
}

/* 模型行预览列：左右各一个 3D 缩略图占位（.ac-thumb + _modelThumbItem，observeModelThumbs 懒加载）。
   noCache 跳过后端缓存（对比场景为任意文件夹，缓存 key 含绝对路径，仅前端离屏渲染 + 内存去重） */
export function appendGroupRows(frag, g) {
  const tr = document.createElement('tr')
  tr.className = 'row-' + g.kind
  if (state.selected && state.selected.key === g.key) tr.classList.add('row-selected')

  const roleCount = (g.isMaterial ? leftRoles(g).length + rightRoles(g).length : 0)
  const expandable = g.isMaterial && roleCount > 1
  const expanded = state.expandedKeys.has(g.key)

  let mainLeft, mainRight
  if (g.isMaterial) { mainLeft = g.left && g.left.main; mainRight = g.right && g.right.main }
  else { mainLeft = g.left && (g.left.file || g.left.dir); mainRight = g.right && (g.right.file || g.right.dir) }

  const previewCell = g.isModel ? renderModelThumbPair(mainLeft, mainRight, state.leftPath, state.rightPath) : renderThumbPair(mainLeft, mainRight)
  const arrow = expandable ? `<span class="expand-arrow">${expanded ? '▾' : '▸'}</span>` : ''
  const folder = folderOf(g)
  const displayName = state.viewMode === 'byFolder' && folder !== t('render.rootFolder') ? g.key.slice(folder.length + 1) : g.key
  const nameHtml = `${arrow}<span class="cell-name" title="${escAttr(g.key)}">${escHtml(displayName || g.key)}</span>`
  const typeHtml = g.isMaterial ? `<span class="type-mat"><svg class="ico"><use href="#i-layers"/></svg>${t('type.material')}</span>` : g.isModel ? `<span class="type-model"><svg class="ico"><use href="#i-cube"/></svg>${t('type.model')}</span>` : g.isDir ? `<span class="type-dir"><svg class="ico"><use href="#i-folder"/></svg>${t('type.folder')}</span>` : `<span class="type-file"><svg class="ico"><use href="#i-image"/></svg>${t('type.file')}</span>`
  const me = mainLeft || mainRight
  const sizeHtml = (g.kind === 'diff' && mainLeft && mainRight && mainLeft.size !== mainRight.size)
    ? `<span class="size-diff" title="${t('common.left')} ${formatSize(mainLeft.size)} / ${t('common.right')} ${formatSize(mainRight.size)}">${formatSize(mainLeft.size)} ≠ ${formatSize(mainRight.size)}</span>`
    : formatSize(me ? me.size : 0)
  const mtimeHtml = formatDate(me ? me.mtime : 0)
  const leftCell = hasAny(g.left) ? '<span class="cell-yes">✓</span>' : '<span class="cell-empty">—</span>'
  const rightCell = hasAny(g.right) ? '<span class="cell-yes">✓</span>' : '<span class="cell-empty">—</span>'

  tr.innerHTML = `<td>${statusBadge(g.kind)}</td><td class="preview-cell">${previewCell}</td><td>${nameHtml}</td><td>${typeHtml}</td><td>${sizeHtml}</td><td>${mtimeHtml}</td><td>${leftCell}</td><td>${rightCell}</td>`
  if (g.isModel) {
    tr.querySelectorAll('.ac-thumb[data-mrel]').forEach(th => {
      th._modelThumbItem = { modelThumb: modelThumbSpec({ name: th.dataset.mrel, mtime: +th.dataset.mtime || 0 }, th.dataset.mroot) }
    })
  }
  tr._group = g

  tr.title = me ? `${g.key}\n${KIND_TEXT[g.kind] || g.kind} · ${formatSize(me.size)} · ${formatDate(me.mtime)}` : (g.key + (KIND_TEXT[g.kind] ? '\n' + KIND_TEXT[g.kind] : ''))
  tr.addEventListener('click', () => selectGroup(g))
  tr.addEventListener('dblclick', (ev) => {
    const e = mainEntryOf(g)
    if (!e) return
    if (ev.metaKey || ev.ctrlKey) window.api.showInFolder(e.fullPath)
    else window.api.openPath(e.fullPath)
  })
  frag.appendChild(tr)

  if (g.isMaterial && expanded) {
    appendSubRows(frag, g)
  }
}

export function appendSubRows(frag, g) {
  for (const role of ['main', 'normal', 'specular']) {
    const le = g.left && g.left[role], re = g.right && g.right[role]
    if (!le && !re) continue
    const sub = document.createElement('tr')
    const sk = subKind(le, re)
    sub.className = 'sub-row row-' + sk
    const subName = `<span class="sub-name">${ROLE_LABEL[role]}</span>`
    const se = le || re
    sub.innerHTML = `<td>${statusBadge(sk)}</td><td class="preview-cell">${renderThumbPair(le, re)}</td><td>${subName}</td><td></td><td>${formatSize(se.size)}</td><td>${formatDate(se.mtime)}</td><td>${le ? '<span class="cell-yes">✓</span>' : '<span class="cell-empty">—</span>'}</td><td>${re ? '<span class="cell-yes">✓</span>' : '<span class="cell-no">✗</span>'}</td>`
    sub.addEventListener('click', () => { state.selected = g; renderSidebar() })
    frag.appendChild(sub)
  }
}

export function renderModelTypeResult() {
  const body = $('modelGridBody')
  if (!body) return
  const result = state.result
  let models = result.filter(g => g.isModel)
  const onlyDiff = onlyMissingChk.checked
  if (onlyDiff) models = models.filter(g => g.kind !== 'have')
  models = models.filter(g => !state.hiddenKeys.has(g.key))
  sortResult(models)
  if (models.length === 0) {
    const msg = !state.leftPath || !state.rightPath ? t('render.dragHint') : result.length === 0 ? t('render.bothEmpty') : t('render.noModel')
    body.innerHTML = `<div class="model-grid-empty">${msg}</div>`
    return
  }
  const typeMap = new Map()
  for (const g of models) {
    const tp = modelTypeOf(g) || t('render.rootFolder')
    if (!typeMap.has(tp)) typeMap.set(tp, [])
    typeMap.get(tp).push(g)
  }
  const types = [...typeMap.keys()].sort((a, b) => a.localeCompare(b, 'zh'))
  const frag = document.createDocumentFragment()
  const limit = state.renderLimit
  let rendered = 0
  let truncated = false
  const buildSummary = (items) => {
    const fc = { have: 0, diff: 0, partial: 0, miss: 0, extra: 0 }
    for (const g of items) fc[g.kind]++
    const sp = []
    if (fc.have) sp.push(`<span class="fc fc-have">✓${fc.have}</span>`)
    if (fc.diff) sp.push(`<span class="fc fc-diff">≈${fc.diff}</span>`)
    if (fc.partial) sp.push(`<span class="fc fc-partial">◐${fc.partial}</span>`)
    if (fc.miss) sp.push(`<span class="fc fc-miss">✗${fc.miss}</span>`)
    if (fc.extra) sp.push(`<span class="fc fc-extra">＋${fc.extra}</span>`)
    return sp.join(' ')
  }
  const renderCardsInto = (container, items) => {
    for (const g of items) {
      if (rendered >= limit) { truncated = true; break }
      appendModelCard(container, g)
      rendered++
    }
  }
  const groupByPrefix = (items) => {
    const buckets = new Map()
    const ungrouped = []
    for (const g of items) {
      const pfx = modelPrefixOf(modelBaseNameOf(g))
      if (pfx == null) ungrouped.push(g)
      else {
        let b = buckets.get(pfx)
        if (!b) { b = []; buckets.set(pfx, b) }
        b.push(g)
      }
    }
    if (buckets.size + (ungrouped.length ? 1 : 0) <= 1) return null
    const out = [...buckets.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([pfx, its]) => ({ prefix: pfx, items: its }))
    if (ungrouped.length) out.push({ prefix: null, items: ungrouped })
    return out
  }
  for (const tp of types) {
    if (rendered >= limit) { truncated = true; break }
    const items = typeMap.get(tp)
    const collapsed = state.collapsedFolders.has(tp)
    const section = document.createElement('div')
    section.className = 'model-type-section'
    section.innerHTML = `<div class="model-type-header"><span class="model-type-arrow">${collapsed ? '▸' : '▾'}</span><svg class="ico ico-sm"><use href="#i-cube"/></svg><span class="model-type-name">${tp}</span><span class="model-type-count">${t('render.modelTypeCount', { n: items.length })}</span><span class="model-type-summary">${buildSummary(items)}</span></div>`
    section.querySelector('.model-type-header').addEventListener('click', () => {
      if (state.collapsedFolders.has(tp)) state.collapsedFolders.delete(tp)
      else state.collapsedFolders.add(tp)
      renderModelTypeResult()
    })
    if (!collapsed) {
      const prefixGroups = groupByPrefix(items)
      if (!prefixGroups) {
        const cards = document.createElement('div')
        cards.className = 'model-cards'
        renderCardsInto(cards, items)
        section.appendChild(cards)
      } else {
        for (const pg of prefixGroups) {
          if (rendered >= limit) { truncated = true; break }
          const subKey = tp + '#' + (pg.prefix || '')
          const subCollapsed = state.collapsedFolders.has(subKey)
          const label = pg.prefix || t('render.modelUngrouped')
          const sub = document.createElement('div')
          sub.className = 'model-prefix-section'
          sub.innerHTML = `<div class="model-prefix-header"><span class="model-type-arrow">${subCollapsed ? '▸' : '▾'}</span><span class="model-prefix-name">${escHtml(label)}</span><span class="model-type-count">${t('render.modelTypeCount', { n: pg.items.length })}</span><span class="model-type-summary">${buildSummary(pg.items)}</span></div>`
          sub.querySelector('.model-prefix-header').addEventListener('click', () => {
            if (state.collapsedFolders.has(subKey)) state.collapsedFolders.delete(subKey)
            else state.collapsedFolders.add(subKey)
            renderModelTypeResult()
          })
          if (!subCollapsed) {
            const cards = document.createElement('div')
            cards.className = 'model-cards'
            renderCardsInto(cards, pg.items)
            sub.appendChild(cards)
          }
          section.appendChild(sub)
        }
      }
    }
    frag.appendChild(section)
  }
  if (truncated) {
    const more = document.createElement('div')
    more.className = 'model-show-more'
    more.innerHTML = `<button class="btn btn-ghost btn-sm">${t('render.showMore', { rendered, total: models.length })}</button>`
    more.querySelector('button').addEventListener('click', () => { state.renderLimit += 200; renderModelTypeResult() })
    frag.appendChild(more)
  }
  body.innerHTML = ''
  body.appendChild(frag)
  observeThumbs(body)
  observeModelThumbs(body)
}

function applyCategoryFilter(arr) {
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

function buildCatRow(dim, labelKey, items, currentVal, scrollable) {
  const label = `<span class="cat-row-label" data-i18n="${labelKey}">${t(labelKey)}</span>`
  const btns = items.map(([val, textKey, count, rawText]) => {
    const text = rawText != null ? escHtml(rawText) : `<span data-i18n="${textKey}">${t(textKey)}</span>`
    const active = currentVal === val ? ' active' : ''
    const cnt = count != null ? `<span class="cat-cnt">${count}</span>` : ''
    return `<button class="cat-btn${active}" data-dim="${dim}" data-val="${escAttr(val)}"><span class="cat-name">${text}</span>${cnt}</button>`
  }).join('')
  return `<div class="cat-row${scrollable ? ' cat-row-scroll' : ''}">${label}<div class="cat-btns">${btns}</div></div>`
}

function renderCategoryBar(baseSet) {
  _lastBaseSet = baseSet || []
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
  _filteredCache = filtered
  _renderedCount = rendered
  observeThumbs(resultBody)
  observeModelThumbs(resultBody)

}

export function selectGroup(g, toggle = true) {
  state.selected = g
  const prevRow = resultBody.querySelector('tr.row-selected:not(.sub-row)')
  if (prevRow && prevRow._group !== g) prevRow.classList.remove('row-selected')
  let curRow = _rowMap.get(g.key) || null
  if (curRow) curRow.classList.add('row-selected')
  if (toggle && g.isMaterial && curRow) {
    const arrow = curRow.querySelector('.expand-arrow')
    if (state.expandedKeys.has(g.key)) {
      state.expandedKeys.delete(g.key)
      let next = curRow.nextSibling
      while (next && next.classList && next.classList.contains('sub-row')) {
        const rm = next; next = next.nextSibling; rm.remove()
      }
      if (arrow) arrow.textContent = '▸'
    } else {
      state.expandedKeys.add(g.key)
      const frag = document.createDocumentFragment()
      appendSubRows(frag, g)
      curRow.after(frag)
      observeThumbs(resultBody)
      if (arrow) arrow.textContent = '▾'
    }
  } else if (toggle && g.isMaterial && !curRow) {
    if (state.expandedKeys.has(g.key)) state.expandedKeys.delete(g.key)
    else state.expandedKeys.add(g.key)
    renderResult()

  }
  renderSidebar()
}

export function bindEmptyCellActions(panel, g) {
  if (!state.rightPath) return
  panel.querySelectorAll('.pv-row').forEach(row => {
    const cells = row.querySelectorAll('.pv-cell')
    if (cells.length < 2) return
    const rightCell = cells[1]
    if (rightCell.querySelector('img')) return
    const role = row.dataset.role
    let le = null
    if (g.isMaterial) le = g.left && g.left[role]
    else le = g.left && (g.left.file || g.left.dir)
    const hasLeft = le && !le.isDirectory
    const canBlank = g.isMaterial && (role === 'normal' || role === 'specular')
    if (!hasLeft && !canBlank) return
    const empty = rightCell.querySelector('.pv-empty')
    if (empty) empty.remove()
    const actions = document.createElement('div')
    actions.className = 'pv-empty-actions'
    if (hasLeft) {
      const rel = relPath(state.leftPath, le.fullPath)
      const dest = joinPath(state.rightPath, rel)
      const copyBtn = document.createElement('button')
      copyBtn.className = 'pv-empty-btn pv-empty-copy'
      copyBtn.textContent = t('preview.copyFromLeft')
      copyBtn.title = t('preview.copyFromLeftTitle')
      copyBtn.addEventListener('click', (e) => { e.stopPropagation(); copySingleToRight(le.fullPath, dest) })
      actions.appendChild(copyBtn)
      const addBtn = document.createElement('button')
      addBtn.className = 'pv-empty-btn pv-empty-add'
      addBtn.textContent = t('preview.addTex')
      addBtn.title = t('preview.addTexTitle')
      addBtn.addEventListener('click', (e) => { e.stopPropagation(); addTextureToRight(dest) })
      actions.appendChild(addBtn)
    }
    if (canBlank) {
      const createBtn = document.createElement('button')
      createBtn.className = 'pv-empty-btn pv-empty-create'
      createBtn.textContent = t('preview.createBlank')
      createBtn.title = role === 'normal' ? t('preview.createBlankNormalTitle') : t('preview.createBlankSpecularTitle')
      createBtn.addEventListener('click', (e) => { e.stopPropagation(); createBlankTextureToRight(g, role) })
      actions.appendChild(createBtn)
    }
    rightCell.appendChild(actions)
  })
}

export { renderSidebar } from './rnd/sidebar.js'
export { loadModelTexEffectPreview } from './rnd/model-preview.js'


