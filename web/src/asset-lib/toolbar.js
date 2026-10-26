/**
 * matoga - 总资产库：toolbar
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 从 asset-library.js 原样搬出，逻辑未改。
 */
import { state, IMG_EXTS, showToast } from '../core.js'
import { t, onLocaleChange } from '../i18n.js'
import { el, shade, loadList, saveList } from './dom.js'
import { S, BROWSE_CLICK_DELAY } from './store.js'
import { applyFilter, rebuild } from './filters.js'

export function sigEntries() {
  let s = 0
  for (const e of state.leftEntries || []) s += (e.mtime || 0)
  for (const e of state.rightEntries || []) s += (e.mtime || 0)
  return (state.leftEntries?.length || 0) + ':' + (state.rightEntries?.length || 0) + ':' + s
}

export function startPoll() {
  if (S.pollTimer) return
  S.pollTimer = setInterval(() => {
    const sig = sigEntries()
    if (sig !== S.lastTexSig) { S.lastTexSig = sig; rebuild() }
  }, 1500)
}

export function buildToolbar() {
  const bar = document.getElementById('assetLibToolbar')
  if (!bar) return
  bar.innerHTML = ''

  const cats = [['all', t('asset.catAll')], ['project', t('asset.catProject')], ['tex', t('asset.catTex')], ['model', t('asset.catModel')], ['hdri', t('asset.catHdri')], ['mc', t('asset.catMc')], ['official', t('asset.catOfficial')], ['preset', t('asset.catPreset')], ['fav', t('asset.catFav')], ['recent', t('asset.catRecent')]]
  const catGroup = el('div', 'asset-lib-tags')
  for (const [v, label] of cats) {
    const btn = el('button', 'asset-lib-tag' + (S.categoryFilter === v ? ' active' : ''), label)
    btn.dataset.cat = v
    btn.addEventListener('click', () => {
      S.categoryFilter = v
      catGroup.querySelectorAll('.asset-lib-tag').forEach(b => b.classList.toggle('active', b.dataset.cat === v))
      rebuild()
    })
    catGroup.appendChild(btn)
  }
  bar.appendChild(catGroup)

  const right = el('div', 'asset-lib-toolbar-right')
  /* 方块/物品切换：与分类标签正交，单选 toggle（再次点击取消） */
  const kindGroup = el('div', 'asset-lib-tags asset-lib-kind')
  for (const [v, label] of [['block', t('asset.kindBlock')], ['item', t('asset.kindItem')]]) {
    const btn = el('button', 'asset-lib-tag' + (S.contentKindFilter === v ? ' active' : ''), label)
    btn.dataset.kind = v
    btn.title = t('asset.kindFilterTitle')
    btn.addEventListener('click', () => {
      S.contentKindFilter = S.contentKindFilter === v ? 'all' : v
      kindGroup.querySelectorAll('.asset-lib-tag').forEach(b => b.classList.toggle('active', b.dataset.kind === S.contentKindFilter))
      applyFilter()
    })
    kindGroup.appendChild(btn)
  }
  right.appendChild(kindGroup)
  const sort = el('select', 'asset-lib-sel')
  for (const [v, label] of [['name', t('asset.sortName')], ['mtime', t('asset.sortMtime')]]) {
    const o = el('option'); o.value = v; o.textContent = label; sort.appendChild(o)
  }
  sort.value = S.sortKey
  sort.addEventListener('change', () => { S.sortKey = sort.value; rebuild() })
  const sortWrap = el('div', 'asset-lib-sel-wrap')
  sortWrap.appendChild(sort)
  right.appendChild(sortWrap)

  const btnGroup = el('div', 'asset-lib-btn-group')

  const dirBtn = el('button', 'asset-lib-btn' + (S.sortDir === 'desc' ? ' desc' : ''))
  dirBtn.title = t('asset.sortDirTitle')
  dirBtn.innerHTML = '<svg class="ico ico-sm"><use href="#i-arrow-up"/></svg>'
  dirBtn.addEventListener('click', () => {
    S.sortDir = S.sortDir === 'asc' ? 'desc' : 'asc'
    dirBtn.classList.toggle('desc', S.sortDir === 'desc')
    rebuild()
  })
  btnGroup.appendChild(dirBtn)

  const viewBtn = el('button', 'asset-lib-btn')
  viewBtn.title = t('asset.viewToggleTitle')
  viewBtn.innerHTML = '<svg class="ico ico-sm"><use href="#i-' + (S.viewMode === 'grid' ? 'grid' : 'list') + '"/></svg>'
  viewBtn.addEventListener('click', () => {
    S.viewMode = S.viewMode === 'grid' ? 'list' : 'grid'
    viewBtn.querySelector('use').setAttribute('href', '#i-' + (S.viewMode === 'grid' ? 'grid' : 'list'))
    rebuild()
  })
  btnGroup.appendChild(viewBtn)
  right.appendChild(btnGroup)

  right.appendChild(el('div', 'asset-lib-stat', ''))
  bar.appendChild(right)
  requestAnimationFrame(() => {
    catGroup.classList.toggle('has-overflow', catGroup.scrollWidth > catGroup.clientWidth + 1)
  })
}

