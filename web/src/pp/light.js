/**
 * matoga - 预览面板：自定义灯光编辑器
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 从 preview-panel.js 原样搬出，逻辑未改。灯光配置的渲染与自定义预设列表。
 */

import { $, showToast } from '../core.js'
import { t } from '../i18n.js'
import { hexToNum, numToHex } from '../preview-presets.js'
import { getCustomLightConfig, applyCustomLightConfigExport } from '../material3d.js'

export function renderLightEditor(config) {
  if (!config) return
  const ac = $('m3dAmbientColor'), ai = $('m3dAmbientIntensity'), aiv = $('m3dAmbientIntensityVal'), bg = $('m3dBgColor'), list = $('m3dLightList')
  if (ac) ac.value = numToHex(config.ambient.color)
  if (ai) { ai.value = config.ambient.intensity; if (aiv) aiv.textContent = config.ambient.intensity.toFixed(2) }
  if (bg) bg.value = numToHex(config.bg)
  if (!list) return
  list.innerHTML = ''
  config.lights.forEach((light, i) => {
    const item = document.createElement('div'); item.className = 'm3d-light-item'
    const head = document.createElement('div'); head.className = 'm3d-light-item-head'
    const dot = document.createElement('span'); dot.className = 'm3d-light-dot'; dot.style.background = numToHex(light.color)
    const title = document.createElement('span'); title.className = 'm3d-light-title'; title.textContent = t('m3d.lightLabel') + ' ' + (i + 1)
    const del = document.createElement('button'); del.className = 'm3d-light-del'; del.innerHTML = '&times;'
    del.addEventListener('click', () => {
      const c = getCustomLightConfig(); if (!c || c.lights.length <= 1) return
      c.lights.splice(i, 1); applyCustomLightConfigExport(c); renderLightEditor(c)
    })
    head.appendChild(dot); head.appendChild(title); head.appendChild(del); item.appendChild(head)
    const r1 = document.createElement('div'); r1.className = 'm3d-ctrl-group'
    const ci = document.createElement('input'); ci.type = 'color'; ci.className = 'm3d-color-input'; ci.value = numToHex(light.color)
    ci.addEventListener('input', () => { const c = getCustomLightConfig(); if (!c) return; c.lights[i].color = hexToNum(ci.value); dot.style.background = ci.value; applyCustomLightConfigExport(c) })
    const il = document.createElement('label'); il.className = 'm3d-slider'
    const isp = document.createElement('span'); isp.textContent = t('m3d.lightIntensity')
    const iin = document.createElement('input'); iin.type = 'range'; iin.min = '0'; iin.max = '5'; iin.step = '0.01'; iin.value = light.intensity
    const ivl = document.createElement('span'); ivl.className = 'm3d-val'; ivl.textContent = light.intensity.toFixed(2)
    iin.addEventListener('input', () => { const v = parseFloat(iin.value); ivl.textContent = v.toFixed(2); const c = getCustomLightConfig(); if (!c) return; c.lights[i].intensity = v; applyCustomLightConfigExport(c) })
    il.appendChild(isp); il.appendChild(iin); il.appendChild(ivl); r1.appendChild(ci); r1.appendChild(il); item.appendChild(r1)
    const r2 = document.createElement('div'); r2.className = 'm3d-ctrl-group'
    ;['x', 'y', 'z'].forEach((axis, ai2) => {
      const lbl = document.createElement('label'); lbl.className = 'm3d-slider'
      const sp = document.createElement('span'); sp.textContent = axis.toUpperCase()
      const inp = document.createElement('input'); inp.type = 'range'; inp.min = '-10'; inp.max = '10'; inp.step = '0.1'; inp.value = light.pos[ai2]
      const vl = document.createElement('span'); vl.className = 'm3d-val'; vl.textContent = light.pos[ai2].toFixed(1)
      inp.addEventListener('input', () => { const v = parseFloat(inp.value); vl.textContent = v.toFixed(1); const c = getCustomLightConfig(); if (!c) return; c.lights[i].pos[ai2] = v; applyCustomLightConfigExport(c) })
      lbl.appendChild(sp); lbl.appendChild(inp); lbl.appendChild(vl); r2.appendChild(lbl)
    })
    item.appendChild(r2); list.appendChild(item)
  })
}

export function renderLightCustomList(customPresets) {
  const list = $('m3dLightCustomList'); if (!list) return; list.innerHTML = ''
  if (!customPresets || customPresets.length === 0) return
  customPresets.forEach((preset, i) => {
    const item = document.createElement('div'); item.className = 'm3d-light-custom-item'
    const applyBtn = document.createElement('button'); applyBtn.className = 'm3d-light-custom-apply'; applyBtn.textContent = preset.name
    applyBtn.addEventListener('click', () => {
      document.querySelectorAll('#m3dLightSeg button').forEach(b => b.classList.remove('active'))
      applyCustomLightConfigExport(preset.config); renderLightEditor(preset.config)
    })
    const delBtn = document.createElement('button'); delBtn.className = 'm3d-light-custom-del'; delBtn.innerHTML = '&times;'
    delBtn.addEventListener('click', async () => {
      const cfg = await window.api.getConfig()
      const presets = (cfg.lightCustomPresets || []).filter((_, j) => j !== i)
      await window.api.setConfig({ lightCustomPresets: presets })
      renderLightCustomList(presets); showToast(t('m3d.lightPresetDeleted'))
    })
    item.appendChild(applyBtn); item.appendChild(delBtn); list.appendChild(item)
  })
}
