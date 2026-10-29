/**
 * matoga - 预览面板：天空预设
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 从 preview-panel.js 原样搬出，逻辑未改。天空参数的写入/读取与自定义预设列表。
 */

import { $, showToast } from '../core.js'
import { t } from '../i18n.js'
import {
  setSkySunElevation, setSkySunAzimuth, setSkyTurbidity,
  setSkyRayleigh, setSkyMieCoefficient, setSkyMieDirectionalG, setSkyTint,
} from '../material3d.js'

export function applySkyPreset(p) {
  const apply = (id, val, valId, text, fn) => { $(id).value = val; $(valId).textContent = text; fn(val) }
  apply('m3dSkyElevation', p.elevation, 'm3dSkyElevationVal', p.elevation + '°', setSkySunElevation)
  apply('m3dSkyAzimuth', p.azimuth, 'm3dSkyAzimuthVal', p.azimuth + '°', setSkySunAzimuth)
  apply('m3dSkyTurbidity', p.turbidity, 'm3dSkyTurbidityVal', p.turbidity.toFixed(1), setSkyTurbidity)
  apply('m3dSkyRayleigh', p.rayleigh, 'm3dSkyRayleighVal', p.rayleigh.toFixed(2), setSkyRayleigh)
  apply('m3dSkyMie', p.mie, 'm3dSkyMieVal', p.mie.toFixed(3), setSkyMieCoefficient)
  apply('m3dSkyMieG', p.mieG, 'm3dSkyMieGVal', p.mieG.toFixed(3), setSkyMieDirectionalG)
  $('m3dSkyTint').value = p.tint; setSkyTint(p.tint)
}
export function getSkyPresetFromUI() {
  return {
    elevation: parseFloat($('m3dSkyElevation').value),
    azimuth: parseFloat($('m3dSkyAzimuth').value),
    turbidity: parseFloat($('m3dSkyTurbidity').value),
    rayleigh: parseFloat($('m3dSkyRayleigh').value),
    mie: parseFloat($('m3dSkyMie').value),
    mieG: parseFloat($('m3dSkyMieG').value),
    tint: $('m3dSkyTint').value
  }
}
export function renderSkyCustomList(customPresets) {
  const list = $('m3dSkyCustomList'); if (!list) return
  list.innerHTML = ''
  if (!customPresets || customPresets.length === 0) return
  customPresets.forEach((preset, i) => {
    const item = document.createElement('div')
    item.className = 'm3d-sky-custom-item'
    const applyBtn = document.createElement('button')
    applyBtn.className = 'm3d-sky-custom-apply'
    applyBtn.textContent = preset.name
    applyBtn.addEventListener('click', () => {
      document.querySelectorAll('#m3dSkyPresetSeg button').forEach(b => b.classList.remove('active'))
      applySkyPreset(preset)
    })
    const delBtn = document.createElement('button')
    delBtn.className = 'm3d-sky-custom-del'
    delBtn.innerHTML = '&times;'
    delBtn.addEventListener('click', async () => {
      const cfg = await window.api.getConfig()
      const presets = (cfg.skyCustomPresets || []).filter((_, j) => j !== i)
      await window.api.setConfig({ skyCustomPresets: presets })
      renderSkyCustomList(presets)
      showToast(t('m3d.skyPresetDeleted'))
    })
    item.appendChild(applyBtn)
    item.appendChild(delBtn)
    list.appendChild(item)
  })
}
