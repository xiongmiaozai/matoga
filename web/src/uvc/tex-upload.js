/**
 * matoga - UV 编辑器：多文件贴图上传
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 从 uv-editor-core.js 原样搬出（正文逐字未改）。
 * 职责：一次拖入多张图时，从当前选中槽位起按顺序逐槽替换
 *       （画师一次导出多张贴图，逐槽位对应）。
 */

import { readAsDataURL } from './tex-utils.js'

let _get_state = () => ({})
let _applyCustomTexture
let _flashNotice
let _t

export function setHooks(h) {
  if (h.get_state) _get_state = h.get_state
  if (h.applyCustomTexture) _applyCustomTexture = h.applyCustomTexture
  if (h.flashNotice) _flashNotice = h.flashNotice
  if (h.t) _t = h.t
}

export async function handleTextureFiles(files) {
  const list = Array.from(files || []).filter(f => f && /^image\//.test(String(f.type || '')))
  if (!list.length || !_get_state().layout) return
  const start = _get_state().activeTex
  let replaced = 0
  for (let i = 0; i < list.length; i++) {
    const texIndex = start + i
    if (texIndex >= _get_state().layout.textures.length) break
    try {
      const dataUrl = await readAsDataURL(list[i])
      _applyCustomTexture(dataUrl, list[i].name, texIndex)
      replaced++
    } catch {}
  }
  if (replaced > 1) _flashNotice(_t('uv.replacedN', { n: replaced }))
}
