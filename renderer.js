/**
 * matoga - 材质贴图对比工具
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 */

import { state, $, showToast } from './src/core.js'
import { closePreview, mainEntryOf, getIgnorePatterns, fileUrl } from './src/utils.js'
import { compare, sortResult } from './src/compare.js'
import { renderResult, renderSidebar, updateSortIndicators, selectGroup, initViewTabs } from './src/render.js'
import {
  loadFromPath, loadFolder, updateCompareButton, saveOptions,
  undo, updateUndoBtn, swapFolders, exportResult, exportHtml,
  batchCopyToSide, reloadAndCompare, handleAction
} from './src/actions.js'
import {
  setGeometry, setMetalness, setRoughness, setNormalScale, setEmissiveIntensity,
  setMaterialFormat, setFormatDetectCallback, setHeightDetectCallback, setSourceSide,
  setParallaxScale, setParallaxSteps, setParallaxMode, setParallaxAdaptive, setParallaxEnabled, setParallaxShadow,
  setLightPreset, setEnvIntensity, setExposure,
  toggleGround, loadHDREnv, clearHDREnv, getCurrentLightPreset, getCurrentEnvMode, setEnvModeExport,
  setSkyTurbidity, setSkyRayleigh, setSkyMieCoefficient, setSkyMieDirectionalG, setSkySunElevation, setSkySunAzimuth,
  setSkyCloudCoverage, setSkyCloudScale, setSkyCloudSpeed, setSkyCloudDensity, setSkyCloudElevation, setSkyTint,
  setAutoRotate, setWireframe, screenshot, toggleFullscreen,
  setOpacityMode, setOpacity, setTransmission, setIOR, setClearcoat,
  setTextureFilter, setMipmapsEnabled, setAnisotropyLevel, getMaxAnisotropy
} from './src/material3d.js'
import { initLayout } from './src/layout.js'
import { initSettings, applyTheme } from './src/settings.js'
import { initPreview2D } from './src/preview2d.js'
import { initHdrPreset, refreshHdrPreset, clearHdrPresetSelection } from './src/hdri-preset.js'

import {
  leftBtn, rightBtn, exportBtn, exportHtmlBtn, swapBtn,
  clearMemBtn, batchRightBtn, batchLeftBtn, undoBtn,
  compareBtn2, swapBtn2,
  recursiveChk, onlyMissingChk, hashChk, ignoreChk, ignoreInput,
  searchInput, resultBody, leftCard, rightCard
} from './src/core.js'

leftBtn.addEventListener('click', () => loadFolder('left'))
rightBtn.addEventListener('click', () => loadFolder('right'))

exportBtn.addEventListener('click', exportResult)
swapBtn.addEventListener('click', swapFolders)
onlyMissingChk.addEventListener('change', () => { saveOptions(); renderResult() })
hashChk.addEventListener('change', () => { saveOptions(); if (state.leftPath && state.rightPath) compare() })

let _searchTimer = null
searchInput.addEventListener('input', () => {
  state.searchText = searchInput.value
  state.renderLimit = 200
  clearTimeout(_searchTimer)
  _searchTimer = setTimeout(renderResult, 150)
})

document.querySelectorAll('input[name="viewMode"]').forEach(r => {
  r.addEventListener('change', () => { state.viewMode = r.value; state.collapsedFolders.clear(); saveOptions(); renderResult() })
})

recursiveChk.addEventListener('change', async () => {
  saveOptions()
  if (state.leftPath) await loadFromPath('left', state.leftPath)
  if (state.rightPath) await loadFromPath('right', state.rightPath)
  if (state.leftPath && state.rightPath) compare()
})

document.querySelectorAll('.result-table th[data-key]').forEach(th => {
  th.classList.add('sortable')
  th.addEventListener('click', () => {
    const key = th.dataset.key
    if (state.sortKey === key) state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc'
    else { state.sortKey = key; state.sortDir = 'asc' }
    state.renderLimit = 200
    saveOptions()
    updateSortIndicators()
    renderResult()
  })
})
updateSortIndicators()

