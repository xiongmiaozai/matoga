/**
 * matoga - 材质贴图对比工具
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 */

import {
  state, $, ROLE_LABEL, KIND_TEXT,
  leftBtn, rightBtn, onlyMissingChk, summaryEl, resultBody,
  leftPathEl, rightPathEl,
  searchInput
} from './core.js'
import {
  formatSize, formatDate, isImageFile, fileUrl, escAttr,
  folderOf, mainEntryOf, hasAny, leftRoles, rightRoles, subKind,
  openPreview, relPath, joinPath, modelTypeOf
} from './utils.js'
import { sortResult } from './compare.js'
import { replaceWithExternalFile, deleteTexture, handleAction, showPixelDiff, copySingleToRight, addTextureToRight } from './actions.js'
import { initMaterial3D, updateMaterial3D, clearCustomModel } from './material3d.js'
import { enhancePreview } from './preview2d.js'
import { observeThumbs } from './thumb-loader.js'
import { observeModelThumbs } from './model-thumb.js'
import { parseModelText, buildModelSummary, diffLines, escHtml, isModelEntry } from './model-diff.js'
import { viewMcModelInViewport, isViewportVisible, resolveModelTexList, textureAssetPath } from './mc-model-viewer.js'
import { t, onLocaleChange } from './i18n.js'

const ALLOWED_MODEL_TYPES = new Set(['block', 'item'])

