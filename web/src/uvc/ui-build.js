/**
 * matoga - UV 编辑器 UI 构建（工具栏 / 画布区 / 状态栏 / 隐藏上传 input）
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 从 uv-editor-core.js 原样搬出，逻辑未改。结构顺序与原浮窗一致：
 * toolbar / canvasWrap / status / 隐藏 fileInput。
 *
 * 所有交互回调由调用方通过 cbs 注入（闭包内函数声明，存在提升，可在构建时引用）。
 */

import { ZOOM_STEPS } from './consts.js'

/**
 * 构建 UV 编辑器全部 DOM。
 * @param {object} p
 * @param {Function} p.t         i18n 函数
 * @param {object}   p.state     uv 编辑器 state
 * @param {Function} p.draw      重绘
 * @param {Function} p.setEdit   切换编辑模式
 * @param {Function} p.selectedFace 取当前选中面
 * @param {Function} p.applyUvInput 应用 UV 输入框数值
 * @param {Function} p.rotateSelected
 * @param {Function} p.mirrorSelected
 * @param {Function} p.remakeSelected
 * @param {Function} p.undoEdit
 * @param {Function} p.redoEdit
 * @param {Function} p.resetEdits
 * @param {Function} p.pickLibraryTexture
 * @param {Function} p.exportModel
 * @param {Function} p.exportUvTemplate
 * @param {Function} p.handleTextureFiles
 * @param {Function} p.applyCustomTexture
 * @param {Function} p.getTexDragData
 * @param {Function} p.isUsableTexUrl
 * @param {Function} p.hitRect
 * @param {Function} p.hitHandle
 * @param {Function} p.startDrag
 * @param {Function} p.onDragMove
 * @param {Function} p.selectFace
 * @param {Function} p.clearSelection
 * @param {Function} p.pushUndo
 * @param {Function} p.updateStatus
 * @param {Function} p.updateActiveHighlight
 * @param {Function} p.visible
 * @param {Function} p.onLocaleChange  订阅语言切换，返回取消函数
 * @param {Function} p.refresh
 * @param {Function} p.onRequestDraw
 * @param {Function} p.onModelShown
 * @returns {object} 元素引用集合（含 setCtx / getCtx）
 */
