/**
 * matoga - 总资产库：ctx-menu
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 从 asset-library.js 原样搬出，逻辑未改。
 */
import { state, IMG_EXTS, showToast } from '../core.js'
import { t, onLocaleChange } from '../i18n.js'
import { el, shade, loadList, saveList } from './dom.js'
import { S, BROWSE_CLICK_DELAY } from './store.js'
import { isFav, pushRecent, resolveLocatePath, toggleFav } from './items.js'
import { deleteUserModel } from './sections-model.js'
import { deleteProjectAsset, renameProjectAsset, updateProjectWithCanvas } from './projects.js'
import { deleteCanvasPreset } from './presets.js'
import { officialSuggestName, renameOfficialAsset } from './sections-official.js'

export function showCtxMenu(e, item) {
  hideCtxMenu()
  S.ctxMenu = el('div', 'asset-ctx-menu')
  const opts = []
  /* 定位：craftPath 副本失效时回退源路径/包内虚拟路径解析（服务端 locatePath 优先） */
  const locatePath = resolveLocatePath(item)
  if (locatePath) {
    opts.push({ label: t('asset.ctxLocate'), fn: () => window.api.showInFolder(locatePath) })
    opts.push({ label: t('asset.ctxCopyPath'), fn: () => copyText(locatePath) })
  }
  opts.push({ label: t('asset.ctxCopyName'), fn: () => copyText(item.name) })
  opts.push({ label: isFav(item) ? t('asset.ctxUnfav') : t('asset.ctxFav'), fn: () => toggleFav(item) })

  if (item.type === 'model') {
    opts.push({ label: t('asset.detailViewViewport'), fn: () => { pushRecent(item); item.onAdd && item.onAdd() } })
    if (item.modelDelete) {
      opts.push({ label: t('asset.ctxDeleteModel'), fn: () => deleteUserModel(item) })
    }
  } else {
    opts.push({ label: t('asset.ctxSendCanvas'), fn: () => { pushRecent(item); item.onAdd() } })
  }
  if (item.type === 'project') {
    opts.push({ label: t('asset.ctxUpdateProject'), fn: () => updateProjectWithCanvas(item) })
    opts.push({ label: t('asset.ctxRenameProject'), fn: () => renameProjectAsset(item) })
    opts.push({ label: t('asset.ctxDeleteProject'), fn: () => deleteProjectAsset(item) })
  }
  if (item.type === 'preset' && item.canvasPresetId) {
    opts.push({ label: t('asset.ctxDeleteCanvasPreset'), fn: () => deleteCanvasPreset(item) })
  }
  if (item.type === 'official' && item.pack) {
    opts.push({ label: t('asset.ctxRenameOfficial'), fn: () => renameOfficialAsset(item, false) })
    if (officialSuggestName(item.pack)) {
      opts.push({ label: t('asset.ctxRenameByVersion'), fn: () => renameOfficialAsset(item, true) })
    }
  }
  for (const it of opts) {
    const mi = el('div', 'asset-ctx-item', it.label)
    mi.addEventListener('click', () => { hideCtxMenu(); it.fn() })
    S.ctxMenu.appendChild(mi)
  }
  document.body.appendChild(S.ctxMenu)
  S.ctxMenu.style.left = Math.min(e.clientX, window.innerWidth - 160) + 'px'
  S.ctxMenu.style.top = Math.min(e.clientY, window.innerHeight - 160) + 'px'
}

export function hideCtxMenu() {
  if (S.ctxMenu) { S.ctxMenu.remove(); S.ctxMenu = null }
}

export async function copyText(s) {
  try { await navigator.clipboard.writeText(s); showToast(t('asset.toastCopied')) }
  catch { showToast(t('asset.toastCopyFail')) }
}

