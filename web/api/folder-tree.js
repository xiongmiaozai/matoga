/**
 * matoga - 材质贴图对比工具
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 目录树选择器：浏览器无系统目录对话框，经 /api/fs/browse 懒加载浏览并选择。
 */

;(() => {
  const UI = {
    zh: { title: '选择文件夹', inputPh: '输入绝对路径后回车', up: '上级', home: '主目录', select: '选择当前目录', cancel: '取消', empty: '（空目录）', loadErr: '读取失败' },
    en: { title: 'Select Folder', inputPh: 'Type an absolute path and press Enter', up: 'Up', home: 'Home', select: 'Select this folder', cancel: 'Cancel', empty: '(empty)', loadErr: 'Read failed' }
  }

  function t(k) {
    const lang = document.documentElement.lang === 'en' ? 'en' : 'zh'
    return UI[lang][k]
  }

  const CSS = `
    .mft-mask { position: fixed; inset: 0; background: rgba(0,0,0,.45); z-index: 9998; display: none; align-items: center; justify-content: center; }
    .mft-mask.show { display: flex; }
    .mft-panel { background: var(--panel-bg, #fff); color: var(--text, #18243A); border: 1px solid var(--border, #E5E7EB); border-radius: 12px; width: 560px; max-width: 92vw; max-height: 78vh; display: flex; flex-direction: column; box-shadow: 0 18px 50px rgba(0,0,0,.25); overflow: hidden; }
    .mft-head { padding: 14px 18px; border-bottom: 1px solid var(--border-soft, #EFF1F4); font-weight: 600; font-size: 14px; }
    .mft-pathrow { padding: 10px 18px 0; display: flex; gap: 8px; }
    .mft-pathrow input { flex: 1; }
    .mft-list { flex: 1; overflow: auto; margin: 10px 18px; border: 1px solid var(--border-soft, #EFF1F4); border-radius: 8px; min-height: 220px; }
    .mft-item { padding: 7px 12px; font-size: 13px; cursor: pointer; display: flex; align-items: center; gap: 8px; border-bottom: 1px solid var(--border-soft, #EFF1F4); user-select: none; }
    .mft-item:hover { background: var(--primary-soft, #E8F0FE); }
    .mft-item.current { background: var(--primary-soft, #E8F0FE); font-weight: 600; }
    .mft-item svg { width: 15px; height: 15px; flex: none; color: var(--primary, #0A59F7); }
    .mft-item .mft-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .mft-foot { padding: 12px 18px; border-top: 1px solid var(--border-soft, #EFF1F4); display: flex; gap: 8px; justify-content: flex-end; align-items: center; }
    .mft-empty { padding: 24px; text-align: center; color: var(--text-muted, #8A92A6); font-size: 12px; }
  `

  let injected = false
  let mask = null, listEl = null, pathInput = null, currentPath = '', currentParent = null, resolveFn = null

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
        <div class="mft-pathrow">
          <input type="text" class="input-text" spellcheck="false" />
          <button class="btn btn-ghost btn-sm mft-home"></button>
          <button class="btn btn-ghost btn-sm mft-up"></button>
        </div>
        <div class="mft-list"></div>
        <div class="mft-foot">
          <button class="btn btn-ghost btn-sm mft-cancel"></button>
          <button class="btn btn-primary btn-sm mft-select"></button>
        </div>
      </div>`
    document.body.appendChild(mask)

    listEl = mask.querySelector('.mft-list')
    pathInput = mask.querySelector('input')
    mask.querySelector('.mft-home').textContent = t('home')
    mask.querySelector('.mft-up').textContent = t('up')
    mask.querySelector('.mft-cancel').textContent = t('cancel')
    mask.querySelector('.mft-select').textContent = t('select')
    pathInput.placeholder = t('inputPh')

    mask.addEventListener('click', (e) => { if (e.target === mask) close(null) })
    mask.querySelector('.mft-cancel').addEventListener('click', () => close(null))
    mask.querySelector('.mft-select').addEventListener('click', () => close(pathInput.value.trim() || currentPath))
    mask.querySelector('.mft-up').addEventListener('click', () => {
      if (currentParent) browseTo(currentParent)
    })
    mask.querySelector('.mft-home').addEventListener('click', () => browseTo(''))
    pathInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') browseTo(pathInput.value.trim())
    })
  }

  function itemHtml(name, fullPath, isUp) {
    const icon = isUp
      ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18l6-6-6-6"/></svg>'
      : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>'
    const div = document.createElement('div')
    div.className = 'mft-item' + (isUp ? ' current' : '')
    div.innerHTML = icon + `<span class="mft-name"></span>`
    div.querySelector('.mft-name').textContent = isUp ? '..' : name
    div.title = fullPath
    div.addEventListener('click', () => browseTo(fullPath))
    listEl.appendChild(div)
  }

  async function browseTo(p) {
    listEl.innerHTML = `<div class="mft-empty">…</div>`
    try {
      const d = await window.matogaCore.call('GET', '/api/fs/browse' + (p ? '?path=' + encodeURIComponent(p) : ''))
      currentPath = d.path || ''
      currentParent = d.parent || null
      pathInput.value = currentPath
      listEl.innerHTML = ''
      if (d.parent) itemHtml('..', d.parent, true)
      if (!d.dirs.length && currentPath) listEl.innerHTML += `<div class="mft-empty">${t('empty')}</div>`
      for (const dir of d.dirs) itemHtml(dir.name, dir.fullPath, false)
    } catch (e) {
      listEl.innerHTML = `<div class="mft-empty">${t('loadErr')}: ${e.message}</div>`
    }
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
        window.api.getConfig().then(cfg => {
          if (side && cfg[side + 'Path']) prefill = cfg[side + 'Path']
          else if (cfg.lastPath) prefill = cfg.lastPath
        }).then(() => browseTo(prefill)).catch(() => browseTo(''))
      })
    }
  }
})()