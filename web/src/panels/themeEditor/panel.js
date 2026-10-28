/**
 * matoga - 主题编辑器面板
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 */

import { t } from '../../i18n.js'
import { showToast } from '../../core.js'
import { initThemes, applyTheme, getRegistry, getActiveId, resolveTokens } from '../../theme/registry.js'
import { S } from './tp/state.js'

import { renderGrid } from './tp/grid.js'
import { applyDraft, deleteCurrent, exportCurrent, importFile, saveDraft, startNew } from './tp/draft.js'
export async function init() {
  await initThemes()
  renderGrid()
  const newBtn = document.getElementById('themeNewBtn')
  if (newBtn) newBtn.addEventListener('click', startNew)
  const importBtn = document.getElementById('themeImportBtn')
  const importFileInput = document.getElementById('themeImportFile')
  if (importBtn && importFileInput) {
    importBtn.addEventListener('click', () => importFileInput.click())
    importFileInput.addEventListener('change', () => {
      const f = importFileInput.files && importFileInput.files[0]
      if (f) importFile(f)
      importFileInput.value = ''
    })
  }
  const saveBtn = document.getElementById('themeSaveBtn')
  if (saveBtn) saveBtn.addEventListener('click', saveDraft)
  const delBtn = document.getElementById('themeDeleteBtn')
  if (delBtn) delBtn.addEventListener('click', deleteCurrent)
  const expBtn = document.getElementById('themeExportBtn')
  if (expBtn) expBtn.addEventListener('click', exportCurrent)
  const nameInput = document.getElementById('themeNameInput')
  if (nameInput)
    nameInput.addEventListener('input', () => {
      S.draftName = nameInput.value
    })
  const modeChk = document.getElementById('themeModeChk')
  if (modeChk)
    modeChk.addEventListener('change', () => {
      S.draftMode = modeChk.checked ? 'dark' : 'light'
      applyDraft()
    })
}
