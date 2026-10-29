/**
 * matoga - 预览面板：材质与过滤控件
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 从 preview-panel.js 原样搬出，逻辑未改。纹理过滤联动 + 自定义材质预设的读写与列表。
 */

import { $, showToast } from '../core.js'
import { t } from '../i18n.js'
import { MAT_PRESET_INPUTS } from '../preview-presets.js'

export function updateFilterControls() {
  const active = document.querySelector('#m3dFilterSeg button.active')
  const mode = active ? active.dataset.filter : 'trilinear'
  const aniso = $('m3dAniso'), anisoVal = $('m3dAnisoVal'), mipmap = $('m3dMipmaps')
  const anisoOn = mode === 'anisotropic'
  const mipmapOn = mode === 'trilinear' || mode === 'anisotropic'
  if (aniso) { aniso.disabled = !anisoOn; if (anisoVal) anisoVal.style.opacity = anisoOn ? '1' : '.4' }
  if (mipmap) { mipmap.disabled = !mipmapOn; mipmap.parentElement.style.opacity = mipmapOn ? '1' : '.4' }
}

export function getMaterialPresetFromUI() {
  const p = {}
  MAT_PRESET_INPUTS.forEach(id => { const el = $(id); if (el) p[id] = parseFloat(el.value) })
  return p
}
export function applyMaterialPreset(p) {
  if (!p) return
  MAT_PRESET_INPUTS.forEach(id => {
    if (p[id] === undefined || p[id] === null) return
    const el = $(id)
    if (el) { el.value = p[id]; el.dispatchEvent(new Event('input', { bubbles: true })) }
  })
}
export function renderMatCustomList(customPresets) {
  const list = $('m3dMatCustomList'); if (!list) return
  list.innerHTML = ''
  if (!customPresets || customPresets.length === 0) return
  customPresets.forEach((preset, i) => {
    const item = document.createElement('div'); item.className = 'm3d-light-custom-item'
    const applyBtn = document.createElement('button'); applyBtn.className = 'm3d-light-custom-apply'; applyBtn.textContent = preset.name
    applyBtn.addEventListener('click', () => applyMaterialPreset(preset.config || preset))
    const delBtn = document.createElement('button'); delBtn.className = 'm3d-light-custom-del'; delBtn.innerHTML = '&times;'
    delBtn.addEventListener('click', async () => {
      const cfg = await window.api.getConfig()
      const presets = ((cfg && cfg.materialCustomPresets) || []).filter((_, j) => j !== i)
      await window.api.setConfig({ materialCustomPresets: presets })
      renderMatCustomList(presets); showToast(t('m3d.matPresetDeleted'))
    })
    item.appendChild(applyBtn); item.appendChild(delBtn); list.appendChild(item)
  })
}
