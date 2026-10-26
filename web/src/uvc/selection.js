/**
 * matoga - UV 编辑器选中面与编辑值应用
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 从 uv-editor-core.js 原样搬出，逻辑未改。
 */

import { fmtUvNum } from './utils.js'
import { applyFaceUvValues, applyFaceRotationValue } from './face-ops.js'

/**
 * 创建选中/编辑控制器。
 * @param {object} o
 * @param {object} o.state                  uv 编辑器 state
 * @param {Function} o.getEls               返回 { canvas, editBtn, editBar, uvInputs }
 * @param {object} o.hooks                  宿主钩子
 * @param {Function} o.t                    i18n
 * @param {Function} o.pushUndo             压入撤销快照
 * @param {Function} o.syncUndoButtons      刷新撤销/重做按钮态
 * @param {Function} o.updateActiveHighlight 同步 3D 高亮
 * @param {Function} o.draw                 重绘
 * @param {Function} o.updateStatus         刷新状态栏
 */
export function createSelection(o) {
  const {
    state, getEls, hooks, t, pushUndo, syncUndoButtons,
    updateActiveHighlight, draw, updateStatus,
  } = o

  function selectedFace() {
    return state.selected ? state.selected.face : null
  }

  function selectedRect() {
    if (!state.selected) return null
    return state.rects.find(rc => rc.el === state.selected.el && rc.key === state.selected.key) || null
  }

  function syncEditInputs() {
    const { uvInputs } = getEls()
    const f = selectedFace()
    if (uvInputs) {
      uvInputs.forEach((inp, i) => {
        inp.disabled = !f
        if (f && Array.isArray(f.uv)) inp.value = String(fmtUvNum(f.uv[i]))
      })
    }
    syncUndoButtons()
  }

  function selectFace(rc) {
    if (state.selected && state.selected.el === rc.el && state.selected.key === rc.key) return
    state.selected = { el: rc.el, face: rc.face, key: rc.key, elIdx: rc.elIdx }
    syncEditInputs()
    updateActiveHighlight()
    draw()
  }

  function clearSelection() {
    if (!state.selected) return
    state.selected = null
    syncEditInputs()
    updateActiveHighlight()
    draw()
  }

  function setEdit(on) {
    const { editBtn, editBar, canvas } = getEls()
    if (on && state.layout && state.layout.sprite) {
      state.notice = t('uv.spriteNoEdit')
      updateStatus()
      return
    }
    state.notice = null
    state.edit = !!(on && state.layout)
    state.selected = null
    state.drag = null
    if (editBtn) editBtn.classList.toggle('active', state.edit)
    if (editBar) editBar.classList.toggle('show', state.edit)
    if (canvas) canvas.style.cursor = state.edit ? 'crosshair' : ''
    syncEditInputs()
    updateActiveHighlight()
    draw()
  }

  function applyUvInput() {
    const { uvInputs } = getEls()
    const f = selectedFace()
    if (!f || !state.selected || !uvInputs) { state.inputOrig = null; return }
    const uv = uvInputs.map(inp => +inp.value)
    const scale = (state.layout && state.layout.uvScale) || 16
    if (!uv.every(n => Number.isFinite(n))) { syncEditInputs(); return }
    const cuv = uv.map(v => Math.min(Math.max(Math.round(v * 4) / 4, 0), scale))
    if (cuv.every((v, i) => v === f.uv[i])) { state.inputOrig = null; return }
    const orig = (state.inputOrig && state.inputOrig.length === 4) ? [...state.inputOrig] : [...f.uv]
    pushUndo({ layEl: state.selected.el, key: state.selected.key, uv: orig, rotation: f.rotation })
    state.inputOrig = null
    applyFaceUvValues(state.selected.el, state.selected.key, cuv, hooks)
    syncEditInputs()
    draw()
  }

  function rotateSelected() {
    const f = selectedFace()
    if (!f || !state.selected) return
    pushUndo({ layEl: state.selected.el, key: state.selected.key, uv: [...f.uv], rotation: f.rotation })
    applyFaceRotationValue(state.selected.el, state.selected.key, ((f.rotation || 0) + 90) % 360, hooks)
    updateStatus()
    draw()
  }

  function mirrorSelected() {
    const f = selectedFace()
    if (!f || !state.selected) return
    pushUndo({ layEl: state.selected.el, key: state.selected.key, uv: [...f.uv], rotation: f.rotation })
    applyFaceUvValues(state.selected.el, state.selected.key, [f.uv[2], f.uv[1], f.uv[0], f.uv[3]], hooks)
    updateStatus()
    draw()
  }

  return {
    selectedFace, selectedRect, syncEditInputs,
    selectFace, clearSelection, setEdit,
    applyUvInput, rotateSelected, mirrorSelected,
  }
}
