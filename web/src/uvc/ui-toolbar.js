/**
 * matoga - UV 编辑器 UI：工具栏构建
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 从 ui-build.js 按职责搬出，逻辑未改。
 * 构建 toolbar：贴图 chips、缩放分段、网格/编辑/上传/库/导出/模板按钮、编辑工具条。
 * el 由调用方创建并传入。
 */
import { ZOOM_STEPS } from './consts.js'

/**
 * 构建 UV 编辑器工具栏并挂到 wrap。
 * @param {object} p
 * @param {object}   p.el       元素引用集合（就地写入）
 * @param {Function} p.t        i18n
 * @param {object}   p.state    uv state
 * @param {Function} p.draw     重绘
 * @param {Function} p.setEdit  切换编辑模式
 * @param {Function} p.selectedFace
 * @param {Function} p.applyUvInput
 * @param {Function} p.rotateSelected
 * @param {Function} p.mirrorSelected
 * @param {Function} p.remakeSelected
 * @param {Function} p.undoEdit
 * @param {Function} p.redoEdit
 * @param {Function} p.resetEdits
 * @param {Function} p.pickLibraryTexture
 * @param {Function} p.exportModel
 * @param {Function} p.exportUvTemplate
 * @returns {HTMLElement} toolbar
 */
export function buildToolbar(p) {
  const {
    el, t, state, draw, setEdit, selectedFace, applyUvInput, rotateSelected,
    mirrorSelected, remakeSelected, undoEdit, redoEdit, resetEdits,
    pickLibraryTexture, exportModel, exportUvTemplate,
  } = p

  const toolbar = document.createElement('div')
  toolbar.className = 'uvv-toolbar'
  el.toolbar = toolbar

  el.chipsEl = document.createElement('div')
  el.chipsEl.className = 'uvv-tex-chips'
  toolbar.appendChild(el.chipsEl)

  const zoomSeg = document.createElement('div')
  zoomSeg.className = 'm3d-segment uvv-zoom-seg'
  el.zoomSeg = zoomSeg
  ZOOM_STEPS.forEach(z => {
    const btn = document.createElement('button')
    btn.dataset.zoom = String(z)
    btn.textContent = z === 'fit' ? t('uv.fit') : z + 'x'
    if (z === 'fit') btn.classList.add('active')
    btn.addEventListener('click', () => {
      state.zoom = z === 'fit' ? 'fit' : +z
      zoomSeg.querySelectorAll('button').forEach(b => b.classList.toggle('active', b === btn))
      draw()
    })
    zoomSeg.appendChild(btn)
  })
  toolbar.appendChild(zoomSeg)

  el.gridBtn = document.createElement('button')
  el.gridBtn.className = 'uvv-grid-btn active'
  el.gridBtn.title = t('uv.grid')
  el.gridBtn.textContent = t('uv.grid')
  el.gridBtn.addEventListener('click', () => {
    state.grid = !state.grid
    el.gridBtn.classList.toggle('active', state.grid)
    draw()
  })
  toolbar.appendChild(el.gridBtn)

  el.editBtn = document.createElement('button')
  el.editBtn.className = 'uvv-grid-btn uvv-edit-btn'
  el.editBtn.title = t('uv.editTitle')
  el.editBtn.textContent = t('uv.edit')
  el.editBtn.addEventListener('click', () => setEdit(!state.edit))
  toolbar.appendChild(el.editBtn)

  el.uploadBtn = document.createElement('button')
  el.uploadBtn.className = 'uvv-grid-btn'
  el.uploadBtn.title = t('uv.uploadTitle')
  el.uploadBtn.textContent = t('uv.upload')
  el.uploadBtn.addEventListener('click', () => { if (el.fileInput) el.fileInput.click() })
  toolbar.appendChild(el.uploadBtn)

  el.libraryBtn = document.createElement('button')
  el.libraryBtn.className = 'uvv-grid-btn uvv-library-btn'
  el.libraryBtn.title = t('uv.libraryTitle')
  el.libraryBtn.textContent = t('uv.library')
  el.libraryBtn.addEventListener('click', pickLibraryTexture)
  toolbar.appendChild(el.libraryBtn)

  el.exportBtn = document.createElement('button')
  el.exportBtn.className = 'uvv-grid-btn'
  el.exportBtn.title = t('uv.exportTitle')
  el.exportBtn.textContent = t('uv.export')
  el.exportBtn.addEventListener('click', exportModel)
  toolbar.appendChild(el.exportBtn)

  el.templateBtn = document.createElement('button')
  el.templateBtn.className = 'uvv-grid-btn'
  el.templateBtn.title = t('uv.templateTitle')
  el.templateBtn.textContent = t('uv.template')
  el.templateBtn.addEventListener('click', exportUvTemplate)
  toolbar.appendChild(el.templateBtn)

  /* 编辑工具条（编辑模式显示；放 toolbar 内随 flex-wrap 换行，不动外层结构） */
  const editBar = document.createElement('div')
  editBar.className = 'uvv-edit-bar'
  el.editBar = editBar
  const uvLabel = document.createElement('span')
  uvLabel.className = 'uvv-edit-label'
  uvLabel.textContent = t('uv.uvLabel')
  editBar.appendChild(uvLabel)
  el.uvInputs = [0, 1, 2, 3].map(() => {
    const inp = document.createElement('input')
    inp.type = 'number'
    inp.className = 'uvv-uv-input'
    inp.step = '1'
    inp.disabled = true
    inp.addEventListener('focus', () => {
      const f = selectedFace()
      state.inputOrig = f ? [...f.uv] : null
    })
    inp.addEventListener('change', () => { applyUvInput() })
    editBar.appendChild(inp)
    return inp
  })
  el.rotBtn = document.createElement('button')
  el.rotBtn.className = 'uvv-grid-btn'
  el.rotBtn.title = t('uv.rotateTitle')
  el.rotBtn.textContent = t('uv.rotate')
  el.rotBtn.addEventListener('click', rotateSelected)
  editBar.appendChild(el.rotBtn)
  el.mirrorBtn = document.createElement('button')
  el.mirrorBtn.className = 'uvv-grid-btn'
  el.mirrorBtn.title = t('uv.mirrorTitle')
  el.mirrorBtn.textContent = t('uv.mirror')
  el.mirrorBtn.addEventListener('click', mirrorSelected)
  editBar.appendChild(el.mirrorBtn)
  el.remakeBtn = document.createElement('button')
  el.remakeBtn.className = 'uvv-grid-btn'
  el.remakeBtn.title = t('uv.remakeTitle')
  el.remakeBtn.textContent = t('uv.remake')
  el.remakeBtn.addEventListener('click', remakeSelected)
  editBar.appendChild(el.remakeBtn)
  el.undoBtn = document.createElement('button')
  el.undoBtn.className = 'uvv-grid-btn'
  el.undoBtn.title = t('uv.undoTitle') + ' (Ctrl+Z)'
  el.undoBtn.textContent = t('uv.undo')
  el.undoBtn.addEventListener('click', undoEdit)
  editBar.appendChild(el.undoBtn)
  el.redoBtn = document.createElement('button')
  el.redoBtn.className = 'uvv-grid-btn'
  el.redoBtn.title = t('uv.redoTitle') + ' (Ctrl+Shift+Z / Ctrl+Y)'
  el.redoBtn.textContent = t('uv.redo')
  el.redoBtn.disabled = true
  el.redoBtn.addEventListener('click', redoEdit)
  editBar.appendChild(el.redoBtn)
  el.resetBtn = document.createElement('button')
  el.resetBtn.className = 'uvv-grid-btn'
  el.resetBtn.title = t('uv.resetTitle')
  el.resetBtn.textContent = t('uv.reset')
  el.resetBtn.addEventListener('click', resetEdits)
  editBar.appendChild(el.resetBtn)
  const hint = document.createElement('span')
  hint.className = 'uvv-edit-hint'
  hint.textContent = t('uv.editHint')
  editBar.appendChild(hint)
  toolbar.appendChild(editBar)

  return toolbar
}
