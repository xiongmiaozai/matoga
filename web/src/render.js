/**
 * matoga - 材质贴图对比工具
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 */

import {
  state,
  $,
  ROLES,
  ROLE_LABEL,
  KIND_TEXT,
  STATUS_ORDER,
  leftBtn,
  rightBtn,
  onlyMissingChk,

  resultBody,
  leftPathEl,
  rightPathEl
} from './core.js'
import {
  formatSize,
  formatDate,
  isImageFile,
  fileUrl,
  escAttr,
  folderOf,
  mainEntryOf,
  hasAny,
  leftRoles,
  rightRoles,
  subKind,
  openPreview,
  relPath,
  joinPath,
  modelTypeOf,
  modelNsOf,
  modelFormatOf,
  modelTexBucketOf,
  modelAnimatedOf,
  modelCustomGroupOf,
  modelNameBucketOf,
  modelPrefixBucketOf,
  groupTypeOf,
  groupContentKind,
  groupTagOf,
  contentKindOfPath
} from './utils.js'
import { sortResult } from './compare.js'

import {
  replaceWithExternalFile,
  deleteTexture,
  handleAction,
  showPixelDiff,
  copySingleToRight,
  addTextureToRight,
  createBlankTextureToRight,
  saveOptions
} from './actions.js'
import { initMaterial3D, updateMaterial3D, clearCustomModel, setModelEmptyHint } from './material3d.js'
import { enhancePreview } from './preview2d.js'
import { observeThumbs } from './thumb-loader.js'
import { observeModelThumbs, prefetchModelThumbs } from './model-thumb.js'
import { parseModelText, buildModelSummary, diffLines, escHtml, isModelEntry, checkTexRefs } from './model-diff.js'
import { modelBaseNameOf } from './model-group-dims.js'
import {
  viewMcModelPairInViewport,
  viewMcModelTexCompareInViewport,
  isViewportVisible,
  resolveModelTexList,
  textureAssetPath
} from './mc-model-viewer.js'
import { t, onLocaleChange } from './i18n.js'
import { loadZhNames, zhOfTexPath, zhOfTexName } from './zh-names.js'
import { filterByResultSearch } from './result-search.js'
import {
  setHooks as setModelCardHooks,
  appendModelGridCard,
  buildModelDetailPanel,
  appendModelCompareRow,
  fillModelPreview,
  renderPreviewModel,
  renderPreviewTex2d
} from './rnd/model-cards.js'
import { renderSidebar } from './rnd/sidebar.js'
import { loadModelDiffView } from './rnd/diff-grid.js'
import { renderCategoryBar, setHooks as setCategoryBarHooks } from './rnd/category-bar.js'
import { bindPreviewImages, loadModelTex2dPreview, setHooks as setPreviewBindHooks } from './rnd/preview-bind.js'
import { bindEmptyCellActions } from './rnd/empty-cell.js'
import { bindResultSearch, setHooks as setResultSearchBindHooks } from './rnd/result-search-bind.js'
import { initViewTabs } from './rnd/view-tabs.js'
/* 门面 re-export：保持对外导出名不变 */
export { initViewTabs } from './rnd/view-tabs.js'
import { renderModelTypeResult, setHooks as setModelTypeResultHooks } from './rnd/model-type-result.js'

/* 门面 re-export：这些函数原为本地 export，搬到子模块后仍须从本文件对外可见，
   否则外部 import 拿到 undefined（曾导致浏览器报 does not provide an export named ...）。 */
export { renderSidebar } from './rnd/sidebar.js'
loadZhNames().catch(() => {})

function zhOfKey(key) {
  if (!key) return ''
  const z = zhOfTexPath(key) || zhOfTexPath(key + '.png')
  if (z) return z
  const base = String(key)
    .split('/')
    .pop()
    .replace(/\.png$/i, '')
  return zhOfTexName(base)
}

const _searchFieldCache = new Map()
function applyResultSearch(arr) {
  return filterByResultSearch(arr, state.resultSearchTerm, _searchFieldCache)
}