;[['left', leftCard], ['right', rightCard]].forEach(([side, card]) => {
  card.addEventListener('dragover', (e) => { e.preventDefault(); card.classList.add('drag-over') })
  card.addEventListener('dragleave', () => card.classList.remove('drag-over'))
  card.addEventListener('drop', async (e) => {
    e.preventDefault()
    card.classList.remove('drag-over')
    const files = e.dataTransfer && e.dataTransfer.files
    if (!files || !files.length) return
    let p
    try { p = window.api.getPathForFile(files[0]) } catch { p = files[0].path }
    if (!p) { showToast('无法获取拖入路径'); return }
    await loadFromPath(side, p)
  })
})

$('previewModal').addEventListener('click', closePreview)
$('previewClose').addEventListener('click', (e) => { e.stopPropagation(); closePreview() })

document.querySelectorAll('.filter-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'))
    btn.classList.add('active')
    state.statusFilter = btn.dataset.filter
    state.renderLimit = 200
    saveOptions()
    renderResult()
  })
})

ignoreChk.addEventListener('change', () => { saveOptions(); if (state.leftPath) loadFromPath('left', state.leftPath); if (state.rightPath) loadFromPath('right', state.rightPath) })
let _ignoreTimer = null
ignoreInput.addEventListener('input', () => {
  clearTimeout(_ignoreTimer)
  _ignoreTimer = setTimeout(() => { saveOptions(); if (state.leftPath) loadFromPath('left', state.leftPath); if (state.rightPath) loadFromPath('right', state.rightPath) }, 400)
})

exportHtmlBtn.addEventListener('click', exportHtml)
clearMemBtn.addEventListener('click', async () => {
  await window.api.clearConfig()
  showToast('已清除记忆')
})

batchRightBtn.addEventListener('click', () => batchCopyToSide('right'))
batchLeftBtn.addEventListener('click', () => batchCopyToSide('left'))
undoBtn.addEventListener('click', () => { undo().catch(err => showToast('撤回出错：' + err.message)) })

if (compareBtn2) compareBtn2.addEventListener('click', compare)
if (swapBtn2) swapBtn2.addEventListener('click', swapFolders)

document.querySelectorAll('.pv-tabs button[data-pv-tab]').forEach(btn => {
  btn.addEventListener('click', () => {
    const tab = btn.dataset.pvTab
    document.querySelectorAll('.pv-tabs button[data-pv-tab]').forEach(b => b.classList.remove('active'))
    btn.classList.add('active')
    document.querySelectorAll('.pv-content[data-pv-content]').forEach(c => c.classList.toggle('active', c.dataset.pvContent === tab))
  })
})

document.querySelectorAll('[data-toggle-card]').forEach(el => {
  el.addEventListener('click', () => {
    const card = el.closest('.panel-card-collapsible')
    if (card) card.classList.toggle('collapsed')
  })
})

function bindSegment(segId, attr, fn) {
  const seg = $(segId)
  if (!seg) return
  seg.querySelectorAll('button').forEach(btn => {
    btn.addEventListener('click', () => {
      seg.querySelectorAll('button').forEach(b => b.classList.remove('active'))
      btn.classList.add('active')
      fn(btn.dataset[attr])
    })
  })
}

bindSegment('m3dGeoSeg', 'geo', setGeometry)
bindSegment('m3dSrcSeg', 'src', setSourceSide)
bindSegment('m3dLightSeg', 'light', setLightPreset)
bindSegment('m3dOpacityModeSeg', 'mode', setOpacityMode)
bindSegment('m3dParallaxModeSeg', 'mode', (v) => setParallaxMode(parseFloat(v)))
bindSegment('m3dFilterSeg', 'filter', (v) => { setTextureFilter(v); updateFilterControls() })

