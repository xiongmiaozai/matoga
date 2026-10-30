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
  summaryEl,
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

const _rowMap = new Map()
let _filteredCache = null
let _renderedCount = 0
let _lastBaseSet = []
let _modelMetaLoading = false

/* 懒加载模型元数据（ns/format/texRefs/animated），供贴图数/动画分组维度使用 */
async function ensureModelMeta() {
  if (state.modelMeta || _modelMetaLoading) return
  _modelMetaLoading = true
  try {
    const res = await fetch('/api/asset/model?meta=1')
    const data = await res.json()
    if (data && data.ok && data.data && Array.isArray(data.data.packs)) {
      const map = new Map()
      for (const pack of data.data.packs) {
        for (const g of pack.groups || []) {
          for (const f of g.files || []) {
            map.set(f.path, {
              ns: f.ns,
              format: f.format,
              texRefs: f.texRefs,
              texBucket: f.texBucket,
              animated: f.animated
            })
          }
        }
      }
      state.modelMeta = map
    }
  } catch {
  } finally {
    _modelMetaLoading = false
  }
}

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

async function loadModelCardTexs(card, g) {
  const le = g.left && g.left.file,
    re = g.right && g.right.file
  const leftList =
    le && isModelEntry(le)
      ? await resolveModelTexList({ fileRoot: state.leftPath, rel: le.name }).catch(() => null)
      : null
  const hasRightModel = re && isModelEntry(re)
  let rightList = hasRightModel
    ? await resolveModelTexList({ fileRoot: state.rightPath, rel: re.name }).catch(() => null)
    : null

  if (!card.isConnected) return
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
  const texsEl = card.querySelector('.model-card-texs')
  if (!texsEl) return
  if (texMap.size === 0) {
    texsEl.innerHTML = `<span class="model-texs-none">${t('render.modelTexNone')}</span>`
    return
  }
  const frag = document.createDocumentFragment()
  for (const [ap, info] of texMap) {
    const dot = ap && ap.lastIndexOf('.')
    const key = dot >= 0 ? ap.slice(0, dot) : ap
    const grp = groupMap.get(key)
    const kind = grp ? grp.kind : 'miss'
    const texEl = document.createElement('div')
    const rMain = grp && grp.right && grp.right.main
    let rightUrl = rMain ? fileUrl(rMain.fullPath) : info.rightUrl
    let texFallback = !rMain && !!info.rightUrl
    texEl.className = 'model-tex-item row-' + kind + (texFallback ? ' model-tex-fallback' : '')
    const thumbL = info.leftUrl
      ? `<img class="thumb thumb-left" src="${escAttr(info.leftUrl)}" alt="" />`
      : '<span class="thumb-ph thumb-left-ph">L</span>'
    const thumbR = rightUrl
      ? `<img class="thumb thumb-right" src="${escAttr(rightUrl)}" alt="" />`
      : '<span class="thumb-ph thumb-right-ph">R</span>'
    const texName = (info.name || ap).replace(/^minecraft:/, '')
    let matHtml = ''
    if (grp) {
      const nHtml = modelTexRoleThumbs(grp, 'normal')
      const sHtml = modelTexRoleThumbs(grp, 'specular')
      if (nHtml || sHtml) {
        matHtml = '<div class="model-tex-mat">'
        if (nHtml) matHtml += `<div class="model-tex-role"><span class="role-tag role-normal">N</span>${nHtml}</div>`
        if (sHtml) matHtml += `<div class="model-tex-role"><span class="role-tag role-specular">S</span>${sHtml}</div>`
        matHtml += '</div>'
      }
    }
    texEl.innerHTML = `<div class="model-tex-thumbs">${thumbL}${thumbR}</div>${matHtml}<span class="model-tex-name" title="${escAttr(ap || info.name)}">${escHtml(texName)}</span>`
    texEl.title = `${texName} · ${KIND_TEXT[kind] || kind}`
    if (grp)
      texEl.addEventListener('click', e => {
        e.stopPropagation()
        state.selected = g
        const cards = document.querySelectorAll('.model-card.selected')
        cards.forEach(c => {
          if (c._group !== g) c.classList.remove('selected')
        })
        const cardEl = texEl.closest('.model-card')
        if (cardEl) cardEl.classList.add('selected')
        const texsHost = texEl.parentElement
        if (texsHost)
          texsHost.querySelectorAll('.model-tex-item.tex-active').forEach(el => el.classList.remove('tex-active'))
        texEl.classList.add('tex-active')
        loadModelTexEffectPreview(g, info.leftUrl, rightUrl)
      })
    frag.appendChild(texEl)
  }
  texsEl.innerHTML = ''
  texsEl.appendChild(frag)
  texsEl.querySelectorAll('img[src]').forEach(img => {
    img.addEventListener('click', e => {
      e.stopPropagation()
      openPreview(img.src, img.dataset.name || '')
    })
  })
}


