/**
 * matoga - UV 编辑器面数据操作
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 从 uv-editor-core.js 原样搬出，逻辑未改；
 * 联动钩子 hooks 改为显式参数（缺省仅写回 layout 数据）。
 */

/**
 * 写回面 UV 并通知 3D 联动钩子。
 * @param {object} layEl layout 元素 { el, faces }
 * @param {string} key   面名
 * @param {number[]} uv  [u1,v1,u2,v2]
 * @param {object} hooks { onFaceUv? }
 * @returns {boolean} 是否写入成功
 */
export function applyFaceUvValues(layEl, key, uv, hooks) {
  const face = layEl && layEl.faces ? layEl.faces[key] : null
  if (!face || !Array.isArray(uv) || uv.length !== 4 || !uv.every(n => Number.isFinite(+n))) return false
  face.uv = [+uv[0], +uv[1], +uv[2], +uv[3]]
  face.mirror = face.uv[2] < face.uv[0]
  if (layEl.el && hooks && typeof hooks.onFaceUv === 'function') {
    try { hooks.onFaceUv(layEl.el, key, face.uv) } catch {}
  }
  return true
}

/**
 * 写回面旋转（90° 对齐、归一到 0..270）并通知 3D 联动钩子。
 * @param {object} layEl layout 元素 { el, faces }
 * @param {string} key   面名
 * @param {number} rotation 旋转角度
 * @param {object} hooks { onFaceRotation? }
 * @returns {boolean} 是否写入成功
 */
export function applyFaceRotationValue(layEl, key, rotation, hooks) {
  const face = layEl && layEl.faces ? layEl.faces[key] : null
  if (!face) return false
  face.rotation = Number.isFinite(+rotation) ? (((Math.round(+rotation / 90) * 90) % 360) + 360) % 360 : 0
  if (layEl.el && hooks && typeof hooks.onFaceRotation === 'function') {
    try { hooks.onFaceRotation(layEl.el, key, face.rotation) } catch {}
  }
  return true
}

/** 取某面的历史快照条目 { layEl, key, uv, rotation }；面无 UV 时 uv=null */
export function faceEntryOf(layEl, key) {
  const f = (layEl && layEl.faces) ? layEl.faces[key] : null
  if (!f) return null
  return { layEl, key, uv: Array.isArray(f.uv) ? [...f.uv] : null, rotation: f.rotation || 0 }
}

/** 按历史条目回滚面数据 */
export function applyHistoryEntry(entry, hooks) {
  if (Array.isArray(entry.uv)) applyFaceUvValues(entry.layEl, entry.key, entry.uv, hooks)
  if (entry.rotation != null) applyFaceRotationValue(entry.layEl, entry.key, entry.rotation, hooks)
}

/** 会话基线快照：逐元素逐面记录 uv/rotation */
export function snapshotLayout(layout) {
  if (!layout || !Array.isArray(layout.elements)) return null
  return layout.elements.map(el => {
    const faces = {}
    for (const key in (el.faces || {})) {
      const f = el.faces[key]
      if (f && Array.isArray(f.uv)) faces[key] = { uv: [...f.uv], rotation: f.rotation || 0 }
    }
    return { faces }
  })
}
