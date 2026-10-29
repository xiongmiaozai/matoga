/**
 * matoga - 材质 3D 视口：sidebar
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 从 material3d.js 原样搬出，逻辑未改。
 */
import {
  state, $, ROLES, ROLE_LABEL, KIND_TEXT, STATUS_ORDER,
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
import { initMaterial3D, updateMaterial3D, clearCustomModel } from '../material3d.js'
import { enhancePreview } from '../preview2d.js'
import { t, onLocaleChange } from '../i18n.js'
import { loadModelDiffView } from './model-diff.js'
import { loadModelPreview, loadModelTexList } from './model-preview.js'
import { bindEmptyCellActions } from '../render.js'

export function pvCell(entry, side) {
  if (!entry) return `<div class="pv-cell"><span class="pv-tag">${side}</span><span class="pv-empty">${t('preview.noSide')}</span></div>`
  if (entry.isDirectory || !isImageFile(entry.name)) return `<div class="pv-cell"><span class="pv-tag">${side}</span><span class="pv-empty">${t('preview.notImage')}</span></div>`
  const url = fileUrl(entry.fullPath)
  return `<div class="pv-cell"><span class="pv-tag">${side}</span><img src="${url}" data-name="${entry.name}" data-path="${entry.fullPath}" alt="" /><span class="pv-size"></span></div>`
}


export function renderSidebar() {
  const g = state.selected
  const panel = $('previewPanel')
  const detail = $('detailPanel')
  const action = $('actionPanel')
  const mat3dContainer = $('material3dContainer')

  if (mat3dContainer) initMaterial3D(mat3dContainer)

  if (!g) {
    panel.innerHTML = `<div class="pv-hint">${t('preview.hint')}</div>`
    detail.innerHTML = `<div class="detail-hint">${t('preview.notSelected')}</div>`
    action.innerHTML = ''
    updateMaterial3D(null)
    clearCustomModel()
    return
  }

  updateMaterial3D(g.isMaterial ? g : null)
  if (!g.isModel) clearCustomModel()

  let html = ''
  const diffPairs = []
  if (g.isMaterial) {
    const hasMain = (g.left && g.left.main) || (g.right && g.right.main)
    for (const role of ROLES) {
      const le = g.left && g.left[role], re = g.right && g.right[role]
      if (!le && !re) {
        if ((role === 'normal' || role === 'specular') && hasMain && state.rightPath)
          html += `<div class="pv-row pv-row-empty" data-role="${role}"><span class="pv-role">${ROLE_LABEL[role]}</span>${pvCell(null, t('common.left'))}${pvCell(null, t('common.right'))}</div>`
        continue
      }
      html += `<div class="pv-row" data-role="${role}"><span class="pv-role">${ROLE_LABEL[role]}</span>${pvCell(le, t('common.left'))}${pvCell(re, t('common.right'))}</div>`
      if (le && re && !le.isDirectory && !re.isDirectory && isImageFile(le.name) && isImageFile(re.name))
        diffPairs.push([le, re, ROLE_LABEL[role]])
    }
  } else if (g.isDir) {
    html = `<div class="pv-hint">${t('preview.folder')}</div>`
  } else if (g.isModel) {
    html = `<div class="pv-model">` +
      `<div class="pv-model-sum">${t('toast.computing')}</div>` +
      `<div class="pv-model-texs">${t('toast.computing')}</div>` +
      `<div class="md-grid"><div class="md-cell md-load">${t('toast.computing')}</div><div class="md-cell md-load">${t('toast.computing')}</div></div>` +
      `</div>`
  } else {
    const le = g.left && (g.left.file || g.left.dir), re = g.right && (g.right.file || g.right.dir)
    html = `<div class="pv-row" data-role="file"><span class="pv-role">${t('preview.file')}</span>${pvCell(le, t('common.left'))}${pvCell(re, t('common.right'))}</div>`
    if (le && re && !le.isDirectory && !re.isDirectory && isImageFile(le.name) && isImageFile(re.name))
      diffPairs.push([le, re, t('preview.file')])
  }
  if (diffPairs.length) {
    html += `<div class="pv-diff-btn-bar"><button class="btn btn-ghost btn-sm" id="pixelDiffBtn">${t('preview.pixelDiff')}</button></div>`
  }
  panel.querySelectorAll('.pv-row').forEach(row => { if (row._splitCleanup) row._splitCleanup() })
  panel.innerHTML = html
  panel.querySelectorAll('img').forEach(img => {
    const cell = img.parentElement
    cell.classList.add('pv-loading')
    img.addEventListener('click', () => openPreview(img.src, img.dataset.name || ''))
    img.addEventListener('load', () => {
      cell.classList.remove('pv-loading')
      const sl = cell.querySelector('.pv-size')
      if (sl && img.naturalWidth) sl.textContent = `${img.naturalWidth}×${img.naturalHeight}`
    })
    img.addEventListener('error', () => { cell.classList.remove('pv-loading'); cell.classList.add('pv-error') })
    const btn = document.createElement('button')
    btn.className = 'pv-replace-btn'
    btn.textContent = t('preview.replace')
    btn.title = t('preview.replaceTitle')
    btn.addEventListener('click', (e) => { e.stopPropagation(); replaceWithExternalFile(img.dataset.path) })
    cell.appendChild(btn)
    const delBtn = document.createElement('button')
    delBtn.className = 'pv-delete-btn'
    delBtn.textContent = t('preview.delete')
    delBtn.title = t('preview.deleteTitle')
    delBtn.addEventListener('click', (e) => { e.stopPropagation(); deleteTexture(img.dataset.path) })
    cell.appendChild(delBtn)
  })
  bindEmptyCellActions(panel, g)


  const diffBtn = $('pixelDiffBtn')
  if (diffBtn) diffBtn.addEventListener('click', () => showPixelDiff(diffPairs, panel))
  if (g.isModel) { loadModelDiffView(g, panel); loadModelPreview(g); loadModelTexList(g) }

  const dRow = (label, val) => `<div class="detail-row"><span class="detail-label">${label}</span><span>${val}</span></div>`
  let dh = `<div class="detail-title" title="${g.key}">${g.key}</div>`
  dh += dRow(t('common.status'), KIND_TEXT[g.kind])
  if (g.isMaterial) {
    dh += dRow(t('common.type'), t('type.material'))
    dh += dRow(t('detail.texCount'), `${t('common.left')} ${leftRoles(g).length} / ${t('common.right')} ${rightRoles(g).length}`)
    const m = mainEntryOf(g)
    if (m) { dh += dRow(t('detail.mainSize'), formatSize(m.size)); dh += dRow(t('detail.mainMtime'), formatDate(m.mtime)) }
  } else if (g.isDir) {
    dh += dRow(t('common.type'), t('type.folder'))
  } else if (g.isModel) {
    dh += dRow(t('common.type'), t('type.model'))
    const e = mainEntryOf(g)
    if (e) { dh += dRow(t('common.size'), formatSize(e.size)); dh += dRow(t('detail.mtime'), formatDate(e.mtime)) }
  } else {
    dh += dRow(t('common.type'), t('type.file'))
    const e = mainEntryOf(g)
    if (e) { dh += dRow(t('common.size'), formatSize(e.size)); dh += dRow(t('detail.mtime'), formatDate(e.mtime)) }
  }
  detail.innerHTML = dh

  const target = mainEntryOf(g)
  let btns = ''
  if (g.left && target) btns += `<button class="btn btn-sm" data-act="open-left">${t('detail.openLeft')}</button><button class="btn btn-ghost btn-sm" data-act="loc-left">${t('detail.locLeft')}</button>`
  if (g.right && target) btns += `<button class="btn btn-sm" data-act="open-right">${t('detail.openRight')}</button><button class="btn btn-ghost btn-sm" data-act="loc-right">${t('detail.locRight')}</button>`
  if (g.left && hasAny(g.left) && state.rightPath) btns += `<button class="btn btn-accent btn-sm" data-act="copy-to-right">${t('detail.copyRight')}</button>`
  if (g.right && hasAny(g.right) && state.leftPath) btns += `<button class="btn btn-accent btn-sm" data-act="copy-to-left">${t('detail.copyLeft')}</button>`
  if (g.isModel && state.rightPath) btns += `<button class="btn btn-accent btn-sm" data-act="upload-model-right">${t('detail.uploadModel')}</button>`
  btns += `<button class="btn btn-ghost btn-sm" data-act="copy">${t('detail.copyName')}</button>`
  action.innerHTML = btns
  action.querySelectorAll('button').forEach(b => {
    b.addEventListener('click', () => handleAction(b.dataset.act, g))
  })
  enhancePreview()
}

