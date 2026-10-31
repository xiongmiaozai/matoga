/**
 * matoga - MC 模型：AssetBrowse
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 从 mc-model-viewer.js 按领域搬出（正文逐字未改）。
 * 职责：包内容浏览（打开包/目录导航/文件网格渲染）
 */

import { t } from '../i18n.js'
import { IMG_EXTS, showToast } from '../core.js'
import { formatSize } from '../utils.js'
import { enCandidatesOfZh, zhOfItem, pinyinOfItem } from '../zh-names.js'
import { assetSearchMatch } from '../asset-search.js'

/* 主文件函数（注入） */
let _packRawUrl = (...a) => undefined
let _packApiFor = (...a) => undefined
let _rebuild = (...a) => undefined
let _el = (...a) => undefined
let _officialBadge = (...a) => undefined
let _pushRecent = (...a) => undefined
let _viewMcModelAsset = (...a) => undefined
let _addPackTextureToCanvas = (...a) => undefined
let _assetApiCall = (...a) => undefined

/* 模块状态：只读用 getter；可写用 get/set 成对（§2.2） */
let _get_MC_OFFICIAL_API = () => undefined
let _get_MODEL_DIR_PATH_RE = () => undefined
let _get_MODEL_JSON_RE = () => undefined
let _get_mcEntries = () => undefined
let _get_officialEntries = () => undefined
let _get_browse = () => undefined
let _set_browse = () => {}
let _get_browseSeq = () => undefined
let _set_browseSeq = () => {}

export function setHooks(h) {
  if (h.packRawUrl) _packRawUrl = h.packRawUrl
  if (h.packApiFor) _packApiFor = h.packApiFor
  if (h.rebuild) _rebuild = h.rebuild
  if (h.el) _el = h.el
  if (h.officialBadge) _officialBadge = h.officialBadge
  if (h.pushRecent) _pushRecent = h.pushRecent
  if (h.viewMcModelAsset) _viewMcModelAsset = h.viewMcModelAsset
  if (h.addPackTextureToCanvas) _addPackTextureToCanvas = h.addPackTextureToCanvas
  if (h.assetApiCall) _assetApiCall = h.assetApiCall
  if (h.get_MC_OFFICIAL_API) _get_MC_OFFICIAL_API = h.get_MC_OFFICIAL_API
  if (h.get_MODEL_DIR_PATH_RE) _get_MODEL_DIR_PATH_RE = h.get_MODEL_DIR_PATH_RE
  if (h.get_MODEL_JSON_RE) _get_MODEL_JSON_RE = h.get_MODEL_JSON_RE
  if (h.get_mcEntries) _get_mcEntries = h.get_mcEntries
  if (h.get_officialEntries) _get_officialEntries = h.get_officialEntries
  if (h.get_browse) _get_browse = h.get_browse
  if (h.set_browse) _set_browse = h.set_browse
  if (h.get_browseSeq) _get_browseSeq = h.get_browseSeq
  if (h.set_browseSeq) _set_browseSeq = h.set_browseSeq
}

export function packEntryRawUrl(packName, relPath) {
  return _packRawUrl(_get_browse() ? _get_browse().api : _get_MC_OFFICIAL_API(), packName, relPath)
}

export function isAddableAssetPath(p) {
  return p === 'pack.png' || p.startsWith('assets/')
}

export function isModelBrowsePath(rel) {
  return typeof rel === 'string' && _get_MODEL_DIR_PATH_RE().test(rel) && _get_MODEL_JSON_RE().test(rel)
}

export function pbLoadView() {
  try {
    const v = localStorage.getItem('matoga:pbView')
    return v === 'grid' || v === 'list' ? v : 'list'
  } catch {
    return 'list'
  }
}

export function pbSaveView(v) {
  try {
    localStorage.setItem('matoga:pbView', v)
  } catch {}
}

export function openPackBrowser(item) {
  const list = item.type === 'mc' ? _get_mcEntries() : item.type === 'official' ? _get_officialEntries() : null
  const pack = item.pack || (list || []).find(p => p.fullPath === item.path) || null
  _set_browse({ item, pack, dir: null, view: pbLoadView(), filter: '', data: null, api: _packApiFor(item.type) })
  renderBrowse()
}

export function browseTo(dir) {
  if (!_get_browse()) return
  _get_browse().dir = dir
  _get_browse().filter = ''
  _get_browse().data = null
  renderBrowse()
}

