/**
 * matoga - 总资产库：pack-browser
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 从 asset-library.js 原样搬出，逻辑未改。
 */
import { state, IMG_EXTS, showToast } from '../core.js'
import { fileUrl, formatSize, formatDate, escAttr, apiUrl, setTexDragData, contentKindOfPath } from '../utils.js'
import { t, onLocaleChange } from '../i18n.js'
import { el, shade, loadList, saveList } from './dom.js'
import { tryActivateModelViewport, viewMcModelAsset, viewImportedModelAsset } from './model-view.js'
import { S, BROWSE_CLICK_DELAY } from './store.js'
import { rebuild } from './filters.js'
import { addPackTextureToCanvas, officialBadge } from './sections-official.js'
import { pushRecent } from './items.js'
import { assetApiCall } from './api.js'

function packEntryRawUrl(packName, relPath) {
  return packRawUrl(S.browse ? S.browse.api : MC_OFFICIAL_API, packName, relPath)
}

function isAddableAssetPath(p) {
  return p === 'pack.png' || p.startsWith('assets/')
}

/* 包浏览中的模型文件判定：assets/<ns>/models/** 下的 .json */
function isModelBrowsePath(rel) {
  return typeof rel === 'string' && MODEL_DIR_PATH_RE.test(rel) && MODEL_JSON_RE.test(rel)
}

function pbLoadView() {
  try {
    const v = localStorage.getItem('matoga:pbView')
    return v === 'grid' || v === 'list' ? v : 'list'
  } catch { return 'list' }
}

function pbSaveView(v) {
  try { localStorage.setItem('matoga:pbView', v) } catch {}
}

export function openPackBrowser(item) {
  const list = item.type === 'mc' ? S.mcEntries : (item.type === 'official' ? S.officialEntries : null)
  const pack = item.pack || (list || []).find(p => p.fullPath === item.path) || null
  S.browse = { item, pack, dir: null, view: pbLoadView(), filter: '', data: null, api: packApiFor(item.type) }
  renderBrowse()
}

function browseTo(dir) {
  if (!S.browse) return
  S.browse.dir = dir
  S.browse.filter = ''
  S.browse.data = null
  renderBrowse()
}

export function browseUp() {
  if (!S.browse || !S.browse.dir) return
  const idx = S.browse.dir.lastIndexOf('/')
  S.browse.dir = idx >= 0 ? S.browse.dir.slice(0, idx) : null
  S.browse.filter = ''
  S.browse.data = null
  renderBrowse()
}

function exitBrowse() {
  S.browse = null
  S.browseSeq++
  const search = document.getElementById('assetLibSearch')
  if (search) search.disabled = false
  const toolbar = document.getElementById('assetLibToolbar')
  if (toolbar) toolbar.classList.remove('pb-off')
  rebuild()
}

function browseCrumbs() {
  const crumbs = [{ name: S.browse.item.name, dir: null }]
  if (S.browse.dir) {
    const segs = S.browse.dir.split('/')
    segs.forEach((s, i) => crumbs.push({ name: s, dir: segs.slice(0, i + 1).join('/') }))
  }
  return crumbs
}

