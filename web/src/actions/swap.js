/**
 * matoga - 材质贴图对比工具
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 */
import { state, showToast, leftPathEl, rightPathEl } from '../core.js'
import { compare } from '../compare.js'
import { t } from '../i18n.js'
import { updateCompareButton } from './load.js'

export function swapFolders() {
  const tp = state.leftPath, te = state.leftEntries
  state.leftPath = state.rightPath; state.leftEntries = state.rightEntries
  state.rightPath = tp; state.rightEntries = te
  leftPathEl.textContent = state.leftPath || t('common.empty')
  rightPathEl.textContent = state.rightPath || t('common.empty')

  updateCompareButton()
  if (state.leftPath && state.rightPath) compare()
  showToast(t('toast.swapped'))
}
