/**
 * matoga - UV 编辑器：贴图槽位 UI
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 从 uv-editor-core.js 原样搬出（正文逐字未改）。
 * 职责：重建贴图槽位按钮条（缩略图 + 槽位序号 + 选中态）。
 */

let _get_state = () => undefined
let _get_chipsEl = () => undefined
let _get_layout = () => undefined
let _draw
let _removeTexture
let _t

export function setHooks(h) {
  if (h.get_state) _get_state = h.get_state
  if (h.get_chipsEl) _get_chipsEl = h.get_chipsEl
  if (h.get_layout) _get_layout = h.get_layout
  if (h.draw) _draw = h.draw
  if (h.removeTexture) _removeTexture = h.removeTexture
  if (h.t) _t = h.t
}

export function rebuildChips() {
  if (!_get_chipsEl()) return
  _get_chipsEl().innerHTML = ''
  const layout = _get_state().layout
  if (!layout) return
  layout.textures.forEach((tex, i) => {
    const removed = !tex.url
    const chip = document.createElement('button')
    chip.className = 'uvv-chip' + (i === _get_state().activeTex ? ' active' : '')
    chip.textContent = (tex.name || '#' + i) + (removed ? ' ⊘' : _get_state().customTex.has(i) ? ' ✎' : '')
    chip.title = (tex.name || '') + ' · ' + _t(removed ? 'uv.removed' : 'uv.chipRemoveHint')
    chip.addEventListener('click', () => {
      _get_state().activeTex = i
      _get_state().hover = null
      _get_state().selected = null
      syncEditInputs()
      _get_chipsEl()
        .querySelectorAll('button')
        .forEach(b => b.classList.remove('active'))
      chip.classList.add('active')
      _draw()
    })
    chip.addEventListener('contextmenu', e => {
      e.preventDefault()
      _removeTexture(i)
    })
    _get_chipsEl().appendChild(chip)
  })
}
