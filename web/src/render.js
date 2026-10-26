/**
 * matoga - 材质贴图对比工具
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 */

import {
  state, $, ROLE_LABEL, KIND_TEXT, STATUS_ORDER,
  leftBtn, rightBtn, onlyMissingChk, summaryEl, resultBody,
  leftPathEl, rightPathEl
} from './core.js'
import {
  formatSize, formatDate, isImageFile, fileUrl, escAttr,
  folderOf, mainEntryOf, hasAny, leftRoles, rightRoles, subKind,
  openPreview, relPath, joinPath, modelTypeOf, modelBaseNameOf,
  groupTypeOf, groupContentKind, groupTagOf
} from './utils.js'
import { sortResult } from './compare.js'
import { replaceWithExternalFile, deleteTexture, handleAction, showPixelDiff, copySingleToRight, addTextureToRight, createBlankTextureToRight, saveOptions } from './actions.js'
import { initMaterial3D, updateMaterial3D, clearCustomModel } from './material3d.js'
import { enhancePreview } from './preview2d.js'
import { observeThumbs } from './thumb-loader.js'
import { observeModelThumbs } from './model-thumb.js'
import { parseModelText, buildModelSummary, diffLines, escHtml, isModelEntry } from './model-diff.js'
import { viewMcModelPairInViewport, viewMcModelTexCompareInViewport, isViewportVisible, resolveModelTexList, textureAssetPath } from './mc-model-viewer.js'
import { t, onLocaleChange } from './i18n.js'
import { modelPrefixOf } from './model-prefix.js'

import { renderChart } from './rnd/charts.js'
import { appendModelCard, modelThumbSpec, renderModelThumbPair } from './rnd/model-cards.js'
import { renderSidebar } from './rnd/sidebar.js'
import { _filteredCache, _lastBaseSet, _renderedCount, _rowMap, setFilteredCache, setRenderedCount, setLastBaseSet } from './rnd/state.js'
import { renderThumbPair } from './rnd/cells.js'
import { renderModelTypeResult } from './rnd/model-result.js'
import { appendGroupRows } from './rnd/rows.js'
export { renderResult } from './rnd/result.js'
export { renderChart } from './rnd/charts.js'
export { setLoading, applyEntries, statusBadge, renderThumbPair, bindEmptyCellActions } from './rnd/cells.js'
export { renderModelTypeResult } from './rnd/model-result.js'
export { renderSidebar } from './rnd/sidebar.js'
export { loadModelTexEffectPreview } from './rnd/model-preview.js'
export { appendGroupRows, appendSubRows, selectGroup } from './rnd/rows.js'
export { renderModelDiffGrid, loadModelDiffView } from './rnd/model-diff.js'
export { initViewTabs, updateSortIndicators } from './rnd/charts.js'
