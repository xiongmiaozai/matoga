/**
 * matoga - UV 编辑器：拖拽处理
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 从 uv-editor-core.js L839-L898 原样搬出（正文逐字未改）。
 * 依赖的闭包符号经 setHooks 注入。
 */

/* 闭包状态（只读 getter）与闭包内函数（直接注入） */
let _get_state = () => undefined
let _get_canvas = () => undefined
let _selectedRect = () => {}
let _requestDraw = () => {}
let _updateStatus = () => {}

export function setHooks(h) {
  if (h.get_state) _get_state = h.get_state
  if (h.get_canvas) _get_canvas = h.get_canvas
  if (h.selectedRect) _selectedRect = h.selectedRect
  if (h.requestDraw) _requestDraw = h.requestDraw
  if (h.updateStatus) _updateStatus = h.updateStatus
}

export function startDrag(e, mode, mx, my) {
  const rc = _selectedRect() || hitRect(mx, my)
  if (!rc) return
  _get_state().drag = { mode, rc, sx: mx, sy: my, orig: [...rc.face.uv], moved: false }
  try {
    _get_canvas().setPointerCapture && _get_canvas().setPointerCapture(e.pointerId)
  } catch {}
}

export function onDragMove(mx, my, altKey) {
  const d = _get_state().drag
  if (!d) return
  const px = _get_state().px || 1
  const maxW = _get_state().uvMaxW || 16
  const maxH = _get_state().uvMaxH || 16
  const step = altKey ? 0.25 : 1
  const snap = v => Math.round(v / step) * step
  const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi)
  let uv
  if (d.mode === 'move') {
    let dx = _snap((mx - d.sx) / px)
    let dy = _snap((my - d.sy) / px)
    const [u1, v1, u2, v2] = d.orig
    dx = clamp(dx, -Math.min(u1, u2), maxW - Math.max(u1, u2))
    dy = clamp(dy, -Math.min(v1, v2), maxH - Math.max(v1, v2))
    uv = [u1 + dx, v1 + dy, u2 + dx, v2 + dy]
  } else {
    const [u1, v1, u2, v2] = d.orig
    let minX = Math.min(u1, u2),
      maxX = Math.max(u1, u2)
    let minY = Math.min(v1, v2),
      maxY = Math.max(v1, v2)
    const U = clamp(_snap(mx / px), 0, maxW)
    const V = clamp(_snap(my / px), 0, maxH)
    const m = d.mode
    if (m.includes('w')) minX = clamp(Math.min(maxX - step, U), 0, maxW)
    if (m.includes('e')) maxX = clamp(Math.max(minX + step, U), 0, maxW)
    if (m.includes('n')) minY = clamp(Math.min(maxY - step, V), 0, maxH)
    if (m.includes('s')) maxY = clamp(Math.max(minY + step, V), 0, maxH)
    uv = [u1 <= u2 ? minX : maxX, v1 <= v2 ? minY : maxY, u1 <= u2 ? maxX : minX, v1 <= v2 ? maxY : minY]
  }
  const before = d.rc.face.uv
  if (uv.every((v, i) => v === before[i])) return
  d.moved = true
  applyFaceUvValues(d.rc.el, d.rc.key, uv)
  syncEditInputs()
  _updateStatus()
  _requestDraw()
}

export function hitRect(mx, my) {
  return _get_state().rects.findLast(rc => mx >= rc.x && mx <= rc.x + rc.w && my >= rc.y && my <= rc.y + rc.h)
}

export function hitHandle(mx, my) {
  for (const h of _get_state().handles) {
    if (Math.abs(mx - h.x) <= HANDLE_HIT && Math.abs(my - h.y) <= HANDLE_HIT) return h
  }
  return null
}