export function renderModelTypeResult() {
  const body = $('modelGridBody')
  if (!body) return
  const result = state.result
  let models = result.filter(g => g.isModel)
  const onlyDiff = onlyMissingChk.checked
  if (onlyDiff) models = models.filter(g => g.kind !== 'have')
  const kindFilter = state.modelKindFilter || 'all'
  if (kindFilter === 'diff') models = models.filter(g => g.kind !== 'have')
  else if (kindFilter !== 'all') models = models.filter(g => g.kind === kindFilter)
  models = models.filter(g => !state.hiddenKeys.has(g.key))
  models = applyCategoryFilter(models)
  sortResult(models)
  if (models.length === 0) {
    const msg =
      !state.leftPath || !state.rightPath
        ? t('render.dragHint')
        : result.length === 0
          ? t('render.bothEmpty')
          : t('render.noModel')
    body.innerHTML = `<div class="model-grid-empty">${msg}</div>`
    return
  }
  const catMap = new Map()
  const groupBy = state.modelGroupBy || 'type'
  for (const g of models) {
    let cat
    if (groupBy === 'ns') cat = modelNsOf(g)
    else if (groupBy === 'kind') cat = g.kind || 'unknown'
    else if (groupBy === 'format') cat = modelFormatOf(g)
    else if (groupBy === 'tex') cat = modelTexBucketOf(g, state.modelMeta)
    else if (groupBy === 'anim') cat = modelAnimatedOf(g, state.modelMeta) ? 'animated' : 'static'
    else if (groupBy === 'name') cat = modelNameBucketOf(g)
    else if (groupBy === 'prefix') cat = modelPrefixBucketOf(g)
    else if (groupBy === 'custom') cat = modelCustomGroupOf(g, state.modelGroupRules) || '__ungrouped__'
    else {
      const tp = modelTypeOf(g)
      cat = tp === 'block' ? 'block' : tp === 'item' ? 'item' : 'other'
    }
    if (!catMap.has(cat)) catMap.set(cat, [])
    catMap.get(cat).push(g)
  }
  const _groupDir = state.modelGroupDir === 'desc' ? -1 : 1
  const catOrder =
    groupBy === 'type'
      ? _groupDir === 1
        ? ['block', 'item', 'other']
        : ['other', 'item', 'block']
      : groupBy === 'kind'
        ? (_groupDir === 1
            ? ['have', 'diff', 'partial', 'miss', 'extra']
            : ['extra', 'miss', 'partial', 'diff', 'have']).filter(k => catMap.has(k))
        : [...catMap.keys()].sort((a, b) => a.localeCompare(b, 'zh') * _groupDir)
  const frag = document.createDocumentFragment()
  const limit = state.renderLimit
  let rendered = 0
  let truncated = false
  const buildSummary = items => {
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
  const grid = state.modelViewMode !== 'list'

  const groupDims = [
    ['type', 'render.groupByType'],
    ['kind', 'render.groupByKind'],
    ['name', 'render.groupByName'],
    ['prefix', 'render.groupByPrefix'],
    ['ns', 'render.groupByNs'],
    ['format', 'render.groupByFormat'],
    ['tex', 'render.groupByTex'],
    ['anim', 'render.groupByAnim']
  ]
  if (state.modelGroupRules && state.modelGroupRules.length) groupDims.push(['custom', 'render.groupByCustom'])
  const groupOpts = groupDims
    .map(([val, key]) => `<option value="${val}"${groupBy === val ? ' selected' : ''}>${t(key)}</option>`)
    .join('')
  const toolbar = document.createElement('div')
  toolbar.className = 'mc-toolbar'
  toolbar.innerHTML =
    `<div class="mc-view-seg">` +
    `<button class="mc-view-btn${grid ? ' on' : ''}" data-mc-view="grid">${t('render.viewModelGrid')}</button>` +
    `<button class="mc-view-btn${!grid ? ' on' : ''}" data-mc-view="list">${t('render.viewModelList')}</button>` +
    `</div>` +
    `<div class="mc-group-sel"><span class="mc-group-lab">${t('render.groupByLabel')}</span><select class="mc-group-dd" data-mc-group>${groupOpts}</select><button class="mc-sort-dir mc-group-dir" data-mc-group-dir title="${t('render.groupDir')}">${state.modelGroupDir === 'asc' ? '↑' : '↓'}</button></div>` +
    `<div class="mc-sort-sel"><span class="mc-group-lab">${t('render.sortByLabel')}</span><select class="mc-sort-dd" data-mc-sort-key>` +
    `<option value="name"${state.sortKey === 'name' ? ' selected' : ''}>${t('render.sortByName')}</option>` +
    `<option value="size"${state.sortKey === 'size' ? ' selected' : ''}>${t('render.sortBySize')}</option>` +
    `<option value="mtime"${state.sortKey === 'mtime' ? ' selected' : ''}>${t('render.sortByTime')}</option>` +
    `<option value="status"${state.sortKey === 'status' ? ' selected' : ''}>${t('render.sortByStatus')}</option>` +
    `</select><button class="mc-sort-dir" data-mc-sort-dir title="${t('render.sortDir')}">${state.sortDir === 'asc' ? '↑' : '↓'}</button></div>` +
    `<div class="mc-filter-sel"><span class="mc-group-lab">${t('render.filterLabel')}</span><select class="mc-filter-dd" data-mc-filter>` +
    `<option value="all"${(state.modelKindFilter || 'all') === 'all' ? ' selected' : ''}>${t('render.filterAll')}</option>` +
    `<option value="diff"${state.modelKindFilter === 'diff' ? ' selected' : ''}>${t('render.filterDiff')}</option>` +
    `<option value="miss"${state.modelKindFilter === 'miss' ? ' selected' : ''}>${t('render.filterMiss')}</option>` +
    `<option value="extra"${state.modelKindFilter === 'extra' ? ' selected' : ''}>${t('render.filterExtra')}</option>` +
    `<option value="partial"${state.modelKindFilter === 'partial' ? ' selected' : ''}>${t('render.filterPartial')}</option>` +
    `</select></div>`
  toolbar.querySelectorAll('[data-mc-view]').forEach(b =>
    b.addEventListener('click', () => {
      state.modelViewMode = b.dataset.mcView
      renderModelTypeResult()
    })
  )
  const groupDd = toolbar.querySelector('[data-mc-group]')
  if (groupDd)
    groupDd.addEventListener('change', async () => {
      state.modelGroupBy = groupDd.value
      state.renderLimit = 200
      saveOptions()
      if (groupDd.value === 'tex' || groupDd.value === 'anim') await ensureModelMeta()
      renderModelTypeResult()
    })
  const groupDirBtn = toolbar.querySelector('[data-mc-group-dir]')
  if (groupDirBtn)
    groupDirBtn.addEventListener('click', () => {
      state.modelGroupDir = state.modelGroupDir === 'asc' ? 'desc' : 'asc'
      groupDirBtn.textContent = state.modelGroupDir === 'asc' ? '↑' : '↓'
      saveOptions()
      renderModelTypeResult()
    })
  const sortKeyDd = toolbar.querySelector('[data-mc-sort-key]')
  if (sortKeyDd)
    sortKeyDd.addEventListener('change', () => {
      state.sortKey = sortKeyDd.value
      saveOptions()
      renderModelTypeResult()
    })
  const sortDirBtn = toolbar.querySelector('[data-mc-sort-dir]')
  if (sortDirBtn)
    sortDirBtn.addEventListener('click', () => {
      state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc'
      sortDirBtn.textContent = state.sortDir === 'asc' ? '↑' : '↓'
      saveOptions()
      renderModelTypeResult()
    })
  const filterDd = toolbar.querySelector('[data-mc-filter]')
  if (filterDd)
    filterDd.addEventListener('change', () => {
      state.modelKindFilter = filterDd.value
      saveOptions()
      renderModelTypeResult()
    })
  frag.appendChild(toolbar)
  for (const cat of catOrder) {
    const items = catMap.get(cat)
    if (!items || !items.length) continue
    if (rendered >= limit) {
      truncated = true
      break
    }
    const catKey = '__cat__' + cat
    const collapsed = state.collapsedFolders.has(catKey)
    const catLabel =
      groupBy === 'type'
        ? t('category.' + cat)
        : groupBy === 'anim'
          ? t('category.anim.' + cat)
          : groupBy === 'tex'
            ? t('category.tex.' + cat, { n: cat })
            : groupBy === 'custom' && cat === '__ungrouped__'
              ? t('category.untagged')
              : cat
    const grp = document.createElement('div')
    grp.className = 'mc-grp' + (collapsed ? ' collapsed' : '')
    grp.dataset.cat = cat
    grp.innerHTML = `<div class="mc-grp-head"><span class="mc-arrow">${collapsed ? '▸' : '▾'}</span><svg class="ico ico-sm"><use href="#i-cube"/></svg><span class="mc-grp-lbl">${escHtml(catLabel)}</span><span class="mc-grp-cnt">${t('render.modelTypeCount', { n: items.length })}</span><span class="mc-grp-sum">${buildSummary(items)}</span></div><div class="mc-grp-body"></div>`
    grp.querySelector('.mc-grp-head').addEventListener('click', () => {
      if (state.collapsedFolders.has(catKey)) state.collapsedFolders.delete(catKey)
      else state.collapsedFolders.add(catKey)
      renderModelTypeResult()
    })
    if (!collapsed) {
      const grpBody = grp.querySelector('.mc-grp-body')
      const wrap = document.createElement('div')
      wrap.className = grid ? 'mc-cards' : 'mc-rows'
      for (const g of items) {
        if (rendered >= limit) {
          truncated = true
          break
        }
        if (grid) appendModelGridCard(wrap, g)
        else appendModelCompareRow(wrap, g)
        rendered++
      }
      grpBody.appendChild(wrap)
    }
    frag.appendChild(grp)
  }
  if (truncated) {
    const more = document.createElement('div')
    more.className = 'model-show-more'
    more.innerHTML = `<button class="btn btn-ghost btn-sm">${t('render.showMore', { rendered, total: models.length })}</button>`
    more.querySelector('button').addEventListener('click', () => {
      state.renderLimit += 200
      renderModelTypeResult()
    })
    frag.appendChild(more)
  }
  if (grid && state.selected && state.selected.isModel && models.includes(state.selected)) {
    frag.appendChild(buildModelDetailPanel(state.selected))
  }
  body.innerHTML = ''
  body.appendChild(frag)
  observeThumbs(body)
  observeModelThumbs(body)
  prefetchModelThumbs(body)
}

function appendModelGridCard(container, g) {
  const mainLeft = g.left && (g.left.file || g.left.dir)
  const mainRight = g.right && (g.right.file || g.right.dir)
  const shortName = g.key
    .replace(/^assets\/[^/]+\/models\//, '')
    .replace(/^assets\/[^/]+\/items\//, '')
    .replace(/\.json$/, '')
  const useLeftForRight = !mainRight && !!mainLeft
  const previewHtml = renderModelThumbPair(
    mainLeft,
    mainRight || mainLeft,
    state.leftPath,
    mainRight ? state.rightPath : state.leftPath,
    useLeftForRight,
    mainRight ? undefined : state.rightPath
  )
  const card = document.createElement('div')
  card.className = 'mc-card row-' + g.kind
  if (state.selected && state.selected.key === g.key) card.classList.add('selected')
  card._group = g
  card.innerHTML =
    `<div class="mc-card-preview">${previewHtml}</div>` +
    `<div class="mc-card-foot">${statusBadge(g.kind)}<span class="mc-card-nm" title="${escAttr(g.key)}">${escHtml(shortName)}</span></div>`
  card.querySelectorAll('.ac-thumb[data-mrel]').forEach(th => {
    th._modelThumbItem = {
      modelThumb: modelThumbSpec(
        { name: th.dataset.mrel, mtime: +th.dataset.mtime || 0 },
        th.dataset.mroot,
        th.dataset.mtexroot || undefined
      )
    }
  })
  card.addEventListener('click', () => {
    state.selected = g
    renderSidebar()
    renderModelTypeResult()
  })
  container.appendChild(card)
}

function buildModelDetailPanel(g) {
  const panel = document.createElement('div')
  panel.className = 'mc-detail'
  panel.innerHTML =
    `<div class="mc-detail-head"><span class="mc-detail-title" title="${escAttr(g.key)}">${escHtml(g.key)}</span><button class="mc-detail-close" title="${t('common.close')}">✕</button></div>` +
    `<div class="mc-detail-body">` +
    `<div class="mc-model-acts">` +
    `<span class="mc-acts-lab">${t('render.modelActs')}</span>` +
    `<button class="btn btn-ghost btn-sm" data-mc-act="show">${t('render.modelShowInFolder')}</button>` +
    `<button class="btn btn-ghost btn-sm" data-mc-act="select">${t('render.modelSelectDetail')}</button>` +
    `</div>` +
    `<div class="mc-model-preview"></div>` +
    `<div class="mc-tex-wrap"><span class="mc-tex-loading">${t('render.modelTexLoading')}</span></div>` +
    `</div>`
  panel.querySelector('.mc-detail-close').addEventListener('click', () => {
    state.selected = null
    renderSidebar()
    renderModelTypeResult()
  })
  panel.querySelector('[data-mc-act="show"]').addEventListener('click', e => {
    e.stopPropagation()
    const ent = mainEntryOf(g)
    if (ent) window.api.showInFolder(ent.fullPath)
  })
  panel.querySelector('[data-mc-act="select"]').addEventListener('click', e => {
    e.stopPropagation()
    selectGroup(g)
  })
  fillModelPreview(panel, g)
  loadModelTexComparePanel(panel, g)
  return panel
}

function appendModelCompareRow(container, g) {
  const mainLeft = g.left && (g.left.file || g.left.dir)
  const mainRight = g.right && (g.right.file || g.right.dir)
  const shortName = g.key
    .replace(/^assets\/[^/]+\/models\//, '')
    .replace(/^assets\/[^/]+\/items\//, '')
    .replace(/\.json$/, '')
  const expanded = state.expandedKeys.has(g.key)
  const row = document.createElement('div')
  row.className = 'mc-model' + (expanded ? ' open' : '')
  if (state.selected && state.selected.key === g.key) row.classList.add('selected')
  row.dataset.key = g.key
  row._group = g
  row.innerHTML =
    `<div class="mc-model-head">` +
    `<span class="mc-arrow">${expanded ? '▾' : '▸'}</span>` +
    statusBadge(g.kind) +
    `<span class="mc-model-nm" title="${escAttr(g.key)}">${escHtml(shortName)}</span>` +
    `<span class="mc-model-path">${escHtml(g.key)}</span>` +
    `<span class="mc-model-mini">` +
    `<span class="mc-mini-l${mainLeft ? ' on' : ''}" title="${t('common.left')}">L</span>` +
    `<span class="mc-mini-r${mainRight ? ' on' : ''}" title="${t('common.right')}">R</span>` +
    `</span>` +
    `</div>` +
    `<div class="mc-model-body">` +
    `<div class="mc-model-acts">` +
    `<span class="mc-acts-lab">${t('render.modelActs')}</span>` +
    `<button class="btn btn-ghost btn-sm" data-mc-act="show">${t('render.modelShowInFolder')}</button>` +
    `<button class="btn btn-ghost btn-sm" data-mc-act="select">${t('render.modelSelectDetail')}</button>` +
    `</div>` +
    `<div class="mc-model-preview"></div>` +
    `<div class="mc-tex-wrap"><span class="mc-tex-loading">${t('render.modelTexLoading')}</span></div>` +
    `</div>`
  row.querySelector('.mc-model-head').addEventListener('click', () => {
    selectGroup(g, false)
    if (state.expandedKeys.has(g.key)) state.expandedKeys.delete(g.key)
    else state.expandedKeys.add(g.key)
    renderModelTypeResult()
  })
  row.querySelector('[data-mc-act="show"]').addEventListener('click', e => {
    e.stopPropagation()
    const ent = mainEntryOf(g)
    if (ent) window.api.showInFolder(ent.fullPath)
  })
  row.querySelector('[data-mc-act="select"]').addEventListener('click', e => {
    e.stopPropagation()
    selectGroup(g)
  })
  container.appendChild(row)
  if (expanded) {
    fillModelPreview(row, g)
    loadModelTexComparePanel(row, g)
  }
}

function fillModelPreview(row, g) {
  const box = row.querySelector('.mc-model-preview')
  if (!box) return
  const mainLeft = g.left && (g.left.file || g.left.dir)
  const mainRight = g.right && (g.right.file || g.right.dir)
  if (!mainLeft && !mainRight) {
    box.innerHTML = `<span class="mc-preview-lab">${t('render.modelPreview')}</span><span class="mc-tex-none">${t('render.modelTexNone')}</span>`
    return
  }
  const tab = state.modelPreviewTab === 'tex2d' ? 'tex2d' : 'model'
  box.innerHTML =
    `<div class="mc-preview-tabs">` +
    `<button class="mc-preview-tab${tab === 'model' ? ' on' : ''}" data-mc-ptab="model">${t('render.previewTabModel')}</button>` +
    `<button class="mc-preview-tab${tab === 'tex2d' ? ' on' : ''}" data-mc-ptab="tex2d">${t('render.previewTabTex2d')}</button>` +
    `</div>` +
    `<div class="mc-preview-content"></div>`
  box.querySelectorAll('[data-mc-ptab]').forEach(b =>
    b.addEventListener('click', e => {
      e.stopPropagation()
      state.modelPreviewTab = b.dataset.mcPtab
      fillModelPreview(row, g)
    })
  )
  const content = box.querySelector('.mc-preview-content')
  if (tab === 'model') renderPreviewModel(content, g)
  else renderPreviewTex2d(content, g)
}

function renderPreviewModel(content, g) {
  const mainLeft = g.left && (g.left.file || g.left.dir)
  const mainRight = g.right && (g.right.file || g.right.dir)
  const useLeftForRight = !mainRight && !!mainLeft
  const html = renderModelThumbPair(
    mainLeft,
    mainRight || mainLeft,
    state.leftPath,
    mainRight ? state.rightPath : state.leftPath,
    useLeftForRight,
    mainRight ? undefined : state.rightPath
  )
  content.innerHTML = `<div class="mc-preview-thumbs">${html}</div>`
  content.querySelectorAll('.ac-thumb[data-mrel]').forEach(th => {
    th._modelThumbItem = {
      modelThumb: modelThumbSpec(
        { name: th.dataset.mrel, mtime: +th.dataset.mtime || 0 },
        th.dataset.mroot,
        th.dataset.mtexroot || undefined
      )
    }
  })
  content.querySelectorAll('.ac-thumb, .thumb-ph').forEach(th => {
    th.addEventListener('click', e => {
      e.stopPropagation()
      selectGroup(g)
    })
  })
  observeModelThumbs(content)
}

async function renderPreviewTex2d(content, g) {
  content.innerHTML = `<span class="mc-tex-loading">${t('render.modelTexLoading')}</span>`
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
  if (!content.isConnected) return
  const col = (list, side) => {
    const tag = `<span class="mc-pv2-tag mc-pv2-tag-${side}">${side === 'left' ? t('common.left') : t('common.right')}</span>`
    if (!list || !list.length)
      return `<div class="mc-pv2-col">${tag}<span class="mc-tex-none">${t('render.texNone')}</span></div>`
    const items = list
      .map(
        tx =>
          `<div class="mc-pv2-item">` +
          `<img class="thumb thumb-${side}" src="${escAttr(tx.url)}" data-name="${escAttr(tx.name)}" alt="" />` +
          `<span class="mc-pv2-name" title="${escAttr(tx.name)}">${escHtml(tx.name.replace(/^minecraft:/, ''))}</span>` +
          `</div>`
      )
      .join('')
    return `<div class="mc-pv2-col">${tag}${items}</div>`
  }
  content.innerHTML = `<div class="mc-pv2">${col(leftList, 'left')}${col(rightList, 'right')}</div>`
  content.querySelectorAll('img.thumb').forEach(img => {
    img.addEventListener('click', e => {
      e.stopPropagation()
      openPreview(img.src, img.dataset.name || '')
    })
  })
  observeThumbs(content)
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

function bindPreviewImages(container) {
  container.querySelectorAll('img').forEach(img => {
    const cell = img.parentElement
    cell.classList.add('pv-loading')
    img.addEventListener('click', () => openPreview(img.src, img.dataset.name || ''))
    img.addEventListener('load', () => {
      cell.classList.remove('pv-loading')
      const sl = cell.querySelector('.pv-size')
      if (sl && img.naturalWidth) sl.textContent = `${img.naturalWidth}×${img.naturalHeight}`
    })
    img.addEventListener('error', () => {
      cell.classList.remove('pv-loading')
      cell.classList.add('pv-error')
    })
    const btn = document.createElement('button')
    btn.className = 'pv-replace-btn'
    btn.textContent = t('preview.replace')
    btn.title = t('preview.replaceTitle')
    btn.addEventListener('click', e => {
      e.stopPropagation()
      replaceWithExternalFile(img.dataset.path)
    })
    cell.appendChild(btn)
    const delBtn = document.createElement('button')
    delBtn.className = 'pv-delete-btn'
    delBtn.textContent = t('preview.delete')
    delBtn.title = t('preview.deleteTitle')
    delBtn.addEventListener('click', e => {
      e.stopPropagation()
      deleteTexture(img.dataset.path)
    })
    cell.appendChild(delBtn)
  })
}

async function loadModelTex2dPreview(container, g) {
  if (!container) return
  container.innerHTML = `<span class="mc-tex-loading">${t('render.modelTexLoading')}</span>`
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
  if (!container.isConnected) return
  const groupMap = new Map()
  for (const grp of state.result) groupMap.set(grp.key, grp)
  const seen = new Set()
  const mats = []
  for (const tx of [...(leftList || []), ...(rightList || [])]) {
    const ap = textureAssetPath(tx.name)
    if (!ap) continue
    const dot = ap.lastIndexOf('.')
    const key = dot >= 0 ? ap.slice(0, dot) : ap
    if (seen.has(key)) continue
    seen.add(key)
    const grp = groupMap.get(key)
    if (grp && grp.isMaterial) mats.push(grp)
  }
  if (!mats.length) {
    container.innerHTML = `<span class="mc-tex-none">${t('render.modelTexNone')}</span>`
    return
  }
  const frag = document.createDocumentFragment()
  for (const matG of mats) {
    const block = document.createElement('div')
    block.className = 'pv-model-mat'
    block.innerHTML = `<div class="pv-model-mat-title" title="${escAttr(matG.key)}">${escHtml(matG.key)} ${statusBadge(matG.kind)}</div>${renderMaterialPreviewHtml(matG)}`
    frag.appendChild(block)
    bindPreviewImages(block)
    bindEmptyCellActions(block, matG)
  }
  container.innerHTML = ''
  container.appendChild(frag)
  observeThumbs(container)
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

function renderCategoryBar(baseSet) {
  _lastBaseSet = baseSet || []
  const bar = $('categoryBar')
  if (!bar) return
  const f = state.categoryFilter || { type: 'all', content: 'all', status: 'all', folder: 'all', tag: 'all' }
  const total = _lastBaseSet.length
  if (total === 0) {
    bar.innerHTML = ''
    return
  }

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
    if (tg) {
      tagCounts.set(tg, (tagCounts.get(tg) || 0) + 1)
      hasCustomTag = true
    }
  }

  const rows = []
  rows.push(
    buildCatRow(
      'type',
      'category.typeLabel',
      [
        ['all', 'common.all', total],
        ['material', 'type.material', typeCounts.material],
        ['model', 'type.model', typeCounts.model],
        ['dir', 'type.folder', typeCounts.dir],
        ['file', 'type.file', typeCounts.file]
      ],
      f.type
    )
  )
  if (contentCounts.block || contentCounts.item) {
    rows.push(
      buildCatRow(
        'content',
        'category.contentLabel',
        [
          ['all', 'common.all', total],
          ['block', 'category.block', contentCounts.block],
          ['item', 'category.item', contentCounts.item],
          ['other', 'category.other', contentCounts.other]
        ],
        f.content
      )
    )
  }
  rows.push(
    buildCatRow(
      'status',
      'category.statusLabel',
      [
        ['all', 'common.all', total],
        ['have', 'status.haveShort', statusCounts.have],
        ['diff', 'status.diffShort', statusCounts.diff],
        ['partial', 'status.partialShort', statusCounts.partial],
        ['miss', 'status.missShort', statusCounts.miss],
        ['extra', 'status.extraShort', statusCounts.extra]
      ],
      f.status
    )
  )
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
    const items = [
      ['all', 'common.all', total],
      ['none', 'category.untagged', noneCount]
    ]
    const tags = [...tagCounts.keys()].sort((a, b) => a.localeCompare(b, 'zh'))
    for (const tg of tags) items.push([tg, null, tagCounts.get(tg), tg])
    rows.push(buildCatRow('tag', 'category.tagLabel', items, f.tag, true))
  }

  bar.innerHTML = rows.join('')
  bar.querySelectorAll('.cat-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const dim = btn.dataset.dim,
        val = btn.dataset.val
      if (state.categoryFilter[dim] === val) return
      state.categoryFilter[dim] = val
      state.renderLimit = 200
      saveOptions()
      renderResult()
    })
  })
  bar.querySelectorAll('.cat-select').forEach(sel => {
    sel.addEventListener('change', () => {
      const dim = sel.dataset.dim
      state.categoryFilter[dim] = sel.value
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

  const counts = state.counts || {
    have: 0,
    diff: 0,
    partial: 0,
    miss: 0,
    extra: 0,
    leftTex: 0,
    rightTex: 0,
    rightMatch: 0,
    pbrExtra: 0,
    leftModel: 0,
    rightModel: 0,
    modelMatch: 0
  }
  const total = state.result.length

  summaryEl.innerHTML =
    total === 0
      ? ''
      : `
    <span class="s-item">${t('render.leftItem')} <span class="s-num">${state.leftEntries.length}</span></span>
    <span class="s-item">${t('render.rightItem')} <span class="s-num">${state.rightEntries.length}</span></span>

    <span class="s-item s-have">✓ <span class="s-num">${counts.have}</span></span>
    <span class="s-item s-diff">≈ <span class="s-num">${counts.diff}</span></span>
    <span class="s-item s-partial">◐ <span class="s-num">${counts.partial}</span></span>
    <span class="s-item s-miss">✗ <span class="s-num">${counts.miss}</span></span>
    <span class="s-item">＋ <span class="s-num">${counts.extra}</span></span>
  `

  if (filtered.length === 0) {
    const msg =
      !state.leftPath || !state.rightPath
        ? t('render.dragHint')
        : result.length === 0
          ? t('render.bothEmpty')
          : onlyDiff
            ? t('render.allConsistent')
            : t('render.noData')
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

function bindEmptyCellActions(panel, g) {
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
      copyBtn.addEventListener('click', e => {
        e.stopPropagation()
        copySingleToRight(le.fullPath, dest)
      })
      actions.appendChild(copyBtn)
      const addBtn = document.createElement('button')
      addBtn.className = 'pv-empty-btn pv-empty-add'
      addBtn.textContent = t('preview.addTex')
      addBtn.title = t('preview.addTexTitle')
      addBtn.addEventListener('click', e => {
        e.stopPropagation()
        addTextureToRight(dest)
      })
      actions.appendChild(addBtn)
    }
    if (canBlank) {
      const createBtn = document.createElement('button')
      createBtn.className = 'pv-empty-btn pv-empty-create'
      createBtn.textContent = t('preview.createBlank')
      createBtn.title = role === 'normal' ? t('preview.createBlankNormalTitle') : t('preview.createBlankSpecularTitle')
      createBtn.addEventListener('click', e => {
        e.stopPropagation()
        createBlankTextureToRight(g, role)
      })
      actions.appendChild(createBtn)
    }
    rightCell.appendChild(actions)
  })
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

function renderModelDiffGrid(grid, lt, rt, g) {
  const a = typeof lt === 'string' && lt ? parseModelText(lt).pretty.split('\n') : []
  const b = typeof rt === 'string' && rt ? parseModelText(rt).pretty.split('\n') : []
  const truncated = a.length > MD_MAX_LINES || b.length > MD_MAX_LINES
  const as = a.slice(0, MD_MAX_LINES),
    bs = b.slice(0, MD_MAX_LINES)
  const showCopy = g && g.isModel && state.rightPath && g.left && (g.left.file || g.left.dir)
  const copyBtn = showCopy
    ? `<button class="md-head-btn" data-act="copy-model-right" title="${escAttr(t('detail.copyModel'))}"><svg class="ico ico-sm"><use href="#i-clipboard"/></svg><span>${escHtml(t('detail.copyModel'))}</span></button>`
    : ''
  const importBtn =
    g && g.isModel && state.rightPath
      ? `<button class="md-head-btn" data-act="upload-model-right" title="${escAttr(t('detail.uploadModel'))}"><svg class="ico ico-sm"><use href="#i-plus"/></svg><span>${escHtml(t('detail.uploadModel'))}</span></button>`
      : ''
  let html = `<div class="md-cell md-head">${t('common.left')}</div><div class="md-cell md-head md-head-right"><span>${t('common.right')}</span>${copyBtn}${importBtn}</div>`
  if (!as.length && !bs.length) {
    html += `<div class="md-cell md-empty">${t('render.noData')}</div><div class="md-cell md-empty"></div>`
  } else {
    const ops = diffLines(as, bs)
    if (ops) {
      for (const op of ops) {
        if (op.type === 'same') html += mdRow(op.text, op.text, 'md-same')
        else if (op.type === 'del') html += mdRow(op.text, '', 'md-del')
        else html += mdRow('', op.text, 'md-add')
      }
    } else {
      const rows = Math.max(as.length, bs.length)
      for (let i = 0; i < rows; i++) html += mdRow(as[i] || '', bs[i] || '', 'md-same')
    }
  }
  if (truncated)
    html += `<div class="md-cell md-trunc">${t('preview.modelTruncated', { n: MD_MAX_LINES })}</div><div class="md-cell md-trunc"></div>`
  grid.innerHTML = html
  const importBtnEl = grid.querySelector('.md-head-right [data-act="upload-model-right"]')
  if (importBtnEl)
    importBtnEl.addEventListener('click', ev => {
      ev.stopPropagation()
      handleAction('upload-model-right', g)
    })
  const copyBtnEl = grid.querySelector('.md-head-right [data-act="copy-model-right"]')
  if (copyBtnEl)
    copyBtnEl.addEventListener('click', ev => {
      ev.stopPropagation()
      handleAction('copy-model-right', g)
    })
}

async function loadModelDiffView(g, panel) {
  const grid = panel.querySelector('.md-grid')
  const sumEl = panel.querySelector('.pv-model-sum')
  if (!grid || !sumEl) return
  const le = g.left && g.left.file,
    re = g.right && g.right.file
  const [lt, rt] = await Promise.all([fetchModelText(le), fetchModelText(re)])
  if (state.selected !== g) return
  const modelName = modelBaseNameOf(g) || '—'
  sumEl.innerHTML =
    `<div class="pv-model-sum-row pv-model-name-row"><span class="pv-model-tag">${t('preview.modelName')}</span><span class="pv-model-name">${escHtml(modelName)}</span></div>` +
    `<div class="pv-model-sum-row"><span class="pv-model-tag">${t('common.left')}</span><span>${escHtml(modelSumLine(lt))}</span></div>` +
    `<div class="pv-model-sum-row"><span class="pv-model-tag">${t('common.right')}</span><span>${escHtml(modelSumLine(rt))}</span></div>`
  renderModelDiffGrid(grid, lt, rt, g)

  const refEl = panel.querySelector('.pv-tex-refs')
  if (refEl) {
    const leftPaths = new Set(state.leftEntries.filter(e => !e.isDirectory).map(e => e.name))
    const rightPaths = new Set(state.rightEntries.filter(e => !e.isDirectory).map(e => e.name))
    const vanillaSet = await getVanillaTexSet()
    if (state.selected !== g) return
    const leftObj = await resolveModelTexturesDeep(lt, state.leftPath)
    if (state.selected !== g) return
    const rightObj = await resolveModelTexturesDeep(rt, state.rightPath)
    if (state.selected !== g) return
    const leftRefs = leftObj ? checkTexRefs(leftObj, leftPaths, vanillaSet) : []
    const rightRefs = rightObj ? checkTexRefs(rightObj, rightPaths, vanillaSet) : []
    const renderRefList = (refs, tag) => {
      if (!refs.length) return ''
      const items = refs
        .map(r => {
          const cls = r.exists ? 'tex-ref-ok' : r.vanilla ? 'tex-ref-vanilla' : 'tex-ref-miss'
          const badge = r.vanilla ? `<span class="tex-ref-badge">${t('preview.texRefVanilla')}</span>` : ''
          const ico = r.exists
            ? `<svg class="ico ico-sm"><use href="#i-check"/></svg>`
            : r.vanilla
              ? ''
              : `<svg class="ico ico-sm"><use href="#i-x"/></svg>`
          return `<div class="tex-ref-item ${cls}">${ico}${badge}<span class="tex-ref-path">${escHtml(r.ref)}</span></div>`
        })
        .join('')
      return `<div class="tex-ref-group"><span class="pv-model-tag">${tag}</span>${items}</div>`
    }
    const allRefs = renderRefList(leftRefs, t('common.left')) + renderRefList(rightRefs, t('common.right'))
    refEl.innerHTML = allRefs
    refEl.style.display = allRefs ? '' : 'none'
  }
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


export function renderSidebar() {
  const g = state.selected
  const panel = $('previewPanel')

  const mat3dContainer = $('material3dContainer')

  if (mat3dContainer) initMaterial3D(mat3dContainer)

  if (!g) {
    panel.innerHTML = `<div class="pv-hint">${t('preview.hint')}</div>`

    updateMaterial3D(null)
    clearCustomModel()
    setModelEmptyHint('')
    return
  }

  updateMaterial3D(g.isMaterial ? g : null)
  if (!g.isModel) {
    clearCustomModel()
    setModelEmptyHint('')
  }

  let html = ''
  const diffPairs = []
  if (g.isMaterial) {
    const hasMain = (g.left && g.left.main) || (g.right && g.right.main)
    for (const role of ROLES) {
      const le = g.left && g.left[role],
        re = g.right && g.right[role]
      if (!le && !re) {
        if ((role === 'normal' || role === 'specular') && hasMain && state.rightPath)
          html += `<div class="pv-row pv-row-empty" data-role="${role}"><span class="pv-role">${ROLE_LABEL[role]}</span>${pvCell(null, t('common.left'))}${pvCell(null, t('common.right'))}</div>`
        continue
      }
      html += `<div class="pv-row" data-role="${role}"><span class="pv-role">${ROLE_LABEL[role]}</span>${pvCell(le, t('common.left'))}${pvCell(re, t('common.right'))}</div>`
      if (le && re && !le.isDirectory && !re.isDirectory && isImageFile(le.name) && isImageFile(re.name))
        diffPairs.push([le, re, ROLE_LABEL[role]])
    }
  } else if (g.isDir) {
    html = `<div class="pv-hint">${t('preview.folder')}</div>`
  } else if (g.isModel) {
    const tab = state.modelPreviewTab === 'tex2d' ? 'tex2d' : 'model'
    html =
      `<div class="pv-model">` +
      `<div class="pv-model-tabs">` +
      `<button class="pv-model-tab${tab === 'model' ? ' on' : ''}" data-pv-mtab="model">${t('render.previewTabModel')}</button>` +
      `<button class="pv-model-tab${tab === 'tex2d' ? ' on' : ''}" data-pv-mtab="tex2d">${t('render.previewTabTex2d')}</button>` +
      `</div>` +
      `<div class="pv-model-sum">${t('toast.computing')}</div>` +
      `<div class="pv-model-preview"${tab === 'model' ? '' : ' style="display:none"'}></div>` +
      `<div class="pv-model-texs mc-tex-wrap"${tab === 'tex2d' ? '' : ' style="display:none"'}>${t('toast.computing')}</div>` +
      `<div class="md-grid"><div class="md-cell md-load">${t('toast.computing')}</div><div class="md-cell md-load">${t('toast.computing')}</div></div>` +
      `<div class="pv-tex-refs" style="display:none"></div>` +
      `</div>`
  } else {
    const le = g.left && (g.left.file || g.left.dir),
      re = g.right && (g.right.file || g.right.dir)
    html = `<div class="pv-row" data-role="file"><span class="pv-role">${t('preview.file')}</span>${pvCell(le, t('common.left'))}${pvCell(re, t('common.right'))}</div>`
    if (le && re && !le.isDirectory && !re.isDirectory && isImageFile(le.name) && isImageFile(re.name))
      diffPairs.push([le, re, t('preview.file')])
  }
  if (diffPairs.length) {
    html += `<div class="pv-diff-btn-bar"><button class="btn btn-ghost btn-sm" id="pixelDiffBtn">${t('preview.pixelDiff')}</button></div>`
  }
  panel.querySelectorAll('.pv-row').forEach(row => {
    if (row._splitCleanup) row._splitCleanup()
  })
  panel.innerHTML = html
  panel.querySelectorAll('img').forEach(img => {
    const cell = img.parentElement
    cell.classList.add('pv-loading')
    img.addEventListener('click', () => openPreview(img.src, img.dataset.name || ''))
    img.addEventListener('load', () => {
      cell.classList.remove('pv-loading')
      const sl = cell.querySelector('.pv-size')
      if (sl && img.naturalWidth) sl.textContent = `${img.naturalWidth}×${img.naturalHeight}`
    })
    img.addEventListener('error', () => {
      cell.classList.remove('pv-loading')
      cell.classList.add('pv-error')
    })
    const btn = document.createElement('button')
    btn.className = 'pv-replace-btn'
    btn.textContent = t('preview.replace')
    btn.title = t('preview.replaceTitle')
    btn.addEventListener('click', e => {
      e.stopPropagation()
      replaceWithExternalFile(img.dataset.path)
    })
    cell.appendChild(btn)
    const delBtn = document.createElement('button')
    delBtn.className = 'pv-delete-btn'
    delBtn.textContent = t('preview.delete')
    delBtn.title = t('preview.deleteTitle')
    delBtn.addEventListener('click', e => {
      e.stopPropagation()
      deleteTexture(img.dataset.path)
    })
    cell.appendChild(delBtn)
  })
  bindEmptyCellActions(panel, g)

  const diffBtn = $('pixelDiffBtn')
  if (diffBtn) diffBtn.addEventListener('click', () => showPixelDiff(diffPairs, panel))
  if (g.isModel) {
    loadModelDiffView(g, panel)
    loadModelPreview(g)
    const tab = state.modelPreviewTab === 'tex2d' ? 'tex2d' : 'model'
    if (tab === 'model') {
      const pv = panel.querySelector('.pv-model-preview')
      if (pv) renderPreviewModel(pv, g)
    } else {
      loadModelTex2dPreview(panel.querySelector('.pv-model-texs'), g)
    }
    panel.querySelectorAll('[data-pv-mtab]').forEach(b =>
      b.addEventListener('click', () => {
        state.modelPreviewTab = b.dataset.pvMtab
        renderSidebar()
      })
    )
  }

  enhancePreview()
}

export function updateSortIndicators() {
  document.querySelectorAll('.result-table th[data-key]').forEach(th => {
    th.classList.remove('asc', 'desc')
    if (th.dataset.key === state.sortKey) {
      th.classList.add(state.sortDir)
      th.setAttribute('aria-sort', state.sortDir === 'asc' ? 'ascending' : 'descending')
    } else {
      th.setAttribute('aria-sort', 'none')
    }
  })
}

export function initViewTabs() {

  document.addEventListener('keydown', e => {
    if ((e.metaKey || e.ctrlKey) && e.key === '2') {
      document.dispatchEvent(new CustomEvent('workspace:focus-panel', { detail: { id: 'modelCategory' } }))
      e.preventDefault()
    }
  })
}
