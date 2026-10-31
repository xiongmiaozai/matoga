/**
 * matoga - UV 编辑器面板：保存状态与提示
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 从 panel.js 按职责搬出，逻辑未改。
 */
import { t, onLocaleChange } from '../../../i18n.js'
import { S } from './state.js'

export function canSave() {
  return S.source.mode === 'offline' && !!S.source.json
}

export function updateSaveButton() {
  if (!S.saveBtn) return
  const dirty = !!(S.editor && S.editor.isDirty())
  S.saveBtn.disabled = !(canSave() && dirty)
  S.saveBtn.classList.toggle('dirty', canSave() && dirty)
}

export function updateHint() {
  if (!S.hintEl) return
  const dirty = !!(S.editor && S.editor.isDirty())
  if (S.source.mode === 'viewport') {
    S.hintEl.textContent = t('uv.panelViewportHint')
  } else {
    S.hintEl.textContent = (S.source.name || S.source.id || '') + (S.source.isBb ? ' · bbmodel' : ' · mc json')
  }
  S.hintEl.classList.toggle('dirty', dirty && canSave())
  updateSaveButton()
}

/* ── 初始化（panel-loader 调用，幂等） ─────────────────────────────────── */
