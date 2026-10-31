/**
 * matoga - 材质贴图对比工具
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 从 render.js L530-L754 原样搬出（正文逐字未改）。
 * 段外本地符号经 setHooks 注入：renderModelThumbPair, modelThumbSpec, renderSidebar,
 * renderModelTypeResult, selectGroup, loadModelTexComparePanel, statusBadge
 */

import { state } from '../core.js'
import { mainEntryOf, openPreview } from '../utils.js'
import { observeThumbs } from '../thumb-loader.js'
import { observeModelThumbs } from '../model-thumb.js'
import { isModelEntry } from '../model-diff.js'
import { resolveModelTexList } from '../mc-model-viewer.js'

/* 以下变量由主模块经 setHooks 注入。正文按裸标识符引用，故模块级声明。 */
let renderModelThumbPair
let modelThumbSpec
let renderSidebar
let renderModelTypeResult
let selectGroup
let loadModelTexComparePanel
let statusBadge
export function setHooks(h) {
  renderModelThumbPair = h.renderModelThumbPair
  modelThumbSpec = h.modelThumbSpec
  renderSidebar = h.renderSidebar
  renderModelTypeResult = h.renderModelTypeResult
  selectGroup = h.selectGroup
  loadModelTexComparePanel = h.loadModelTexComparePanel
  statusBadge = h.statusBadge
}

export function appendModelGridCard(container, g) {
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

export function buildModelDetailPanel(g) {
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

export function appendModelCompareRow(container, g) {
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

export function fillModelPreview(row, g) {
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

export function renderPreviewModel(content, g) {
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

export async function renderPreviewTex2d(content, g) {
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
