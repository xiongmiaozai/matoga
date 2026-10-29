/**
 * matoga - UV 编辑器 UI：交互绑定
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 从 ui-build.js 按职责搬出，逻辑未改。
 * 绑定画布 hover/拖拽、键盘撤销重做、模型显示刷新、语言切换、尺寸观察。
 * 全部回调由调用方注入，本模块不持有编辑器状态。
 */

/**
 * 绑定 UV 编辑器全部事件监听。
 * @param {object} p
 * @param {object}   p.el            元素引用集合（就地写入 onKeyDown / offLocaleChange / resizeObserver）
 * @param {object}   p.state         uv state
 * @param {object}   p.canvas        画布元素
 * @param {object}   p.canvasWrap    画布容器
 * @param {Function} p.t             i18n
 * @param {Function} p.draw          重绘
 * @param {Function} p.hitRect       命中矩形
 * @param {Function} p.hitHandle     命中手柄
 * @param {Function} p.updateStatus
 * @param {Function} p.updateActiveHighlight
 * @param {Function} p.selectFace
 * @param {Function} p.clearSelection
 * @param {Function} p.startDrag
 * @param {Function} p.onDragMove
 * @param {Function} p.pushUndo
 * @param {Function} p.visible
 * @param {Function} p.undoEdit
 * @param {Function} p.redoEdit
 * @param {Function} p.onModelShown
 * @param {boolean}  p.autoRefreshOnModelShown
 * @param {Function} p.onLocaleChange
 * @param {Function} p.refresh
 */
export function bindUvInteractions(p) {
  const {
    el, state, canvas, canvasWrap, t, draw, hitRect, hitHandle, updateStatus,
    updateActiveHighlight, selectFace, clearSelection, startDrag, onDragMove, pushUndo,
    visible, undoEdit, redoEdit, onModelShown, autoRefreshOnModelShown, onLocaleChange, refresh,
  } = p

  /* 手柄 cursor 表（与 consts.js 的 HANDLE_CURSOR 同值，避免此文件反向依赖主文件） */
  const HANDLE_CURSOR_UI = {
    n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize',
    ne: 'nesw-resize', sw: 'nesw-resize', nw: 'nwse-resize', se: 'nwse-resize',
  }

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
}
