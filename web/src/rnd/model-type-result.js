/**
 * matoga - MC 模型：RenderModelTypeResult
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 从 mc-model-viewer.js 按领域搬出（正文逐字未改）。
 * 职责：模型分类结果表格渲染与贴图对比面板
 */

import { $, state, onlyMissingChk } from '../core.js'
import { applyCategoryFilter } from '../rnd/category-bar.js'
import { applyResultSearch } from '../rnd/search.js'
import { sortResult } from '../compare.js'
import { t } from '../i18n.js'
import {
  modelNsOf,
  modelFormatOf,
  modelTexBucketOf,
  modelAnimatedOf,
  modelNameBucketOf,
  modelPrefixBucketOf,
  modelCustomGroupOf,
  modelTypeOf,
  contentKindOfPath,
  fileUrl,
  escAttr,
  openPreview
} from '../utils.js'
import { escHtml, isModelEntry } from '../model-diff.js'
import { appendGroupRows, renderModelThumbPair, modelThumbSpec, statusBadge } from '../rnd/table-rows.js'
import { observeThumbs } from '../thumb-loader.js'
import { observeModelThumbs } from '../model-thumb.js'
import { resolveModelTexList, textureAssetPath } from '../mc-model-viewer.js'
import { renderMaterialPreviewHtml, bindPreviewImages, bindEmptyCellActions } from '../rnd/preview.js'

/* 主文件函数（注入） */
let _selectGroup = (...a) => undefined
let _renderSidebar = (...a) => undefined

export function setHooks(h) {
  if (h.selectGroup) _selectGroup = h.selectGroup
  if (h.renderSidebar) _renderSidebar = h.renderSidebar
}

export function renderModelTypeResult() {
  const body = $('modelResultBody')
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
  models = applyResultSearch(models)
  sortResult(models)
  if (models.length === 0) {
    let msg
    if (!state.leftPath || !state.rightPath) msg = t('render.dragHint')
    else if (result.length === 0) msg = t('render.bothEmpty')
    else if (state.resultSearchTerm && state.resultSearchTerm.trim()) {
      const baseModels = applyResultSearch(
        applyCategoryFilter(
          result
            .filter(g => g.isModel)
            .filter(g => !onlyMissingChk.checked || g.kind !== 'have')
            .filter(g => !state.hiddenKeys.has(g.key))
        )
      )
      msg = baseModels.length ? t('categoryFilter.noMatch', { q: state.resultSearchTerm.trim() }) : t('render.noModel')
    } else msg = t('render.noModel')
    body.innerHTML = `<tr class="empty-row"><td colspan="8">${msg}</td></tr>`
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
            : ['extra', 'miss', 'partial', 'diff', 'have']
          ).filter(k => catMap.has(k))
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
    const ftr = document.createElement('tr')
    ftr.className = 'folder-group-row'
    ftr.innerHTML = `<td colspan="8"><span class="folder-arrow">${collapsed ? '▸' : '▾'}</span><svg class="ico ico-sm"><use href="#i-cube"/></svg><span class="folder-name">${escHtml(catLabel)}</span><span class="folder-count">${t('render.modelTypeCount', { n: items.length })}</span><span class="folder-summary">${buildSummary(items)}</span></td>`
    ftr.addEventListener('click', () => {
      if (state.collapsedFolders.has(catKey)) state.collapsedFolders.delete(catKey)
      else state.collapsedFolders.add(catKey)
      renderModelTypeResult()
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
  if (truncated) {
    const moreRow = document.createElement('tr')
    moreRow.className = 'show-more-row'
    moreRow.innerHTML = `<td colspan="8" style="text-align:center;padding:8px;"><button class="btn btn-ghost btn-sm">${t('render.showMore', { rendered, total: models.length })}</button></td>`
    moreRow.querySelector('button').addEventListener('click', () => {
      state.renderLimit += 200
      renderModelTypeResult()
    })
    frag.appendChild(moreRow)
  }
  body.innerHTML = ''
  body.appendChild(frag)
  for (const tr of body.children) {
    const g = tr._group
    if (!g || !g.isModel) continue
    const nameCell = tr.children[2]
    if (nameCell && !nameCell.querySelector('.expand-arrow')) {
      const arrow = document.createElement('span')
      arrow.className = 'expand-arrow'
      arrow.textContent = state.expandedKeys.has(g.key) ? '▾' : '▸'
      nameCell.prepend(arrow)
    }
    tr.addEventListener('click', () => {
      if (state.expandedKeys.has(g.key)) state.expandedKeys.delete(g.key)
      else state.expandedKeys.add(g.key)
      renderModelTypeResult()
    })
    if (state.expandedKeys.has(g.key)) {
      const sub = document.createElement('tr')
      sub.className = 'mc-tex-sub-row'
      sub.innerHTML = `<td colspan="8"><div class="mc-tex-wrap"></div></td>`
      tr.after(sub)
      loadModelTexComparePanel(sub, g)
    }
  }
  observeThumbs(body)
  observeModelThumbs(body)
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
      _selectGroup(g)
    })
  })
  observeModelThumbs(content)
}

export async function loadModelTexComparePanel(row, g) {
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
    for (const it of items) bodyEl.appendChild(buildTexCompareRow(it, g))
    frag.appendChild(catEl)
  }
  wrap.innerHTML = ''
  wrap.appendChild(frag)
  observeThumbs(wrap)
}

export function buildTexCompareRow(it) {
  const row = document.createElement('div')
  row.className = 'mc-tex-row row-' + it.kind
  const thumbL = it.leftUrl
    ? `<img class="thumb thumb-left" src="${escAttr(it.leftUrl)}" loading="lazy" alt="" />`
    : `<span class="thumb-ph thumb-left-ph">L</span>`
  const thumbR = it.rightUrl
    ? `<img class="thumb thumb-right" src="${escAttr(it.rightUrl)}" loading="lazy" alt="" />`
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
      _renderSidebar()
    })
  return row
}

export async function loadModelTex2dPreview(container, g) {
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
