/**
 * matoga - 总资产库：包内浏览（浏览头与工具栏）
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 从 pack-browser.js 按职责搬出，逻辑未改。
 */
import { t, onLocaleChange } from '../../i18n.js'
import { el, shade, loadList, saveList } from '../dom.js'
import { S, BROWSE_CLICK_DELAY } from '../store.js'
import { addPackTextureToCanvas, officialBadge } from '../sections-official.js'
import { browseCrumbs, browseTo, browseUp, exitBrowse } from './nav.js'
import { packEntryRawUrl } from './urls.js'
import { fillBrowseView } from './fill.js'
import { pbSaveView } from './persist.js'

export function buildBrowseHead(item, pack, kind) {
  const head = el('div', 'pb-top')
  const back = el('button', 'pb-back', '<svg class="ico"><use href="#i-chevron-left"/></svg>')
  back.title = t('asset.browseBack')
  back.addEventListener('click', exitBrowse)
  head.appendChild(back)

  const logo = el('div', 'pb-logo')
  const logoImg = el('img')
  logoImg.alt = ''
  logoImg.loading = 'lazy'
  logoImg.src = packEntryRawUrl(item.name, 'pack.png')
  logoImg.addEventListener('error', () => { logo.innerHTML = '<svg class="ico"><use href="#i-box"/></svg>' })
  logo.appendChild(logoImg)
  logo.title = item.name
  head.appendChild(logo)

  const title = el('div', 'pb-title')
  title.appendChild(el('span', 'pb-name', item.name))
  if (item.badge || (pack && officialBadge(pack))) {
    title.appendChild(el('span', 'pb-badge', item.badge || officialBadge(pack)))
  }
  head.appendChild(title)
  head.appendChild(el('span', 'pb-kind', kind === 'zip' ? 'ZIP' : (kind === 'dir' ? t('asset.officialKindDir') : '')))

  const meta = el('div', 'pb-meta')
  if (pack) {
    if (pack.description) meta.appendChild(el('div', 'pb-desc', pack.description))
    const stats = el('div', 'pb-stats')
    const stat = (label, value) => {
      if (value == null || value === '') return
      stats.appendChild(el('span', 's', `<b>${label}</b> ${value}`))
    }
    stat(t('asset.detailMcVersion'), pack.formatRange || (pack.format != null ? 'pack_format ' + pack.format : null))
    stat(t('asset.detailPackFormat'), pack.formatLabel || (pack.format != null ? String(pack.format) : null))
    stat(t('asset.detailPackTexCount'), pack.textureCount != null ? String(pack.textureCount) : null)
    if (stats.childNodes.length) meta.appendChild(stats)
  }
  head.appendChild(meta)
  return head
}

export function buildBrowseCrumbsBar() {
  const bar = el('div', 'pb-crumbs')
  const crumbs = browseCrumbs()
  crumbs.forEach((c, i) => {
    if (i > 0) bar.appendChild(el('span', 'pb-sep', '›'))
    const cur = i === crumbs.length - 1
    const btn = el('button', 'pb-crumb' + (cur ? ' cur' : ''), c.name)
    btn.title = c.dir || S.browse.item.name
    if (!cur) btn.addEventListener('click', () => browseTo(c.dir))
    bar.appendChild(btn)
  })
  return bar
}

export function buildBrowseToolbar() {
  const bar = el('div', 'pb-toolbar')
  const up = el('button', 'pb-up', '<svg class="ico"><use href="#i-arrow-up"/></svg>')
  up.title = t('asset.browseUp')
  if (!S.browse || !S.browse.dir) up.disabled = true
  else up.addEventListener('click', browseUp)
  bar.appendChild(up)
  bar.appendChild(buildBrowseCrumbsBar())

  const tools = el('div', 'pb-tools')
  const filterWrap = el('div', 'pb-filter-wrap')
  filterWrap.innerHTML = '<svg class="ico"><use href="#i-search"/></svg>'
  const filter = el('input', 'pb-filter')
  filter.type = 'search'
  filter.placeholder = t('asset.browseFilterPh')
  filter.value = S.browse ? S.browse.filter : ''
  filter.addEventListener('input', () => {
    if (!S.browse) return
    S.browse.filter = filter.value
    if (S.browse.data) fillBrowseView(S.browse.item, S.browse.pack, S.browse.data)
  })
  filterWrap.appendChild(filter)
  tools.appendChild(filterWrap)

  const seg = el('div', 'pb-viewseg')
  const mkViewBtn = (mode, icon, titleKey) => {
    const b = el('button', 'pb-vbtn' + (S.browse && S.browse.view === mode ? ' active' : ''),
      `<svg class="ico"><use href="#i-${icon}"/></svg>`)
    b.title = t(titleKey)
    b.dataset.view = mode
    b.addEventListener('click', () => {
      if (!S.browse || S.browse.view === mode) return
      S.browse.view = mode
      pbSaveView(mode)
      seg.querySelectorAll('.pb-vbtn').forEach(x => x.classList.toggle('active', x.dataset.view === mode))
      if (S.browse.data) fillBrowseView(S.browse.item, S.browse.pack, S.browse.data)
    })
    return b
  }
  seg.appendChild(mkViewBtn('list', 'list', 'asset.browseViewList'))
  seg.appendChild(mkViewBtn('grid', 'grid', 'asset.browseViewGrid'))
  tools.appendChild(seg)
  bar.appendChild(tools)
  return bar
}

export function setBrowseStatus(text) {
  const st = document.querySelector('.pack-browser .pb-status')
  if (st) st.textContent = text
}

export function browseEntryPath(name) {
  return S.browse && S.browse.dir ? S.browse.dir + '/' + name : name
}

