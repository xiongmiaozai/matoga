/**
 * matoga - 材质 3D 视口：cells
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 从 material3d.js 原样搬出，逻辑未改。
 */
import {
  state, $, ROLE_LABEL, KIND_TEXT, STATUS_ORDER,
  leftBtn, rightBtn, onlyMissingChk, summaryEl, resultBody,
  leftPathEl, rightPathEl
} from '../core.js'
import {
  formatSize, formatDate, isImageFile, fileUrl, escAttr,
  folderOf, mainEntryOf, hasAny, leftRoles, rightRoles, subKind,
  openPreview, relPath, joinPath, modelTypeOf, modelBaseNameOf,
  groupTypeOf, groupContentKind, groupTagOf
} from '../utils.js'
import { replaceWithExternalFile, deleteTexture, handleAction, showPixelDiff, copySingleToRight, addTextureToRight, createBlankTextureToRight, saveOptions } from '../actions.js'
import { t, onLocaleChange } from '../i18n.js'
import { renderSidebar } from './sidebar.js'

export function setLoading(side, on) {
  const path = side === 'left' ? leftPathEl : rightPathEl
  const btn = side === 'left' ? leftBtn : rightBtn
  if (on) path.textContent = t('render.loading')
  else path.textContent = (side === 'left' ? state.leftPath : state.rightPath) || t('common.empty')
  btn.disabled = on
}

export function applyEntries(side, folderPath, entries) {
  if (side === 'left') {
    state.leftPath = folderPath; state.leftEntries = entries
    leftPathEl.textContent = folderPath
  } else {
    state.rightPath = folderPath; state.rightEntries = entries
    rightPathEl.textContent = folderPath
  }
}

export function statusBadge(kind) {
  const icons = { have: 'i-check', diff: 'i-alert', partial: 'i-minus', miss: 'i-x', extra: 'i-plus' }
  const labels = { have: t('status.haveShort'), diff: t('status.diffShort'), partial: t('status.partialShort'), miss: t('status.missShort'), extra: t('status.extraShort') }
  return `<span class="status-badge status-${kind}"><svg class="ico"><use href="#${icons[kind]}"/></svg>${labels[kind]}</span>`
}

export function renderThumbPair(le, re) {
  const isImgE = (e) => e && !e.isDirectory && isImageFile(e.name)
  if (!isImgE(le) && !isImgE(re)) return '<span class="cell-empty">—</span>'
  const lt = isImgE(le) ? `<img class="thumb thumb-left" data-thumb="${escAttr(le.fullPath)}" />` : '<span class="thumb-ph thumb-left-ph">L</span>'
  const rt = isImgE(re) ? `<img class="thumb thumb-right" data-thumb="${escAttr(re.fullPath)}" />` : '<span class="thumb-ph thumb-right-ph">R</span>'
  return `<div class="thumb-pair">${lt}${rt}</div>`
}

/* 模型行预览列：左右各一个 3D 缩略图占位（.ac-thumb + _modelThumbItem，observeModelThumbs 懒加载）。
   noCache 跳过后端缓存（对比场景为任意文件夹，缓存 key 含绝对路径，仅前端离屏渲染 + 内存去重） */

export function bindEmptyCellActions(panel, g) {
  if (!state.rightPath) return
  panel.querySelectorAll('.pv-row').forEach(row => {
    const cells = row.querySelectorAll('.pv-cell')
    if (cells.length < 2) return
    const rightCell = cells[1]
    if (rightCell.querySelector('img')) return
    const role = row.dataset.role
    let le = null
    if (g.isMaterial) le = g.left && g.left[role]
    else le = g.left && (g.left.file || g.left.dir)
    const hasLeft = le && !le.isDirectory
    const canBlank = g.isMaterial && (role === 'normal' || role === 'specular')
    if (!hasLeft && !canBlank) return
    const empty = rightCell.querySelector('.pv-empty')
    if (empty) empty.remove()
    const actions = document.createElement('div')
    actions.className = 'pv-empty-actions'
    if (hasLeft) {
      const rel = relPath(state.leftPath, le.fullPath)
      const dest = joinPath(state.rightPath, rel)
      const copyBtn = document.createElement('button')
      copyBtn.className = 'pv-empty-btn pv-empty-copy'
      copyBtn.textContent = t('preview.copyFromLeft')
      copyBtn.title = t('preview.copyFromLeftTitle')
      copyBtn.addEventListener('click', (e) => { e.stopPropagation(); copySingleToRight(le.fullPath, dest) })
      actions.appendChild(copyBtn)
      const addBtn = document.createElement('button')
      addBtn.className = 'pv-empty-btn pv-empty-add'
      addBtn.textContent = t('preview.addTex')
      addBtn.title = t('preview.addTexTitle')
      addBtn.addEventListener('click', (e) => { e.stopPropagation(); addTextureToRight(dest) })
      actions.appendChild(addBtn)
    }
    if (canBlank) {
      const createBtn = document.createElement('button')
      createBtn.className = 'pv-empty-btn pv-empty-create'
      createBtn.textContent = t('preview.createBlank')
      createBtn.title = role === 'normal' ? t('preview.createBlankNormalTitle') : t('preview.createBlankSpecularTitle')
      createBtn.addEventListener('click', (e) => { e.stopPropagation(); createBlankTextureToRight(g, role) })
      actions.appendChild(createBtn)
    }
    rightCell.appendChild(actions)
  })
}






