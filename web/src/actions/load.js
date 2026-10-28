/**
 * matoga - 材质贴图对比工具
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 */
import { state, showToast, compareBtn2, recursiveChk } from '../core.js'
import { getIgnorePatterns } from '../utils.js'
import { compare } from '../compare.js'
import { applyEntries, setLoading, renderSidebar } from '../render.js'
import { t } from '../i18n.js'

export async function loadFromPath(side, folderPath, opts) {
  setLoading(side, true)
  const forceRecursive = !!(opts && opts.forceRecursive)
  if (forceRecursive && recursiveChk && !recursiveChk.checked) {
    recursiveChk.checked = true
    window.api.setConfig({ recursive: true })
  }
  const recursive = forceRecursive || recursiveChk.checked
  const ignore = getIgnorePatterns()
  const res = recursive ? await window.api.readRecursive(folderPath, ignore) : await window.api.readEntries(folderPath, ignore)
  setLoading(side, false)
  if (!res.success) { showToast(t('toast.readFail', { msg: res.error })); return }
  applyEntries(side, folderPath, res.entries)
  updateCompareButton()
  window.api.setConfig({ [side + 'Path']: folderPath })
}

export async function loadFolder(side) {
  const folderPath = await window.api.selectFolder(side)
  if (!folderPath) return
  await loadFromPath(side, folderPath)
}

export function updateCompareButton() {
  const enabled = !!(state.leftPath && state.rightPath)

  if (compareBtn2) compareBtn2.disabled = !enabled
}
export async function reloadAndCompare() {
  const prevKey = state.selected && state.selected.key
  if (state.leftPath) await loadFromPath('left', state.leftPath)
  if (state.rightPath) await loadFromPath('right', state.rightPath)
  if (state.leftPath && state.rightPath) await compare()
  if (prevKey) {
    const g = state.result.find(g => g.key === prevKey)
    if (g) { state.selected = g; renderSidebar() }
  }
}
