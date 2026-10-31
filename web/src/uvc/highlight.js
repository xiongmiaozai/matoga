/**
 * matoga - UV 编辑器：3D 高亮联动
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 从 uv-editor-core.js 原样搬出（正文逐字未改）。
 * 职责：把 UV 画布上的悬停/选中面同步高亮到 3D 视口（经 hooks.highlightFace）。
 */

/* state / hooks 只读；hlFace 是可变的"当前高亮"缓存，需 get/set 成对 */
let _get_state = () => ({})
let _get_hooks = () => ({})
let _get_hlFace = () => null
let _set_hlFace = () => {}

export function setHooks(h) {
  if (h.get_state) _get_state = h.get_state
  if (h.get_hooks) _get_hooks = h.get_hooks
  if (h.get_hlFace) _get_hlFace = h.get_hlFace
  if (h.set_hlFace) _set_hlFace = h.set_hlFace
}

export function clearHighlight3d() {
  if (!_get_hlFace()) return
  if (typeof _get_hooks().highlightFace === 'function') {
    try {
      _get_hooks().highlightFace(_get_hlFace().el, _get_hlFace().key, false)
    } catch {}
  }
  _set_hlFace(null)
}

export function updateActiveHighlight() {
  const tgt = _get_state().hover || _get_state().selected
  const elRef = tgt && tgt.el && tgt.el.el ? tgt.el.el : null
  const key = tgt ? tgt.key : null
  if (hlFace && elRef && hlFace.el === elRef && hlFace.key === key) return
  clearHighlight3d()
  if (elRef && typeof _get_hooks().highlightFace === 'function') {
    try {
      if (_get_hooks().highlightFace(elRef, key, true)) _set_hlFace({ el: elRef, key })
    } catch {}
  }
}