onLocaleChange(() => {
  leftPathEl.textContent = state.leftPath || t('common.empty')
  rightPathEl.textContent = state.rightPath || t('common.empty')
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
function modelThumbSpec(entry, root) {
  if (!entry || !isModelEntry(entry)) return null
  return {
    kind: 'mc',
    fileRoot: root,
    rel: entry.name,
    path: 'cmp:' + root + '/' + entry.name,
    mtime: entry.mtime || 0,
    noCache: true,
  }
}

function renderModelThumbCell(entry, root, side) {
  if (!modelThumbSpec(entry, root)) return `<span class="thumb-ph thumb-${side}-ph">${side === 'left' ? 'L' : 'R'}</span>`
  return `<div class="ac-thumb thumb-model thumb-${side}" data-mroot="${escAttr(root)}" data-mrel="${escAttr(entry.name)}" data-mtime="${entry.mtime || 0}"></div>`
}

function renderModelThumbPair(le, re, leftRoot, rightRoot) {
  const hasL = isModelEntry(le), hasR = isModelEntry(re)
  if (!hasL && !hasR) return '<span class="cell-empty">—</span>'
  const lt = hasL ? renderModelThumbCell(le, leftRoot, 'left') : '<span class="thumb-ph thumb-left-ph">L</span>'
  const rt = hasR ? renderModelThumbCell(re, rightRoot, 'right') : '<span class="thumb-ph thumb-right-ph">R</span>'
  return `<div class="thumb-pair">${lt}${rt}</div>`
}

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
  const nameHtml = `${arrow}<span class="cell-name" title="${g.key}">${displayName || g.key}</span>`
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

async function loadModelCardTexs(card, g) {
  const le = g.left && g.left.file, re = g.right && g.right.file
  const leftList = le && isModelEntry(le) ? await resolveModelTexList({ fileRoot: state.leftPath, rel: le.name }).catch(() => null) : null
  const rightList = re && isModelEntry(re) ? await resolveModelTexList({ fileRoot: state.rightPath, rel: re.name }).catch(() => null) : null
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
    texEl.className = 'model-tex-item row-' + kind
    const thumbL = info.leftUrl ? `<img class="thumb thumb-left" src="${escAttr(info.leftUrl)}" alt="" />` : '<span class="thumb-ph thumb-left-ph">L</span>'
    const thumbR = info.rightUrl ? `<img class="thumb thumb-right" src="${escAttr(info.rightUrl)}" alt="" />` : '<span class="thumb-ph thumb-right-ph">R</span>'
    const texName = (info.name || ap).replace(/^minecraft:/, '')
    texEl.innerHTML = `<div class="model-tex-thumbs">${thumbL}${thumbR}</div><span class="model-tex-name" title="${escAttr(ap || info.name)}">${escHtml(texName)}</span>`
    texEl.title = `${texName} · ${KIND_TEXT[kind] || kind}`
    if (grp) texEl.addEventListener('click', (e) => { e.stopPropagation(); selectGroup(grp, false) })
    frag.appendChild(texEl)
  }
  texsEl.innerHTML = ''
  texsEl.appendChild(frag)
  texsEl.querySelectorAll('img[src]').forEach(img => {
    img.addEventListener('click', (e) => { e.stopPropagation(); openPreview(img.src, img.dataset.name || '') })
  })
}

function appendModelCard(container, g) {
  const mainLeft = g.left && (g.left.file || g.left.dir)
  const mainRight = g.right && (g.right.file || g.right.dir)
  const me = mainLeft || mainRight
  const card = document.createElement('div')
  card.className = 'model-card row-' + g.kind
  if (state.selected && state.selected.key === g.key) card.classList.add('selected')
  const previewHtml = renderModelThumbPair(mainLeft, mainRight, state.leftPath, state.rightPath)
  const shortName = g.key.replace(/^assets\/[^/]+\/models\//, '').replace(/^assets\/[^/]+\/items\//, '').replace(/\.json$/, '')
  card.innerHTML = `<div class="model-card-head">${statusBadge(g.kind)}<span class="model-card-name" title="${g.key}">${escHtml(shortName)}</span></div><div class="model-card-preview">${previewHtml}</div><div class="model-card-texs"><span class="model-texs-loading">${t('render.modelTexLoading')}</span></div>`
  card.querySelectorAll('.ac-thumb[data-mrel]').forEach(th => {
    th._modelThumbItem = { modelThumb: modelThumbSpec({ name: th.dataset.mrel, mtime: +th.dataset.mtime || 0 }, th.dataset.mroot) }
  })
  card._group = g
  card.addEventListener('click', () => {
    state.selected = g
    const body = $('modelGridBody')
    if (body) body.querySelectorAll('.model-card.selected').forEach(c => c.classList.remove('selected'))
    card.classList.add('selected')
    renderSidebar()
  })
  card.addEventListener('dblclick', (ev) => {
    const e = mainEntryOf(g)
    if (!e) return
    if (ev.metaKey || ev.ctrlKey) window.api.showInFolder(e.fullPath)
    else window.api.openPath(e.fullPath)
  })
  container.appendChild(card)
  loadModelCardTexs(card, g)
}

export function renderModelTypeResult() {
  const body = $('modelGridBody')
  if (!body) return
  const result = state.result
  let models = result.filter(g => g.isModel)
  const onlyDiff = onlyMissingChk.checked
  if (onlyDiff) models = models.filter(g => g.kind !== 'have')
  const sf = state.statusFilter
  if (sf === 'missing') models = models.filter(g => g.kind === 'miss' || g.kind === 'partial')
  else if (sf === 'diff') models = models.filter(g => g.kind === 'diff')
  else if (sf === 'extra') models = models.filter(g => g.kind === 'extra')
  const q = state.searchText.trim().toLowerCase()
  if (q) models = models.filter(g => g.key.toLowerCase().includes(q))
  models = models.filter(g => { const tp = modelTypeOf(g); return tp && ALLOWED_MODEL_TYPES.has(tp) })
  sortResult(models)
  if (models.length === 0) {
    const msg = !state.leftPath || !state.rightPath ? t('render.dragHint') : result.length === 0 ? t('render.bothEmpty') : q ? t('render.noMatch') : t('render.noModel')
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
  for (const tp of types) {
    if (rendered >= limit) { truncated = true; break }
    const items = typeMap.get(tp)
    const collapsed = state.collapsedFolders.has(tp)
    const fc = { have: 0, diff: 0, partial: 0, miss: 0, extra: 0 }
    for (const g of items) fc[g.kind]++
    const sp = []
    if (fc.have) sp.push(`<span class="fc fc-have">✓${fc.have}</span>`)
    if (fc.diff) sp.push(`<span class="fc fc-diff">≈${fc.diff}</span>`)
    if (fc.partial) sp.push(`<span class="fc fc-partial">◐${fc.partial}</span>`)
    if (fc.miss) sp.push(`<span class="fc fc-miss">✗${fc.miss}</span>`)
    if (fc.extra) sp.push(`<span class="fc fc-extra">＋${fc.extra}</span>`)
    const section = document.createElement('div')
    section.className = 'model-type-section'
    section.innerHTML = `<div class="model-type-header"><span class="model-type-arrow">${collapsed ? '▸' : '▾'}</span><svg class="ico ico-sm"><use href="#i-cube"/></svg><span class="model-type-name">${tp}</span><span class="model-type-count">${t('render.modelTypeCount', { n: items.length })}</span><span class="model-type-summary">${sp.join(' ')}</span></div>`
    section.querySelector('.model-type-header').addEventListener('click', () => {
      if (state.collapsedFolders.has(tp)) state.collapsedFolders.delete(tp)
      else state.collapsedFolders.add(tp)
      renderModelTypeResult()
    })
    if (!collapsed) {
      const cards = document.createElement('div')
      cards.className = 'model-cards'
      for (const g of items) { if (rendered >= limit) { truncated = true; break }; appendModelCard(cards, g); rendered++ }
      section.appendChild(cards)
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

export function renderResult() {
  renderModelTypeResult()
  const result = state.result
  const onlyDiff = onlyMissingChk.checked
  let filtered = onlyDiff ? result.filter(g => g.kind !== 'have') : result.slice()
  const sf = state.statusFilter
  if (sf === 'missing') filtered = filtered.filter(g => g.kind === 'miss' || g.kind === 'partial')
  else if (sf === 'diff') filtered = filtered.filter(g => g.kind === 'diff')
  else if (sf === 'extra') filtered = filtered.filter(g => g.kind === 'extra')
  const tf = state.typeFilter
  if (tf === 'material') filtered = filtered.filter(g => g.isMaterial)
  else if (tf === 'model') filtered = filtered.filter(g => g.isModel)
  else if (tf === 'image') filtered = filtered.filter(g => !g.isMaterial && !g.isDir && !g.isModel)
  else if (tf === 'folder') filtered = filtered.filter(g => g.isDir)
  const q = state.searchText.trim().toLowerCase()
  if (q) filtered = filtered.filter(g => g.key.toLowerCase().includes(q))
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

  renderChart(true)

  if (filtered.length === 0) {
    const msg = !state.leftPath || !state.rightPath
      ? t('render.dragHint')
      : result.length === 0 ? t('render.bothEmpty')
      : q ? t('render.noMatch')
      : (tf !== 'all' && result.some(g => tf === 'material' ? g.isMaterial : tf === 'model' ? g.isModel : tf === 'image' ? (!g.isMaterial && !g.isDir && !g.isModel) : g.isDir)) ? t('render.noTypeMatch')
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
    const folders = [...folderMap.keys()].sort((a, b) => a.localeCompare(b, 'zh'))
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
        if (state.collapsedFolders.has(f)) state.collapsedFolders.delete(f)
        else state.collapsedFolders.add(f)
        renderResult()
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
    moreRow.querySelector('button').addEventListener('click', () => { state.renderLimit += 200; renderResult() })
    frag.appendChild(moreRow)
  }

  resultBody.innerHTML = ''
  resultBody.appendChild(frag)
  observeThumbs(resultBody)
  observeModelThumbs(resultBody)

}

export function selectGroup(g, toggle = true) {
  state.selected = g
  const prevRow = resultBody.querySelector('tr.row-selected:not(.sub-row)')
  if (prevRow && prevRow._group !== g) prevRow.classList.remove('row-selected')
  let curRow = null
  for (const r of resultBody.children) {
    if (r._group === g && !r.classList.contains('sub-row')) { curRow = r; break }
  }
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

function pvCell(entry, side) {
  if (!entry) return `<div class="pv-cell"><span class="pv-tag">${side}</span><span class="pv-empty">${t('preview.noSide')}</span></div>`
  if (entry.isDirectory || !isImageFile(entry.name)) return `<div class="pv-cell"><span class="pv-tag">${side}</span><span class="pv-empty">${t('preview.notImage')}</span></div>`
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
    if (!le || le.isDirectory) return
    const rel = relPath(state.leftPath, le.fullPath)
    const dest = joinPath(state.rightPath, rel)
    const empty = rightCell.querySelector('.pv-empty')
    if (empty) empty.remove()
    const actions = document.createElement('div')
    actions.className = 'pv-empty-actions'
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
  } catch { return '' }
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

function renderModelDiffGrid(grid, lt, rt) {
  const a = typeof lt === 'string' && lt ? parseModelText(lt).pretty.split('\n') : []
  const b = typeof rt === 'string' && rt ? parseModelText(rt).pretty.split('\n') : []
  const truncated = a.length > MD_MAX_LINES || b.length > MD_MAX_LINES
  const as = a.slice(0, MD_MAX_LINES), bs = b.slice(0, MD_MAX_LINES)
  let html = `<div class="md-cell md-head">${t('common.left')}</div><div class="md-cell md-head">${t('common.right')}</div>`
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
  if (truncated) html += `<div class="md-cell md-trunc">${t('preview.modelTruncated', { n: MD_MAX_LINES })}</div><div class="md-cell md-trunc"></div>`
  grid.innerHTML = html
}

async function loadModelDiffView(g, panel) {
  const grid = panel.querySelector('.md-grid')
  const sumEl = panel.querySelector('.pv-model-sum')
  if (!grid || !sumEl) return
  const le = g.left && g.left.file, re = g.right && g.right.file
  const [lt, rt] = await Promise.all([fetchModelText(le), fetchModelText(re)])
  if (state.selected !== g) return
  sumEl.innerHTML =
    `<div class="pv-model-sum-row"><span class="pv-model-tag">${t('common.left')}</span><span>${escHtml(modelSumLine(lt))}</span></div>` +
    `<div class="pv-model-sum-row"><span class="pv-model-tag">${t('common.right')}</span><span>${escHtml(modelSumLine(rt))}</span></div>`
  renderModelDiffGrid(grid, lt, rt)
}

/* 3D 视口未激活时自动切到预览面板 3D tab（等价用户点击）；返回视口是否就绪 */
function tryActivateCompareModelViewport() {
  if (isViewportVisible()) return true
  const pvBtn = document.querySelector('.pv-tabs button[data-pv-tab="3d"]')
  if (pvBtn) { pvBtn.click(); return true }
  return false
}

/* 选中模型行：将主模型（优先左侧，左侧缺失用右侧）送入 3D 视口展示。
   左右双模型对比暂不支持（material3d 单自定义模型通道）；2D tab 仍保留 JSON 文本差异 */
async function loadModelPreview(g) {
  if (state.selected !== g) return
  const le = g.left && g.left.file, re = g.right && g.right.file
  const e = le || re
  if (!e || !isModelEntry(e)) return
  const root = (e === le) ? state.leftPath : state.rightPath
  if (!tryActivateCompareModelViewport()) return
  try {
    await viewMcModelInViewport({ fileRoot: root, rel: e.name })
    if (state.selected !== g) clearCustomModel()
  } catch {}
}

/* 列出左右模型各自引用的材质贴图（名称 + 缩略图），与 3D 预览 / JSON 差异同区展示。
   贴图直接用 raw URL 加载（MC 贴图通常很小）；异步填充，不参与 renderSidebar 的 img 循环 */
async function loadModelTexList(g) {
  if (state.selected !== g) return
  const le = g.left && g.left.file, re = g.right && g.right.file
  const [lt, rt] = await Promise.all([
    le && isModelEntry(le) ? resolveModelTexList({ fileRoot: state.leftPath, rel: le.name }).catch(() => null) : Promise.resolve(null),
    re && isModelEntry(re) ? resolveModelTexList({ fileRoot: state.rightPath, rel: re.name }).catch(() => null) : Promise.resolve(null),
  ])
  if (state.selected !== g) return
  const el = $('previewPanel').querySelector('.pv-model-texs')
  if (!el) return
  el.innerHTML = renderModelTexListHtml(lt, rt)
  el.querySelectorAll('img').forEach(img => {
    img.addEventListener('click', () => openPreview(img.src, img.dataset.name || ''))
  })
}

function renderModelTexListHtml(lt, rt) {
  const col = (list, side) => {
    const tag = `<span class="pv-tex-tag pv-tex-tag-${side}">${side === 'left' ? t('common.left') : t('common.right')}</span>`
    if (!list || !list.length) return `<div class="pv-tex-col">${tag}<span class="pv-empty">${t('preview.noSide')}</span></div>`
    const items = list.map(tx =>
      `<div class="pv-tex-item">` +
      `<img class="thumb thumb-${side}" src="${escAttr(tx.url)}" data-name="${escAttr(tx.name)}" alt="" />` +
      `<span class="pv-tex-name" title="${escAttr(tx.name)}">${escHtml(tx.name)}</span>` +
      `</div>`
    ).join('')
    return `<div class="pv-tex-col">${tag}${items}</div>`
  }
  return col(lt, 'left') + col(rt, 'right')
}

export function renderSidebar() {
  const g = state.selected
  const panel = $('previewPanel')
  const detail = $('detailPanel')
  const action = $('actionPanel')
  const mat3dContainer = $('material3dContainer')

  if (mat3dContainer) initMaterial3D(mat3dContainer)

  if (!g) {
    panel.innerHTML = `<div class="pv-hint">${t('preview.hint')}</div>`
    detail.innerHTML = `<div class="detail-hint">${t('preview.notSelected')}</div>`
    action.innerHTML = ''
    updateMaterial3D(null)
    clearCustomModel()
    return
  }

  updateMaterial3D(g.isMaterial ? g : null)
  if (!g.isModel) clearCustomModel()

  let html = ''
  const diffPairs = []
  if (g.isMaterial) {
    for (const role of ['main', 'normal', 'specular']) {
      const le = g.left && g.left[role], re = g.right && g.right[role]
      if (!le && !re) continue
      html += `<div class="pv-row" data-role="${role}"><span class="pv-role">${ROLE_LABEL[role]}</span>${pvCell(le, t('common.left'))}${pvCell(re, t('common.right'))}</div>`
      if (le && re && !le.isDirectory && !re.isDirectory && isImageFile(le.name) && isImageFile(re.name))
        diffPairs.push([le, re, ROLE_LABEL[role]])
    }
  } else if (g.isDir) {
    html = `<div class="pv-hint">${t('preview.folder')}</div>`
  } else if (g.isModel) {
    html = `<div class="pv-model">` +
      `<div class="pv-model-sum">${t('toast.computing')}</div>` +
      `<div class="pv-model-texs">${t('toast.computing')}</div>` +
      `<div class="md-grid"><div class="md-cell md-load">${t('toast.computing')}</div><div class="md-cell md-load">${t('toast.computing')}</div></div>` +
      `</div>`
  } else {
    const le = g.left && (g.left.file || g.left.dir), re = g.right && (g.right.file || g.right.dir)
    html = `<div class="pv-row" data-role="file"><span class="pv-role">${t('preview.file')}</span>${pvCell(le, t('common.left'))}${pvCell(re, t('common.right'))}</div>`
    if (le && re && !le.isDirectory && !re.isDirectory && isImageFile(le.name) && isImageFile(re.name))
      diffPairs.push([le, re, t('preview.file')])
  }
  if (diffPairs.length) {
    html += `<div class="pv-diff-btn-bar"><button class="btn btn-ghost btn-sm" id="pixelDiffBtn">${t('preview.pixelDiff')}</button></div>`
  }
  panel.querySelectorAll('.pv-row').forEach(row => { if (row._splitCleanup) row._splitCleanup() })
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
    img.addEventListener('error', () => { cell.classList.remove('pv-loading'); cell.classList.add('pv-error') })
    const btn = document.createElement('button')
    btn.className = 'pv-replace-btn'
    btn.textContent = t('preview.replace')
    btn.title = t('preview.replaceTitle')
    btn.addEventListener('click', (e) => { e.stopPropagation(); replaceWithExternalFile(img.dataset.path) })
    cell.appendChild(btn)
    const delBtn = document.createElement('button')
    delBtn.className = 'pv-delete-btn'
    delBtn.textContent = t('preview.delete')
    delBtn.title = t('preview.deleteTitle')
    delBtn.addEventListener('click', (e) => { e.stopPropagation(); deleteTexture(img.dataset.path) })
    cell.appendChild(delBtn)
  })
  bindEmptyCellActions(panel, g)

 
  const diffBtn = $('pixelDiffBtn')
  if (diffBtn) diffBtn.addEventListener('click', () => showPixelDiff(diffPairs, panel))
  if (g.isModel) { loadModelDiffView(g, panel); loadModelPreview(g); loadModelTexList(g) }

  const dRow = (label, val) => `<div class="detail-row"><span class="detail-label">${label}</span><span>${val}</span></div>`
  let dh = `<div class="detail-title" title="${g.key}">${g.key}</div>`
  dh += dRow(t('common.status'), KIND_TEXT[g.kind])
  if (g.isMaterial) {
    dh += dRow(t('common.type'), t('type.material'))
    dh += dRow(t('detail.texCount'), `${t('common.left')} ${leftRoles(g).length} / ${t('common.right')} ${rightRoles(g).length}`)
    const m = mainEntryOf(g)
    if (m) { dh += dRow(t('detail.mainSize'), formatSize(m.size)); dh += dRow(t('detail.mainMtime'), formatDate(m.mtime)) }
  } else if (g.isDir) {
    dh += dRow(t('common.type'), t('type.folder'))
  } else if (g.isModel) {
    dh += dRow(t('common.type'), t('type.model'))
    const e = mainEntryOf(g)
    if (e) { dh += dRow(t('common.size'), formatSize(e.size)); dh += dRow(t('detail.mtime'), formatDate(e.mtime)) }
  } else {
    dh += dRow(t('common.type'), t('type.file'))
    const e = mainEntryOf(g)
    if (e) { dh += dRow(t('common.size'), formatSize(e.size)); dh += dRow(t('detail.mtime'), formatDate(e.mtime)) }
  }
  detail.innerHTML = dh

  const target = mainEntryOf(g)
  let btns = ''
  if (g.left && target) btns += `<button class="btn btn-sm" data-act="open-left">${t('detail.openLeft')}</button><button class="btn btn-ghost btn-sm" data-act="loc-left">${t('detail.locLeft')}</button>`
  if (g.right && target) btns += `<button class="btn btn-sm" data-act="open-right">${t('detail.openRight')}</button><button class="btn btn-ghost btn-sm" data-act="loc-right">${t('detail.locRight')}</button>`
  if (g.left && hasAny(g.left) && state.rightPath) btns += `<button class="btn btn-accent btn-sm" data-act="copy-to-right">${t('detail.copyRight')}</button>`
  if (g.right && hasAny(g.right) && state.leftPath) btns += `<button class="btn btn-accent btn-sm" data-act="copy-to-left">${t('detail.copyLeft')}</button>`
  btns += `<button class="btn btn-ghost btn-sm" data-act="copy">${t('detail.copyName')}</button>`
  action.innerHTML = btns
  action.querySelectorAll('button').forEach(b => {
    b.addEventListener('click', () => handleAction(b.dataset.act, g))
  })
  enhancePreview()
}

export function updateSortIndicators() {
  document.querySelectorAll('.result-table th[data-key]').forEach(th => {
    th.classList.remove('asc', 'desc')
    if (th.dataset.key === state.sortKey) th.classList.add(state.sortDir)
  })
}

export function initViewTabs() {
  const tabs = document.querySelectorAll('.view-tab')
  const tableView = $('tableView')
  const modelView = $('modelView')
  const chartView = $('chartView')
  const tableToolbar = $('tableToolbar')
  const statsDashboard = $('statsDashboard')
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'))
      tab.classList.add('active')
      const view = tab.dataset.view
      const isTableLike = view === 'table' || view === 'model'
      if (tableView) tableView.classList.toggle('active', view === 'table')
      if (modelView) modelView.classList.toggle('active', view === 'model')
      if (chartView) chartView.classList.toggle('active', view === 'chart')
      if (tableToolbar) tableToolbar.style.display = isTableLike ? '' : 'none'
      if (statsDashboard) statsDashboard.style.display = isTableLike ? '' : 'none'
      if (view === 'chart') renderChart()
      if (view === 'model') renderModelTypeResult()
    })
  })
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && (e.key === '1' || e.key === '2' || e.key === '3')) {
      const idx = e.key === '1' ? 0 : e.key === '2' ? 1 : 2
      if (tabs[idx]) tabs[idx].click()
      e.preventDefault()
    }
  })
}

