/**
 * matoga - 预览面板：3D 参数浮窗拖拽
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 从 preview-panel.js 原样搬出，逻辑未改。浮窗在容器内可拖动，边界钳制在容器范围内。
 */

import { $ } from '../core.js'

/** 初始化参数浮窗拖拽（元素缺失时直接跳过）。 */
export function bindParamsDrag() {
  ;(() => {
    const ov = $('m3dParamsOverlay'), drag = $('m3dParamsDrag'), container = $('material3dContainer')
    if (!ov || !drag || !container) return
    let dragging = false, sx = 0, sy = 0, sl = 0, st = 0
    drag.addEventListener('mousedown', (e) => {
      if (e.target.closest('.m3d-params-close')) return
      e.preventDefault(); dragging = true
      const r = ov.getBoundingClientRect(), cr = container.getBoundingClientRect()
      sl = r.left - cr.left; st = r.top - cr.top; sx = e.clientX; sy = e.clientY
      ov.style.right = 'auto'; ov.style.bottom = 'auto'; ov.style.left = sl + 'px'; ov.style.top = st + 'px'
      document.body.style.cursor = 'grabbing'; document.body.style.userSelect = 'none'
    })
    document.addEventListener('mousemove', (e) => {
      if (!dragging) return
      const cr = container.getBoundingClientRect()
      const nl = Math.max(0, Math.min(cr.width - ov.offsetWidth, sl + e.clientX - sx))
      const nt = Math.max(0, Math.min(cr.height - ov.offsetHeight, st + e.clientY - sy))
      ov.style.left = nl + 'px'; ov.style.top = nt + 'px'
    })
    document.addEventListener('mouseup', () => { if (!dragging) return; dragging = false; document.body.style.cursor = ''; document.body.style.userSelect = '' })
  })()
}