function buildBrowseHead(item, pack, kind) {
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

function buildBrowseCrumbsBar() {
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

function buildBrowseToolbar() {
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

function setBrowseStatus(text) {
  const st = document.querySelector('.pack-browser .pb-status')
  if (st) st.textContent = text
}

function browseEntryPath(name) {
  return S.browse && S.browse.dir ? S.browse.dir + '/' + name : name
}

function buildBrowseFolderCard(d) {
  const f = el('div', 'pb-folder')
  f.innerHTML = '<svg class="ico"><use href="#i-folder"/></svg>'
  f.appendChild(el('span', 'fn', d.name))
  f.appendChild(el('span', 'pb-farrow', '<svg class="ico"><use href="#i-chevron-right"/></svg>'))
  const dir = browseEntryPath(d.name)
  f.title = dir
  f.addEventListener('dblclick', (e) => { e.preventDefault(); browseTo(dir) })
  f.addEventListener('click', () => {
    document.querySelectorAll('.pack-browser .pb-folder.sel').forEach(x => x.classList.remove('sel'))
    document.querySelectorAll('.pack-browser .pb-file.sel').forEach(x => x.classList.remove('sel'))
    f.classList.add('sel')
    setBrowseStatus(dir + ' · ' + t('asset.officialKindDir'))
  })
  return f
}

function buildBrowseFileRow(item, pack, file, grid) {
  const rel = browseEntryPath(file.name)
  const isImgFile = IMG_EXTS.has((file.name.split('.').pop() || '').toLowerCase())
  const isModelFile = isModelBrowsePath(rel)
  const addable = (isImgFile || isModelFile) && isAddableAssetPath(rel)
  const row = el('div', 'pb-file' + (grid ? ' card' : ''))
  const th = el('div', 'pf-thumb')
  if (isImgFile) {
    const img = el('img')
    img.loading = 'lazy'
    img.alt = ''
    img.src = packEntryRawUrl(item.name, rel)
    img.addEventListener('error', () => { th.innerHTML = '<svg class="ico"><use href="#i-file"/></svg>' })
    th.appendChild(img)
  } else if (isModelFile) {
    th.classList.add('model')
    th.innerHTML = '<svg class="ico"><use href="#i-cube"/></svg>'
  } else {
    th.innerHTML = '<svg class="ico"><use href="#i-file"/></svg>'
  }
  row.appendChild(th)
  row.appendChild(el('span', 'fn', file.name))
  row.appendChild(el('span', 'fs', file.size ? formatSize(file.size) : ''))
  const addHint = isModelFile ? t('asset.browseAddModel') : t('asset.browseAddTex')
  row.title = rel + (file.size ? ' · ' + formatSize(file.size) : '') + (addable ? ' · ' + addHint : '')

  if (addable) {
    const add = el('button', 'pf-add', '<svg class="ico"><use href="#i-plus"/></svg>')
    add.title = addHint
    add.addEventListener('click', (e) => {
      e.stopPropagation()
      if (isModelFile) {
        pushRecent(item)
        viewMcModelAsset(item.type, item.name, rel, file.name)
        return
      }
      const p = pack || { name: item.name }
      pushRecent(item)
      addPackTextureToCanvas(item, p, { path: rel, name: file.name })
    })
    row.appendChild(add)
  }
  row.addEventListener('click', () => {
    document.querySelectorAll('.pack-browser .pb-folder.sel').forEach(x => x.classList.remove('sel'))
    document.querySelectorAll('.pack-browser .pb-file.sel').forEach(x => x.classList.remove('sel'))
    row.classList.add('sel')
    setBrowseStatus(row.title)
  })
  row.addEventListener('dblclick', (e) => {
    e.preventDefault()
    if (isModelFile && isAddableAssetPath(rel)) {
      pushRecent(item)
      viewMcModelAsset(item.type, item.name, rel, file.name)
      return
    }
    if (!isImgFile || !isAddableAssetPath(rel)) {
      showToast(t('asset.toastFileNotAddable'))
      return
    }
    const p = pack || { name: item.name }
    pushRecent(item)
    addPackTextureToCanvas(item, p, { path: rel, name: file.name })
  })
  return row
}

function fillBrowseError(item, pack, msg) {
  const list = document.querySelector('.pack-browser .pb-list')
  if (!list) return
  list.innerHTML = ''
  const hint = el('div', 'asset-lib-hint error', t('asset.loadFailed', { msg }))
  const retry = el('button', 'asset-lib-sec-btn', t('asset.browseRetry'))
  retry.addEventListener('click', () => renderBrowse())
  hint.appendChild(document.createElement('br'))
  hint.appendChild(retry)
  list.appendChild(hint)
  setBrowseStatus(t('asset.loadFailed', { msg }))
}

function fillBrowseView(item, pack, data) {
  const list = document.querySelector('.pack-browser .pb-list')
  if (!list) return
  list.innerHTML = ''
  const kindEl = document.querySelector('.pack-browser .pb-kind')
  if (kindEl) kindEl.textContent = data.kind === 'zip' ? 'ZIP' : t('asset.officialKindDir')

  const term = S.browse && S.browse.filter ? S.browse.filter.trim().toLowerCase() : ''
  const match = (name) => !term || String(name).toLowerCase().includes(term)
  const dirs = (data.dirs || []).filter(d => match(d.name))
  const files = (data.files || []).filter(f => match(f.name))
  const total = dirs.length + files.length
  const unfiltered = (data.dirs || []).length + (data.files || []).length

  if (!total) {
    list.appendChild(el('div', 'pb-empty', term ? t('asset.browseNoMatch') : t('asset.browseEmptyDir')))
  } else {
    if (dirs.length) {
      const fg = el('div', 'pb-folders')
      for (const d of dirs) fg.appendChild(buildBrowseFolderCard(d))
      list.appendChild(fg)
    }
    if (files.length) {
      const grid = S.browse && S.browse.view === 'grid'
      const fl = el('div', grid ? 'pb-tex-grid' : 'pb-files')
      for (const f of files) fl.appendChild(buildBrowseFileRow(item, pack, f, grid))
      list.appendChild(fl)
    }
    if (data.truncated) {
      const more = el('div', 'pb-empty', t('asset.browseTruncated', { n: String(data.total) }))
      list.appendChild(more)
    }
  }
  const stat = document.querySelector('.asset-lib-stat')
  if (stat) stat.textContent = t('asset.statTotal', { n: String(total) })

  const parts = []
  if (dirs.length) parts.push(t('asset.browseStatDirs', { n: String(dirs.length) }))
  if (files.length) parts.push(t('asset.browseStatFiles', { n: String(files.length) }))
  let status = parts.join(' · ') || t('asset.browseEmptyDir')
  if (term && total !== unfiltered) {
    status += ' · ' + t('asset.browseFiltered', { n: String(total), total: String(unfiltered) })
  }
  status += ' — ' + t('asset.browseHint')
  setBrowseStatus(status)
}

export async function renderBrowse() {
  const body = document.getElementById('assetLibraryBody')
  if (!body || !S.browse) return
  const search = document.getElementById('assetLibSearch')
  if (search) search.disabled = true
  const toolbar = document.getElementById('assetLibToolbar')
  if (toolbar) toolbar.classList.add('pb-off')
  const seq = ++S.browseSeq
  const { item, pack, dir, api } = S.browse

  body.scrollTop = 0
  body.innerHTML = ''
  const view = el('div', 'pack-browser')
  view.appendChild(buildBrowseHead(item, pack, null))
  view.appendChild(buildBrowseToolbar())
  const list = el('div', 'pb-list')
  list.appendChild(el('div', 'pb-loading', t('asset.browseLoading')))
  view.appendChild(list)
  view.appendChild(el('div', 'pb-status', t('asset.browseLoading')))
  body.appendChild(view)

  let data
  try {
    const q = dir ? '?dir=' + encodeURIComponent(dir) : ''
    data = await assetApiCall('GET', api + '/' + encodeURIComponent(item.name) + '/entries' + q)
  } catch (e) {
    if (seq === S.browseSeq && S.browse) fillBrowseError(item, pack, e.message)
    return
  }
  if (seq !== S.browseSeq || !S.browse) return
  S.browse.data = data
  fillBrowseView(item, pack, data)
}

