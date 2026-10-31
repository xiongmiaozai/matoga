/**
 * matoga - 材质贴图对比工具
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 从 render.js L351-L511 原样搬出（正文逐字未改）。
 * 段外本地符号经 setHooks 注入：applyCategoryFilter, applyResultSearch
 */

import { state, $, onlyMissingChk } from '../core.js'
import {
  modelTypeOf,
  modelNsOf,
  modelFormatOf,
  modelTexBucketOf,
  modelAnimatedOf,
  modelCustomGroupOf,
  modelNameBucketOf,
  modelPrefixBucketOf
} from '../utils.js'
import { sortResult } from '../compare.js'
import { observeThumbs } from '../thumb-loader.js'
import { observeModelThumbs, prefetchModelThumbs } from '../model-thumb.js'
import { t } from '../i18n.js'
import { appendModelGridCard, buildModelDetailPanel, appendModelCompareRow } from '../rnd/model-cards.js'

/* 以下变量由主模块经 setHooks 注入。正文按裸标识符引用，故模块级声明。 */
let applyCategoryFilter
let applyResultSearch
export function setHooks(h) {
  applyCategoryFilter = h.applyCategoryFilter
  applyResultSearch = h.applyResultSearch
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
  const grid = state.modelViewMode !== 'list'

  const toolbar = document.createElement('div')
  toolbar.className = 'mc-toolbar'
  toolbar.innerHTML =
    `<div class="mc-view-seg">` +
    `<button class="mc-view-btn${grid ? ' on' : ''}" data-mc-view="grid">${t('render.viewModelGrid')}</button>` +
    `<button class="mc-view-btn${!grid ? ' on' : ''}" data-mc-view="list">${t('render.viewModelList')}</button>` +
    `</div>`
  toolbar.querySelectorAll('[data-mc-view]').forEach(b =>
    b.addEventListener('click', () => {
      state.modelViewMode = b.dataset.mcView
      renderModelTypeResult()
    })
  )

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
