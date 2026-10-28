/**
 * matoga - 材质贴图对比工具
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 */
import { state, showToast, undoBtn } from '../core.js'
import { renderResult, renderSidebar } from '../render.js'
import { t } from '../i18n.js'
import { reloadAndCompare } from './load.js'

export function pushHistory(entries) {
  state.history.push({ entries, time: Date.now() })
  if (state.history.length > 50) state.history.shift()
  updateUndoBtn()
}

export function updateUndoBtn() {
  if (undoBtn) undoBtn.disabled = state.history.length === 0
}

export async function undo() {
  if (state.history.length === 0) { showToast(t('toast.noUndo')); return }
  const last = state.history[state.history.length - 1]
  let ok = 0, fail = 0
  const errors = []
  for (const e of last.entries) {
    if (e.backupPath) {
      const r = await window.api.copyFile(e.backupPath, e.destPath)
      if (r.success) ok++; else { fail++; errors.push(r.error || t('toast.restoreFail')) }
    } else {
      const r = await window.api.deleteFile(e.destPath)
      if (r.success) ok++; else { fail++; errors.push(r.error || t('toast.deleteFail')) }
    }
  }
  if (ok > 0) {
    state.history.pop()
    updateUndoBtn()
    const savedKey = state.selected ? state.selected.key : null
    await reloadAndCompare()
    if (savedKey) {
      const g = state.result.find(r => r.key === savedKey)
      if (g) { state.selected = g; renderResult(); renderSidebar() }
    }
    showToast(fail ? t('toast.undoneWithFail', { n: ok, fail }) : t('toast.undone', { n: ok }))
  } else {
    showToast(t('toast.undoFail', { msg: errors[0] || t('toast.unknownError') }))
  }
}
