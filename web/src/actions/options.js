/**
 * matoga - 材质贴图对比工具
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 */
import { state, showToast, recursiveChk, hashChk, onlyMissingChk, ignoreChk, ignoreInput } from '../core.js'
import { renderResult, renderSidebar } from '../render.js'
import { t } from '../i18n.js'
import { copyToSide } from './copy.js'
import { uploadModelToRight } from './file-ops.js'

export function saveOptions() {
  window.api.setConfig({
    recursive: recursiveChk.checked,
    hash: hashChk.checked,
    onlyMissing: onlyMissingChk.checked,
    ignoreSys: ignoreChk.checked,
    ignoreCustom: ignoreInput.value,
    viewMode: state.viewMode,
    sortKey: state.sortKey,
    sortDir: state.sortDir,

    hiddenKeys: [...state.hiddenKeys],
    categoryFilter: state.categoryFilter,
    customTags: state.customTags
  })
}

export function setGroupTag(g, tag) {
  if (!g || !tag) return
  state.customTags[g.key] = tag
  saveOptions()
  renderResult()
  if (state.selected && state.selected.key === g.key) renderSidebar()
  showToast(t('toast.tagSet', { name: g.key, tag }))
}

export function clearGroupTag(g) {
  if (!g) return
  delete state.customTags[g.key]
  saveOptions()
  renderResult()
  if (state.selected && state.selected.key === g.key) renderSidebar()
  showToast(t('toast.tagCleared', { name: g.key }))
}

export function handleAction(act, g) {
  const pickEntry = (side) => { const s = g[side]; if (!s) return null; return s.main || s.file || s.dir || s.normal || s.specular || null }
  const lt = pickEntry('left')
  const rt = pickEntry('right')
  if (act === 'open-left' && lt) window.api.openPath(lt.fullPath)
  else if (act === 'open-right' && rt) window.api.openPath(rt.fullPath)
  else if (act === 'loc-left' && lt) window.api.showInFolder(lt.fullPath)
  else if (act === 'loc-right' && rt) window.api.showInFolder(rt.fullPath)
  else if (act === 'copy') {
    navigator.clipboard.writeText(g.key).then(() => showToast(t('toast.copiedName'))).catch(() => showToast(t('toast.copyFail')))
  }
  else if (act === 'copy-to-right') copyToSide(g, 'right')
  else if (act === 'copy-to-left') copyToSide(g, 'left')
  else if (act === 'upload-model-right') uploadModelToRight(g)
}
