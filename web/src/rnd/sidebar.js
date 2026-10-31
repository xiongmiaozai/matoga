/**
 * matoga - 材质贴图对比工具
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 从 render.js L1409-L1534 原样搬出（正文逐字未改）。
 * 段外本地符号经 setHooks 注入：bindEmptyCellActions, loadModelDiffView, loadModelPreview, loadModelTex2dPreview
 */

import { state, $, ROLES, ROLE_LABEL } from '../core.js'
import { isImageFile, openPreview } from '../utils.js'
import { replaceWithExternalFile, deleteTexture, showPixelDiff } from '../actions.js'
import { initMaterial3D, updateMaterial3D, clearCustomModel, setModelEmptyHint } from '../material3d.js'
import { enhancePreview } from '../preview2d.js'
import { t } from '../i18n.js'
import { renderPreviewModel } from '../rnd/model-cards.js'

/* 以下变量由主模块经 setHooks 注入。正文按裸标识符引用，故模块级声明。 */
let bindEmptyCellActions
let loadModelDiffView
let loadModelPreview
let loadModelTex2dPreview
export function setHooks(h) {
  bindEmptyCellActions = h.bindEmptyCellActions
  loadModelDiffView = h.loadModelDiffView
  loadModelPreview = h.loadModelPreview
  loadModelTex2dPreview = h.loadModelTex2dPreview
}

export function renderSidebar() {
  const g = state.selected
  const panel = $('previewPanel')

  const mat3dContainer = $('material3dContainer')

  if (mat3dContainer) initMaterial3D(mat3dContainer)

  if (!g) {
    panel.innerHTML = `<div class="pv-hint">${t('preview.hint')}</div>`

    updateMaterial3D(null)
    clearCustomModel()
    setModelEmptyHint('')
    return
  }

  updateMaterial3D(g.isMaterial ? g : null)
  if (!g.isModel) {
    clearCustomModel()
    setModelEmptyHint('')
  }

  let html = ''
  const diffPairs = []
  if (g.isMaterial) {
    const hasMain = (g.left && g.left.main) || (g.right && g.right.main)
    for (const role of ROLES) {
      const le = g.left && g.left[role],
        re = g.right && g.right[role]
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
    const tab = state.modelPreviewTab === 'tex2d' ? 'tex2d' : 'model'
    html =
      `<div class="pv-model">` +
      `<div class="pv-model-tabs">` +
      `<button class="pv-model-tab${tab === 'model' ? ' on' : ''}" data-pv-mtab="model">${t('render.previewTabModel')}</button>` +
      `<button class="pv-model-tab${tab === 'tex2d' ? ' on' : ''}" data-pv-mtab="tex2d">${t('render.previewTabTex2d')}</button>` +
      `</div>` +
      `<div class="pv-model-sum">${t('toast.computing')}</div>` +
      `<div class="pv-model-preview"${tab === 'model' ? '' : ' style="display:none"'}></div>` +
      `<div class="pv-model-texs mc-tex-wrap"${tab === 'tex2d' ? '' : ' style="display:none"'}>${t('toast.computing')}</div>` +
      `<div class="md-grid"><div class="md-cell md-load">${t('toast.computing')}</div><div class="md-cell md-load">${t('toast.computing')}</div></div>` +
      `<div class="pv-tex-refs" style="display:none"></div>` +
      `</div>`
  } else {
    const le = g.left && (g.left.file || g.left.dir),
      re = g.right && (g.right.file || g.right.dir)
    html = `<div class="pv-row" data-role="file"><span class="pv-role">${t('preview.file')}</span>${pvCell(le, t('common.left'))}${pvCell(re, t('common.right'))}</div>`
    if (le && re && !le.isDirectory && !re.isDirectory && isImageFile(le.name) && isImageFile(re.name))
      diffPairs.push([le, re, t('preview.file')])
  }
  if (diffPairs.length) {
    html += `<div class="pv-diff-btn-bar"><button class="btn btn-ghost btn-sm" id="pixelDiffBtn">${t('preview.pixelDiff')}</button></div>`
  }
  panel.querySelectorAll('.pv-row').forEach(row => {
    if (row._splitCleanup) row._splitCleanup()
  })
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
  bindEmptyCellActions(panel, g)

  const diffBtn = $('pixelDiffBtn')
  if (diffBtn) diffBtn.addEventListener('click', () => showPixelDiff(diffPairs, panel))
  if (g.isModel) {
    loadModelDiffView(g, panel)
    loadModelPreview(g)
    const tab = state.modelPreviewTab === 'tex2d' ? 'tex2d' : 'model'
    if (tab === 'model') {
      const pv = panel.querySelector('.pv-model-preview')
      if (pv) renderPreviewModel(pv, g)
    } else {
      loadModelTex2dPreview(panel.querySelector('.pv-model-texs'), g)
    }
    panel.querySelectorAll('[data-pv-mtab]').forEach(b =>
      b.addEventListener('click', () => {
        state.modelPreviewTab = b.dataset.pvMtab
        renderSidebar()
      })
    )
  }

  enhancePreview()
}
