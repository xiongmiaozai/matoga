/**
 * matoga - 材质贴图对比工具
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 目录树选择器：浏览器无系统目录对话框，经 /api/fs/browse 懒加载浏览并选择。
 * 支持：收藏夹、最近访问、当前列表过滤、递归搜索子目录、新建文件夹、
 *       面包屑导航、键盘导航、外接盘友好卷名。
 */

;(() => {
  const UI = {
    zh: { title: '选择文件夹', inputPh: '输入绝对路径后回车', up: '上级', home: '主目录', select: '选择当前目录', cancel: '取消', empty: '（空目录）', loadErr: '读取失败',
          fav: '收藏', recent: '最近', filterPh: '过滤当前列表', searchPh: '递归搜索子目录', newFolder: '新建', addFav: '加入收藏', searching: '搜索中…', noResults: '无匹配结果', searchResults: '搜索结果', clear: '清除', newPh: '新文件夹名', createErr: '创建失败', root: '位置', copyPath: '复制路径', pastePath: '粘贴路径', copiedPath: '已复制路径', pasteEmpty: '剪贴板无路径', pasteFail: '粘贴失败' },
    en: { title: 'Select Folder', inputPh: 'Type an absolute path and press Enter', up: 'Up', home: 'Home', select: 'Select this folder', cancel: 'Cancel', empty: '(empty)', loadErr: 'Read failed',
          fav: 'Favorites', recent: 'Recent', filterPh: 'Filter current list', searchPh: 'Recursive search', newFolder: 'New', addFav: 'Add favorite', searching: 'Searching…', noResults: 'No matches', searchResults: 'Search results', clear: 'Clear', newPh: 'New folder name', createErr: 'Create failed', root: 'Locations', copyPath: 'Copy path', pastePath: 'Paste path', copiedPath: 'Path copied', pasteEmpty: 'Clipboard has no path', pasteFail: 'Paste failed' }
  }

  function t(k) {
    const lang = document.documentElement.lang === 'en' ? 'en' : 'zh'
    return UI[lang][k]
  }

  function toast(msg) {
    const el = document.getElementById('toast')
    if (!el) return
    el.textContent = msg
    el.classList.add('show')
    clearTimeout(toast._t)
    toast._t = setTimeout(() => el.classList.remove('show'), 2000)
  }

  const CSS = `
    .mft-mask { position: fixed; inset: 0; background: rgba(0,0,0,.45); z-index: 9998; display: none; align-items: center; justify-content: center; }
    .mft-mask.show { display: flex; }
    .mft-panel { background: var(--panel-bg, #fff); color: var(--text, #18243A); border: 1px solid var(--border, #E5E7EB); border-radius: 12px; width: 600px; max-width: 92vw; max-height: 82vh; display: flex; flex-direction: column; box-shadow: 0 18px 50px rgba(0,0,0,.25); overflow: hidden; }
    .mft-head { padding: 14px 18px; border-bottom: 1px solid var(--border-soft, #EFF1F4); font-weight: 600; font-size: 14px; }
    .mft-crumb { padding: 6px 18px; display: flex; flex-wrap: wrap; gap: 4px; align-items: center; font-size: 12px; color: var(--text-muted, #8A92A6); border-bottom: 1px solid var(--border-soft, #EFF1F4); }
    .mft-cseg { cursor: pointer; padding: 2px 6px; border-radius: 4px; }
    .mft-cseg:hover { background: var(--primary-soft, #E8F0FE); color: var(--primary, #0A59F7); }
    .mft-csep { opacity: .5; }
    .mft-ccur { color: var(--text, #18243A); font-weight: 600; cursor: default; }
    .mft-ccur:hover { background: none; color: var(--text, #18243A); }
    .mft-quick { padding: 6px 18px; display: flex; flex-wrap: wrap; gap: 6px; align-items: center; border-bottom: 1px solid var(--border-soft, #EFF1F4); max-height: 66px; overflow: auto; }
    .mft-quick:empty { display: none; }
    .mft-chip { display: inline-flex; align-items: center; gap: 4px; padding: 3px 8px; border-radius: 999px; font-size: 12px; cursor: pointer; background: var(--primary-soft, #E8F0FE); color: var(--primary, #0A59F7); border: 1px solid transparent; max-width: 220px; }
    .mft-chip:hover { border-color: var(--primary, #0A59F7); }
    .mft-chip .mft-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .mft-chip .mft-x { opacity: .6; padding: 0 4px; border-radius: 50%; }
    .mft-chip .mft-x:hover { opacity: 1; background: rgba(0,0,0,.12); }
    .mft-chip.rec { background: var(--border-soft, #EFF1F4); color: var(--text-muted, #8A92A6); }
    .mft-chiplabel { font-size: 11px; color: var(--text-muted, #8A92A6); margin-right: 2px; }
    .mft-pathrow { padding: 10px 18px 0; display: flex; gap: 8px; flex-wrap: wrap; }
    .mft-pathrow input { flex: 1; min-width: 120px; }
    .mft-searchrow { padding: 8px 18px 0; display: flex; gap: 8px; }
    .mft-searchrow input { flex: 1; }
    .mft-list { flex: 1; overflow: auto; margin: 10px 18px; border: 1px solid var(--border-soft, #EFF1F4); border-radius: 8px; min-height: 220px; position: relative; }
    .mft-item { padding: 7px 12px; font-size: 13px; cursor: pointer; display: flex; align-items: center; gap: 8px; border-bottom: 1px solid var(--border-soft, #EFF1F4); user-select: none; }
    .mft-item:hover { background: var(--primary-soft, #E8F0FE); }
    .mft-item.active { background: var(--primary-soft, #E8F0FE); outline: 2px solid var(--primary, #0A59F7); outline-offset: -2px; }
    .mft-item.current { background: var(--primary-soft, #E8F0FE); font-weight: 600; }
    .mft-item svg { width: 15px; height: 15px; flex: none; color: var(--primary, #0A59F7); }
    .mft-item .mft-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .mft-empty { padding: 24px; text-align: center; color: var(--text-muted, #8A92A6); font-size: 12px; }
    .mft-newrow { display: flex; gap: 6px; padding: 8px 12px; border-bottom: 1px solid var(--border-soft, #EFF1F4); background: var(--primary-soft, #E8F0FE); }
    .mft-newrow input { flex: 1; }
    .mft-srhead { padding: 6px 12px; font-size: 11px; color: var(--text-muted, #8A92A6); background: var(--border-soft, #EFF1F4); display: flex; justify-content: space-between; align-items: center; }
    .mft-srhead .mft-clear { cursor: pointer; color: var(--primary, #0A59F7); }
    .mft-foot { padding: 12px 18px; border-top: 1px solid var(--border-soft, #EFF1F4); display: flex; gap: 8px; justify-content: flex-end; align-items: center; }
    .mft-ctx { position: fixed; z-index: 9999; background: var(--panel-bg, #fff); border: 1px solid var(--border, #E5E7EB); border-radius: 6px; box-shadow: 0 6px 18px rgba(0,0,0,.18); padding: 4px 0; min-width: 130px; display: none; }
    .mft-ctx.show { display: block; }
    .mft-ctx-item { display: block; width: 100%; padding: 6px 14px; background: none; border: 0; text-align: left; cursor: pointer; font-size: 13px; color: var(--text, #18243A); }
    .mft-ctx-item:hover { background: var(--primary-soft, #E8F0FE); color: var(--primary, #0A59F7); }
  `

  const FOLDER_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>'
  const UP_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18l6-6-6-6"/></svg>'

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

  function ensureModal() {
    if (injected) return
    injected = true
    const style = document.createElement('style')
    style.textContent = CSS
    document.head.appendChild(style)

    mask = document.createElement('div')
    mask.className = 'mft-mask'
    mask.innerHTML = `
      <div class="mft-panel">
        <div class="mft-head">${t('title')}</div>
        <div class="mft-crumb"></div>
        <div class="mft-quick"></div>
        <div class="mft-pathrow">
          <input type="text" class="input-text mft-path" spellcheck="false" />
          <button class="btn btn-ghost btn-sm mft-home"></button>
          <button class="btn btn-ghost btn-sm mft-up"></button>
          <button class="btn btn-ghost btn-sm mft-new"></button>
          <button class="btn btn-ghost btn-sm mft-addfav"></button>
        </div>
        <div class="mft-searchrow">
          <input type="text" class="input-text mft-filter" spellcheck="false" />
          <input type="text" class="input-text mft-search" spellcheck="false" />
        </div>
        <div class="mft-list"></div>
        <div class="mft-foot">
          <button class="btn btn-ghost btn-sm mft-cancel"></button>
          <button class="btn btn-primary btn-sm mft-select"></button>
        </div>
      </div>`
    document.body.appendChild(mask)

    listEl = mask.querySelector('.mft-list')
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
    mask.querySelector('.mft-new').addEventListener('click', showNewRow)
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

    const ctx = document.createElement('div')
    ctx.className = 'mft-ctx'
    ctx.innerHTML = `<button class="mft-ctx-item" data-act="copy-path">${t('copyPath')}</button><button class="mft-ctx-item" data-act="paste-path">${t('pastePath')}</button>`
    mask.appendChild(ctx)
    let ctxPath = ''
    mask.addEventListener('contextmenu', (e) => {
      e.preventDefault()
      const item = e.target.closest('.mft-item')
      ctxPath = (item && item.title) || currentPath || ''
      ctx.classList.add('show')
      ctx.style.left = Math.min(e.clientX, window.innerWidth - 150) + 'px'
      ctx.style.top = Math.min(e.clientY, window.innerHeight - 90) + 'px'
    })
    ctx.addEventListener('click', (e) => {
      const act = e.target.dataset && e.target.dataset.act
      if (!act) return
      ctx.classList.remove('show')
      if (act === 'copy-path') {
        if (!ctxPath) return
        navigator.clipboard.writeText(ctxPath).then(() => toast(t('copiedPath'))).catch(() => toast(t('pasteFail')))
      } else if (act === 'paste-path') {
        navigator.clipboard.readText().then((text) => {
          const p = String(text).trim()
          if (!p) { toast(t('pasteEmpty')); return }
          browseTo(p)
        }).catch(() => toast(t('pasteFail')))
      }
    })
    document.addEventListener('click', () => ctx.classList.remove('show'))
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
      if (i > 0) { const s = document.createElement('span'); s.className = 'mft-csep'; s.textContent = sep; crumbEl.appendChild(s) }
      const seg = document.createElement('span')
      const isLast = i === parts.length - 1
      seg.className = 'mft-cseg' + (isLast ? ' mft-ccur' : '')
      seg.textContent = part
      if (!isLast) seg.addEventListener('click', () => browseTo(acc))
      crumbEl.appendChild(seg)
    })
  }

  function shortName(p) {
    if (!p) return p
    const parts = p.split(/[\\/]/).filter(Boolean)
    return parts[parts.length - 1] || p
  }

  function makeChip(p, isRecent) {
    const chip = document.createElement('span')
    chip.className = 'mft-chip' + (isRecent ? ' rec' : '')
    const name = document.createElement('span'); name.className = 'mft-name'; name.textContent = shortName(p); chip.appendChild(name)
    chip.title = p
    chip.addEventListener('click', (e) => { if (e.target.classList.contains('mft-x')) return; browseTo(p) })
    if (!isRecent) {
      const x = document.createElement('span'); x.className = 'mft-x'; x.textContent = '×'; x.title = t('clear')
      x.addEventListener('click', (e) => { e.stopPropagation(); removeFavorite(p) })
      chip.appendChild(x)
    }
    return chip
  }

  function renderQuickbar() {
    quickEl.innerHTML = ''
    if (favorites.length) {
      const lab = document.createElement('span'); lab.className = 'mft-chiplabel'; lab.textContent = t('fav'); quickEl.appendChild(lab)
      favorites.forEach(p => quickEl.appendChild(makeChip(p, false)))
    }
    if (history.length) {
      const lab = document.createElement('span'); lab.className = 'mft-chiplabel'; lab.textContent = t('recent'); quickEl.appendChild(lab)
      history.forEach(p => quickEl.appendChild(makeChip(p, true)))
    }
  }

  function itemHtml(name, fullPath, isUp) {
    const div = document.createElement('div')
    div.className = 'mft-item' + (isUp ? ' current' : '')
    div.innerHTML = (isUp ? UP_ICON : FOLDER_ICON) + `<span class="mft-name"></span>`
    div.querySelector('.mft-name').textContent = isUp ? '..' : name
    div.title = fullPath
    div.addEventListener('click', () => browseTo(fullPath))
    listEl.appendChild(div)
  }

  function renderCurrent() {
    listEl.innerHTML = ''
    listTargets = []
    activeIndex = -1
    const kw = filterInput.value.trim().toLowerCase()
    if (currentParent) { itemHtml('..', currentParent, true); listTargets.push({ fullPath: currentParent, isUp: true }) }
    const dirs = kw ? currentDirs.filter(d => (d.name || '').toLowerCase().includes(kw)) : currentDirs
    if (!dirs.length && currentPath) {
      const empty = document.createElement('div'); empty.className = 'mft-empty'; empty.textContent = t('empty'); listEl.appendChild(empty); return
    }
    for (const d of dirs) { itemHtml(d.name, d.fullPath, false); listTargets.push({ fullPath: d.fullPath, isUp: false }) }
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

  function cleanPath(p) {
    if (typeof p !== 'string') return p
    const INV = /^[\u200B-\u200D\u2060\u180E\uFEFF]+|[\u200B-\u200D\u2060\u180E\uFEFF]+$/g
    let s = p.replace(INV, '').trim()
    if (s.length >= 2) {
      const a = s[0], b = s[s.length - 1]
      if ((a === '"' && b === '"') || (a === "'" && b === "'") || (a === '`' && b === '`')) s = s.slice(1, -1).replace(INV, '').trim()
    }
    return s
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

  function showNewRow() {
    if (!currentPath) return
    if (listEl.querySelector('.mft-newrow')) return
    const row = document.createElement('div'); row.className = 'mft-newrow'
    row.innerHTML = `<input type="text" class="input-text" placeholder="${t('newPh')}" /><button class="btn btn-primary btn-sm">✓</button><button class="btn btn-ghost btn-sm">✗</button>`
    const inp = row.querySelector('input'); const okBtn = row.querySelector('.btn-primary'); const noBtn = row.querySelector('.btn-ghost')
    const commit = async () => {
      const name = inp.value.trim()
      if (!name) { row.remove(); return }
      const sep = currentPath.includes('\\') && !currentPath.includes('/') ? '\\' : '/'
      const full = currentPath + sep + name
      okBtn.disabled = true
      try {
        const res = await window.api.createFolder(full)
        if (res && res.success) { row.remove(); browseTo(currentPath) }
        else { okBtn.disabled = false; inp.title = (res && res.error) || t('createErr'); inp.style.borderColor = '#e53935' }
      } catch (e) { okBtn.disabled = false; inp.title = e.message; inp.style.borderColor = '#e53935' }
    }
    okBtn.addEventListener('click', commit)
    noBtn.addEventListener('click', () => row.remove())
    inp.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); commit() }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); row.remove() }
    })
    listEl.insertBefore(row, listEl.firstChild)
    inp.focus()
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