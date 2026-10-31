/**
 * matoga - MC 模型：AssetToolbar
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 从 mc-model-viewer.js 按领域搬出（正文逐字未改）。
 * 职责：工具栏与过滤（分类/排序/搜索过滤/轮询）
 */

import { enCandidatesOfZh } from '../zh-names.js'
import { assetSearchMatch } from '../asset-search.js'
import { t } from '../i18n.js'
import { state } from '../core.js'

/* 主文件函数（注入） */
let _el = (...a) => undefined
let _categoryLabel = (...a) => undefined
let _rebuild = (...a) => undefined

/* 模块状态：只读用 getter；可写用 get/set 成对（§2.2） */
let _get_browse = () => undefined
let _get_searchTerm = () => undefined
let _get_QUICK_CATS = () => undefined
let _get_SECTION_CATS = () => undefined
let _get_recent = () => undefined
let _get_contentKindFilter = () => undefined
let _set_contentKindFilter = () => {}
let _get_categoryFilter = () => undefined
let _set_categoryFilter = () => {}
let _get_pollTimer = () => undefined
let _set_pollTimer = () => {}
let _get_lastTexSig = () => undefined
let _set_lastTexSig = () => {}
let _get_sortKey = () => undefined
let _set_sortKey = () => {}
let _get_sortDir = () => undefined
let _set_sortDir = () => {}
let _get_viewMode = () => undefined
let _set_viewMode = () => {}

export function setHooks(h) {
  if (h.el) _el = h.el
  if (h.categoryLabel) _categoryLabel = h.categoryLabel
  if (h.rebuild) _rebuild = h.rebuild
  if (h.get_browse) _get_browse = h.get_browse
  if (h.get_searchTerm) _get_searchTerm = h.get_searchTerm
  if (h.get_QUICK_CATS) _get_QUICK_CATS = h.get_QUICK_CATS
  if (h.get_SECTION_CATS) _get_SECTION_CATS = h.get_SECTION_CATS
  if (h.get_recent) _get_recent = h.get_recent
  if (h.get_contentKindFilter) _get_contentKindFilter = h.get_contentKindFilter
  if (h.set_contentKindFilter) _set_contentKindFilter = h.set_contentKindFilter
  if (h.get_categoryFilter) _get_categoryFilter = h.get_categoryFilter
  if (h.set_categoryFilter) _set_categoryFilter = h.set_categoryFilter
  if (h.get_pollTimer) _get_pollTimer = h.get_pollTimer
  if (h.set_pollTimer) _set_pollTimer = h.set_pollTimer
  if (h.get_lastTexSig) _get_lastTexSig = h.get_lastTexSig
  if (h.set_lastTexSig) _set_lastTexSig = h.set_lastTexSig
  if (h.get_sortKey) _get_sortKey = h.get_sortKey
  if (h.set_sortKey) _set_sortKey = h.set_sortKey
  if (h.get_sortDir) _get_sortDir = h.get_sortDir
  if (h.set_sortDir) _set_sortDir = h.set_sortDir
  if (h.get_viewMode) _get_viewMode = h.get_viewMode
  if (h.set_viewMode) _set_viewMode = h.set_viewMode
}