const _rowMap = new Map()
let _filteredCache = null
let _renderedCount = 0
let _lastBaseSet = []
let _modelMetaLoading = false

/* 懒加载模型元数据（ns/format/texRefs/animated），供贴图数/动画分组维度使用 */

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
      if (added >= 200) {
        truncated = true
        break
      }
      appendGroupRows(frag, _filteredCache[i])
      added++
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
    state.leftPath = folderPath
    state.leftEntries = entries
    leftPathEl.textContent = folderPath
  } else {
    state.rightPath = folderPath
    state.rightEntries = entries
    rightPathEl.textContent = folderPath
  }
}

export function statusBadge(kind) {
  const icons = { have: 'i-check', diff: 'i-alert', partial: 'i-minus', miss: 'i-x', extra: 'i-plus' }
  const labels = {
    have: t('status.haveShort'),
    diff: t('status.diffShort'),
    partial: t('status.partialShort'),
    miss: t('status.missShort'),
    extra: t('status.extraShort')
  }
  return `<span class="status-badge status-${kind}"><svg class="ico"><use href="#${icons[kind]}"/></svg>${labels[kind]}</span>`
}

export function renderThumbPair(le, re) {
  const isImgE = e => e && !e.isDirectory && isImageFile(e.name)
  if (!isImgE(le) && !isImgE(re)) return '<span class="cell-empty">—</span>'
  const lt = isImgE(le)
    ? `<img class="thumb thumb-left" data-thumb="${escAttr(le.fullPath)}" />`
    : '<span class="thumb-ph thumb-left-ph">L</span>'
  const rt = isImgE(re)
    ? `<img class="thumb thumb-right" data-thumb="${escAttr(re.fullPath)}" />`
    : '<span class="thumb-ph thumb-right-ph">R</span>'
  return `<div class="thumb-pair">${lt}${rt}</div>`
}

/* 模型行预览列：左右各一个 3D 缩略图占位（.ac-thumb + _modelThumbItem，observeModelThumbs 懒加载）。
   noCache 跳过后端缓存（对比场景为任意文件夹，缓存 key 含绝对路径，仅前端离屏渲染 + 内存去重） */
function modelThumbSpec(entry, root, texRoot) {
  if (!entry || !isModelEntry(entry)) return null
  return {
    kind: 'mc',
    fileRoot: root,
    texRoot: texRoot || undefined,
    rel: entry.name,
    path: 'cmp:' + (texRoot || root) + '/' + entry.name,
    mtime: entry.mtime || 0
  }
}

function renderModelThumbCell(entry, root, side, texRoot) {
  if (!modelThumbSpec(entry, root, texRoot))
    return `<span class="thumb-ph thumb-${side}-ph">${side === 'left' ? 'L' : 'R'}</span>`
  return `<div class="ac-thumb thumb-model thumb-${side}" data-mroot="${escAttr(root)}"${texRoot ? ` data-mtexroot="${escAttr(texRoot)}"` : ''} data-mrel="${escAttr(entry.name)}" data-mtime="${entry.mtime || 0}"></div>`
}

function renderModelThumbPair(le, re, leftRoot, rightRoot, rightFallback, rightTexRoot) {
  const hasL = isModelEntry(le),
    hasR = isModelEntry(re)
  if (!hasL && !hasR) return '<span class="cell-empty">—</span>'
  const lt = hasL ? renderModelThumbCell(le, leftRoot, 'left') : '<span class="thumb-ph thumb-left-ph">L</span>'
  const rt = hasR
    ? renderModelThumbCell(re, rightRoot, 'right', rightTexRoot)
    : '<span class="thumb-ph thumb-right-ph">R</span>'
  return `<div class="thumb-pair${rightFallback ? ' thumb-pair-fallback' : ''}">${lt}${rt}</div>`
}