function donutChart(segments) {
  const size = 180, r = 65, sw = 26
  const C = 2 * Math.PI * r
  const total = segments.reduce((s, seg) => s + seg.value, 0)
  if (total === 0) return ''
  let offset = 0
  const circles = segments.filter(s => s.value > 0).map(seg => {
    const len = (seg.value / total) * C
    const dash = `${len} ${C - len}`
    const circle = `<circle cx="${size/2}" cy="${size/2}" r="${r}" fill="none" stroke="${seg.color}" stroke-width="${sw}" stroke-dasharray="${dash}" stroke-dashoffset="${-offset}" transform="rotate(-90 ${size/2} ${size/2})"/>`
    offset += len
    return circle
  }).join('')
  return `<svg viewBox="0 0 ${size} ${size}" class="chart-svg">` +
    `<circle cx="${size/2}" cy="${size/2}" r="${r}" fill="none" stroke="var(--border)" stroke-width="${sw}"/>` +
    circles +
    `<text x="${size/2}" y="${size/2}" text-anchor="middle" dy="-2" class="chart-donut-num">${total}</text>` +
    `<text x="${size/2}" y="${size/2}" text-anchor="middle" dy="16" class="chart-donut-label">${t('render.totalGroups')}</text></svg>`
}

function gaugeChart(pct, label, color) {
  const size = 180, r = 65, sw = 26
  const C = 2 * Math.PI * r
  const len = (Math.min(pct, 100) / 100) * C
  return `<svg viewBox="0 0 ${size} ${size}" class="chart-svg">` +
    `<circle cx="${size/2}" cy="${size/2}" r="${r}" fill="none" stroke="var(--border)" stroke-width="${sw}"/>` +
    `<circle cx="${size/2}" cy="${size/2}" r="${r}" fill="none" stroke="${color}" stroke-width="${sw}" stroke-dasharray="${len} ${C - len}" stroke-linecap="round" transform="rotate(-90 ${size/2} ${size/2})"/>` +
    `<text x="${size/2}" y="${size/2}" text-anchor="middle" dy="-2" class="chart-donut-num">${pct.toFixed(1)}%</text>` +
    `<text x="${size/2}" y="${size/2}" text-anchor="middle" dy="16" class="chart-donut-label">${label}</text></svg>`
}