export function browseUp() {
  if (!_get_browse() || !_get_browse().dir) return
  const idx = _get_browse().dir.lastIndexOf('/')
  _get_browse().dir = idx >= 0 ? _get_browse().dir.slice(0, idx) : null
  _get_browse().filter = ''
  _get_browse().data = null
  renderBrowse()
}

export function exitBrowse() {
  _set_browse(null)
  _set_browseSeq(_get_browseSeq() + 1)
  const search = document.getElementById('assetLibSearch')
  if (search) search.disabled = false
  const toolbar = document.getElementById('assetLibToolbar')
  if (toolbar) toolbar.classList.remove('pb-off')
  _rebuild()
}

export function browseCrumbs() {
  const crumbs = [{ name: _get_browse().item.name, dir: null }]
  if (_get_browse().dir) {
    const segs = _get_browse().dir.split('/')
    segs.forEach((s, i) => crumbs.push({ name: s, dir: segs.slice(0, i + 1).join('/') }))
  }
  return crumbs
}

export function buildBrowseHead(item, pack, kind) {
  const head = _el('div', 'pb-top')
  const back = _el('button', 'pb-back', '<svg class="ico"><use href="#i-chevron-left"/></svg>')
  back.title = t('asset.browseBack')
  back.addEventListener('click', exitBrowse)
  head.appendChild(back)

  const logo = _el('div', 'pb-logo')
  const logoImg = _el('img')
  logoImg.alt = ''
  logoImg.loading = 'lazy'
  logoImg.src = packEntryRawUrl(item.name, 'pack.png')
  logoImg.addEventListener('error', () => {
    logo.innerHTML = '<svg class="ico"><use href="#i-box"/></svg>'
  })
  logo.appendChild(logoImg)
  logo.title = item.name
  head.appendChild(logo)

  const title = _el('div', 'pb-title')
  title.appendChild(_el('span', 'pb-name', item.name))
  if (item.badge || (pack && _officialBadge(pack))) {
    title.appendChild(_el('span', 'pb-badge', item.badge || _officialBadge(pack)))
  }
  head.appendChild(title)
  head.appendChild(_el('span', 'pb-kind', kind === 'zip' ? 'ZIP' : kind === 'dir' ? t('asset.officialKindDir') : ''))

  const meta = _el('div', 'pb-meta')
  if (pack) {
    if (pack.description) meta.appendChild(_el('div', 'pb-desc', pack.description))
    const stats = _el('div', 'pb-stats')
    const stat = (label, value) => {
      if (value == null || value === '') return
      stats.appendChild(_el('span', 's', `<b>${label}</b> ${value}`))
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
  const bar = _el('div', 'pb-crumbs')
  const crumbs = browseCrumbs()
  crumbs.forEach((c, i) => {
    if (i > 0) bar.appendChild(_el('span', 'pb-sep', '›'))
    const cur = i === crumbs.length - 1
    const btn = _el('button', 'pb-crumb' + (cur ? ' cur' : ''), c.name)
    btn.title = c.dir || _get_browse().item.name
    if (!cur) btn.addEventListener('click', () => browseTo(c.dir))
    bar.appendChild(btn)
  })
  return bar
}

export function buildBrowseToolbar() {
  const bar = _el('div', 'pb-toolbar')
  const up = _el('button', 'pb-up', '<svg class="ico"><use href="#i-arrow-up"/></svg>')
  up.title = t('asset.browseUp')
  if (!_get_browse() || !_get_browse().dir) up.disabled = true
  else up.addEventListener('click', browseUp)
  bar.appendChild(up)
  bar.appendChild(buildBrowseCrumbsBar())

  const tools = _el('div', 'pb-tools')
  const filterWrap = _el('div', 'pb-filter-wrap')
  filterWrap.innerHTML = '<svg class="ico"><use href="#i-search"/></svg>'
  const filter = _el('input', 'pb-filter')
  filter.type = 'search'
  filter.placeholder = t('asset.browseFilterPh')
  filter.value = _get_browse() ? _get_browse().filter : ''
  filter.addEventListener('input', () => {
    if (!_get_browse()) return
    _get_browse().filter = filter.value
    if (_get_browse().data) fillBrowseView(_get_browse().item, _get_browse().pack, _get_browse().data)
  })
  filterWrap.appendChild(filter)
  tools.appendChild(filterWrap)

  const seg = _el('div', 'pb-viewseg')
  const mkViewBtn = (mode, icon, titleKey) => {
    const b = _el(
      'button',
      'pb-vbtn' + (_get_browse() && _get_browse().view === mode ? ' active' : ''),
      `<svg class="ico"><use href="#i-${icon}"/></svg>`
    )
    b.title = t(titleKey)
    b.dataset.view = mode
    b.addEventListener('click', () => {
      if (!_get_browse() || _get_browse().view === mode) return
      _get_browse().view = mode
      pbSaveView(mode)
      seg.querySelectorAll('.pb-vbtn').forEach(x => x.classList.toggle('active', x.dataset.view === mode))
      if (_get_browse().data) fillBrowseView(_get_browse().item, _get_browse().pack, _get_browse().data)
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
  return _get_browse() && _get_browse().dir ? _get_browse().dir + '/' + name : name
}

export function buildBrowseFolderCard(d) {
  const f = _el('div', 'pb-folder')
  f.innerHTML = '<svg class="ico"><use href="#i-folder"/></svg>'
  f.appendChild(_el('span', 'fn', d.name))
  f.appendChild(_el('span', 'pb-farrow', '<svg class="ico"><use href="#i-chevron-right"/></svg>'))
  const dir = browseEntryPath(d.name)
  f.title = dir
  f.addEventListener('dblclick', e => {
    e.preventDefault()
    browseTo(dir)
  })
  f.addEventListener('click', () => {
    document.querySelectorAll('.pack-browser .pb-folder.sel').forEach(x => x.classList.remove('sel'))
    document.querySelectorAll('.pack-browser .pb-file.sel').forEach(x => x.classList.remove('sel'))
    f.classList.add('sel')
    setBrowseStatus(dir + ' · ' + t('asset.officialKindDir'))
  })
  return f
}

export function buildBrowseFileRow(item, pack, file, grid) {
  const rel = browseEntryPath(file.name)
  const isImgFile = IMG_EXTS.has((file.name.split('.').pop() || '').toLowerCase())
  const isModelFile = isModelBrowsePath(rel)
  const addable = (isImgFile || isModelFile) && isAddableAssetPath(rel)
  const row = _el('div', 'pb-file' + (grid ? ' card' : ''))
  const th = _el('div', 'pf-thumb')
  if (isImgFile) {
    const img = _el('img')
    img.loading = 'lazy'
    img.alt = ''
    img.src = packEntryRawUrl(item.name, rel)
    img.addEventListener('error', () => {
      th.innerHTML = '<svg class="ico"><use href="#i-file"/></svg>'
    })
    th.appendChild(img)
  } else if (isModelFile) {
    th.classList.add('model')
    th.innerHTML = '<svg class="ico"><use href="#i-cube"/></svg>'
  } else {
    th.innerHTML = '<svg class="ico"><use href="#i-file"/></svg>'
  }
  row.appendChild(th)
  row.appendChild(_el('span', 'fn', file.name))
  row.appendChild(_el('span', 'fs', file.size ? formatSize(file.size) : ''))
  const addHint = isModelFile ? t('asset.browseAddModel') : t('asset.browseAddTex')
  row.title = rel + (file.size ? ' · ' + formatSize(file.size) : '') + (addable ? ' · ' + addHint : '')

  if (addable) {
    const add = _el('button', 'pf-add', '<svg class="ico"><use href="#i-plus"/></svg>')
    add.title = addHint
    add.addEventListener('click', e => {
      e.stopPropagation()
      if (isModelFile) {
        _pushRecent(item)
        _viewMcModelAsset(item.type, item.name, rel, file.name)
        return
      }
      const p = pack || { name: item.name }
      _pushRecent(item)
      _addPackTextureToCanvas(item, p, { path: rel, name: file.name })
    })
    row.appendChild(add)
  }
  row.addEventListener('click', () => {
    document.querySelectorAll('.pack-browser .pb-folder.sel').forEach(x => x.classList.remove('sel'))
    document.querySelectorAll('.pack-browser .pb-file.sel').forEach(x => x.classList.remove('sel'))
    row.classList.add('sel')
    setBrowseStatus(row.title)
  })
  row.addEventListener('dblclick', e => {
    e.preventDefault()
    if (isModelFile && isAddableAssetPath(rel)) {
      _pushRecent(item)
      _viewMcModelAsset(item.type, item.name, rel, file.name)
      return
    }
    if (!isImgFile || !isAddableAssetPath(rel)) {
      showToast(t('asset.toastFileNotAddable'))
      return
    }
    const p = pack || { name: item.name }
    _pushRecent(item)
    _addPackTextureToCanvas(item, p, { path: rel, name: file.name })
  })
  return row
}

export function fillBrowseError(item, pack, msg) {
  const list = document.querySelector('.pack-browser .pb-list')
  if (!list) return
  list.innerHTML = ''
  const hint = _el('div', 'asset-lib-hint error', t('asset.loadFailed', { msg }))
  const retry = _el('button', 'asset-lib-sec-btn', t('asset.browseRetry'))
  retry.addEventListener('click', () => renderBrowse())
  hint.appendChild(document.createElement('br'))
  hint.appendChild(retry)
  list.appendChild(hint)
  setBrowseStatus(t('asset.loadFailed', { msg }))
}

export function fillBrowseView(item, pack, data) {
  const list = document.querySelector('.pack-browser .pb-list')
  if (!list) return
  list.innerHTML = ''
  const kindEl = document.querySelector('.pack-browser .pb-kind')
  if (kindEl) kindEl.textContent = data.kind === 'zip' ? 'ZIP' : t('asset.officialKindDir')

  const term = _get_browse() && _get_browse().filter ? _get_browse().filter.trim() : ''
  const enCands = term ? enCandidatesOfZh(term) : []
  const match = (name, zh, pinyin) =>
    assetSearchMatch(String(name).toLowerCase(), (zh || '').toLowerCase(), (pinyin || '').toLowerCase(), enCands, term)
  const dirs = (data.dirs || []).filter(d => match(d.name))
  const files = (data.files || []).filter(f => {
    const item = { path: f.path, name: f.name }
    return match(f.name, zhOfItem(item), pinyinOfItem(item))
  })
  const total = dirs.length + files.length
  const unfiltered = (data.dirs || []).length + (data.files || []).length

  if (!total) {
    list.appendChild(_el('div', 'pb-empty', term ? t('asset.browseNoMatch') : t('asset.browseEmptyDir')))
  } else {
    if (dirs.length) {
      const fg = _el('div', 'pb-folders')
      for (const d of dirs) fg.appendChild(buildBrowseFolderCard(d))
      list.appendChild(fg)
    }
    if (files.length) {
      const grid = _get_browse() && _get_browse().view === 'grid'
      const fl = _el('div', grid ? 'pb-tex-grid' : 'pb-files')
      for (const f of files) fl.appendChild(buildBrowseFileRow(item, pack, f, grid))
      list.appendChild(fl)
    }
    if (data.truncated) {
      const more = _el('div', 'pb-empty', t('asset.browseTruncated', { n: String(data.total) }))
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
  if (!body || !_get_browse()) return
  const search = document.getElementById('assetLibSearch')
  if (search) search.disabled = true
  const toolbar = document.getElementById('assetLibToolbar')
  if (toolbar) toolbar.classList.add('pb-off')
  const seq = _get_browseSeq() + 1
  _set_browseSeq(seq)
  const { item, pack, dir, api } = _get_browse()

  body.scrollTop = 0
  body.innerHTML = ''
  const view = _el('div', 'pack-browser')
  view.appendChild(buildBrowseHead(item, pack, null))
  view.appendChild(buildBrowseToolbar())
  const list = _el('div', 'pb-list')
  list.appendChild(_el('div', 'pb-loading', t('asset.browseLoading')))
  view.appendChild(list)
  view.appendChild(_el('div', 'pb-status', t('asset.browseLoading')))
  body.appendChild(view)

  let data
  try {
    const q = dir ? '?dir=' + encodeURIComponent(dir) : ''
    data = await _assetApiCall('GET', api + '/' + encodeURIComponent(item.name) + '/entries' + q)
  } catch (e) {
    if (seq === _get_browseSeq() && _get_browse()) fillBrowseError(item, pack, e.message)
    return
  }
  if (seq !== _get_browseSeq() || !_get_browse()) return
  _get_browse().data = data
  fillBrowseView(item, pack, data)
}
