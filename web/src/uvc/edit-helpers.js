/**
 * matoga - UV 编辑器：编辑辅助
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 从 uv-editor-core.js 原样搬出（正文逐字未改）。
 * 职责：状态栏临时提示（3 秒自动消失）、编辑基线快照（撤销/重置的对照）。
 */

let _get_state = () => ({})
let _get_layout = () => ({})
let _updateStatus

export function setHooks(h) {
  if (h.get_state) _get_state = h.get_state
  if (h.get_layout) _get_layout = h.get_layout
  if (h.updateStatus) _updateStatus = h.updateStatus
}

export function snapshotLayout(layout) {
  if (!layout || !Array.isArray(layout.elements)) return null
  return layout.elements.map(el => {
    const faces = {}
    for (const key in el.faces || {}) {
      const f = el.faces[key]
      if (f && Array.isArray(f.uv)) faces[key] = { uv: [...f.uv], rotation: f.rotation || 0 }
    }
    return { faces }
  })
}

export function flashNotice(msg) {
  _get_state().notice = msg
  _updateStatus()
  setTimeout(() => {
    if (_get_state().notice === msg) {
      _get_state().notice = null
      _updateStatus()
    }
  }, 3000)
}
