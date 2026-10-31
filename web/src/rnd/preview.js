/**
 * matoga - MC 模型：RenderPreview
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 从 mc-model-viewer.js 按领域搬出（正文逐字未改）。
 * 职责：预览面板单元格与空单元格操作
 */

import { ROLES, state, $, ROLE_LABEL } from '../core.js'
import { t } from '../i18n.js'
import { openPreview, isImageFile, fileUrl, relPath, joinPath } from '../utils.js'
import {
  replaceWithExternalFile,
  deleteTexture,
  copySingleToRight,
  addTextureToRight,
  createBlankTextureToRight,
  createBlankTextureSetToRight
} from '../actions.js'

export function renderMaterialPreviewHtml(matG) {
  const hasMain = (matG.left && matG.left.main) || (matG.right && matG.right.main)
  let h = ''
  for (const role of ROLES) {
    const le = matG.left && matG.left[role],
      re = matG.right && matG.right[role]
    if (!le && !re) {
      if ((role === 'normal' || role === 'specular') && hasMain && state.rightPath)
        h += `<div class="pv-row pv-row-empty" data-role="${role}"><span class="pv-role">${ROLE_LABEL[role]}</span>${pvCell(null, t('common.left'))}${pvCell(null, t('common.right'))}</div>`
      continue
    }
    h += `<div class="pv-row" data-role="${role}"><span class="pv-role">${ROLE_LABEL[role]}</span>${pvCell(le, t('common.left'))}${pvCell(re, t('common.right'))}</div>`
  }
  return h
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

export function pvCell(entry, side) {
  if (!entry)
    return `<div class="pv-cell"><span class="pv-tag">${side}</span><span class="pv-empty">${t('preview.noSide')}</span></div>`
  if (entry.isDirectory || !isImageFile(entry.name))
    return `<div class="pv-cell"><span class="pv-tag">${side}</span><span class="pv-empty">${t('preview.notImage')}</span></div>`
  const url = fileUrl(entry.fullPath)
  return `<div class="pv-cell"><span class="pv-tag">${side}</span><img src="${url}" data-name="${entry.name}" data-path="${entry.fullPath}" alt="" /><span class="pv-size"></span></div>`
}

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
    const canBlankSet = g.isMaterial && role === 'main'
    if (!hasLeft && !canBlank && !canBlankSet) return
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
      copyBtn.addEventListener('click', e => {
        e.stopPropagation()
        copySingleToRight(le.fullPath, dest)
      })
      actions.appendChild(copyBtn)
      const addBtn = document.createElement('button')
      addBtn.className = 'pv-empty-btn pv-empty-add'
      addBtn.textContent = t('preview.addTex')
      addBtn.title = t('preview.addTexTitle')
      addBtn.addEventListener('click', e => {
        e.stopPropagation()
        addTextureToRight(dest)
      })
      actions.appendChild(addBtn)
    }
    if (canBlank) {
      const createBtn = document.createElement('button')
      createBtn.className = 'pv-empty-btn pv-empty-create'
      createBtn.textContent = t('preview.createBlank')
      createBtn.title = role === 'normal' ? t('preview.createBlankNormalTitle') : t('preview.createBlankSpecularTitle')
      createBtn.addEventListener('click', e => {
        e.stopPropagation()
        createBlankTextureToRight(g, role)
      })
      actions.appendChild(createBtn)
    }
    if (canBlankSet) {
      const setBtn = document.createElement('button')
      setBtn.className = 'pv-empty-btn pv-empty-create'
      setBtn.textContent = t('preview.createBlankSet')
      setBtn.title = t('preview.createBlankSetTitle')
      setBtn.addEventListener('click', e => {
        e.stopPropagation()
        createBlankTextureSetToRight(g)
      })
      actions.appendChild(setBtn)
    }
    rightCell.appendChild(actions)
  })
}