bindSegment('m3dEnvModeSeg', 'envmode', (mode) => {
  setEnvModeExport(mode)
  document.querySelectorAll('.m3d-env-subpane').forEach(p => p.classList.toggle('active', p.dataset.envpane === mode))
})
function updateFilterControls() {
  const active = document.querySelector('#m3dFilterSeg button.active')
  const mode = active ? active.dataset.filter : 'trilinear'
  const aniso = $('m3dAniso'), anisoVal = $('m3dAnisoVal'), mipmap = $('m3dMipmaps')
  const anisoOn = mode === 'anisotropic'
  const mipmapOn = mode === 'trilinear' || mode === 'anisotropic'
  if (aniso) { aniso.disabled = !anisoOn; if (anisoVal) anisoVal.style.opacity = anisoOn ? '1' : '.4' }
  if (mipmap) { mipmap.disabled = !mipmapOn; mipmap.parentElement.style.opacity = mipmapOn ? '1' : '.4' }
}
updateFilterControls()

$('m3dMetalness').addEventListener('input', (e) => { const v = parseFloat(e.target.value); setMetalness(v); $('m3dMetalnessVal').textContent = v.toFixed(2) })
$('m3dRoughness').addEventListener('input', (e) => { const v = parseFloat(e.target.value); setRoughness(v); $('m3dRoughnessVal').textContent = v.toFixed(2) })
$('m3dNormal').addEventListener('input', (e) => { const v = parseFloat(e.target.value); setNormalScale(v); $('m3dNormalVal').textContent = v.toFixed(2) })
$('m3dEmissive').addEventListener('input', (e) => { const v = parseFloat(e.target.value); setEmissiveIntensity(v); $('m3dEmissiveVal').textContent = v.toFixed(1) })
$('m3dOpacity').addEventListener('input', (e) => { const v = parseFloat(e.target.value); setOpacity(v); $('m3dOpacityVal').textContent = v.toFixed(2) })
$('m3dTransmission').addEventListener('input', (e) => { const v = parseFloat(e.target.value); setTransmission(v); $('m3dTransmissionVal').textContent = v.toFixed(2) })
$('m3dIOR').addEventListener('input', (e) => { const v = parseFloat(e.target.value); setIOR(v); $('m3dIORVal').textContent = v.toFixed(2) })
$('m3dClearcoat').addEventListener('input', (e) => { const v = parseFloat(e.target.value); setClearcoat(v); $('m3dClearcoatVal').textContent = v.toFixed(2) })
$('m3dParallax').addEventListener('input', (e) => { const v = parseFloat(e.target.value); setParallaxScale(v); $('m3dParallaxVal').textContent = v.toFixed(2) })
$('m3dParallaxSteps').addEventListener('input', (e) => { const v = parseInt(e.target.value); setParallaxSteps(v); $('m3dParallaxStepsVal').textContent = v })
$('m3dParallaxAdaptive').addEventListener('change', (e) => setParallaxAdaptive(e.target.checked ? 1.0 : 0.0))
$('m3dParallaxEnable').addEventListener('change', (e) => setParallaxEnabled(e.target.checked))
$('m3dParallaxShadow').addEventListener('change', (e) => { const s = $('m3dParallaxShadowStr'); s.disabled = !e.target.checked; setParallaxShadow(e.target.checked ? parseFloat(s.value) : 0.0) })
$('m3dParallaxShadowStr').addEventListener('input', (e) => { const v = parseFloat(e.target.value); setParallaxShadow(v); $('m3dParallaxShadowStrVal').textContent = v.toFixed(2) })

