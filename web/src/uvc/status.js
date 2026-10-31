/**
 * matoga - UV 编辑器：状态刷新
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 从 uv-editor-core.js 原样搬出（正文逐字未改）。
 * 依赖的闭包状态经 setHooks 注入（只读）。
 */

/* 闭包状态（只读，getter 转发）与闭包内函数（直接注入） */
let _get_state = () => ({})
let _get_statusEl = () => null
let _t = k => k
let _rebuildChips = () => {}
let _draw = () => {}
let _loadTexAnimInfo = () => {}

export function setHooks(h) {
  if (h.get_state) _get_state = h.get_state
  if (h.get_statusEl) _get_statusEl = h.get_statusEl
  if (h.t) _t = h.t
  if (h.rebuildChips) _rebuildChips = h.rebuildChips
  if (h.draw) _draw = h.draw
  if (h.loadTexAnimInfo) _loadTexAnimInfo = h.loadTexAnimInfo
}

export function updateStatus() {
  if (!_get_statusEl()) return
  const layout = _get_state().layout
  if (!layout) {
    _get_statusEl().textContent = _get_state().notice || ''
    return
  }
  const tex = layout.textures[_get_state().activeTex]
  if (!tex) {
    _get_statusEl().textContent = _get_state().notice || ''
    return
  }
  if (_get_state().notice) {
    _get_statusEl().textContent = _get_state().notice
    return
  }
  let faceCount = 0
  layout.elements.forEach(el => {
    for (const key in el.faces) if (el.faces[key].tex === _get_state().activeTex) faceCount++
  })
  const rec = imgCache.get(tex.url)
  const failed = rec && rec.done && !rec.ok
  const sizeStr = rec && rec.ok && rec.img ? `${rec.img.naturalWidth}×${rec.img.naturalHeight}` : ''
  const animInfo = sizeStr ? _loadTexAnimInfo(tex, rec.img.naturalWidth, rec.img.naturalHeight) : null
  const animStr = animInfo ? ` · ${_t('uv.animFrames', { n: animInfo.frames })}` : ''
  const removedStr = !tex.url ? ` · ${_t('uv.removed')}` : ''
  const customStr = !tex.url || !_get_state().customTex.has(_get_state().activeTex) ? '' : ` · ${_t('uv.custom')}`
  let text =
    (tex.name || '') +
    (sizeStr ? ` · ${sizeStr}` : '') +
    animStr +
    customStr +
    removedStr +
    (failed ? ` · ${_t('uv.missing')}` : '') +
    ` · ${_t('uv.faces', { n: faceCount })}`
  if (_get_state().drag && _get_state().drag.moved) {
    const f = _get_state().drag.rc.face
    text +=
      '  ·  ' +
      `${_t('uv.el')} ${_get_state().drag.rc.elIdx} ${_get_state().drag.rc.key} · uv [${f.uv.map(fmtUvNum).join(', ')}]`
  } else if (_get_state().hover) {
    const f = _get_state().hover.face
    const parts = [`${_t('uv.el')} ${layout.elements.indexOf(_get_state().hover.el)}`, _get_state().hover.key]
    if (f.rotation) parts.push(`${_t('uv.rot')} ${f.rotation}°`)
    if (f.mirror) parts.push(_t('uv.mirror'))
    text += '  ·  ' + parts.join(' · ')
  } else if (_get_state().edit && _get_state().selected) {
    const f = _get_state().selected.face
    text +=
      '  ·  ' +
      `${_t('uv.el')} ${_get_state().selected.elIdx} ${_get_state().selected.key} · uv [${f.uv.map(fmtUvNum).join(', ')}]`
  }
  _get_statusEl().textContent = text
}
