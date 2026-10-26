/**
 * matoga - 总资产库：collapse
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 从 asset-library.js 原样搬出，逻辑未改。
 */
import { t, onLocaleChange } from '../i18n.js'
import { el, shade, loadList, saveList } from './dom.js'
import { S, BROWSE_CLICK_DELAY } from './store.js'
import { sortItems } from './items.js'
import { makeCard } from './card.js'

function loadCollapsed() {
  try { return new Set(JSON.parse(localStorage.getItem('matoga:assetCollapsed')) || []) } catch { return new Set() }
}
export function saveCollapsed(set) {
  try { localStorage.setItem('matoga:assetCollapsed', JSON.stringify([...set])) } catch {}
}
export let collapsedSet = loadCollapsed()

/* 贴图子分组（文件夹/包类别）的折叠状态 */
function loadTexCollapsed() {
  try { return new Set(JSON.parse(localStorage.getItem('matoga:assetTexCollapsed')) || []) } catch { return new Set() }
}
export function saveTexCollapsed(set) {
  try { localStorage.setItem('matoga:assetTexCollapsed', JSON.stringify([...set])) } catch {}
}
export let texCollapsedSet = loadTexCollapsed()

/* 模型子分组（导入 / 自定义 / 包类别）的折叠状态 */
function loadModelCollapsed() {
  try { return new Set(JSON.parse(localStorage.getItem('matoga:assetModelCollapsed')) || []) } catch { return new Set() }
}
export function saveModelCollapsed(set) {
  try { localStorage.setItem('matoga:assetModelCollapsed', JSON.stringify([...set])) } catch {}
}
export let modelCollapsedSet = loadModelCollapsed()

export function buildSection(catKey, title, items, errMsg, loading) {
  const sorted = sortItems(items)
  const count = sorted.length
  const sec = el('div', 'asset-lib-section')
  sec.dataset.cat = catKey
  if (collapsedSet.has(catKey)) sec.classList.add('collapsed')
  const head = el('div', 'asset-lib-section-head',
    `<span class="caret">▾</span><span>${title}</span><span class="cnt">${count}</span>`)
  head.addEventListener('click', () => {
    sec.classList.toggle('collapsed')
    if (sec.classList.contains('collapsed')) { collapsedSet.add(catKey); saveCollapsed(collapsedSet) }
    else { collapsedSet.delete(catKey); saveCollapsed(collapsedSet) }
  })
  sec.appendChild(head)
  const grid = el('div', 'asset-lib-grid')
  if (S.viewMode === 'list') grid.classList.add('list-view')
  if (loading && !count) {
    grid.appendChild(el('div', 'asset-lib-hint', t('asset.loading')))
  } else if (errMsg && !count) {
    grid.appendChild(el('div', 'asset-lib-hint error', t('asset.loadFailed', { msg: errMsg })))
  } else if (!count) {
    return null
  } else {
    for (const it of sorted) grid.appendChild(makeCard(it))
  }
  sec.appendChild(grid)
  return sec
}