$('m3dEnvIntensity').addEventListener('input', (e) => { const v = parseFloat(e.target.value); setEnvIntensity(v); $('m3dEnvIntensityVal').textContent = v.toFixed(2) })
$('m3dExposure').addEventListener('input', (e) => { const v = parseFloat(e.target.value); setExposure(v); $('m3dExposureVal').textContent = v.toFixed(2) })
$('m3dSkyElevation').addEventListener('input', (e) => { const v = parseFloat(e.target.value); setSkySunElevation(v); $('m3dSkyElevationVal').textContent = v + '°' })
$('m3dSkyAzimuth').addEventListener('input', (e) => { const v = parseFloat(e.target.value); setSkySunAzimuth(v); $('m3dSkyAzimuthVal').textContent = v + '°' })
$('m3dSkyTurbidity').addEventListener('input', (e) => { const v = parseFloat(e.target.value); setSkyTurbidity(v); $('m3dSkyTurbidityVal').textContent = v.toFixed(1) })
$('m3dSkyRayleigh').addEventListener('input', (e) => { const v = parseFloat(e.target.value); setSkyRayleigh(v); $('m3dSkyRayleighVal').textContent = v.toFixed(2) })
$('m3dSkyMie').addEventListener('input', (e) => { const v = parseFloat(e.target.value); setSkyMieCoefficient(v); $('m3dSkyMieVal').textContent = v.toFixed(3) })
$('m3dSkyMieG').addEventListener('input', (e) => { const v = parseFloat(e.target.value); setSkyMieDirectionalG(v); $('m3dSkyMieGVal').textContent = v.toFixed(3) })
$('m3dSkyCloudCov').addEventListener('input', (e) => { const v = parseFloat(e.target.value); setSkyCloudCoverage(v); $('m3dSkyCloudCovVal').textContent = v.toFixed(2) })
$('m3dSkyCloudDen').addEventListener('input', (e) => { const v = parseFloat(e.target.value); setSkyCloudDensity(v); $('m3dSkyCloudDenVal').textContent = v.toFixed(2) })
$('m3dSkyCloudScale').addEventListener('input', (e) => { const v = parseFloat(e.target.value); setSkyCloudScale(v); $('m3dSkyCloudScaleVal').textContent = v.toFixed(5) })
$('m3dSkyCloudSpeed').addEventListener('input', (e) => { const v = parseFloat(e.target.value); setSkyCloudSpeed(v); $('m3dSkyCloudSpeedVal').textContent = v.toFixed(6) })
$('m3dSkyCloudElev').addEventListener('input', (e) => { const v = parseFloat(e.target.value); setSkyCloudElevation(v); $('m3dSkyCloudElevVal').textContent = v.toFixed(2) })
$('m3dSkyTint').addEventListener('input', (e) => setSkyTint(e.target.value))
const skyPresets = {
  noon: { elevation:70, azimuth:180, turbidity:2, rayleigh:1, mie:0.005, mieG:0.8, cloudCov:0.3, cloudDen:0.4, cloudScale:0.0002, cloudSpeed:0.00002, cloudElev:0.5, tint:'#ffffff' },
  sunset: { elevation:4, azimuth:270, turbidity:8, rayleigh:2, mie:0.01, mieG:0.85, cloudCov:0.5, cloudDen:0.5, cloudScale:0.0002, cloudSpeed:0.00002, cloudElev:0.4, tint:'#ffd0a0' },
  overcast: { elevation:25, azimuth:180, turbidity:15, rayleigh:0.5, mie:0.02, mieG:0.9, cloudCov:0.85, cloudDen:0.7, cloudScale:0.0003, cloudSpeed:0.00003, cloudElev:0.6, tint:'#d0d0d8' },
  night: { elevation:-5, azimuth:180, turbidity:3, rayleigh:0.3, mie:0.003, mieG:0.7, cloudCov:0.3, cloudDen:0.4, cloudScale:0.0002, cloudSpeed:0.00001, cloudElev:0.5, tint:'#2a3a5a' }
}
document.querySelectorAll('#m3dSkyPresetSeg button').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('#m3dSkyPresetSeg button').forEach(b => b.classList.remove('active'))
    btn.classList.add('active')
    const p = skyPresets[btn.dataset.preset]
    const apply = (id, val, valId, text, fn) => { $(id).value = val; $(valId).textContent = text; fn(val) }
    apply('m3dSkyElevation', p.elevation, 'm3dSkyElevationVal', p.elevation + '°', setSkySunElevation)
    apply('m3dSkyAzimuth', p.azimuth, 'm3dSkyAzimuthVal', p.azimuth + '°', setSkySunAzimuth)
    apply('m3dSkyTurbidity', p.turbidity, 'm3dSkyTurbidityVal', p.turbidity.toFixed(1), setSkyTurbidity)
    apply('m3dSkyRayleigh', p.rayleigh, 'm3dSkyRayleighVal', p.rayleigh.toFixed(2), setSkyRayleigh)
    apply('m3dSkyMie', p.mie, 'm3dSkyMieVal', p.mie.toFixed(3), setSkyMieCoefficient)
    apply('m3dSkyMieG', p.mieG, 'm3dSkyMieGVal', p.mieG.toFixed(3), setSkyMieDirectionalG)
    apply('m3dSkyCloudCov', p.cloudCov, 'm3dSkyCloudCovVal', p.cloudCov.toFixed(2), setSkyCloudCoverage)
    apply('m3dSkyCloudDen', p.cloudDen, 'm3dSkyCloudDenVal', p.cloudDen.toFixed(2), setSkyCloudDensity)
    apply('m3dSkyCloudScale', p.cloudScale, 'm3dSkyCloudScaleVal', p.cloudScale.toFixed(5), setSkyCloudScale)
    apply('m3dSkyCloudSpeed', p.cloudSpeed, 'm3dSkyCloudSpeedVal', p.cloudSpeed.toFixed(6), setSkyCloudSpeed)
    apply('m3dSkyCloudElev', p.cloudElev, 'm3dSkyCloudElevVal', p.cloudElev.toFixed(2), setSkyCloudElevation)
    $('m3dSkyTint').value = p.tint; setSkyTint(p.tint)
  })
})
$('m3dGround').addEventListener('change', (e) => toggleGround(e.target.checked))
$('m3dAutoRotate').addEventListener('change', (e) => setAutoRotate(e.target.checked))
$('m3dWireframe').addEventListener('change', (e) => setWireframe(e.target.checked))
$('m3dAniso').addEventListener('input', (e) => { const v = parseInt(e.target.value); setAnisotropyLevel(v); $('m3dAnisoVal').textContent = v })
$('m3dMipmaps').addEventListener('change', (e) => setMipmapsEnabled(e.target.checked))
$('m3dShotBtn').addEventListener('click', screenshot)
$('m3dFullscreenBtn').addEventListener('click', toggleFullscreen)

