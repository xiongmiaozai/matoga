/**
 * matoga - 目录树选择器：右键菜单
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 从 folder-tree.js 原样搬出，逻辑未改。列表项的复制/粘贴路径菜单，回调由调用方注入。
 */

/**
 * 在 mask 上挂右键菜单。
 * @param {object} p
 * @param {HTMLElement} p.mask 弹窗根元素
 * @param {Function} p.t i18n
 * @param {Function} p.toast 提示
 * @param {Function} p.browseTo 跳转目录
 * @param {() => string} p.getCurrentPath 取当前路径
 */
export function bindContextMenu(p) {
  const { mask, t, toast, browseTo, getCurrentPath } = p

  const ctx = document.createElement('div')
  ctx.className = 'mft-ctx'
  ctx.innerHTML = `<button class="mft-ctx-item" data-act="copy-path">${t('copyPath')}</button><button class="mft-ctx-item" data-act="paste-path">${t('pastePath')}</button>`
  mask.appendChild(ctx)
  let ctxPath = ''
  mask.addEventListener('contextmenu', e => {
    e.preventDefault()
    const item = e.target.closest('.mft-item')
    ctxPath = (item && item.title) || getCurrentPath() || ''
    ctx.classList.add('show')
    ctx.style.left = Math.min(e.clientX, window.innerWidth - 150) + 'px'
    ctx.style.top = Math.min(e.clientY, window.innerHeight - 90) + 'px'
  })
  ctx.addEventListener('click', e => {
    const act = e.target.dataset && e.target.dataset.act
    if (!act) return
    ctx.classList.remove('show')
    if (act === 'copy-path') {
      if (!ctxPath) return
      navigator.clipboard
        .writeText(ctxPath)
        .then(() => toast(t('copiedPath')))
        .catch(() => toast(t('pasteFail')))
    } else if (act === 'paste-path') {
      navigator.clipboard
        .readText()
        .then(text => {
          const p = String(text).trim()
          if (!p) {
            toast(t('pasteEmpty'))
            return
          }
          browseTo(p)
        })
        .catch(() => toast(t('pasteFail')))
    }
  })
  document.addEventListener('click', () => ctx.classList.remove('show'))
}
