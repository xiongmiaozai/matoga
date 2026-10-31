/**
 * matoga - UV 编辑器：贴图槽位操作
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 从 uv-editor-core.js 原样搬出（正文逐字未改）。
 * 职责：贴图的自定义替换、移除、从贴图库选择。
 *
 * 按组合式架构约定：宿主对象（state / layout / hooks）与回调函数
 * 由 createUvEditor 在构造完成后一次性注入，模块内部不反向 import 主文件。
 */

import { isUsableTexUrl } from './tex-utils.js'
import { rebuildChips } from './tex-chips.js'

/* 宿主对象（getter 转发）与回调函数 */
let _get_state = () => ({})
let _get_layout = () => ({})
let _get_hooks = () => ({})
let _draw
let _notifyDirty
let _loadTexImage
let _updateStatus

export function setHooks(h) {
  if (h.get_state) _get_state = h.get_state
  if (h.get_layout) _get_layout = h.get_layout
  if (h.get_hooks) _get_hooks = h.get_hooks
  if (h.draw) _draw = h.draw
  if (h.notifyDirty) _notifyDirty = h.notifyDirty
  if (h.loadTexImage) _loadTexImage = h.loadTexImage
  if (h.updateStatus) _updateStatus = h.updateStatus
}

export function applyCustomTexture(dataUrl, filename, texIndex, extra) {
  const layout = _get_state().layout
  if (!layout || !isUsableTexUrl(dataUrl)) return
  const i = texIndex != null && Number.isFinite(+texIndex) ? +texIndex : _get_state().activeTex
  const tex = layout.textures[i]
  if (!tex) return
  tex.url = dataUrl
  tex.mcmetaUrl = null /* 自定义贴图无动画元数据 */
  if (filename) tex.name = String(filename).replace(/\.[^.]+$/, '')
  _get_state().customTex.add(i)
  rebuildChips()
  _loadTexImage(dataUrl) /* 预载 → onload 后重绘 */
  if (typeof _get_hooks().onTexture === 'function') {
    try {
      Promise.resolve(_get_hooks().onTexture(i, dataUrl, layout, extra)).catch(() => {})
    } catch {}
  }
  _updateStatus()
  _draw()
  _notifyDirty()
}

export function removeTexture(texIndex) {
  const layout = _get_state().layout
  if (!layout) return
  const i = texIndex != null && Number.isFinite(+texIndex) ? +texIndex : _get_state().activeTex
  const tex = layout.textures[i]
  if (!tex || !tex.url) return
  tex.url = ''
  tex.mcmetaUrl = null
  _get_state().customTex.add(i)
  rebuildChips()
  _updateStatus()
  _draw()
  _notifyDirty()
  if (typeof _get_hooks().onTexture === 'function') {
    try {
      Promise.resolve(_get_hooks().onTexture(i, '', layout)).catch(() => {})
    } catch {}
  }
}

export async function pickLibraryTexture() {
  if (!_get_state().layout) return
  let picked = null
  try {
    if (typeof _get_hooks().pickTexture === 'function') {
      picked = await _get_hooks().pickTexture()
    } else {
      const m = await import('./uv-tex-picker.js')
      picked = await m.openTexPicker()
    }
  } catch (e) {
    console.error('[uv-editor] tex-picker', e)
  }
  if (picked && isUsableTexUrl(picked.url)) {
    const extra = { normal: picked.normal || '', specular: picked.specular || '' }
    applyCustomTexture(picked.url, picked.name || null, null, extra)
  }
}
