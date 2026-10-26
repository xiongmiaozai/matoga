/**
 * matoga - UV 编辑器数据刷新（layout 重建 → 芯片 / 输入框 / 画布）
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 从 uv-editor-core.js 原样搬出，逻辑未改。
 */

import { snapshotLayout } from './face-ops.js'
import { loadTexImage } from './tex-cache.js'

/**
 * 创建刷新控制器。
 * @param {object} o
 * @param {object} o.state          uv 编辑器 state
 * @param {Function} o.t            i18n
 * @param {Function} o.getLayout    从宿主取原始 layout
 * @param {Function} o.getChipsEl   返回贴图槽芯片容器
 * @param {Function} o.clearHighlight3d       清除 3D 高亮
 * @param {Function} o.syncUndoButtons        刷新撤销按钮态
 * @param {Function} o.notifyDirty            脏状态通知
 * @param {Function} o.requestDraw            节流重绘
 * @param {Function} o.setEdit                切换编辑模式
 * @param {Function} o.syncEditInputs         同步编辑输入框
 * @param {Function} o.draw                   立即重绘
 * @param {Function} o.removeTexture          移除贴图槽
 */
export function createRefresher(o) {
  const {
    state, t, getLayout, getChipsEl, clearHighlight3d,
    syncUndoButtons, notifyDirty, requestDraw, setEdit, syncEditInputs, draw, removeTexture,
  } = o

  function refresh() {
    clearHighlight3d()
    const layout = getLayout()
    state.layout = layout && Array.isArray(layout.textures) && layout.textures.length ? layout : null
    state.activeTex = 0
    state.hover = null
    state.rects = []
    state.selected = null
    state.drag = null
    state.snapshot = snapshotLayout(state.layout)
    state.undoStack.length = 0
    state.redoStack.length = 0
    state.customTex.clear()
    state.notice = null
    syncUndoButtons()
    notifyDirty()
    if (state.layout) {
      for (const tex of state.layout.textures) { if (tex.url) loadTexImage(tex.url, requestDraw) }
    }
    if (!state.layout && state.edit) setEdit(false)
    rebuildChips()
    syncEditInputs()
    draw()
  }

  function rebuildChips() {
    const chipsEl = getChipsEl()
    if (!chipsEl) return
    chipsEl.innerHTML = ''
    const layout = state.layout
    if (!layout) return
    layout.textures.forEach((tex, i) => {
      const removed = !tex.url
      const chip = document.createElement('button')
      chip.className = 'uvv-chip' + (i === state.activeTex ? ' active' : '')
      chip.textContent = (tex.name || ('#' + i)) + (removed ? ' ⊘' : (state.customTex.has(i) ? ' ✎' : ''))
      chip.title = (tex.name || '') + ' · ' + t(removed ? 'uv.removed' : 'uv.chipRemoveHint')
      chip.addEventListener('click', () => {
        state.activeTex = i
        state.hover = null
        state.selected = null
        syncEditInputs()
        chipsEl.querySelectorAll('button').forEach(b => b.classList.remove('active'))
        chip.classList.add('active')
        draw()
      })
      chip.addEventListener('contextmenu', (e) => {
        e.preventDefault()
        removeTexture(i)
      })
      chipsEl.appendChild(chip)
    })
  }

  return { refresh, rebuildChips }
}