;(() => {
  const handle = $('m3dResizer'), container = $('material3dContainer')
  if (!handle || !container) return
  const minH = 160
  const maxH = () => window.innerHeight - 48
  const defaultH = 420
  let tip = null
  let startY = 0, startH = 0
  handle.addEventListener('mousedown', (e) => {
    e.preventDefault()
    startY = e.clientY
    startH = container.offsetHeight
    container.style.flex = 'none'
    handle.classList.add('dragging')
    document.body.style.cursor = 'ns-resize'
    document.body.style.userSelect = 'none'
    if (!tip) { tip = document.createElement('div'); tip.className = 'm3d-resizer-tip'; handle.appendChild(tip) }
    const onMove = (ev) => {
      const h = Math.max(minH, Math.min(maxH(), startH + (ev.clientY - startY)))
      container.style.height = h + 'px'
      tip.textContent = Math.round(h) + 'px'
      tip.style.opacity = '1'
    }
    const onUp = () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      handle.classList.remove('dragging')
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      if (tip) tip.style.opacity = '0'
      window.api.setConfig({ m3dHeight: container.offsetHeight })
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  })
  handle.addEventListener('dblclick', () => { container.style.flex = 'none'; container.style.height = defaultH + 'px'; window.api.setConfig({ m3dHeight: defaultH }) })
})()

$('m3dHdrBtn').addEventListener('click', async () => {
  const filePath = await window.api.selectHDRFile()
  if (filePath) {
    loadHDREnv(fileUrl(filePath))
    clearHdrPresetSelection()
    const seg = $('m3dEnvModeSeg')
    if (seg) {
      seg.querySelectorAll('button').forEach(b => b.classList.toggle('active', b.dataset.envmode === 'hdri'))
      document.querySelectorAll('.m3d-env-subpane').forEach(p => p.classList.toggle('active', p.dataset.envpane === 'hdri'))
    }
  }
})
$('m3dHdrClearBtn').addEventListener('click', () => {
  clearHDREnv()
  clearHdrPresetSelection()
  const mode = getCurrentEnvMode()
  const seg = $('m3dEnvModeSeg')
  if (seg) {
    seg.querySelectorAll('button').forEach(b => b.classList.toggle('active', b.dataset.envmode === mode))
    document.querySelectorAll('.m3d-env-subpane').forEach(p => p.classList.toggle('active', p.dataset.envpane === mode))
  }
  const preset = getCurrentLightPreset()
  const lightSeg = $('m3dLightSeg')
  if (lightSeg) lightSeg.querySelectorAll('button').forEach(b => b.classList.toggle('active', b.dataset.light === preset))
})
$('m3dHdrRefreshBtn').addEventListener('click', () => refreshHdrPreset())

