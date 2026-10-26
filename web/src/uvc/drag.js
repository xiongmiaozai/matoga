/**
 * matoga - UV 编辑器拖拽编辑（移动 / 8 向手柄缩放）
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 从 uv-editor-core.js 原样搬出，逻辑未改。
 */

import { applyFaceUvValues } from './face-ops.js'

/**
 * 创建拖拽控制器。
 * @param {object} o
 * @param {object} o.state           uv 编辑器 state
 * @param {object} o.hooks           宿主钩子
 * @param {Function} o.getCanvas     返回 canvas
 * @param {Function} o.selectedRect  当前选中面矩形
 * @param {Function} o.hitRect       命中面矩形
 * @param {Function} o.syncEditInputs 同步编辑输入框
 * @param {Function} o.updateStatus   刷新状态栏
 * @param {Function} o.requestDraw    节流重绘
 */
export function createDrag(o) {
  const {
    state, hooks, getCanvas, selectedRect, hitRect,
    syncEditInputs, updateStatus, requestDraw,
  } = o

  function startDrag(e, mode, mx, my) {
    const canvas = getCanvas()
    const rc = selectedRect() || hitRect(mx, my)
    if (!rc) return
    state.drag = { mode, rc, sx: mx, sy: my, orig: [...rc.face.uv], moved: false }
    try { canvas.setPointerCapture && canvas.setPointerCapture(e.pointerId) } catch {}
  }

  function onDragMove(mx, my, altKey) {
    const d = state.drag
    if (!d) return
    const px = state.px || 1
    const scale = (state.layout && state.layout.uvScale) || 16
    const step = altKey ? 0.25 : 1
    const snap = v => Math.round(v / step) * step
    const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi)
    let uv
    if (d.mode === 'move') {
      let dx = snap((mx - d.sx) / px)
      let dy = snap((my - d.sy) / px)
      const [u1, v1, u2, v2] = d.orig
      dx = clamp(dx, -Math.min(u1, u2), scale - Math.max(u1, u2))
      dy = clamp(dy, -Math.min(v1, v2), scale - Math.max(v1, v2))
      uv = [u1 + dx, v1 + dy, u2 + dx, v2 + dy]
    } else {
      const [u1, v1, u2, v2] = d.orig
      let minX = Math.min(u1, u2), maxX = Math.max(u1, u2)
      let minY = Math.min(v1, v2), maxY = Math.max(v1, v2)
      const U = clamp(snap(mx / px), 0, scale)
      const V = clamp(snap(my / px), 0, scale)
      const m = d.mode
      if (m.includes('w')) minX = clamp(Math.min(maxX - 1, U), 0, scale)
      if (m.includes('e')) maxX = clamp(Math.max(minX + 1, U), 0, scale)
      if (m.includes('n')) minY = clamp(Math.min(maxY - 1, V), 0, scale)
      if (m.includes('s')) maxY = clamp(Math.max(minY + 1, V), 0, scale)
      uv = [
        u1 <= u2 ? minX : maxX,
        v1 <= v2 ? minY : maxY,
        u1 <= u2 ? maxX : minX,
        v1 <= v2 ? maxY : minY,
      ]
    }
    const before = d.rc.face.uv
    if (uv.every((v, i) => v === before[i])) return
    d.moved = true
    applyFaceUvValues(d.rc.el, d.rc.key, uv, hooks)
    syncEditInputs()
    updateStatus()
    requestDraw()
  }

  return { startDrag, onDragMove }
}
