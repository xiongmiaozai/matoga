/**
 * matoga - UV 画布 ↔ 3D 视口高亮联动（highlightFace 钩子）
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 从 uv-editor-core.js 原样搬出，逻辑未改。
 */

/**
 * 创建高亮控制器。
 * @param {object} o
 * @param {object} o.state     uv 编辑器 state
 * @param {object} o.hooks     宿主钩子（highlightFace(el, key, on) → 是否成功）
 */
export function createHighlighter(o) {
  const { state, hooks } = o
  let hlFace = null

  function clearHighlight3d() {
    if (!hlFace) return
    if (typeof hooks.highlightFace === 'function') {
      try { hooks.highlightFace(hlFace.el, hlFace.key, false) } catch {}
    }
    hlFace = null
  }

  function updateActiveHighlight() {
    const tgt = state.hover || state.selected
    const elRef = (tgt && tgt.el && tgt.el.el) ? tgt.el.el : null
    const key = tgt ? tgt.key : null
    if (hlFace && elRef && hlFace.el === elRef && hlFace.key === key) return
    clearHighlight3d()
    if (elRef && typeof hooks.highlightFace === 'function') {
      try {
        if (hooks.highlightFace(elRef, key, true)) hlFace = { el: elRef, key }
      } catch {}
    }
  }

  return { clearHighlight3d, updateActiveHighlight }
}