$('m3dFormat').addEventListener('change', (e) => { setMaterialFormat(e.target.value); $('m3dFormatDetected').textContent = '' })
setFormatDetectCallback((fmt) => { $('m3dFormatDetected').textContent = fmt === 'labpbr' ? '→ labPBR' : '→ 旧版PBR' })
setHeightDetectCallback((status) => {
  const el = $('m3dHeightStatus'); if (!el) return
  const fill = $('m3dParallaxStatusFill')
  el.classList.remove('has-height', 'no-height')
  if (fill) fill.classList.remove('success', 'fail', 'loading')
  if (status === 'loading') { el.textContent = '处理中...'; if (fill) fill.classList.add('loading') }
  else if (status === 'alpha') { el.textContent = '✓ A通道高度图'; el.classList.add('has-height'); if (fill) fill.classList.add('success') }
  else if (status === 'normal') { el.textContent = '✓ 法线推算'; el.classList.add('has-height'); if (fill) fill.classList.add('success') }
  else { el.textContent = ''; el.classList.remove('has-height', 'no-height'); if (fill) fill.classList.remove('success', 'fail', 'loading') }

})
$('m3dParamsBtn').addEventListener('click', () => $('m3dParamsOverlay').classList.toggle('show'))
$('m3dParamsClose').addEventListener('click', () => $('m3dParamsOverlay').classList.remove('show'))
$('material3dContainer').addEventListener('mousedown', (e) => { const ov = $('m3dParamsOverlay'); if (ov && ov.classList.contains('show') && !ov.contains(e.target)) ov.classList.remove('show') })
document.querySelectorAll('.m3d-tabs button').forEach(btn => btn.addEventListener('click', () => {
  const tab = btn.dataset.tab
  document.querySelectorAll('.m3d-tabs button').forEach(b => b.classList.remove('active'))
  btn.classList.add('active')
  document.querySelectorAll('.m3d-tab-pane').forEach(p => p.classList.toggle('active', p.dataset.pane === tab))
}))
document.querySelectorAll('.m3d-presets button').forEach(btn => btn.addEventListener('click', () => {
  const p = btn.dataset.preset
  const set = (id, val) => { const el = $(id); if (el) { el.value = val; el.dispatchEvent(new Event('input', { bubbles: true })) } }
  if (p === 'metal') { set('m3dMetalness', 1); set('m3dRoughness', 0.3); set('m3dEmissive', 1); set('m3dOpacity', 1); set('m3dTransmission', 0) }
  else if (p === 'plastic') { set('m3dMetalness', 0); set('m3dRoughness', 0.5); set('m3dEmissive', 1); set('m3dOpacity', 1); set('m3dTransmission', 0) }
  else if (p === 'glass') { set('m3dMetalness', 0); set('m3dRoughness', 0); set('m3dEmissive', 1); set('m3dOpacity', 1); set('m3dTransmission', 1); set('m3dIOR', 1.5) }
  else if (p === 'fabric') { set('m3dMetalness', 0); set('m3dRoughness', 0.8); set('m3dEmissive', 1); set('m3dOpacity', 1); set('m3dTransmission', 0) }
  else if (p === 'emissive') { set('m3dMetalness', 0); set('m3dRoughness', 0.5); set('m3dEmissive', 3); set('m3dOpacity', 1); set('m3dTransmission', 0) }
}))

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { closePreview(); return }
  if ((e.metaKey || e.ctrlKey) && e.key === 'f') { e.preventDefault(); searchInput.focus(); return }
  if ((e.metaKey || e.ctrlKey) && e.key === 'z') { e.preventDefault(); undo().catch(err => showToast('撤回出错：' + err.message)); return }
  const tag = e.target.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA') return
  const modal = $('previewModal')
  if (modal.classList.contains('show')) return
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault()
    const rows = [...resultBody.querySelectorAll('tr:not(.folder-group-row):not(.sub-row):not(.empty-row)')]
    if (!rows.length) return
    let idx = rows.findIndex(r => r.classList.contains('row-selected'))
    if (e.key === 'ArrowDown') idx = idx < 0 ? 0 : Math.min(idx + 1, rows.length - 1)
    else idx = idx < 0 ? 0 : Math.max(idx - 1, 0)
    const g = rows[idx]._group
    if (g) selectGroup(g, false)
    rows[idx].scrollIntoView({ block: 'nearest' })
  } else if (e.key === 'Enter') {
    const sel = state.selected
    if (sel) { const ent = mainEntryOf(sel); if (ent) window.api.openPath(ent.fullPath) }
  }
})

