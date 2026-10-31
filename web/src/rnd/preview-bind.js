/**
 * matoga - 材质贴图对比工具
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 从 render.js L652-L732 原样搬出（正文逐字未改）。
 * 段外本地符号经 setHooks 注入：bindEmptyCellActions
 */

import { state } from '../core.js'
import { openPreview } from '../utils.js'
import { replaceWithExternalFile, deleteTexture } from '../actions.js'
import { observeThumbs } from '../thumb-loader.js'
import { isModelEntry } from '../model-diff.js'
import { resolveModelTexList, textureAssetPath } from '../mc-model-viewer.js'
import { t } from '../i18n.js'

/* 以下变量由主模块经 setHooks 注入。正文按裸标识符引用，故模块级声明。 */
let bindEmptyCellActions
export function setHooks(h) {
  bindEmptyCellActions = h.bindEmptyCellActions
}

export function bindPreviewImages(container) {
  container.querySelectorAll('img').forEach(img => {
    const cell = img.parentElement
    cell.classList.add('pv-loading')
    img.addEventListener('click', () => openPreview(img.src, img.dataset.name || ''))
    img.addEventListener('load', () => {
      cell.classList.remove('pv-loading')
      const sl = cell.querySelector('.pv-size')
      if (sl && img.naturalWidth) sl.textContent = `${img.naturalWidth}×${img.naturalHeight}`
    })
    img.addEventListener('error', () => {
      cell.classList.remove('pv-loading')
      cell.classList.add('pv-error')
    })
    const btn = document.createElement('button')
    btn.className = 'pv-replace-btn'
    btn.textContent = t('preview.replace')
    btn.title = t('preview.replaceTitle')
    btn.addEventListener('click', e => {
      e.stopPropagation()
      replaceWithExternalFile(img.dataset.path)
    })
    cell.appendChild(btn)
    const delBtn = document.createElement('button')
    delBtn.className = 'pv-delete-btn'
    delBtn.textContent = t('preview.delete')
    delBtn.title = t('preview.deleteTitle')
    delBtn.addEventListener('click', e => {
      e.stopPropagation()
      deleteTexture(img.dataset.path)
    })
    cell.appendChild(delBtn)
  })
}

export async function loadModelTex2dPreview(container, g) {
  if (!container) return
  container.innerHTML = `<span class="mc-tex-loading">${t('render.modelTexLoading')}</span>`
  const le = g.left && g.left.file,
    re = g.right && g.right.file
  const leftList =
    le && isModelEntry(le)
      ? await resolveModelTexList({ fileRoot: state.leftPath, rel: le.name }).catch(() => null)
      : null
  const rightList =
    re && isModelEntry(re)
      ? await resolveModelTexList({ fileRoot: state.rightPath, rel: re.name }).catch(() => null)
      : null
  if (!container.isConnected) return
  const groupMap = new Map()
  for (const grp of state.result) groupMap.set(grp.key, grp)
  const seen = new Set()
  const mats = []
  for (const tx of [...(leftList || []), ...(rightList || [])]) {
    const ap = textureAssetPath(tx.name)
    if (!ap) continue
    const dot = ap.lastIndexOf('.')
    const key = dot >= 0 ? ap.slice(0, dot) : ap
    if (seen.has(key)) continue
    seen.add(key)
    const grp = groupMap.get(key)
    if (grp && grp.isMaterial) mats.push(grp)
  }
  if (!mats.length) {
    container.innerHTML = `<span class="mc-tex-none">${t('render.modelTexNone')}</span>`
    return
  }
  const frag = document.createDocumentFragment()
  for (const matG of mats) {
    const block = document.createElement('div')
    block.className = 'pv-model-mat'
    block.innerHTML = `<div class="pv-model-mat-title" title="${escAttr(matG.key)}">${escHtml(matG.key)} ${statusBadge(matG.kind)}</div>${renderMaterialPreviewHtml(matG)}`
    frag.appendChild(block)
    bindPreviewImages(block)
    bindEmptyCellActions(block, matG)
  }
  container.innerHTML = ''
  container.appendChild(frag)
  observeThumbs(container)
}
