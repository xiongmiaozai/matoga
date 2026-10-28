/**
 * matoga - 主题编辑器面板：网格与 token 列表渲染
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 从 panel.js 按职责搬出，逻辑未改。
 */

import { escapeHtml } from './helpers.js'

import { initThemes, applyTheme, getRegistry, getActiveId, resolveTokens } from '../../../theme/registry.js'
import { S } from './state.js'
import { applyDraft, currentResolved, startEdit, stopEdit } from './draft.js'
import { hexify, isColorVal } from './helpers.js'

export function renderGrid() {
  const grid = document.getElementById('themeGrid')
  if (!grid) return
  const reg = getRegistry()
  const active = getActiveId()
  grid.innerHTML = ''
  for (const def of reg.values()) {
    const card = document.createElement('button')
    card.className = 'theme-card' + (def.id === active ? ' active' : '')
    card.dataset.id = def.id
    const swatches = ['--primary', '--accent', '--bg', '--panel-bg']
    const tokens = resolveTokens(def)
    const sw = swatches.map(k => `<span class="theme-sw" style="background:${tokens[k] || '#888'}"></span>`).join('')
    card.innerHTML = `<span class="theme-card-name">${escapeHtml(def.name)}</span><span class="theme-card-sw">${sw}</span>${def.builtin ? '' : '<span class="theme-card-tag">自定义</span>'}`
    card.addEventListener('click', () => {
      applyTheme(def.id)
      renderGrid()
      if (!def.builtin) startEdit(def)
      else stopEdit()
    })
    grid.appendChild(card)
  }
}


export function renderTokenList(containerId, keys) {
  const el = document.getElementById(containerId)
  if (!el) return
  const resolved = currentResolved()
  el.innerHTML = ''
  for (const k of keys) {
    const val = S.draftTokens[k] !== undefined ? S.draftTokens[k] : resolved[k] || ''
    const row = document.createElement('div')
    row.className = 'theme-token-row'
    const label = document.createElement('span')
    label.className = 'theme-token-label'
    label.textContent = k
    row.appendChild(label)
    if (isColorVal(val)) {
      const color = document.createElement('input')
      color.type = 'color'
      color.value = hexify(val)
      color.className = 'theme-token-color'
      color.addEventListener('input', () => {
        S.draftTokens[k] = color.value
        applyDraft()
      })
      row.appendChild(color)
      const text = document.createElement('input')
      text.type = 'text'
      text.value = val
      text.className = 'input-text theme-token-text'
      text.addEventListener('change', () => {
        S.draftTokens[k] = text.value
        if (isColorVal(text.value)) color.value = hexify(text.value)
        applyDraft()
      })
      row.appendChild(text)
    } else {
      const text = document.createElement('input')
      text.type = 'text'
      text.value = val
      text.className = 'input-text theme-token-text'
      text.addEventListener('input', () => {
        S.draftTokens[k] = text.value
        applyDraft()
      })
      row.appendChild(text)
    }
    el.appendChild(row)
  }
}