function initCtxMenu() {
  const menu = $('ctxMenu')
  const tbody = $('resultBody')
  if (!menu || !tbody) return
  tbody.addEventListener('contextmenu', (ev) => {
    const tr = ev.target.closest('tr')
    if (!tr || !tr._group) return
    ev.preventDefault()
    const g = tr._group
    state.selected = g
    selectGroup(g)
    menu.style.display = 'block'
    const mx = Math.min(ev.clientX, window.innerWidth - 180)
    const my = Math.min(ev.clientY, window.innerHeight - 260)
    menu.style.left = mx + 'px'
    menu.style.top = my + 'px'
    menu.querySelectorAll('.ctx-item').forEach(item => {
      const act = item.dataset.act
      const pickEntry = (side) => { const s = g[side]; if (!s) return null; return s.main || s.file || s.dir || s.normal || s.specular || null }
      let enabled = true
      if (act === 'open-left' || act === 'loc-left') enabled = !!pickEntry('left')
      else if (act === 'open-right' || act === 'loc-right') enabled = !!pickEntry('right')
      else if (act === 'copy-to-right') enabled = !!(g.left && state.rightPath)
      else if (act === 'copy-to-left') enabled = !!(g.right && state.leftPath)
      item.classList.toggle('disabled', !enabled)
      item.onclick = enabled ? () => { handleAction(act, g); menu.style.display = 'none' } : null
    })
  })
  document.addEventListener('click', () => { menu.style.display = 'none' })
  document.addEventListener('contextmenu', (ev) => {
    if (!ev.target.closest('tr')) menu.style.display = 'none'
  })
}

;(async function init() {
  initSettings()
  initPreview2D()
  initHdrPreset()
  initViewTabs()
  initCtxMenu()
  await initLayout()

  const cfg = await window.api.getConfig()
  if (cfg.theme === 'dark') applyTheme('dark')
  if (cfg.m3dHeight) { const c = $('material3dContainer'); if (c) { c.style.flex = 'none'; c.style.height = cfg.m3dHeight + 'px' } }

  if (cfg.recursive) recursiveChk.checked = true
  if (cfg.hash) hashChk.checked = true
  if (cfg.onlyMissing) onlyMissingChk.checked = true
  if (cfg.ignoreSys !== undefined) ignoreChk.checked = cfg.ignoreSys
  if (cfg.ignoreCustom) ignoreInput.value = cfg.ignoreCustom
  if (cfg.viewMode) {
    state.viewMode = cfg.viewMode
    const r = document.querySelector(`input[name="viewMode"][value="${cfg.viewMode}"]`)
    if (r) r.checked = true
  }
  if (cfg.sortKey) state.sortKey = cfg.sortKey
  if (cfg.sortDir) state.sortDir = cfg.sortDir
  if (cfg.statusFilter) {
    state.statusFilter = cfg.statusFilter
    document.querySelectorAll('.filter-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.filter === cfg.statusFilter)
    })
  }
  updateSortIndicators()

  const tasks = []
  if (cfg.leftPath) tasks.push(loadFromPath('left', cfg.leftPath).catch(() => {}))
  if (cfg.rightPath) tasks.push(loadFromPath('right', cfg.rightPath).catch(() => {}))
  await Promise.all(tasks)
  if (state.leftPath && state.rightPath) compare()
  updateUndoBtn()
})()