export function applyFilter() {
  const body = document.getElementById('assetLibraryBody')
  if (!body) return
  if (_get_browse()) return
  const term = _get_searchTerm().trim()
  const searching = !!term
  const termLower = term.toLowerCase()
  const enCands = searching ? enCandidatesOfZh(term) : []
  const kind = _get_contentKindFilter()

  const groupVisible = new Set()
  const secVisible = new Set()
  const secCount = new Map()

  /* 卡片：单次遍历，命中名称（搜索词）且符合方块/物品过滤才显示；同时累加组/分区可见计数 */
  const cards = body.querySelectorAll('.asset-card')
  for (let i = 0; i < cards.length; i++) {
    const card = cards[i]
    const name = (card.dataset.name || '').toLowerCase()
    const zh = (card.dataset.zhName || '').toLowerCase()
    const py = (card.dataset.pinyin || '').toLowerCase()
    const nameOk = !searching || assetSearchMatch(name, zh, py, enCands, termLower)
    const kindOk = kind === 'all' || card.dataset.kind === kind
    const show = nameOk && kindOk
    card.classList.toggle('is-hidden', !show)
    if (!show) continue
    const grp = card.closest('.asset-lib-group')
    if (grp) groupVisible.add(grp)
    const sec = card.closest('.asset-lib-section')
    if (sec) {
      secVisible.add(sec)
      secCount.set(sec, (secCount.get(sec) || 0) + 1)
    }
  }

  /* 分组：组内无可见卡片则整组隐藏；搜索命中时临时展开折叠分组 */
  const groups = body.querySelectorAll('.asset-lib-group')
  for (let i = 0; i < groups.length; i++) {
    const grp = groups[i]
    const hit = groupVisible.has(grp)
    grp.classList.toggle('is-hidden', !hit)
    grp.classList.toggle('search-open', searching && hit)
  }

  /* 分区：非搜索时按当前分类标签过滤；搜索时跨分类展示 */
  let visible = 0
  const sections = body.querySelectorAll('.asset-lib-section')
  for (let i = 0; i < sections.length; i++) {
    const sec = sections[i]
    const cat = sec.dataset.cat
    const catOk = searching
      ? !_get_QUICK_CATS().has(cat)
      : _get_categoryFilter() === 'all'
        ? _get_SECTION_CATS().includes(cat)
        : cat === _get_categoryFilter()
    const hit = secVisible.has(sec)
    const hint = !!sec.querySelector('.asset-lib-hint')
    sec.classList.toggle('is-hidden', !catOk || (!hit && !hint))
    sec.classList.toggle('search-open', searching && hit)
    if (catOk && hit) visible += secCount.get(sec) || 0
  }

  updateStat(visible)
  const hasVisibleHint = !!body.querySelector('.asset-lib-section:not(.is-hidden) .asset-lib-hint')
  let empty = body.querySelector('.asset-lib-empty')
  if (visible === 0 && !hasVisibleHint) {
    if (!empty) {
      empty = _el('div', 'asset-lib-empty')
      body.appendChild(empty)
    }
    let msg
    if (term) msg = t('asset.emptyFiltered')
    else if (_get_contentKindFilter() !== 'all')
      msg = t('asset.emptyKind', {
        kind: t(_get_contentKindFilter() === 'block' ? 'asset.kindBlock' : 'asset.kindItem')
      })
    else if (_get_categoryFilter() !== 'all')
      msg = t('asset.emptyCategory', { cat: _categoryLabel(_get_categoryFilter()) })
    else msg = t('asset.empty')
    empty.textContent = msg
    empty.style.display = ''
  } else if (empty) {
    empty.style.display = 'none'
  }
}

export function updateStat(n) {
  const stat = document.querySelector('.asset-lib-stat')
  if (stat) stat.textContent = t('asset.statTotal', { n })
}

export function sigEntries() {
  let s = 0
  for (const e of state.leftEntries || []) s += e.mtime || 0
  for (const e of state.rightEntries || []) s += e.mtime || 0
  return (state.leftEntries?.length || 0) + ':' + (state.rightEntries?.length || 0) + ':' + s
}

export function startPoll() {
  if (_get_pollTimer()) return
  _set_pollTimer(
    setInterval(() => {
      const sig = sigEntries()
      if (sig !== _get_lastTexSig()) {
        _set_lastTexSig(sig)
        _rebuild()
      }
    }, 1500)
  )
}

