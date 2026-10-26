/**
 * matoga - UV 编辑器撤销 / 重做 / 重制 / 重置
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 从 uv-editor-core.js 原样搬出，逻辑未改。
 */

import { UNDO_MAX } from './consts.js'
import {
  applyFaceUvValues, applyFaceRotationValue, faceEntryOf, applyHistoryEntry,
} from './face-ops.js'

/**
 * 创建撤销/重做控制器。
 * @param {object} o
 * @param {object} o.state          uv 编辑器 state
 * @param {object} o.hooks          宿主钩子
 * @param {Function} o.t            i18n
 * @param {Function} o.getEls       返回 { undoBtn, redoBtn }
 * @param {Function} o.selectedFace 当前选中面
 * @param {Function} o.syncEditInputs 同步编辑输入框
 * @param {Function} o.updateStatus   刷新状态栏
 * @param {Function} o.draw           重绘
 * @param {Function} o.notifyDirty    脏状态通知
 * @param {Function} o.defaultFaceUv  默认面 UV 计算（vanilla 规则）
 */
export function createHistory(o) {
  const {
    state, hooks, t, getEls, selectedFace, syncEditInputs,
    updateStatus, draw, notifyDirty, defaultFaceUv,
  } = o

  /* 取 layout 面当前值（撤销/重做互推时保存“另一侧”状态用） */
  function pushUndo(entry) {
    state.undoStack.push(entry)
    state.redoStack.length = 0   /* 新编辑 → 重做历史分叉失效 */
    if (state.undoStack.length > UNDO_MAX) state.undoStack.shift()
    syncUndoButtons()
    notifyDirty()
  }

  function undoEdit() {
    const entry = state.undoStack.pop()
    if (!entry) return
    const cur = faceEntryOf(entry.layEl, entry.key)
    applyHistoryEntry(entry, hooks)
    if (cur && cur.uv) state.redoStack.push(cur)
    syncEditInputs()
    updateStatus()
    draw()
    notifyDirty()
  }

  function redoEdit() {
    const entry = state.redoStack.pop()
    if (!entry) return
    const cur = faceEntryOf(entry.layEl, entry.key)
    applyHistoryEntry(entry, hooks)
    if (cur && cur.uv) state.undoStack.push(cur)   /* 直接入栈（不经 pushUndo，避免清空 redo） */
    syncEditInputs()
    updateStatus()
    draw()
    notifyDirty()
  }

  /* 撤销/重做按钮禁用态同步 */
  function syncUndoButtons() {
    const { undoBtn, redoBtn } = getEls()
    if (undoBtn) undoBtn.disabled = state.undoStack.length === 0
    if (redoBtn) redoBtn.disabled = state.redoStack.length === 0
  }

  /* 重制：按元素尺寸（vanilla 规则）重算选中面默认 UV；无元素引用时回退全幅 */
  function remakeSelected() {
    const f = selectedFace()
    if (!f || !state.selected) return
    const layEl = state.selected.el
    const scale = (state.layout && state.layout.uvScale) || 16
    const el = layEl.el
    let def = null
    if (typeof defaultFaceUv === 'function' && el && Array.isArray(el.from) && Array.isArray(el.to)) {
      def = defaultFaceUv(state.selected.key, el.from, el.to, scale)
    }
    if (!def) def = [0, 0, scale, scale]
    pushUndo({ layEl, key: state.selected.key, uv: [...f.uv], rotation: f.rotation })
    applyFaceUvValues(layEl, state.selected.key, def, hooks)
    syncEditInputs()
    updateStatus()
    draw()
  }

  function resetEdits() {
    const layout = state.layout
    if (!layout || !state.snapshot) return
    try {
      if (typeof confirm === 'function' && !confirm(t('uv.resetConfirm'))) return
    } catch {}
    layout.elements.forEach((el, i) => {
      const snapEl = state.snapshot[i]
      if (!snapEl) return
      for (const key in snapEl.faces) {
        const sf = snapEl.faces[key]
        applyFaceUvValues(el, key, sf.uv, hooks)
        applyFaceRotationValue(el, key, sf.rotation, hooks)
      }
    })
    state.undoStack.length = 0
    state.redoStack.length = 0
    syncUndoButtons()
    syncEditInputs()
    updateStatus()
    draw()
    notifyDirty()
  }

  return {
    pushUndo, undoEdit, redoEdit, syncUndoButtons, remakeSelected, resetEdits,
  }
}
