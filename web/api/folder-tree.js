/**
 * matoga - 材质贴图对比工具
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 目录树选择器：浏览器无系统目录对话框，经 /api/fs/browse 懒加载浏览并选择。
 * 支持：收藏夹、最近访问、当前列表过滤、递归搜索子目录、新建文件夹、
 *       面包屑导航、键盘导航、外接盘友好卷名。
 */

import { t } from './folder-tree-i18n.js'
import { FOLDER_ICON, UP_ICON } from './folder-tree-icons.js'
import { shortName, cleanPath } from './folder-tree-path.js'
import { CSS } from './folder-tree-css.js'
import { toast } from './folder-tree-toast.js'
import { makeChip, itemHtml, showNewRow } from './folder-tree-render.js'
import { panelHtml } from './folder-tree-template.js'
import { bindContextMenu } from './folder-tree-ctxmenu.js'

;(() => {
  let injected = false
  let mask = null, listEl = null, pathInput = null, filterInput = null, searchInput = null
  let crumbEl = null, quickEl = null
  let currentPath = '', currentParent = null, currentDirs = []
  let listTargets = []
  let activeIndex = -1
  let isSearching = false
  let resolveFn = null
  let favorites = [], history = []
  let historyTimer = null, searchTimer = null

  /* 渲染函数所需的闭包依赖：以对象注入，避免子模块反向依赖本文件 */
  const renderDeps = {
    listEl: null,          // 延迟绑定（ensureModal 里赋值）
    t,
    shortName,
    browseTo: (...a) => browseTo(...a),
    removeFavorite: (...a) => removeFavorite(...a),
    getCurrentPath: () => currentPath,
    UP_ICON,
    FOLDER_ICON,
  }

  function ensureModal() {
    if (injected) return
    injected = true
    const style = document.createElement('style')
    style.textContent = CSS
    document.head.appendChild(style)

    mask = document.createElement('div')
    mask.className = 'mft-mask'
    mask.innerHTML = panelHtml(t)
    document.body.appendChild(mask)

    listEl = mask.querySelector('.mft-list')
    renderDeps.listEl = listEl
    pathInput = mask.querySelector('.mft-path')
    filterInput = mask.querySelector('.mft-filter')
    searchInput = mask.querySelector('.mft-search')
    crumbEl = mask.querySelector('.mft-crumb')
    quickEl = mask.querySelector('.mft-quick')
    mask.querySelector('.mft-home').textContent = t('home')
    mask.querySelector('.mft-up').textContent = t('up')
    mask.querySelector('.mft-new').textContent = t('newFolder')
    mask.querySelector('.mft-addfav').textContent = t('addFav')
    mask.querySelector('.mft-cancel').textContent = t('cancel')
    mask.querySelector('.mft-select').textContent = t('select')
    pathInput.placeholder = t('inputPh')
    filterInput.placeholder = t('filterPh')
    searchInput.placeholder = t('searchPh')

    mask.addEventListener('click', (e) => { if (e.target === mask) close(null) })
    mask.querySelector('.mft-cancel').addEventListener('click', () => close(null))
    mask.querySelector('.mft-select').addEventListener('click', () => close(cleanPath(pathInput.value) || currentPath))
    mask.querySelector('.mft-up').addEventListener('click', () => { if (currentParent) browseTo(currentParent) })
    mask.querySelector('.mft-home').addEventListener('click', () => browseTo(''))
    mask.querySelector('.mft-new').addEventListener('click', () => showNewRow(renderDeps))
    mask.querySelector('.mft-addfav').addEventListener('click', () => addFavorite(currentPath))
    pathInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); browseTo(pathInput.value.trim()) } })
    filterInput.addEventListener('input', () => {
      if (searchInput.value) searchInput.value = ''
      isSearching = false; renderCurrent()
    })
    searchInput.addEventListener('input', () => {
      if (filterInput.value) filterInput.value = ''
      clearTimeout(searchTimer)
      const q = searchInput.value.trim()
      if (!q) { isSearching = false; renderCurrent(); return }
      searchTimer = setTimeout(() => doSearch(q), 300)
    })
    mask.addEventListener('keydown', onKeydown)

    bindContextMenu({ mask, t, toast, browseTo, getCurrentPath: () => currentPath })
  }

  function onKeydown(e) {
    const inInput = e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')
    if (e.key === 'Escape') { e.preventDefault(); close(null); return }
    if (e.key === 'ArrowDown') { e.preventDefault(); moveActive(1); return }
    if (e.key === 'ArrowUp') { e.preventDefault(); moveActive(-1); return }
    if (e.key === 'Enter' && !inInput) {
      e.preventDefault()
      if (activeIndex >= 0 && listTargets[activeIndex]) browseTo(listTargets[activeIndex].fullPath)
      return
    }
    if (e.key === 'Backspace' && !inInput) {
      e.preventDefault()
      if (currentParent) browseTo(currentParent)
      return
    }
  }

  function moveActive(delta) {
    if (!listTargets.length) return
    if (activeIndex < 0) activeIndex = delta > 0 ? 0 : listTargets.length - 1
    else activeIndex = (activeIndex + delta + listTargets.length) % listTargets.length
    renderActive()
  }

  function renderActive() {
    const items = listEl.querySelectorAll('.mft-item')
    items.forEach((el, i) => el.classList.toggle('active', i === activeIndex))
    if (activeIndex >= 0 && items[activeIndex]) items[activeIndex].scrollIntoView({ block: 'nearest' })
  }

  function renderBreadcrumb() {
    crumbEl.innerHTML = ''
    if (!currentPath) {
      const span = document.createElement('span'); span.className = 'mft-ccur'; span.textContent = t('root'); crumbEl.appendChild(span); return
    }
    const sep = currentPath.includes('\\') && !currentPath.includes('/') ? '\\' : '/'
    const isAbsUnix = currentPath[0] === '/'
    const parts = currentPath.split(/[\\/]/).filter(Boolean)
    let acc = ''
    parts.forEach((part, i) => {
      acc = isAbsUnix ? acc + sep + part : (i === 0 ? part + sep : acc + sep + part)
      const target = acc
      if (i > 0) { const s = document.createElement('span'); s.className = 'mft-csep'; s.textContent = sep; crumbEl.appendChild(s) }
      const seg = document.createElement('span')
      const isLast = i === parts.length - 1
      seg.className = 'mft-cseg' + (isLast ? ' mft-ccur' : '')
      seg.textContent = part
      if (!isLast) seg.addEventListener('click', () => browseTo(target))
      crumbEl.appendChild(seg)
    })
  }

  function renderQuickbar() {
    quickEl.innerHTML = ''
    if (favorites.length) {
      const lab = document.createElement('span'); lab.className = 'mft-chiplabel'; lab.textContent = t('fav'); quickEl.appendChild(lab)
      favorites.forEach(p => quickEl.appendChild(makeChip(p, false)))
    }
    if (history.length) {
      const lab = document.createElement('span'); lab.className = 'mft-chiplabel'; lab.textContent = t('recent'); quickEl.appendChild(lab)
      history.forEach(p => quickEl.appendChild(makeChip(renderDeps, p, true)))
    }
  }

  function renderCurrent() {
    listEl.innerHTML = ''
    listTargets = []
    activeIndex = -1
    const kw = filterInput.value.trim().toLowerCase()
    if (currentParent) { itemHtml(renderDeps, '..', currentParent, true); listTargets.push({ fullPath: currentParent, isUp: true }) }
    const dirs = kw ? currentDirs.filter(d => (d.name || '').toLowerCase().includes(kw)) : currentDirs
    if (!dirs.length && currentPath) {
      const empty = document.createElement('div'); empty.className = 'mft-empty'; empty.textContent = t('empty'); listEl.appendChild(empty); return
    }
    for (const d of dirs) { itemHtml(renderDeps, d.name, d.fullPath, false); listTargets.push({ fullPath: d.fullPath, isUp: false }) }
  }

  function renderSearchResults(results, q) {
    listEl.innerHTML = ''
    listTargets = []
    activeIndex = -1
    const head = document.createElement('div'); head.className = 'mft-srhead'
    const left = document.createElement('span'); left.textContent = `${t('searchResults')} "${q}" · ${results.length}`
    const clr = document.createElement('span'); clr.className = 'mft-clear'; clr.textContent = t('clear')
    clr.addEventListener('click', () => { searchInput.value = ''; isSearching = false; renderCurrent() })
    head.appendChild(left); head.appendChild(clr); listEl.appendChild(head)
    if (!results.length) {
      const empty = document.createElement('div'); empty.className = 'mft-empty'; empty.textContent = t('noResults'); listEl.appendChild(empty); return
    }
    for (const r of results) {
      const div = document.createElement('div'); div.className = 'mft-item'
      div.innerHTML = FOLDER_ICON + `<span class="mft-name"></span>`
      div.querySelector('.mft-name').textContent = r.fullPath
      div.title = r.fullPath
      div.addEventListener('click', () => { searchInput.value = ''; isSearching = false; browseTo(r.fullPath) })
      listEl.appendChild(div); listTargets.push({ fullPath: r.fullPath, isUp: false })
    }
  }

  async function browseTo(p) {
    p = cleanPath(p)
    listEl.innerHTML = `<div class="mft-empty">…</div>`
    listTargets = []; activeIndex = -1; isSearching = false
    try {
      const d = await window.matogaCore.call('GET', '/api/fs/browse' + (p ? '?path=' + encodeURIComponent(p) : ''))
      currentPath = d.path || ''
      currentParent = d.parent || null
      currentDirs = d.dirs || []
      pathInput.value = currentPath
      filterInput.value = ''
      renderBreadcrumb()
      renderQuickbar()
      renderCurrent()
      if (currentPath) pushHistory(currentPath)
    } catch (e) {
      listEl.innerHTML = `<div class="mft-empty">${t('loadErr')}: ${e.message}</div>`
    }
  }

  async function doSearch(q) {
    if (!currentPath) return
    isSearching = true
    listEl.innerHTML = `<div class="mft-empty">${t('searching')}</div>`
    listTargets = []; activeIndex = -1
    try {
      const d = await window.matogaCore.call('GET', '/api/fs/search?path=' + encodeURIComponent(currentPath) + '&q=' + encodeURIComponent(q) + '&depth=4&limit=200')
      if (!isSearching) return
      renderSearchResults(d.results || [], q)
    } catch (e) {
      if (!isSearching) return
      listEl.innerHTML = `<div class="mft-empty">${t('loadErr')}: ${e.message}</div>`
    }
  }

  function addFavorite(p) {
    if (!p) return
    if (favorites.includes(p)) return
    favorites.unshift(p)
    if (favorites.length > 20) favorites = favorites.slice(0, 20)
    saveFavorites()
    renderQuickbar()
  }

  function removeFavorite(p) {
    favorites = favorites.filter(x => x !== p)
    saveFavorites()
    renderQuickbar()
  }

  function saveFavorites() { try { window.api.setConfig({ folderFavorites: favorites }) } catch {} }

  function pushHistory(p) {
    const i = history.indexOf(p)
    if (i >= 0) history.splice(i, 1)
    history.unshift(p)
    if (history.length > 10) history = history.slice(0, 10)
    clearTimeout(historyTimer)
    historyTimer = setTimeout(() => { try { window.api.setConfig({ folderHistory: history }) } catch {} }, 800)
    renderQuickbar()
  }

  async function loadConfig() {
    try {
      const cfg = await window.api.getConfig()
      favorites = Array.isArray(cfg.folderFavorites) ? cfg.folderFavorites : []
      history = Array.isArray(cfg.folderHistory) ? cfg.folderHistory : []
      return cfg || {}
    } catch { favorites = []; history = []; return {} }
  }

  function close(result) {
    if (mask) mask.classList.remove('show')
    if (resolveFn) { resolveFn(result); resolveFn = null }
  }

  window.matogaFolderTree = {
    async pick(side) {
      ensureModal()
      resolveFn = null
      return new Promise((resolve) => {
        resolveFn = resolve
        mask.classList.add('show')
        let prefill = ''
        loadConfig().then(cfg => {
          renderQuickbar()
          if (side && cfg[side + 'Path']) prefill = cfg[side + 'Path']
          else if (cfg.lastPath) prefill = cfg.lastPath
          return browseTo(prefill)
        }).catch(() => browseTo(''))
      })
    }
  }
})()