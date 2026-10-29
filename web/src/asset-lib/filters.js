/**
 * matoga - 总资产库：filters
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 从 asset-library.js 原样搬出，逻辑未改。
 */
import { t, onLocaleChange } from '../i18n.js'
import { ensureModelThumb, observeModelThumbs } from '../model-thumb.js'
import { el, shade, loadList, saveList } from './dom.js'
import { S, BROWSE_CLICK_DELAY } from './store.js'
import { buildSection } from './collapse.js'
import { itemFromStored } from './items.js'
import { buildProjectSection } from './projects.js'
import { buildPresetSection } from './presets.js'
import { buildTexSection } from './sections-tex.js'
import { buildHdriSection, buildMcSection, buildModelSection } from './sections-model.js'
import { buildOfficialSection } from './sections-official.js'
import { QUICK_CATS, SECTION_CATS, categoryLabel } from './helpers.js'

function buildFavSection() {
  if (!S.favorites.length) return null
  return buildSection('fav', t('asset.favSection'), S.favorites.map(itemFromStored), null, false)
}

function buildRecentSection() {
  if (!S.recent.length) return null
  return buildSection('recent', t('asset.recentSection'), S.recent.map(itemFromStored), null, false)
}

export function rebuild() {
  const body = document.getElementById('assetLibraryBody')
  if (!body) return
  if (S.browse) return /* 包内容浏览模式独占列表区 */
  const scrollTop = body.scrollTop
  body.innerHTML = ''
  const sections = [
    buildFavSection(),
    buildRecentSection(),
    buildProjectSection(),
    buildPresetSection(),
    buildTexSection(),
    buildModelSection(),
    buildHdriSection(),
    buildMcSection(),
    buildOfficialSection(),
  ].filter(Boolean)
  for (const s of sections) body.appendChild(s)
  body.scrollTop = scrollTop
  observeModelThumbs(body)
  applyFilter()
}

export function applyFilter() {
  const body = document.getElementById('assetLibraryBody')
  if (!body) return
  if (S.browse) return
  const term = S.searchTerm.toLowerCase()
  const searching = !!term
  const kind = S.contentKindFilter

  /* 卡片：命中名称（搜索词）且符合方块/物品过滤才显示 */
  body.querySelectorAll('.asset-card').forEach(card => {
    const name = (card.dataset.name || '').toLowerCase()
    const nameOk = !searching || name.includes(term)
    const kindOk = kind === 'all' || card.dataset.kind === kind
    card.classList.toggle('is-hidden', !nameOk || !kindOk)
  })

  /* 分组：组内无可见卡片则整组隐藏；搜索命中时临时展开折叠分组，保证结果可见 */
  body.querySelectorAll('.asset-lib-group').forEach(grp => {
    const hit = !!grp.querySelector('.asset-card:not(.is-hidden)')
    grp.classList.toggle('is-hidden', !hit)
    grp.classList.toggle('search-open', searching && hit)
  })

  /* 分区：非搜索时按当前分类标签过滤；搜索时跨分类展示（快捷视图分区不重复展示） */
  let visible = 0
  body.querySelectorAll('.asset-lib-section').forEach(sec => {
    const cat = sec.dataset.cat
    const catOk = searching
      ? !QUICK_CATS.has(cat)
      : (S.categoryFilter === 'all' ? SECTION_CATS.includes(cat) : cat === S.categoryFilter)
    const hit = !!sec.querySelector('.asset-card:not(.is-hidden)')
    const hint = !!sec.querySelector('.asset-lib-hint')
    sec.classList.toggle('is-hidden', !catOk || (!hit && !hint))
    sec.classList.toggle('search-open', searching && hit)
    if (catOk) visible += sec.querySelectorAll('.asset-card:not(.is-hidden)').length
  })

  updateStat(visible)
  const hasVisibleHint = !!body.querySelector('.asset-lib-section:not(.is-hidden) .asset-lib-hint')
  let empty = body.querySelector('.asset-lib-empty')
  if (visible === 0 && !hasVisibleHint) {
    if (!empty) { empty = el('div', 'asset-lib-empty'); body.appendChild(empty) }
    let msg
    if (term) msg = t('asset.emptyFiltered')
    else if (S.contentKindFilter !== 'all') msg = t('asset.emptyKind', { kind: t(S.contentKindFilter === 'block' ? 'asset.kindBlock' : 'asset.kindItem') })
    else if (S.categoryFilter !== 'all') msg = t('asset.emptyCategory', { cat: categoryLabel(S.categoryFilter) })
    else msg = t('asset.empty')
    empty.textContent = msg
    empty.style.display = ''
  } else if (empty) {
    empty.style.display = 'none'
  }
}

function updateStat(n) {
  const stat = document.querySelector('.asset-lib-stat')
  if (stat) stat.textContent = t('asset.statTotal', { n })
}

