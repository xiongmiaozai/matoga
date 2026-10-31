/**
 * matoga - 材质贴图对比工具
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 从 workspace.js L339-L401 原样搬出（正文逐字未改）。
 */

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
  const interactive =
    'button, input, select, label, [data-act], th[data-key], .filter-btn, .view-tab, .sortable, .panel-card-title'
  clone.addEventListener(
    'click',
    e => {
      const t = e.target.closest(interactive)
      if (!t) return
      const orig = getOrigEl(t)
      if (orig && orig !== original) orig.click()
    },
    true
  )
  clone.addEventListener(
    'input',
    e => {
      const orig = getOrigEl(e.target)
      if (orig && orig !== original) {
        orig.value = e.target.value
        orig.dispatchEvent(new Event('input', { bubbles: true }))
      }
    },
    true
  )
  clone.addEventListener(
    'change',
    e => {
      const orig = getOrigEl(e.target)
      if (orig && orig !== original) {
        if (orig.type === 'checkbox' || orig.type === 'radio') orig.checked = e.target.checked
        else orig.value = e.target.value
        orig.dispatchEvent(new Event('change', { bubbles: true }))
      }
    },
    true
  )
  clone.addEventListener(
    'dblclick',
    e => {
      const orig = getOrigEl(e.target)
      if (orig && orig !== original) orig.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
    },
    true
  )
}
