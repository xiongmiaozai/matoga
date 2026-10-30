/**
 * matoga - 工作区：克隆面板实例
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 从 workspace.js 按职责搬出，逻辑未改。
 */
import { S } from './state.js'

export function createPanelClone(original) {
  const clone = original.cloneNode(true)
  clone.classList.add('gl-panel-content', 'gl-panel-clone')
  clone.removeAttribute('id')
  clone.querySelectorAll('[id]').forEach(el => el.removeAttribute('id'))
  stripCloneViewport(clone)
  bindCloneDelegation(clone, original)
  syncCloneFromOriginal(original, clone)
  return clone
}

export function stripCloneViewport(clone) {
  clone.querySelectorAll('.material3d-container').forEach(c => {
    c.querySelectorAll('canvas').forEach(cv => cv.remove())
    c.classList.remove('m3d-host-active')
    const hint = c.querySelector('.m3d-host-empty')
    if (hint) hint.style.display = 'none'
  })
}

export function bindCloneDelegation(clone, original) {
  function getOrigEl(target) {
    const path = []
    let node = target
    while (node && node !== clone) {
      const parent = node.parentElement
      if (!parent) return null
      path.unshift(Array.from(parent.children).indexOf(node))
      node = parent
    }
    if (node !== clone) return null
    let result = original
    for (const i of path) {
      result = result.children[i]
      if (!result) return null
    }
    return result
  }
  const interactive = 'button, input, select, label, [data-act], th[data-key], .filter-btn, .view-tab, .sortable, .panel-card-title'
  clone.addEventListener('click', (e) => {
    const t = e.target.closest(interactive)
    if (!t) return
    const orig = getOrigEl(t)
    if (orig && orig !== original) orig.click()
  }, true)
  clone.addEventListener('input', (e) => {
    const orig = getOrigEl(e.target)
    if (orig && orig !== original) {
      orig.value = e.target.value
      orig.dispatchEvent(new Event('input', { bubbles: true }))
    }
  }, true)
  clone.addEventListener('change', (e) => {
    const orig = getOrigEl(e.target)
    if (orig && orig !== original) {
      if (orig.type === 'checkbox' || orig.type === 'radio') orig.checked = e.target.checked
      else orig.value = e.target.value
      orig.dispatchEvent(new Event('change', { bubbles: true }))
    }
  }, true)
  clone.addEventListener('dblclick', (e) => {
    const orig = getOrigEl(e.target)
    if (orig && orig !== original) orig.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
  }, true)
}

export function syncCloneFromOriginal(original, clone) {
  const observer = new MutationObserver(() => {
    if (!clone.isConnected) { observer.disconnect(); return }
    const html = original.innerHTML
    if (clone._lastHtml !== html) {
      clone._lastHtml = html
      clone.innerHTML = html
      clone.querySelectorAll('[id]').forEach(el => el.removeAttribute('id'))
      stripCloneViewport(clone)
    }
  })
  observer.observe(original, { childList: true, subtree: true, characterData: true, attributes: true })
  S.cloneObservers.push(observer)
}

