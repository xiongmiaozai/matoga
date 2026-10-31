/**
 * matoga - UV 编辑器：重绘调度
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 从 uv-editor-core.js 原样搬出（正文逐字未改）。
 * 职责：把多次重绘请求合并到下一帧（避免同帧内重复绘制）。
 * drawPending 是可变量（防重入标记），需 get/set 成对；
 * visible / draw 由宿主注入。
 */

let _visible = () => true
let _draw = () => {}
let _get_drawPending = () => false
let _set_drawPending = () => {}

export function setHooks(h) {
  if (h.visible) _visible = h.visible
  if (h.draw) _draw = h.draw
  if (h.get_drawPending) _get_drawPending = h.get_drawPending
  if (h.set_drawPending) _set_drawPending = h.set_drawPending
}

export function requestDraw() {
  if (_get_drawPending() || !_visible()) return
  _set_drawPending(true)
  requestAnimationFrame(() => {
    _set_drawPending(false)
    _draw()
  })
}
