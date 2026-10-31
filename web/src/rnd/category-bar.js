/**
 * matoga - MC 模型：RenderCategoryBar
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 从 mc-model-viewer.js 按领域搬出（正文逐字未改）。
 * 职责：分类过滤栏（类型/内容/状态/文件夹/标签维度）
 */

import { state, $ } from '../core.js'
import { groupTypeOf, groupContentKind, folderOf, groupTagOf, escAttr } from '../utils.js'
import { t } from '../i18n.js'
import { escHtml } from '../model-diff.js'
import { bindResultSearch } from '../rnd/search.js'
import { saveOptions } from '../actions.js'

/* 主文件函数（注入） */
let _renderResult = (...a) => undefined

/* 模块状态：只读用 getter；可写用 get/set 成对（§2.2） */
let _get__lastBaseSet = () => undefined
let _set__lastBaseSet = () => {}

export function setHooks(h) {
  if (h.renderResult) _renderResult = h.renderResult
  if (h.get__lastBaseSet) _get__lastBaseSet = h.get__lastBaseSet
  if (h.set__lastBaseSet) _set__lastBaseSet = h.set__lastBaseSet
}

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

export function renderCategoryBar(baseSet) {
  _set__lastBaseSet(baseSet || [])
  const bar = $('categoryBar')
  if (!bar) return
  const f = state.categoryFilter || { type: 'all', content: 'all', status: 'all', folder: 'all', tag: 'all' }
  bindResultSearch()
  const total = _get__lastBaseSet().length
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
  for (const g of _get__lastBaseSet()) {
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
      _renderResult()
    })
  })
  bar.querySelectorAll('.cat-select').forEach(sel => {
    sel.addEventListener('change', () => {
      const dim = sel.dataset.dim
      state.categoryFilter[dim] = sel.value
      state.renderLimit = 200
      saveOptions()
      _renderResult()
    })
  })
}
