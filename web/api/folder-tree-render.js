/**
 * matoga - 目录树选择器：列表渲染
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 从 folder-tree.js 原样搬出，逻辑未改。列表项、快捷 chip、新建行三块
 * 渲染逻辑，全部通过 deps 注入闭包依赖（browseTo / t / listEl 等）。
 */

/**
 * 创建快捷栏 chip（收藏或最近）。
 * @param {object} deps
 * @param {Function} deps.t i18n
 * @param {Function} deps.shortName 取短名
 * @param {Function} deps.browseTo 跳转目录
 * @param {Function} deps.removeFavorite 移除收藏
 * @param {string} p 路径
 * @param {boolean} isRecent 是否为最近记录
 * @returns {HTMLElement}
 */
export function makeChip(deps, p, isRecent) {
  const { t, shortName, browseTo, removeFavorite } = deps
  const chip = document.createElement('span')
  chip.className = 'mft-chip' + (isRecent ? ' rec' : '')
  const name = document.createElement('span')
  name.className = 'mft-name'
  name.textContent = shortName(p)
  chip.appendChild(name)
  chip.title = p
  chip.addEventListener('click', e => {
    if (e.target.classList.contains('mft-x')) return
    browseTo(p)
  })
  if (!isRecent) {
    const x = document.createElement('span')
    x.className = 'mft-x'
    x.textContent = '×'
    x.title = t('clear')
    x.addEventListener('click', e => {
      e.stopPropagation()
      removeFavorite(p)
    })
    chip.appendChild(x)
  }
  return chip
}

/**
 * 往列表追加一个目录项。
 * @param {object} deps
 * @param {HTMLElement} deps.listEl 列表容器
 * @param {Function} deps.browseTo 跳转目录
 * @param {string} deps.UP_ICON 上级图标
 * @param {string} deps.FOLDER_ICON 目录图标
 * @param {string} name 显示名
 * @param {string} fullPath 完整路径
 * @param {boolean} isUp 是否为上级项
 */
export function itemHtml(deps, name, fullPath, isUp) {
  const { listEl, browseTo, UP_ICON, FOLDER_ICON } = deps
  const div = document.createElement('div')
  div.className = 'mft-item' + (isUp ? ' current' : '')
  div.innerHTML = (isUp ? UP_ICON : FOLDER_ICON) + `<span class="mft-name"></span>`
  div.querySelector('.mft-name').textContent = isUp ? '..' : name
  div.title = fullPath
  div.addEventListener('click', () => browseTo(fullPath))
  listEl.appendChild(div)
}

/**
 * 在列表顶部插入「新建文件夹」行。
 * @param {object} deps
 * @param {HTMLElement} deps.listEl 列表容器
 * @param {Function} deps.t i18n
 * @param {Function} deps.browseTo 跳转目录
 * @param {() => string} deps.getCurrentPath 取当前路径
 */
export function showNewRow(deps) {
  const { listEl, t, browseTo, getCurrentPath } = deps
  const currentPath = getCurrentPath()
  if (!currentPath) return
  if (listEl.querySelector('.mft-newrow')) return
  const row = document.createElement('div')
  row.className = 'mft-newrow'
  row.innerHTML = `<input type="text" class="input-text" placeholder="${t('newPh')}" /><button class="btn btn-primary btn-sm">✓</button><button class="btn btn-ghost btn-sm">✗</button>`
  const inp = row.querySelector('input')
  const okBtn = row.querySelector('.btn-primary')
  const noBtn = row.querySelector('.btn-ghost')
  const commit = async () => {
    const name = inp.value.trim()
    if (!name) {
      row.remove()
      return
    }
    const sep = currentPath.includes('\\') && !currentPath.includes('/') ? '\\' : '/'
    const full = currentPath + sep + name
    okBtn.disabled = true
    try {
      const res = await window.api.createFolder(full)
      if (res && res.success) {
        row.remove()
        browseTo(currentPath)
      } else {
        okBtn.disabled = false
        inp.title = (res && res.error) || t('createErr')
        inp.style.borderColor = 'var(--danger)'
      }
    } catch (e) {
      okBtn.disabled = false
      inp.title = e.message
      inp.style.borderColor = 'var(--danger)'
    }
  }
  okBtn.addEventListener('click', commit)
  noBtn.addEventListener('click', () => row.remove())
  inp.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      e.preventDefault()
      e.stopPropagation()
      commit()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      row.remove()
    }
  })
  listEl.insertBefore(row, listEl.firstChild)
  inp.focus()
}