export function buildUvUi(p) {
  const {
    t, state, draw, setEdit, selectedFace, applyUvInput, rotateSelected, mirrorSelected,
    remakeSelected, undoEdit, redoEdit, resetEdits, pickLibraryTexture, exportModel,
    exportUvTemplate, handleTextureFiles, applyCustomTexture, getTexDragData, isUsableTexUrl,
    hitRect, hitHandle, startDrag, onDragMove, selectFace, clearSelection, pushUndo,
    updateStatus, updateActiveHighlight, visible, onLocaleChange, refresh, onRequestDraw,
    onModelShown, autoRefreshOnModelShown, container,
  } = p

  const el = {}
  let ctx = null

  const wrap = document.createElement('div')
  wrap.className = 'uvv-wrap'

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

  wrap.appendChild(toolbar)

  /* 画布区 */
  const canvasWrap = document.createElement('div')
  canvasWrap.className = 'uvv-canvas-wrap'
  el.canvasWrap = canvasWrap
  const canvas = document.createElement('canvas')
  canvas.className = 'uvv-canvas'
  el.canvas = canvas
  canvasWrap.appendChild(canvas)

  /* 自定义贴图上传（隐藏 input 挂 wrap 尾部，保持 canvasWrap 子结构不变；拖放目标为画布区） */
  const fileInput = document.createElement('input')
  el.fileInput = fileInput
  fileInput.type = 'file'
  fileInput.multiple = true
  fileInput.accept = 'image/png,image/jpeg,image/webp,image/gif'
  fileInput.style.display = 'none'
  fileInput.addEventListener('change', () => {
    handleTextureFiles(fileInput.files)
    try { fileInput.value = '' } catch {}
  })

  canvasWrap.addEventListener('dragover', (e) => {
    if (!state.layout) return
    e.preventDefault()
    canvasWrap.classList.add('uvv-drop-active')
  })
  canvasWrap.addEventListener('dragleave', () => canvasWrap.classList.remove('uvv-drop-active'))
  canvasWrap.addEventListener('drop', (e) => {
    e.preventDefault()
    canvasWrap.classList.remove('uvv-drop-active')
    /* 资产库贴图卡片拖入：raw URL 直接替换当前贴图槽位 */
    const tex = getTexDragData(e.dataTransfer)
    if (tex) {
      if (state.layout && isUsableTexUrl(tex.url)) applyCustomTexture(tex.url, tex.name || null)
      return
    }
    const files = e.dataTransfer && e.dataTransfer.files
    handleTextureFiles(files)
  })

  el.emptyEl = document.createElement('div')
  el.emptyEl.className = 'uvv-empty'
  canvasWrap.appendChild(el.emptyEl)
  wrap.appendChild(canvasWrap)

  /* 状态栏 */
  el.statusEl = document.createElement('div')
  el.statusEl.className = 'uvv-status'
  wrap.appendChild(el.statusEl)
  wrap.appendChild(fileInput)   /* 隐藏上传 input（尾部，不占结构索引） */

  container.appendChild(wrap)
  ctx = canvas.getContext('2d')

  canvas.addEventListener('mousemove', (e) => {
    if (state.drag) return
    const r = canvas.getBoundingClientRect()
    const mx = e.clientX - r.left, my = e.clientY - r.top
    const hit = hitRect(mx, my)
    const same = hit && state.hover
      ? (hit.el === state.hover.el && hit.key === state.hover.key)
      : (!hit && !state.hover)
    if (!same) {
      state.hover = hit ? { el: hit.el, face: hit.face, key: hit.key } : null
      updateStatus()
      updateActiveHighlight()
      draw()
    }
    if (state.edit) {
      const h = state.selected ? hitHandle(mx, my) : null
      canvas.style.cursor = h ? HANDLE_CURSOR_UI[h.mode] : (hit ? 'move' : 'crosshair')
    }
  })
  canvas.addEventListener('mouseleave', () => {
    if (state.hover) { state.hover = null; updateStatus(); updateActiveHighlight(); draw() }
  })

  /* 编辑拖拽（pointer events 支持触控笔/触摸） */
  canvas.addEventListener('pointerdown', (e) => {
    if (!state.edit || state.drag || !state.layout) return
    const r = canvas.getBoundingClientRect()
    const mx = e.clientX - r.left, my = e.clientY - r.top
    const h = state.selected ? hitHandle(mx, my) : null
    if (h) { startDrag(e, h.mode, mx, my); return }
    const rc = hitRect(mx, my)
    if (rc) {
      selectFace(rc)
      startDrag(e, 'move', mx, my)
    } else if (state.selected) {
      clearSelection()
    }
  })
  canvas.addEventListener('pointermove', (e) => {
    if (!state.drag) return
    const r = canvas.getBoundingClientRect()
    onDragMove(e.clientX - r.left, e.clientY - r.top, e.altKey)
  })
  const endDrag = (e) => {
    const d = state.drag
    if (!d) return
    state.drag = null
    try { canvas.releasePointerCapture && canvas.releasePointerCapture(e.pointerId) } catch {}
    if (d.moved) pushUndo({ layEl: d.rc.el, key: d.rc.key, uv: [...d.orig], rotation: d.rc.face.rotation })
    updateStatus()
    draw()
  }
  canvas.addEventListener('pointerup', endDrag)
  canvas.addEventListener('pointercancel', endDrag)

  /* Ctrl+Z 撤销 / Ctrl+Shift+Z 或 Ctrl+Y 重做（输入框聚焦时放行浏览器原生行为） */
  const onKeyDown = (e) => {
    if (!visible() || !state.edit) return
    if (!(e.ctrlKey || e.metaKey)) return
    const k = e.key
    const isUndo = (k === 'z' || k === 'Z') && !e.shiftKey
    const isRedo = (k === 'y' || k === 'Y') || ((k === 'z' || k === 'Z') && e.shiftKey)
    if (!isUndo && !isRedo) return
    const tag = e.target && e.target.tagName
    if (tag === 'INPUT' || tag === 'TEXTAREA') return
    e.preventDefault()
    if (isUndo) undoEdit()
    else redoEdit()
  }
  window.addEventListener('keydown', onKeyDown)
  el.onKeyDown = onKeyDown

  if (onModelShown && autoRefreshOnModelShown !== false) {
    window.addEventListener('mcmodel:shown', onModelShown)
  }

  const offLocaleChange = onLocaleChange(() => {
    el.gridBtn.title = t('uv.grid')
    el.gridBtn.textContent = t('uv.grid')
    el.editBtn.title = t('uv.editTitle')
    el.editBtn.textContent = t('uv.edit')
    el.uploadBtn.title = t('uv.uploadTitle')
    el.uploadBtn.textContent = t('uv.upload')
    el.libraryBtn.title = t('uv.libraryTitle')
    el.libraryBtn.textContent = t('uv.library')
    el.exportBtn.title = t('uv.exportTitle')
    el.exportBtn.textContent = t('uv.export')
    el.templateBtn.title = t('uv.templateTitle')
    el.templateBtn.textContent = t('uv.template')
    el.rotBtn.textContent = t('uv.rotate')
    el.mirrorBtn.textContent = t('uv.mirror')
    el.remakeBtn.textContent = t('uv.remake')
    el.undoBtn.textContent = t('uv.undo')
    el.redoBtn.textContent = t('uv.redo')
    el.resetBtn.textContent = t('uv.reset')
    refresh()
  })
  el.offLocaleChange = offLocaleChange

  const resizeObserver = new ResizeObserver(() => draw())
  resizeObserver.observe(canvasWrap)
  el.resizeObserver = resizeObserver

  el.getCtx = () => ctx
  el.wrap = wrap
  return el
}

/* 手柄 cursor 表（与 consts.js 的 HANDLE_CURSOR 同值，避免此文件反向依赖主文件） */
const HANDLE_CURSOR_UI = {
  n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize',
  ne: 'nesw-resize', sw: 'nesw-resize', nw: 'nwse-resize', se: 'nwse-resize',
}
