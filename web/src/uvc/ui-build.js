/**
 * matoga - UV 编辑器 UI 构建（工具栏 / 画布区 / 状态栏 / 隐藏上传 input）
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 从 uv-editor-core.js 原样搬出，逻辑未改。结构顺序与原浮窗一致：
 * toolbar / canvasWrap / status / 隐藏 fileInput。
 *
 * 所有交互回调由调用方通过 cbs 注入（闭包内函数声明，存在提升，可在构建时引用）。
 *
 * 本文件只做装配：工具栏、画布区、事件绑定分别由 ui-toolbar.js /
 * ui-canvas.js / ui-interactions.js 承担，三者都接收同一个 el 引用集合，
 * 就地写入各自的元素引用。
 */

import { buildToolbar } from './ui-toolbar.js'
import { buildCanvasArea } from './ui-canvas.js'
import { bindUvInteractions } from './ui-interactions.js'

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

  // ── 工具栏 ──
  buildToolbar({
    el, t, state, draw, setEdit, selectedFace, applyUvInput, rotateSelected,
    mirrorSelected, remakeSelected, undoEdit, redoEdit, resetEdits,
    pickLibraryTexture, exportModel, exportUvTemplate,
  })
  wrap.appendChild(el.toolbar)

  // ── 画布区（含隐藏上传 input / 空态 / 状态栏） ──
  const { canvasWrap, canvas, fileInput } = buildCanvasArea({
    el, state, wrap, getTexDragData, isUsableTexUrl, applyCustomTexture, handleTextureFiles,
  })

  container.appendChild(wrap)
  ctx = canvas.getContext('2d')

  // ── 交互绑定 ──
  bindUvInteractions({
    el, state, canvas, canvasWrap, t, draw, hitRect, hitHandle, updateStatus,
    updateActiveHighlight, selectFace, clearSelection, startDrag, onDragMove, pushUndo,
    visible, undoEdit, redoEdit, onModelShown, autoRefreshOnModelShown, onLocaleChange, refresh,
  })

  el.getCtx = () => ctx
  el.wrap = wrap
  return el
}
