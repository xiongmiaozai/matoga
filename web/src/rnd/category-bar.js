/**
 * matoga - 材质贴图对比工具
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 从 render.js L777-L897 原样搬出（正文逐字未改）。
 * 段外本地符号经 setHooks 注入：bindResultSearch, buildCatRow, renderResult
 * 以及 _lastBaseSet 的 getter/setter。
 */

import { state, $ } from '../core.js'
import { folderOf, groupTypeOf, groupContentKind, groupTagOf } from '../utils.js'
import { saveOptions } from '../actions.js'

/* 以下变量由主模块经 setHooks 注入。正文按裸标识符引用，故模块级声明。 */
/* _getLastBaseSet() 是主文件的可变状态：用 getter/setter 转发，
   直接注入副本会导致两边的赋值互不可见。 */
let _getLastBaseSet = () => []
let _setLastBaseSet = () => {}
let bindResultSearch
let buildCatRow
let renderResult
export function setHooks(h) {
  if (h.getLastBaseSet) _getLastBaseSet = h.getLastBaseSet
  if (h.setLastBaseSet) _setLastBaseSet = h.setLastBaseSet
  bindResultSearch = h.bindResultSearch
  buildCatRow = h.buildCatRow
  renderResult = h.renderResult
}

export function renderCategoryBar(baseSet) {
  _setLastBaseSet(baseSet || [])
  const bar = $('categoryBar')
  if (!bar) return
  const f = state.categoryFilter || { type: 'all', content: 'all', status: 'all', folder: 'all', tag: 'all' }
  bindResultSearch()
  const total = _getLastBaseSet().length
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
  for (const g of _getLastBaseSet()) {
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