export function buildToolbar() {
  const bar = document.getElementById('assetLibToolbar')
  if (!bar) return
  bar.innerHTML = ''

  const quickCats = [
    ['fav', 'i-star', t('asset.catFav')],
    ['recent', 'i-clock', t('asset.catRecent')]
  ]
  const fullCats = [
    ['all', 'i-folder', t('asset.catAll')],
    ['project', 'i-layers', t('asset.catProject')],
    ['preset', 'i-sliders', t('asset.catPreset')],
    ['tex', 'i-image', t('asset.catTex')],
    ['model', 'i-cube', t('asset.catModel')],
    ['hdri', 'i-palette', t('asset.catHdri')],
    ['mc', 'i-box', t('asset.catMc')],
    ['official', 'i-box', t('asset.catOfficial')]
  ]
  const catLabel = v => [...quickCats, ...fullCats].find(c => c[0] === v)?.[2] || v

  const sortLabel = v => sortOptions.find(s => s[0] === v)?.[2] || v
  const sortOptions = [
    ['name', 'i-arrow-down', t('asset.sortName')],
    ['mtime', 'i-clock', t('asset.sortMtime')],

    ['fav', 'i-star', t('asset.sortFav')]
  ]

  const quickGroup = _el('div', 'asset-lib-tags')
  for (const [v, icon, label] of quickCats) {
    const btn = _el('button', 'asset-lib-tag icon-only' + (_get_categoryFilter() === v ? ' active' : ''))
    btn.innerHTML = `<svg class="ico ico-sm"><use href="#${icon}"/></svg>`
    btn.title = label
    btn.dataset.cat = v
    btn.addEventListener('click', () => {
      _set_categoryFilter(v)
      syncFilterChip()
      _rebuild()
    })
    quickGroup.appendChild(btn)
  }
  bar.appendChild(quickGroup)

  const filterChip = _el(
    'button',
    'asset-lib-chip' + (_get_categoryFilter() !== 'all' || _get_contentKindFilter() !== 'all' ? ' active' : '')
  )
  filterChip.innerHTML = `<svg class="ico ico-sm"><use href="#i-filter"/></svg><span class="chip-label">${catLabel(_get_categoryFilter())}</span><svg class="ico ico-sm chip-caret"><use href="#i-chevron-down"/></svg>`
  filterChip.title = t('asset.filterTitle')
  filterChip.setAttribute('aria-haspopup', 'true')
  filterChip.setAttribute('aria-expanded', 'false')

  const popover = _el('div', 'asset-lib-popover')
  popover.setAttribute('role', 'menu')
  const popCats = _el('div', 'asset-lib-pop-cats')
  for (const [v, icon, label] of fullCats) {
    const btn = _el('button', 'asset-lib-pop-tag' + (_get_categoryFilter() === v ? ' active' : ''))
    btn.innerHTML = `<svg class="ico ico-sm"><use href="#${icon}"/></svg><span>${label}</span>`
    btn.dataset.cat = v
    btn.addEventListener('click', () => {
      _set_categoryFilter(v)
      popCats.querySelectorAll('.asset-lib-pop-tag').forEach(b => b.classList.toggle('active', b.dataset.cat === v))
      syncFilterChip()
      _rebuild()
    })
    popCats.appendChild(btn)
  }
  popover.appendChild(popCats)

  popover.appendChild(_el('div', 'asset-lib-pop-sep'))

  const kindGroup = _el('div', 'asset-lib-pop-kind')
  for (const [v, icon, label] of [
    ['block', 'i-box', t('asset.kindBlock')],
    ['item', 'i-cube', t('asset.kindItem')]
  ]) {
    const btn = _el('button', 'asset-lib-pop-tag' + (_get_contentKindFilter() === v ? ' active' : ''))
    btn.innerHTML = `<svg class="ico ico-sm"><use href="#${icon}"/></svg><span>${label}</span>`
    btn.dataset.kind = v
    btn.title = t('asset.kindFilterTitle')
    btn.addEventListener('click', () => {
      _set_contentKindFilter(_get_contentKindFilter() === v ? 'all' : v)
      kindGroup
        .querySelectorAll('.asset-lib-pop-tag')
        .forEach(b => b.classList.toggle('active', b.dataset.kind === _get_contentKindFilter()))
      syncFilterChip()
      applyFilter()
    })
    kindGroup.appendChild(btn)
  }
  popover.appendChild(kindGroup)

  popover.appendChild(_el('div', 'asset-lib-pop-sep'))

  const sortGroup = _el('div', 'asset-lib-pop-sort')
  const sortTags = _el('div', 'asset-lib-pop-sort-tags')
  for (const [v, icon, label] of sortOptions) {
    const btn = _el('button', 'asset-lib-pop-tag' + (_get_sortKey() === v ? ' active' : ''))
    btn.innerHTML = `<svg class="ico ico-sm"><use href="#${icon}"/></svg><span>${label}</span>`
    btn.dataset.sort = v
    btn.addEventListener('click', () => {
      _set_sortKey(v)
      sortTags.querySelectorAll('.asset-lib-pop-tag').forEach(b => b.classList.toggle('active', b.dataset.sort === v))
      syncFilterChip()
      _rebuild()
    })
    sortTags.appendChild(btn)
  }
  sortGroup.appendChild(sortTags)
  const dirBtn = _el('button', 'asset-lib-pop-dir' + (_get_sortDir() === 'desc' ? ' desc' : ''))
  dirBtn.title = t('asset.sortDirTitle')
  dirBtn.innerHTML = '<svg class="ico ico-sm"><use href="#i-arrow-up"/></svg>'
  dirBtn.addEventListener('click', () => {
    _set_sortDir(_get_sortDir() === 'asc' ? 'desc' : 'asc')
    dirBtn.classList.toggle('desc', _get_sortDir() === 'desc')
    syncFilterChip()
    _rebuild()
  })
  sortGroup.appendChild(dirBtn)
  popover.appendChild(sortGroup)

  for (const stale of document.querySelectorAll('body > .asset-lib-popover')) stale.remove()
  const chipWrap = _el('div', 'asset-lib-chip-wrap')
  chipWrap.appendChild(filterChip)
  document.body.appendChild(popover)
  bar.appendChild(chipWrap)

  const placePopover = () => {
    const r = filterChip.getBoundingClientRect()
    popover.style.top = r.bottom + 4 + 'px'
    popover.style.left = r.left + 'px'
  }
  const togglePopover = open => {
    const isOpen = open === undefined ? !popover.classList.contains('open') : open
    popover.classList.toggle('open', isOpen)
    filterChip.classList.toggle('open', isOpen)
    filterChip.setAttribute('aria-expanded', String(isOpen))
    if (isOpen) {
      placePopover()
      document.addEventListener('mousedown', onOutside)
      window.addEventListener('resize', placePopover)
      window.addEventListener('scroll', placePopover, true)
    } else {
      document.removeEventListener('mousedown', onOutside)
      window.removeEventListener('resize', placePopover)
      window.removeEventListener('scroll', placePopover, true)
    }
  }
  const onOutside = e => {
    if (!chipWrap.contains(e.target) && !popover.contains(e.target)) togglePopover(false)
  }
  filterChip.addEventListener('click', e => {
    e.stopPropagation()
    togglePopover()
  })

  function syncFilterChip() {
    const lbl = filterChip.querySelector('.chip-label')
    if (lbl) lbl.textContent = catLabel(_get_categoryFilter())
    const hasActive =
      _get_categoryFilter() !== 'all' ||
      _get_contentKindFilter() !== 'all' ||
      _get_sortKey() !== 'name' ||
      _get_sortDir() !== 'asc'
    filterChip.classList.toggle('active', hasActive)
  }

  const right = _el('div', 'asset-lib-toolbar-right')
  const btnGroup = _el('div', 'asset-lib-btn-group')
  const viewBtn = _el('button', 'asset-lib-btn')
  viewBtn.title = t('asset.viewToggleTitle')
  viewBtn.innerHTML =
    '<svg class="ico ico-sm"><use href="#i-' + (_get_viewMode() === 'grid' ? 'grid' : 'list') + '"/></svg>'
  viewBtn.addEventListener('click', () => {
    _set_viewMode(_get_viewMode() === 'grid' ? 'list' : 'grid')
    viewBtn.querySelector('use').setAttribute('href', '#i-' + (_get_viewMode() === 'grid' ? 'grid' : 'list'))
    _rebuild()
  })
  btnGroup.appendChild(viewBtn)
  btnGroup.appendChild(_el('span', 'asset-lib-stat', ''))
  right.appendChild(btnGroup)

  bar.appendChild(right)
}
