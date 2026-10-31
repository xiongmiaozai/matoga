/**
 * matoga - UV 编辑器：编辑模式切换
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 从 uv-editor-core.js 原样搬出（正文逐字未改）。
 * 职责：进入/退出 UV 编辑态（sprite 模型不支持编辑，给出提示后拒绝）。
 */

let _get_state = () => undefined
let _get_editBtn = () => undefined
let _get_editBar = () => undefined
let _get_canvas = () => undefined
let _syncEditInputs
let _updateActiveHighlight
let _draw
let _updateStatus
let _t

export function setHooks(h) {
  if (h.get_state) _get_state = h.get_state
  if (h.get_editBtn) _get_editBtn = h.get_editBtn
  if (h.get_editBar) _get_editBar = h.get_editBar
  if (h.get_canvas) _get_canvas = h.get_canvas
  if (h.syncEditInputs) _syncEditInputs = h.syncEditInputs
  if (h.updateActiveHighlight) _updateActiveHighlight = h.updateActiveHighlight
  if (h.draw) _draw = h.draw
  if (h.updateStatus) _updateStatus = h.updateStatus
  if (h.t) _t = h.t
}

export function setEdit(on) {
  if (on && _get_state().layout && _get_state().layout.sprite) {
    _get_state().notice = _t('uv.spriteNoEdit')
    _updateStatus()
    return
  }
  _get_state().notice = null
  _get_state().edit = !!(on && _get_state().layout)
  _get_state().selected = null
  _get_state().drag = null
  if (_get_editBtn()) _get_editBtn().classList.toggle('active', _get_state().edit)
  if (_get_editBar()) _get_editBar().classList.toggle('show', _get_state().edit)
  if (_get_canvas()) _get_canvas().style.cursor = _get_state().edit ? 'crosshair' : ''
  _syncEditInputs()
  _updateActiveHighlight()
  _draw()
}