export function appendGroupRows(frag, g) {
  const tr = document.createElement('tr')
  tr.className = 'row-' + g.kind
  if (state.selected && state.selected.key === g.key) tr.classList.add('row-selected')

  const roleCount = g.isMaterial ? leftRoles(g).length + rightRoles(g).length : 0
  const expandable = g.isMaterial && roleCount > 1
  const expanded = state.expandedKeys.has(g.key)

  let mainLeft, mainRight
  if (g.isMaterial) {
    mainLeft = g.left && g.left.main
    mainRight = g.right && g.right.main
  } else {
    mainLeft = g.left && (g.left.file || g.left.dir)
    mainRight = g.right && (g.right.file || g.right.dir)
  }

  const previewCell = g.isModel
    ? renderModelThumbPair(mainLeft, mainRight, state.leftPath, state.rightPath)
    : renderThumbPair(mainLeft, mainRight)
  const arrow = expandable ? `<span class="expand-arrow">${expanded ? '▾' : '▸'}</span>` : ''
  const folder = folderOf(g)
  const displayName =
    state.viewMode === 'byFolder' && folder !== t('render.rootFolder') ? g.key.slice(folder.length + 1) : g.key
  const zhName = zhOfKey(g.key)
  const zhHtml = zhName
    ? `<span class="cell-zh" style="margin-left:6px;color:var(--text-muted,#888);font-size:.85em">${escHtml(zhName)}</span>`
    : ''
  const nameHtml = `${arrow}<span class="cell-name" title="${escAttr(g.key)}">${escHtml(displayName || g.key)}</span>${zhHtml}`
  const typeHtml = g.isMaterial
    ? `<span class="type-mat"><svg class="ico"><use href="#i-layers"/></svg>${t('type.material')}</span>`
    : g.isModel
      ? `<span class="type-model"><svg class="ico"><use href="#i-cube"/></svg>${t('type.model')}</span>`
      : g.isDir
        ? `<span class="type-dir"><svg class="ico"><use href="#i-folder"/></svg>${t('type.folder')}</span>`
        : `<span class="type-file"><svg class="ico"><use href="#i-image"/></svg>${t('type.file')}</span>`
  const me = mainLeft || mainRight
  const sizeHtml =
    g.kind === 'diff' && mainLeft && mainRight && mainLeft.size !== mainRight.size
      ? `<span class="size-diff" title="${t('common.left')} ${formatSize(mainLeft.size)} / ${t('common.right')} ${formatSize(mainRight.size)}">${formatSize(mainLeft.size)} ≠ ${formatSize(mainRight.size)}</span>`
      : formatSize(me ? me.size : 0)
  const mtimeHtml = formatDate(me ? me.mtime : 0)
  const leftCell = hasAny(g.left) ? '<span class="cell-yes">✓</span>' : '<span class="cell-empty">—</span>'
  const rightCell = hasAny(g.right) ? '<span class="cell-yes">✓</span>' : '<span class="cell-empty">—</span>'

  const similarMark = g.similar ? `<span class="similar-mark" title="${escAttr(t('status.similar'))}">≈</span>` : ''
  tr.innerHTML = `<td>${statusBadge(g.kind)}${similarMark}</td><td class="preview-cell">${previewCell}</td><td>${nameHtml}</td><td>${typeHtml}</td><td>${sizeHtml}</td><td>${mtimeHtml}</td><td>${leftCell}</td><td>${rightCell}</td>`
  if (g.isModel) {
    tr.querySelectorAll('.ac-thumb[data-mrel]').forEach(th => {
      th._modelThumbItem = {
        modelThumb: modelThumbSpec(
          { name: th.dataset.mrel, mtime: +th.dataset.mtime || 0 },
          th.dataset.mroot,
          th.dataset.mtexroot || undefined
        )
      }
    })
  }
  tr._group = g

  tr.title = me
    ? `${g.key}\n${KIND_TEXT[g.kind] || g.kind} · ${formatSize(me.size)} · ${formatDate(me.mtime)}`
    : g.key + (KIND_TEXT[g.kind] ? '\n' + KIND_TEXT[g.kind] : '')
  tr.addEventListener('click', () => selectGroup(g))
  tr.addEventListener('dblclick', ev => {
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
  for (const role of ROLES) {
    const le = g.left && g.left[role],
      re = g.right && g.right[role]
    if (!le && !re) continue
    const sub = document.createElement('tr')
    const sk = subKind(le, re)
    sub.className = 'sub-row row-' + sk
    const subName = `<span class="sub-name">${ROLE_LABEL[role]}</span>`
    const se = le || re
    sub.innerHTML = `<td>${statusBadge(sk)}</td><td class="preview-cell">${renderThumbPair(le, re)}</td><td>${subName}</td><td></td><td>${formatSize(se.size)}</td><td>${formatDate(se.mtime)}</td><td>${le ? '<span class="cell-yes">✓</span>' : '<span class="cell-empty">—</span>'}</td><td>${re ? '<span class="cell-yes">✓</span>' : '<span class="cell-no">✗</span>'}</td>`
    sub.addEventListener('click', () => {
      state.selected = g
      renderSidebar()
    })
    frag.appendChild(sub)
  }
}

function modelTexRoleThumbs(grp, role) {
  const lEntry = grp && grp.left && grp.left[role]
  const rReal = grp && grp.right && grp.right[role]
  const rEntry = rReal || lEntry
  if (!lEntry && !rEntry) return ''
  const thumbL = lEntry
    ? `<img class="thumb thumb-left" src="${escAttr(fileUrl(lEntry.fullPath))}" alt="" />`
    : '<span class="thumb-ph thumb-left-ph">L</span>'
  const thumbR = rEntry
    ? `<img class="thumb thumb-right" src="${escAttr(fileUrl(rEntry.fullPath))}" alt="" />`
    : '<span class="thumb-ph thumb-right-ph">R</span>'
  return `<div class="model-tex-thumbs${!rReal && lEntry ? ' model-tex-role-fallback' : ''}">${thumbL}${thumbR}</div>`
}


async function loadModelTexComparePanel(row, g) {
  const wrap = row.querySelector('.mc-tex-wrap')
  if (!wrap) return
  const le = g.left && g.left.file,
    re = g.right && g.right.file
  const leftList =
    le && isModelEntry(le)
      ? await resolveModelTexList({ fileRoot: state.leftPath, rel: le.name }).catch(() => null)
      : null
  const rightList =
    re && isModelEntry(re)
      ? await resolveModelTexList({ fileRoot: state.rightPath, rel: re.name }).catch(() => null)
      : null
  if (!row.isConnected) return
  const groupMap = new Map()
  for (const grp of state.result) groupMap.set(grp.key, grp)
  const texMap = new Map()
  for (const tx of leftList || []) {
    const ap = textureAssetPath(tx.name)
    if (!ap) continue
    if (!texMap.has(ap)) texMap.set(ap, { name: tx.name, leftUrl: tx.url, rightUrl: null })
    else texMap.get(ap).leftUrl = tx.url
  }
  for (const tx of rightList || []) {
    const ap = textureAssetPath(tx.name)
    if (!ap) continue
    if (!texMap.has(ap)) texMap.set(ap, { name: tx.name, leftUrl: null, rightUrl: tx.url })
    else texMap.get(ap).rightUrl = tx.url
  }
  if (texMap.size === 0) {
    wrap.innerHTML = `<span class="mc-tex-none">${t('render.modelTexNone')}</span>`
    return
  }
  const buckets = { block: [], item: [], other: [] }
  for (const [ap, info] of texMap) {
    const dot = ap.lastIndexOf('.')
    const key = dot >= 0 ? ap.slice(0, dot) : ap
    const grp = groupMap.get(key)
    const kind = grp ? grp.kind : 'miss'
    const ck = contentKindOfPath(ap)
    const bucket = ck === 'block' ? 'block' : ck === 'item' ? 'item' : 'other'
    const lMain = grp && grp.left && grp.left.main
    const rMain = grp && grp.right && grp.right.main
    const leftUrl = lMain ? fileUrl(lMain.fullPath) : info.leftUrl
    const rightUrl = rMain ? fileUrl(rMain.fullPath) : info.rightUrl
    const texName = (info.name || ap).replace(/^minecraft:/, '')
    buckets[bucket].push({ ap, texName, leftUrl, rightUrl, kind, grp })
  }
  const frag = document.createDocumentFragment()
  for (const bk of ['block', 'item', 'other']) {
    const items = buckets[bk]
    const catEl = document.createElement('div')
    catEl.className = 'mc-tex-cat' + (items.length ? '' : ' empty')
    catEl.innerHTML = `<div class="mc-tex-cat-head"><span class="mc-tex-tag">${t('category.' + bk)}</span><span class="mc-tex-cat-cnt">${items.length ? items.length + ' ' + t('render.texCount') : t('render.texNone')}</span></div><div class="mc-tex-cat-body"></div>`
    const bodyEl = catEl.querySelector('.mc-tex-cat-body')
    for (const it of items) bodyEl.appendChild(buildTexCompareRow(it))
    frag.appendChild(catEl)
  }
  wrap.innerHTML = ''
  wrap.appendChild(frag)
  observeThumbs(wrap)
}

function buildTexCompareRow(it) {
  const row = document.createElement('div')
  row.className = 'mc-tex-row row-' + it.kind
  const thumbL = it.leftUrl
    ? `<img class="thumb thumb-left" src="${escAttr(it.leftUrl)}" alt="" />`
    : `<span class="thumb-ph thumb-left-ph">L</span>`
  const thumbR = it.rightUrl
    ? `<img class="thumb thumb-right" src="${escAttr(it.rightUrl)}" alt="" />`
    : `<span class="thumb-ph thumb-right-ph">R</span>`
  row.innerHTML =
    `<div class="mc-tex-cell left">${thumbL}</div>` +
    `<div class="mc-tex-mid"><span class="mc-tex-name" title="${escAttr(it.ap)}">${escHtml(it.texName)}</span>${statusBadge(it.kind)}</div>` +
    `<div class="mc-tex-cell right">${thumbR}</div>`
  row.querySelectorAll('img.thumb').forEach(img => {
    img.addEventListener('click', e => {
      e.stopPropagation()
      openPreview(img.src, it.texName)
    })
  })
  if (it.grp)
    row.addEventListener('click', () => {
      state.selected = it.grp
      renderSidebar()
    })
  return row
}

function renderMaterialPreviewHtml(matG) {
  const hasMain = (matG.left && matG.left.main) || (matG.right && matG.right.main)
  let h = ''
  for (const role of ROLES) {
    const le = matG.left && matG.left[role],
      re = matG.right && matG.right[role]
    if (!le && !re) {
      if ((role === 'normal' || role === 'specular') && hasMain && state.rightPath)
        h += `<div class="pv-row pv-row-empty" data-role="${role}"><span class="pv-role">${ROLE_LABEL[role]}</span>${pvCell(null, t('common.left'))}${pvCell(null, t('common.right'))}</div>`
      continue
    }
    h += `<div class="pv-row" data-role="${role}"><span class="pv-role">${ROLE_LABEL[role]}</span>${pvCell(le, t('common.left'))}${pvCell(re, t('common.right'))}</div>`
  }
  return h
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
  if (scrollable && items.length > 12) {
    const opts = items
      .map(([val, textKey, count, rawText]) => {
        const text = rawText != null ? escHtml(rawText) : t(textKey)
        const cnt = count != null ? ` (${count})` : ''
        const sel = currentVal === val ? ' selected' : ''
        return `<option value="${escAttr(val)}"${sel}>${text}${cnt}</option>`
      })
      .join('')
    return `<div class="cat-row"><span class="cat-row-label" data-i18n="${labelKey}">${t(labelKey)}</span><select class="cat-select" data-dim="${dim}">${opts}</select></div>`
  }
  const btns = items
    .map(([val, textKey, count, rawText]) => {
      const text = rawText != null ? escHtml(rawText) : `<span data-i18n="${textKey}">${t(textKey)}</span>`
      const active = currentVal === val ? ' active' : ''
      const cnt = count != null ? `<span class="cat-cnt">${count}</span>` : ''
      return `<button class="cat-btn${active}" data-dim="${dim}" data-val="${escAttr(val)}"><span class="cat-name">${text}</span>${cnt}</button>`
    })
    .join('')
  return `<div class="cat-row${scrollable ? ' cat-row-scroll' : ''}">${label}<div class="cat-btns">${btns}</div></div>`
}

export function renderResult() {
  renderModelTypeResult()
  const result = state.result
  const onlyDiff = onlyMissingChk.checked
  let filtered = onlyDiff ? result.filter(g => g.kind !== 'have') : result.slice()
  filtered = filtered.filter(g => !state.hiddenKeys.has(g.key))
  renderCategoryBar(filtered)
  filtered = applyCategoryFilter(filtered)
  filtered = applyResultSearch(filtered)
  sortResult(filtered)


  if (filtered.length === 0) {
    let msg
    if (!state.leftPath || !state.rightPath) msg = t('render.dragHint')
    else if (result.length === 0) msg = t('render.bothEmpty')
    else if (state.resultSearchTerm && state.resultSearchTerm.trim()) {
      const baseFiltered = applyCategoryFilter(
        (onlyDiff ? result.filter(g => g.kind !== 'have') : result).filter(g => !state.hiddenKeys.has(g.key))
      )
      msg = baseFiltered.length ? t('categoryFilter.noMatch', { q: state.resultSearchTerm.trim() }) : t('render.noData')
    } else if (onlyDiff) msg = t('render.allConsistent')
    else msg = t('render.noData')
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
    const _sKey = state.sortKey,
      _sDir = state.sortDir === 'asc' ? 1 : -1
    if (_sKey === 'name' || !_sKey) {
      folders.sort((a, b) => a.localeCompare(b, 'zh') * _sDir)
    } else {
      const fk = new Map()
      for (const f of folders) {
        const items = folderMap.get(f)
        let v
        if (_sKey === 'status') {
          v = Infinity
          for (const g of items) {
            const s = STATUS_ORDER[g.kind]
            if (s < v) v = s
          }
        } else if (_sKey === 'size') {
          v = 0
          for (const g of items) {
            const s = mainEntryOf(g)?.size || 0
            if (s > v) v = s
          }
        } else if (_sKey === 'mtime') {
          v = 0
          for (const g of items) {
            const s = mainEntryOf(g)?.mtime || 0
            if (s > v) v = s
          }
        } else if (_sKey === 'left') {
          v = 1
          for (const g of items)
            if (hasAny(g.left)) {
              v = 0
              break
            }
        } else if (_sKey === 'right') {
          v = 1
          for (const g of items)
            if (hasAny(g.right)) {
              v = 0
              break
            }
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
      if (rendered >= limit) {
        truncated = true
        break
      }
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
            const rm = next
            next = next.nextSibling
            rm.remove()
          }
          if (arrow) arrow.textContent = '▸'
        }
      })
      frag.appendChild(ftr)
      if (collapsed) continue
      for (const g of items) {
        if (rendered >= limit) {
          truncated = true
          break
        }
        appendGroupRows(frag, g)
        rendered++
      }
    }
  } else {
    for (const g of filtered) {
      if (rendered >= limit) {
        truncated = true
        break
      }
      appendGroupRows(frag, g)
      rendered++
    }
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
        const rm = next
        next = next.nextSibling
        rm.remove()
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

function pvCell(entry, side) {
  if (!entry)
    return `<div class="pv-cell"><span class="pv-tag">${side}</span><span class="pv-empty">${t('preview.noSide')}</span></div>`
  if (entry.isDirectory || !isImageFile(entry.name))
    return `<div class="pv-cell"><span class="pv-tag">${side}</span><span class="pv-empty">${t('preview.notImage')}</span></div>`
  const url = fileUrl(entry.fullPath)
  return `<div class="pv-cell"><span class="pv-tag">${side}</span><img src="${url}" data-name="${entry.name}" data-path="${entry.fullPath}" alt="" /><span class="pv-size"></span></div>`
}

const MD_MAX_LINES = 600

async function fetchModelText(entry) {
  if (!entry) return undefined
  try {
    const res = await fetch(fileUrl(entry.fullPath))
    if (!res.ok) return ''
    return await res.text()
  } catch {
    return ''
  }
}

/* 原版贴图路径集合（official-packs 全量贴图，懒加载缓存）：用于判定模型贴图引用是否由原版提供，避免误报缺失 */
let vanillaTexSet = null
let vanillaTexLoading = null
function getVanillaTexSet() {
  if (vanillaTexSet) return Promise.resolve(vanillaTexSet)
  if (vanillaTexLoading) return vanillaTexLoading
  vanillaTexLoading = fetch('/api/mc-official/tex-index')
    .then(r => (r.ok ? r.json() : null))
    .then(d => {
      vanillaTexSet = d && Array.isArray(d.paths) ? new Set(d.paths) : new Set()
      vanillaTexLoading = null
      return vanillaTexSet
    })
    .catch(() => {
      vanillaTexSet = new Set()
      vanillaTexLoading = null
      return vanillaTexSet
    })
  return vanillaTexLoading
}

/* 沿 parent 继承链递归合并 textures（子覆盖父），供侧栏贴图引用检测使用，
   与 mc-model-viewer resolveMcModelRaw 的 parent 解析对齐，避免漏报 potted_* 等继承贴图 */
const MAX_PARENT_DEPTH = 8
function parentModelRel(parent) {
  if (typeof parent !== 'string' || !parent) return null
  let ns = 'minecraft',
    rest = parent
  const ci = parent.indexOf(':')
  if (ci >= 0) {
    ns = parent.slice(0, ci)
    rest = parent.slice(ci + 1)
  }
  if (!rest) return null
  return `assets/${ns}/models/${rest}.json`
}

async function resolveModelTexturesDeep(text, fileRoot) {
  const { obj } = parseModelText(text)
  if (!obj || typeof obj !== 'object') return null
  const merged = {}
  let cur = obj
  const seen = new Set()
  for (let d = 0; d < MAX_PARENT_DEPTH && cur; d++) {
    if (cur.textures && typeof cur.textures === 'object') {
      for (const [k, v] of Object.entries(cur.textures)) {
        if (!(k in merged)) merged[k] = v
      }
    }
    const parent = typeof cur.parent === 'string' ? cur.parent : null
    if (!parent || seen.has(parent)) break
    seen.add(parent)
    const rel = parentModelRel(parent)
    if (!rel) break
    let pText
    try {
      const res = await fetch(fileUrl(joinPath(fileRoot, rel)))
      if (!res.ok) break
      pText = await res.text()
    } catch {
      break
    }
    cur = parseModelText(pText).obj
  }
  return { textures: merged }
}

function modelSumLine(text) {
  if (text === undefined) return t('preview.noSide')
  if (text === '') return t('preview.modelLoadFail')
  const { ok, obj } = parseModelText(text)
  if (!ok) return t('preview.modelNoParse')
  const s = buildModelSummary(obj)
  if (!s) return t('preview.modelNoParse')
  if (s.itemDef) return `${t('preview.modelItemDef')} · ${s.itemRef}`
  return `${t('preview.modelParent')} ${s.parent || '—'} · ${t('preview.modelElements', { n: s.elements })} · ${t('preview.modelTexRefs', { n: s.textures })}`
}

function mdRow(l, r, cls) {
  return `<div class="md-cell ${l ? cls : 'md-gap'}">${l ? escHtml(l) : ''}</div><div class="md-cell ${r ? cls : 'md-gap'}">${r ? escHtml(r) : ''}</div>`
}
/* 确保 3D 视口就绪。autoSwitch=true 时（用户主动操作）才切到预览面板 3D tab；
   自动选中模型时不切 tab，保留用户当前的 2D/3D 选择，避免 2D 内容被切走。 */
function tryActivateCompareModelViewport(autoSwitch = false) {
  if (isViewportVisible()) return true
  if (autoSwitch) {
    const pvBtn = document.querySelector('.pv-tabs button[data-pv-tab="3d"]')
    if (pvBtn) {
      pvBtn.click()
      return true
    }
  }
  return true
}

/* 选中模型行：左右模型并排送入 3D 视口对比展示；右侧缺失时回退用左侧模型。
   2D tab 仍保留 JSON 文本差异 */
async function loadModelPreview(g) {
  if (state.selected !== g) return
  const mySeq = ++state.modelLoadSeq
  const le = g.left && g.left.file,
    re = g.right && g.right.file
  const left = le && isModelEntry(le) ? { fileRoot: state.leftPath, rel: le.name } : null
  const right = re && isModelEntry(re) ? { fileRoot: state.rightPath, rel: re.name } : null
  if (!left && !right) return
  if (!tryActivateCompareModelViewport()) return
  try {
    await viewMcModelPairInViewport({
      left,
      right,
      rightRoot: state.rightPath,
      isStale: () => state.modelLoadSeq !== mySeq
    })
    if (state.selected !== g) clearCustomModel()
  } catch {}
}

/* 点击模型卡片下方的贴图条目：3D 视口贴图效果对比。
   左=左模型+左贴图，右=右模型+右贴图（模型或贴图缺失均回退左侧），展示替换后模型的贴图渲染效果 */
async function loadModelTexEffectPreview(g, leftTexUrl, rightTexUrl) {
  const mySeq = ++state.modelLoadSeq
  const le = g.left && g.left.file,
    re = g.right && g.right.file
  const left = le && isModelEntry(le) ? { fileRoot: state.leftPath, rel: le.name } : null
  const right = re && isModelEntry(re) ? { fileRoot: state.rightPath, rel: re.name } : null
  if (!left && !right) return
  if (!tryActivateCompareModelViewport(true)) return
  try {
    await viewMcModelTexCompareInViewport({
      left,
      right,
      rightRoot: state.rightPath,
      leftTexUrl,
      rightTexUrl,
      isStale: () => state.modelLoadSeq !== mySeq
    })
  } catch {}
}
export function updateSortIndicators() {
  document.querySelectorAll('.result-table th[data-key]').forEach(th => {
    th.classList.remove('asc', 'desc')
    if (th.dataset.key === state.sortKey) {
      th.classList.add(state.sortDir === 'asc' ? 'asc' : 'desc')
    }
  })
}

/* 模型卡片模块的段外依赖注入（该模块正文按裸标识符引用这些符号） */
setModelCardHooks({
  renderModelThumbPair: renderModelThumbPair,
  modelThumbSpec: modelThumbSpec,
  renderSidebar: renderSidebar,
  renderModelTypeResult: renderModelTypeResult,
  selectGroup: selectGroup,
  loadModelTexComparePanel: loadModelTexComparePanel,
  statusBadge: statusBadge
})

/* 分类栏模块的段外依赖注入 */
setCategoryBarHooks({
  bindResultSearch: bindResultSearch,
  buildCatRow: buildCatRow,
  renderResult: renderResult,
  getLastBaseSet: () => _lastBaseSet,
  setLastBaseSet: (v) => {
    _lastBaseSet = v
  }
})


/* 预览绑定模块的段外依赖注入 */
setPreviewBindHooks({ bindEmptyCellActions: bindEmptyCellActions })

/* 结果搜索绑定模块的段外依赖注入 */
setResultSearchBindHooks({ renderResult: renderResult })

/* 模型类型结果模块的段外依赖注入 */
setModelTypeResultHooks({
  applyCategoryFilter: applyCategoryFilter,
  applyResultSearch: applyResultSearch
})
