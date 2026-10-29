/**
 * matoga - 材质 3D 视口：model-result
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
import { observeThumbs } from '../thumb-loader.js'
import { observeModelThumbs } from '../model-thumb.js'
import { t, onLocaleChange } from '../i18n.js'
import { modelPrefixOf } from '../model-prefix.js'
import { appendModelCard, modelThumbSpec, renderModelThumbPair } from './model-cards.js'
import { escHtml } from '../model-diff.js'

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