function barChart(items) {
  const max = Math.max(...items.map(i => i.value), 1)
  return items.map(item => {
    const pct = (item.value / max) * 100
    return `<div class="bar-row"><span class="bar-label">${item.label}</span>` +
      `<div class="bar-track"><div class="bar-fill" style="width:${pct}%;background:${item.color}"></div></div>` +
      `<span class="bar-val">${item.value}</span></div>`
  }).join('')
}

function renderChart(lazy = false) {
  const el = $('chartContent')
  if (!el) return
  if (lazy) {
    const cv = $('chartView')
    if (cv && !cv.classList.contains('active')) return
  }
  const c = state.counts || { have: 0, diff: 0, partial: 0, miss: 0, extra: 0, leftTex: 0, rightTex: 0, rightMatch: 0, pbrExtra: 0 }
  const total = c.have + c.diff + c.partial + c.miss + c.extra
  const leftGroups = c.have + c.diff + c.partial + c.miss
  if (total === 0) {
    el.innerHTML = `<div class="chart-empty"><svg class="ico"><use href="#i-pie"/></svg><p>${t('render.chartEmpty')}</p></div>`
    return
  }
  const cov = c.leftTex > 0 ? c.rightMatch / c.leftTex * 100 : 0
  const consist = leftGroups > 0 ? c.have / leftGroups * 100 : 0
  const missRate = leftGroups > 0 ? c.miss / leftGroups * 100 : 0
  const diffRate = leftGroups > 0 ? c.diff / leftGroups * 100 : 0
  const extraRate = total > 0 ? c.extra / total * 100 : 0

  const sh = t('status.haveShort'), sd = t('status.diffShort'), sp = t('status.partialShort'), sm = t('status.missShort'), se = t('status.extraShort')

  const donut = donutChart([
    { value: c.have, color: 'var(--accent)', label: sh },
    { value: c.diff, color: 'var(--warn)', label: sd },
    { value: c.partial, color: 'var(--partial)', label: sp },
    { value: c.miss, color: 'var(--danger)', label: sm },
    { value: c.extra, color: 'var(--text-dim)', label: se },
  ])

  const legend = [
    { label: sh, value: c.have, color: 'var(--accent)' },
    { label: sd, value: c.diff, color: 'var(--warn)' },
    { label: sp, value: c.partial, color: 'var(--partial)' },
    { label: sm, value: c.miss, color: 'var(--danger)' },
    { label: se, value: c.extra, color: 'var(--text-dim)' },
  ].map(l => `<div class="legend-item"><span class="legend-dot" style="background:${l.color}"></span>${l.label} <b>${l.value}</b></div>`).join('')

  const bars = barChart([
    { label: sh, value: c.have, color: 'var(--accent)' },
    { label: sd, value: c.diff, color: 'var(--warn)' },
    { label: t('status.partialFull'), value: c.partial, color: 'var(--partial)' },
    { label: sm, value: c.miss, color: 'var(--danger)' },
    { label: se, value: c.extra, color: 'var(--text-dim)' },
  ])

  const texBars = barChart([
    { label: t('render.leftTex'), value: c.leftTex, color: 'var(--primary)' },
    { label: t('render.rightTex'), value: c.rightTex, color: 'var(--accent)' },
    { label: t('render.matchTex'), value: c.rightMatch, color: 'var(--accent)' },
    { label: t('render.pbrTitle'), value: c.pbrExtra, color: 'var(--partial)' },
    ...(c.leftModel ? [
      { label: t('render.leftModel'), value: c.leftModel, color: 'var(--primary)' },
      { label: t('render.rightModel'), value: c.rightModel, color: 'var(--accent)' },
      { label: t('render.matchModel'), value: c.modelMatch, color: 'var(--accent)' },
    ] : []),
  ])

  const rateCards = [
    { label: t('render.covTitle'), val: cov, sub: t('render.covSub', { match: c.rightMatch, total: c.leftTex }), color: 'var(--primary)' },
    { label: t('render.consistTitle'), val: consist, sub: t('render.consistSub', { have: c.have, total: leftGroups }), color: 'var(--accent)' },
    { label: t('render.missTitle'), val: missRate, sub: t('render.missSub', { n: c.miss }), color: 'var(--danger)' },
    { label: t('render.diffTitle'), val: diffRate, sub: t('render.diffSub', { n: c.diff }), color: 'var(--warn)' },
    { label: t('render.redundancyTitle'), val: extraRate, sub: t('render.extraSub', { n: c.extra }), color: 'var(--text-dim)' },
  ].map(r => `<div class="rate-card" style="--rc:${r.color}"><div class="rate-label">${r.label}</div>` +
    `<div class="rate-val">${r.val.toFixed(1)}<span class="rate-unit">%</span></div>` +
    `<div class="rate-bar"><div class="rate-fill" style="width:${Math.min(r.val,100)}%"></div></div>` +
    `<div class="rate-sub">${r.sub}</div></div>`).join('')

  const funnelData = [
    { label: t('render.leftTotalGroups'), value: leftGroups, color: 'var(--primary)' },
    { label: t('render.rightExist'), value: leftGroups - c.miss, color: 'var(--accent)' },
    { label: t('render.consistPartial'), value: c.have + c.partial, color: 'var(--partial)' },
    { label: t('render.fullConsist'), value: c.have, color: 'var(--accent)' },
  ]
  const funnelMax = funnelData[0].value || 1
  const funnel = funnelData.map((f, i) => {
    const pct = (f.value / funnelMax) * 100
    const rate = i > 0 && funnelData[i - 1].value > 0 ? (f.value / funnelData[i - 1].value * 100).toFixed(0) : '100'
    return `<div class="funnel-row" style="width:${Math.max(pct, 8)}%;background:${f.color}">` +
      `<span class="funnel-label">${f.label}</span>` +
      `<span class="funnel-value">${f.value}</span>` +
      `<span class="funnel-rate">${rate}%</span></div>`
  }).join('')

  const stackColors = { have: 'var(--accent)', diff: 'var(--warn)', partial: 'var(--partial)', miss: 'var(--danger)', extra: 'var(--text-dim)' }
  const stackLabels = { have: sh, diff: sd, partial: sp, miss: sm, extra: se }
  const folderMap = new Map()
  for (const g of state.result) {
    const f = folderOf(g)
    if (!folderMap.has(f)) folderMap.set(f, { have: 0, diff: 0, partial: 0, miss: 0, extra: 0, total: 0 })
    const fs = folderMap.get(f)
    fs[g.kind]++
    fs.total++
  }
  const topFolders = [...folderMap.entries()].sort((a, b) => b[1].total - a[1].total).slice(0, 12)
  const folderBars = topFolders.map(([folder, fs]) => {
    const segs = ['have', 'diff', 'partial', 'miss', 'extra'].map(k =>
      fs[k] > 0 ? `<div class="stack-seg" style="flex:${fs[k]};background:${stackColors[k]}" title="${stackLabels[k]}: ${fs[k]}"></div>` : ''
    ).join('')
    return `<div class="stack-row" style="cursor:pointer"><span class="stack-label" title="${folder}">${folder}</span>` +
      `<div class="stack-track">${segs}</div><span class="stack-val">${fs.total}</span></div>`
  }).join('')

  const heatFolders = topFolders.slice(0, 10)
  const heatMax = Math.max(...heatFolders.flatMap(([, fs]) => [fs.have, fs.diff, fs.partial, fs.miss, fs.extra]), 1)
  const heatHeader = `<div class="heat-row heat-head"><span class="heat-label">${t('render.heatFolder')}</span>` +
    [sh, sd, sp, sm, se].map(l => `<div class="heat-cell">${l}</div>`).join('') + `</div>`
  const heatRows = heatFolders.map(([folder, fs]) => {
    const cells = ['have', 'diff', 'partial', 'miss', 'extra'].map(k => {
      const v = fs[k]
      const intensity = v / heatMax
      const bgAlpha = v > 0 ? 0.12 + intensity * 0.88 : 0
      return `<div class="heat-cell" title="${stackLabels[k]}: ${v}">` +
        (v > 0 ? `<div class="heat-bg" style="opacity:${bgAlpha};background:${stackColors[k]}"></div><span>${v}</span>` : '') +
        `</div>`
    }).join('')
    return `<div class="heat-row"><span class="heat-label" title="${folder}">${folder}</span>${cells}</div>`
  }).join('')

  const typeMap = new Map()
  for (const g of state.result) {
    const e = mainEntryOf(g)
    if (e && e.name) {
      const dot = e.name.lastIndexOf('.')
      const ext = dot >= 0 ? e.name.slice(dot + 1).toLowerCase() : 'other'
      typeMap.set(ext, (typeMap.get(ext) || 0) + 1)
    }
  }
  const typeColors = ['var(--primary)', 'var(--accent)', 'var(--warn)', 'var(--partial)', 'var(--danger)', 'var(--extra)', 'var(--text-dim)']
  const typeSegs = [...typeMap.entries()].sort((a, b) => b[1] - a[1]).map(([ext, count], i) =>
    ({ value: count, color: typeColors[i % typeColors.length], label: ext })
  )
  const typeDonut = donutChart(typeSegs)
  const typeLegend = typeSegs.map(s =>
    `<div class="legend-item legend-drill" data-ext="${s.label}"><span class="legend-dot" style="background:${s.color}"></span>.${s.label} <b>${s.value}</b></div>`
  ).join('')

  const sizeBuckets = [
    { label: '<1KB', min: 0, max: 1024, count: 0 },
    { label: '1-10KB', min: 1024, max: 10240, count: 0 },
    { label: '10-100KB', min: 10240, max: 102400, count: 0 },
    { label: '100KB-1MB', min: 102400, max: 1048576, count: 0 },
    { label: '1-10MB', min: 1048576, max: 10485760, count: 0 },
    { label: '>10MB', min: 10485760, max: Infinity, count: 0 },
  ]
  for (const g of state.result) {
    const e = mainEntryOf(g)
    if (e && e.size != null) {
      for (const b of sizeBuckets) { if (e.size >= b.min && e.size < b.max) { b.count++; break } }
    }
  }
  const sizeBars = barChart(sizeBuckets.map(b =>
    ({ label: b.label, value: b.count, color: 'var(--primary)' })
  ))

  el.innerHTML = `<div class="chart-grid">` +
    `<div class="chart-card"><div class="chart-card-title">${t('render.chartStatusDist')}</div><div class="chart-donut-wrap">${donut}</div><div class="chart-legend">${legend}</div></div>` +
    `<div class="chart-card"><div class="chart-card-title">${t('render.chartCovGauge')}</div><div class="chart-donut-wrap">${gaugeChart(cov, t('render.covTitle'), 'var(--primary)')}</div></div>` +
    `<div class="chart-card chart-wide"><div class="chart-card-title">${t('render.chartCategoryCount')}</div><div class="chart-bars">${bars}</div></div>` +
    `<div class="chart-card chart-wide"><div class="chart-card-title">${t('render.chartTexCompare')}</div><div class="chart-bars">${texBars}</div></div>` +
    `<div class="chart-card chart-full"><div class="chart-card-title">${t('render.chartMetrics')}</div><div class="rate-cards">${rateCards}</div></div>` +
    `<div class="chart-card"><div class="chart-card-title">${t('render.chartTypeDist')}</div><div class="chart-donut-wrap">${typeDonut}</div><div class="chart-legend">${typeLegend}</div></div>` +
    `<div class="chart-card"><div class="chart-card-title">${t('render.chartSizeDist')}</div><div class="chart-bars">${sizeBars}</div></div>` +
    `<div class="chart-card chart-full"><div class="chart-card-title">${t('render.chartFunnel')}</div><div class="chart-funnel">${funnel}</div></div>` +
    `<div class="chart-card chart-full"><div class="chart-card-title">${t('render.chartFolderDist')}</div><div class="chart-stacks">${folderBars}</div></div>` +
    `<div class="chart-card chart-full"><div class="chart-card-title">${t('render.chartHeatmap')}</div><div class="chart-heat">${heatHeader}${heatRows}</div></div>` +
    `</div>`

  if (!el._chartDelegated) {
    el._chartDelegated = true
    el.addEventListener('click', (ev) => {
      const drill = ev.target.closest('.legend-drill')
      if (drill) {
        searchInput.value = '.' + drill.dataset.ext
        state.searchText = '.' + drill.dataset.ext
        switchToTable()
        return
      }
      const row = ev.target.closest('.stack-row')
      if (row) {
        const label = row.querySelector('.stack-label')
        if (label) {
          searchInput.value = label.textContent
          state.searchText = label.textContent
          switchToTable()
        }
      }
    })
  }
}

function switchToTable() {
  const tableTab = document.querySelector('.view-tab[data-view="table"]')
  if (tableTab) tableTab.click()
  renderResult()
}