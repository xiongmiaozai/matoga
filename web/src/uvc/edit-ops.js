/**
 * matoga - UV 编辑器：UV 编辑操作
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 从 uv-editor-core.js 原样搬出（正文逐字未改）。
 * 职责：数值输入应用到选中面、重置全部编辑。
 */

let _get_state = () => ({})
let _get_layout = () => ({})
let _uvInputs
let _selectedFace
let _applyFaceUvValues
let _pushUndo
let _draw
let _syncUndoButtons
let _notifyDirty
let _updateStatus

export function setHooks(h) {
  if (h.get_state) _get_state = h.get_state
  if (h.get_layout) _get_layout = h.get_layout
  if (h.uvInputs) _uvInputs = h.uvInputs
  if (h.selectedFace) _selectedFace = h.selectedFace
  if (h.applyFaceUvValues) _applyFaceUvValues = h.applyFaceUvValues
  if (h.pushUndo) _pushUndo = h.pushUndo
  if (h.draw) _draw = h.draw
  if (h.syncUndoButtons) _syncUndoButtons = h.syncUndoButtons
  if (h.notifyDirty) _notifyDirty = h.notifyDirty
  if (h.updateStatus) _updateStatus = h.updateStatus
}

export function applyUvInput() {
  const f = _selectedFace()
  if (!f || !_get_state().selected) {
    _get_state().inputOrig = null
    return
  }
  const uv = uvInputs.map(inp => +inp.value)
  const maxW = _get_state().uvMaxW || 16
  const maxH = _get_state().uvMaxH || 16
  if (!uv.every(n => Number.isFinite(n))) {
    syncEditInputs()
    return
  }
  const cuv = [
    Math.min(Math.max(Math.round(uv[0] * 4) / 4, 0), maxW),
    Math.min(Math.max(Math.round(uv[1] * 4) / 4, 0), maxH),
    Math.min(Math.max(Math.round(uv[2] * 4) / 4, 0), maxW),
    Math.min(Math.max(Math.round(uv[3] * 4) / 4, 0), maxH)
  ]
  if (cuv.every((v, i) => v === f.uv[i])) {
    _get_state().inputOrig = null
    return
  }
  const orig = _get_state().inputOrig && _get_state().inputOrig.length === 4 ? [...state.inputOrig] : [...f.uv]
  _pushUndo({ layEl: _get_state().selected.el, key: _get_state().selected.key, uv: orig, rotation: f.rotation })
  _get_state().inputOrig = null
  _applyFaceUvValues(_get_state().selected.el, _get_state().selected.key, cuv)
  syncEditInputs()
  _draw()
}

export function resetEdits() {
  const layout = _get_state().layout
  if (!layout || !_get_state().snapshot) return
  try {
    if (typeof confirm === 'function' && !confirm(t('uv.resetConfirm'))) return
  } catch {}
  layout.elements.forEach((el, i) => {
    const snapEl = _get_state().snapshot[i]
    if (!snapEl) return
    for (const key in snapEl.faces) {
      const sf = snapEl.faces[key]
      _applyFaceUvValues(el, key, sf.uv)
      applyFaceRotationValue(el, key, sf.rotation)
    }
  })
  _get_state().undoStack.length = 0
  _get_state().redoStack.length = 0
  _syncUndoButtons()
  syncEditInputs()
  _updateStatus()
  _draw()
  _notifyDirty()
}
