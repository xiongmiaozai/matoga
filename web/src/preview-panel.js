/**
 * matoga - 材质贴图对比工具
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 预览面板（2D 工具栏 + 3D 参数/HUD）公共绑定模块。
 * 供 index.html 与 node-editor.html 复用，由 initPreviewPanel() 一次性挂载所有控件。
 */

import { $, showToast } from './core.js'
import { fileUrl } from './utils.js'
import { t } from './i18n.js'
import {
  setGeometry, setMetalness, setRoughness, setNormalScale, setEmissiveIntensity,
  setMaterialFormat, setFormatDetectCallback, setHeightDetectCallback, setSourceSide,
  setParallaxScale, setParallaxSteps, setParallaxMode, setParallaxAdaptive, setParallaxEnabled, setParallaxShadow,
  setLightPreset, getCustomLightConfig, applyCustomLightConfigExport, setEnvIntensity, setExposure,
  toggleGround, loadHDREnv, clearHDREnv, getCurrentLightPreset, getCurrentEnvMode, setEnvModeExport,
  setHdrRotation, setHdrUsage, getHdrInfo,
  setSkyTurbidity, setSkyRayleigh, setSkyMieCoefficient, setSkyMieDirectionalG, setSkySunElevation, setSkySunAzimuth, setSkyTint,
  setAutoRotate, setWireframe, screenshot, toggleFullscreen,
  setFreeCameraMode, isFreeCameraMode,
  setOpacityMode, setOpacity, setTransmission, setIOR, setClearcoat,
  setTextureFilter, setMipmapsEnabled, setAnisotropyLevel, getMaxAnisotropy,
  isMaterial3DReady, activateMaterial3DHost, refreshMaterial3DTint
} from './material3d.js'
import {
  initHdrPreset, refreshHdrPreset, clearHdrPresetSelection, filterHdrPresets,
  openHdrPreview, initHdrDragDrop, disposeHdrPreview
} from './hdri-preset.js'
import { getMcBiomes, getCurrentBiome, setCurrentBiome, rerenderLastMcModel } from './mc-model-viewer.js'
import { enhancePreview } from './preview2d.js'
import { bindInput, hexToNum, numToHex, MAT_PRESET_INPUTS, SKY_PRESETS } from './preview-presets.js'
import { bindSegment } from './pp/segment.js'
import { renderLightEditor, renderLightCustomList } from './pp/light.js'
import { applySkyPreset, getSkyPresetFromUI, renderSkyCustomList } from './pp/sky.js'
import { updateFilterControls, getMaterialPresetFromUI, applyMaterialPreset, renderMatCustomList } from './pp/material.js'
import { bindHdrPreviewModal } from './pp/hdr-preview.js'
import { bindParamsDrag } from './pp/params-drag.js'

let _initialized = false
export async function initPreviewPanel() {
  if (_initialized) return
  _initialized = true
  /* ── 2D/3D 顶层 tab 切换 ── */
  document.querySelectorAll('.pv-tabs button[data-pv-tab]').forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.pvTab
      document.querySelectorAll('.pv-tabs button[data-pv-tab]').forEach(b => b.classList.remove('active'))
      btn.classList.add('active')
      document.querySelectorAll('.pv-content[data-pv-content]').forEach(c => c.classList.toggle('active', c.dataset.pvContent === tab))
      if (tab === '3d') {
        const host = btn.closest('.panel') && btn.closest('.panel').querySelector('.material3d-container')
        if (host) activateMaterial3DHost(host)
      }
    })
  })

  bindSegment('m3dGeoSeg', 'geo', setGeometry)
  bindSegment('m3dSrcSeg', 'src', setSourceSide)
  const biomeSel = $('m3dBiome')
  if (biomeSel) {
    const biomes = getMcBiomes()
    const cur = getCurrentBiome()
    for (const b of biomes) {
      const opt = document.createElement('option')
      opt.value = b.id
      opt.textContent = t('preview.biome.' + b.id) || b.id
      if (b.id === cur.id) opt.selected = true
      biomeSel.appendChild(opt)
    }
    biomeSel.addEventListener('change', async (e) => {
      setCurrentBiome(e.target.value)
      const pv = $('pvBiome'); if (pv) pv.value = e.target.value
      enhancePreview()
      refreshMaterial3DTint()
      await rerenderLastMcModel()
    })
  }
  bindSegment('m3dLightSeg', 'light', (key) => { setLightPreset(key); renderLightEditor(getCustomLightConfig()) })
  const acEl = $('m3dAmbientColor'); if (acEl) acEl.addEventListener('input', (e) => { const c = getCustomLightConfig(); if (!c) return; c.ambient.color = hexToNum(e.target.value); applyCustomLightConfigExport(c) })
  const aiEl = $('m3dAmbientIntensity'); if (aiEl) aiEl.addEventListener('input', (e) => { const v = parseFloat(e.target.value); const aiv2 = $('m3dAmbientIntensityVal'); if (aiv2) aiv2.textContent = v.toFixed(2); const c = getCustomLightConfig(); if (!c) return; c.ambient.intensity = v; applyCustomLightConfigExport(c) })
  const bgEl = $('m3dBgColor'); if (bgEl) bgEl.addEventListener('input', (e) => { const c = getCustomLightConfig(); if (!c) return; c.bg = hexToNum(e.target.value); applyCustomLightConfigExport(c) })
  const addLight = $('m3dAddLight'); if (addLight) addLight.addEventListener('click', () => { const c = getCustomLightConfig(); if (!c) return; c.lights.push({ color: 0xffffff, intensity: 1.0, pos: [3, 3, 4] }); applyCustomLightConfigExport(c); renderLightEditor(c) })
  const lightSave = $('m3dLightSaveBtn'); if (lightSave) lightSave.addEventListener('click', async () => {
    const name = $('m3dLightPresetName').value.trim()
    if (!name) { showToast(t('m3d.lightPresetNameEmpty')); return }
    const cfg = await window.api.getConfig()
    const presets = cfg.lightCustomPresets || []
    presets.push({ name, config: getCustomLightConfig() })
    await window.api.setConfig({ lightCustomPresets: presets })
    $('m3dLightPresetName').value = ''; renderLightCustomList(presets); showToast(t('m3d.lightPresetSaved'))
  })
  document.addEventListener('material3d:ready', () => { renderLightEditor(getCustomLightConfig()) })
  bindSegment('m3dOpacityModeSeg', 'mode', setOpacityMode)
  bindSegment('m3dParallaxModeSeg', 'mode', (v) => setParallaxMode(parseFloat(v)))
  bindSegment('m3dFilterSeg', 'filter', (v) => { setTextureFilter(v); updateFilterControls() })

  bindSegment('m3dEnvModeSeg', 'envmode', (mode) => {
    setEnvModeExport(mode)
    document.querySelectorAll('.m3d-env-subpane').forEach(p => p.classList.toggle('active', p.dataset.envpane === mode))
  })
  updateFilterControls()

  bindInput('m3dMetalness', (v) => { const n = parseFloat(v); setMetalness(n); $('m3dMetalnessVal').textContent = n.toFixed(2) })
  bindInput('m3dRoughness', (v) => { const n = parseFloat(v); setRoughness(n); $('m3dRoughnessVal').textContent = n.toFixed(2) })
  bindInput('m3dNormal', (v) => { const n = parseFloat(v); setNormalScale(n); $('m3dNormalVal').textContent = n.toFixed(2) })
  bindInput('m3dEmissive', (v) => { const n = parseFloat(v); setEmissiveIntensity(n); $('m3dEmissiveVal').textContent = n.toFixed(1) })
  bindInput('m3dOpacity', (v) => { const n = parseFloat(v); setOpacity(n); $('m3dOpacityVal').textContent = n.toFixed(2) })
  bindInput('m3dTransmission', (v) => { const n = parseFloat(v); setTransmission(n); $('m3dTransmissionVal').textContent = n.toFixed(2) })
  bindInput('m3dIOR', (v) => { const n = parseFloat(v); setIOR(n); $('m3dIORVal').textContent = n.toFixed(2) })
  bindInput('m3dClearcoat', (v) => { const n = parseFloat(v); setClearcoat(n); $('m3dClearcoatVal').textContent = n.toFixed(2) })
  bindInput('m3dParallax', (v) => { const n = parseFloat(v); setParallaxScale(n); $('m3dParallaxVal').textContent = n.toFixed(2) })
  bindInput('m3dParallaxSteps', (v) => { const n = parseInt(v); setParallaxSteps(n); $('m3dParallaxStepsVal').textContent = n })
  const pxAdaptive = $('m3dParallaxAdaptive'); if (pxAdaptive) pxAdaptive.addEventListener('change', (e) => setParallaxAdaptive(e.target.checked ? 1.0 : 0.0))
  const pxEnable = $('m3dParallaxEnable'); if (pxEnable) pxEnable.addEventListener('change', (e) => setParallaxEnabled(e.target.checked))
  const pxShadow = $('m3dParallaxShadow'); if (pxShadow) pxShadow.addEventListener('change', (e) => { const s = $('m3dParallaxShadowStr'); s.disabled = !e.target.checked; setParallaxShadow(e.target.checked ? parseFloat(s.value) : 0.0) })
  bindInput('m3dParallaxShadowStr', (v) => { const n = parseFloat(v); setParallaxShadow(n); $('m3dParallaxShadowStrVal').textContent = n.toFixed(2) })

  bindInput('m3dEnvIntensity', (v) => { const n = parseFloat(v); setEnvIntensity(n); $('m3dEnvIntensityVal').textContent = n.toFixed(2) })
  bindInput('m3dExposure', (v) => { const n = parseFloat(v); setExposure(n); $('m3dExposureVal').textContent = n.toFixed(2) })
  bindInput('m3dSkyElevation', (v) => { setSkySunElevation(parseFloat(v)); $('m3dSkyElevationVal').textContent = v + '°' })
  bindInput('m3dSkyAzimuth', (v) => { setSkySunAzimuth(parseFloat(v)); $('m3dSkyAzimuthVal').textContent = v + '°' })
  bindInput('m3dSkyTurbidity', (v) => { const n = parseFloat(v); setSkyTurbidity(n); $('m3dSkyTurbidityVal').textContent = n.toFixed(1) })
  bindInput('m3dSkyRayleigh', (v) => { const n = parseFloat(v); setSkyRayleigh(n); $('m3dSkyRayleighVal').textContent = n.toFixed(2) })
  bindInput('m3dSkyMie', (v) => { const n = parseFloat(v); setSkyMieCoefficient(n); $('m3dSkyMieVal').textContent = n.toFixed(3) })
  bindInput('m3dSkyMieG', (v) => { const n = parseFloat(v); setSkyMieDirectionalG(n); $('m3dSkyMieGVal').textContent = n.toFixed(3) })

  const skyTint = $('m3dSkyTint'); if (skyTint) skyTint.addEventListener('input', (e) => setSkyTint(e.target.value))
  document.querySelectorAll('#m3dSkyPresetSeg button').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#m3dSkyPresetSeg button').forEach(b => b.classList.remove('active'))
      btn.classList.add('active')
      applySkyPreset(SKY_PRESETS[btn.dataset.preset])
    })
  })
  const skySave = $('m3dSkySaveBtn'); if (skySave) skySave.addEventListener('click', async () => {
    const name = $('m3dSkyPresetName').value.trim()
    if (!name) { showToast(t('m3d.skyPresetNameEmpty')); return }
    const cfg = await window.api.getConfig()
    const presets = cfg.skyCustomPresets || []
    presets.push({ name, ...getSkyPresetFromUI() })
    await window.api.setConfig({ skyCustomPresets: presets })
    $('m3dSkyPresetName').value = ''
    renderSkyCustomList(presets)
    showToast(t('m3d.skyPresetSaved'))
  })
  const groundChk = $('m3dGround'); if (groundChk) groundChk.addEventListener('change', (e) => toggleGround(e.target.checked))
  const autoRotChk = $('m3dAutoRotate'); if (autoRotChk) autoRotChk.addEventListener('change', (e) => setAutoRotate(e.target.checked))
  const wireChk = $('m3dWireframe'); if (wireChk) wireChk.addEventListener('change', (e) => setWireframe(e.target.checked))
  bindInput('m3dAniso', (v) => { const n = parseInt(v); setAnisotropyLevel(n); $('m3dAnisoVal').textContent = n })
  const mipmapChk = $('m3dMipmaps'); if (mipmapChk) mipmapChk.addEventListener('change', (e) => setMipmapsEnabled(e.target.checked))
  const shotBtn = $('m3dShotBtn'); if (shotBtn) shotBtn.addEventListener('click', screenshot)
  const fsBtn = $('m3dFullscreenBtn'); if (fsBtn) fsBtn.addEventListener('click', toggleFullscreen)
  document.querySelectorAll('#m3dFreeCamBtn').forEach(btn => {
    btn.classList.toggle('active', isFreeCameraMode())
    btn.addEventListener('click', () => setFreeCameraMode(!isFreeCameraMode()))
  })
  document.addEventListener('material3d:freecam', (e) => {
    document.querySelectorAll('#m3dFreeCamBtn').forEach(b => b.classList.toggle('active', e.detail.enabled))
    showToast(t(e.detail.enabled ? 'm3d.freeCamHint' : 'm3d.freeCamOff'))
  })

  const hdrBtn = $('m3dHdrBtn'); if (hdrBtn) hdrBtn.addEventListener('click', async () => {
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
  const hdrClear = $('m3dHdrClearBtn'); if (hdrClear) hdrClear.addEventListener('click', () => {
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
  const hdrRefresh = $('m3dHdrRefreshBtn'); if (hdrRefresh) hdrRefresh.addEventListener('click', () => refreshHdrPreset())

  bindSegment('m3dHdrUsageSeg', 'hdruage', (mode) => setHdrUsage(mode))
  bindInput('m3dHdrRotation', (v) => { const n = parseFloat(v); setHdrRotation(n); $('m3dHdrRotationVal').textContent = v + '°' })

  const hdrSearch = $('m3dHdrSearch'); if (hdrSearch) hdrSearch.addEventListener('input', (e) => filterHdrPresets(e.target.value))
  window.addEventListener('material3d:hdrLoaded', (e) => {
    const info = e.detail; if (!info) return
    const el = $('m3dHdrInfo'); if (!el) return
    const sz = info.size ? (info.size / 1024 / 1024).toFixed(1) + ' MB' : '--'
    el.textContent = `${info.width}×${info.height} · ${info.format} · ${sz}`
  })
  window.addEventListener('material3d:hdrLoading', () => {
    const el = $('m3dHdrInfo'); if (el) el.textContent = t('m3d.hdrLoading')
  })
  window.addEventListener('material3d:hdrLoadFailed', () => {
    const el = $('m3dHdrInfo'); if (el) el.textContent = ''
    showToast(t('toast.loadHdrFailed'))
  })
  const hdrGrid = $('m3dHdrPresetGrid'); if (hdrGrid) initHdrDragDrop(hdrGrid)
  bindHdrPreviewModal()

  const fmtSel = $('m3dFormat'); if (fmtSel) fmtSel.addEventListener('change', (e) => { setMaterialFormat(e.target.value); const d = $('m3dFormatDetected'); if (d) d.textContent = '' })
  setFormatDetectCallback((fmt) => { const el = $('m3dFormatDetected'); if (el) el.textContent = fmt === 'labpbr' ? t('m3d.detectedLabpbr') : t('m3d.detectedOld') })
  setHeightDetectCallback((status) => {
    const el = $('m3dHeightStatus'); if (!el) return
    const fill = $('m3dParallaxStatusFill')
    el.classList.remove('has-height', 'no-height')
    if (fill) fill.classList.remove('success', 'fail', 'loading')
    if (status === 'loading') { el.textContent = t('m3d.heightLoading'); if (fill) fill.classList.add('loading') }
    else if (status === 'alpha') { el.textContent = t('m3d.heightAlpha'); el.classList.add('has-height'); if (fill) fill.classList.add('success') }
    else if (status === 'normal') { el.textContent = t('m3d.heightNormal'); el.classList.add('has-height'); if (fill) fill.classList.add('success') }
    else { el.textContent = ''; el.classList.remove('has-height', 'no-height'); if (fill) fill.classList.remove('success', 'fail', 'loading') }
  })
  const paramsBtn = $('m3dParamsBtn'); if (paramsBtn) paramsBtn.addEventListener('click', () => $('m3dParamsOverlay').classList.toggle('show'))
  const paramsClose = $('m3dParamsClose'); if (paramsClose) paramsClose.addEventListener('click', () => $('m3dParamsOverlay').classList.remove('show'))
  /* UV 贴图视图浮窗（HUD 按钮，按需加载；无模型时浮窗显示空态提示） */
  const uvBtn = $('m3dUvBtn'); if (uvBtn) uvBtn.addEventListener('click', async () => {
    try {
      const m = await import('./uv-view.js')
      m.toggleUvView()
    } catch (e) { console.error('[preview-panel] uv-view', e) }
  })

  bindParamsDrag()
  const m3dContainer = $('material3dContainer'); if (m3dContainer) m3dContainer.addEventListener('mousedown', (e) => { const ov = $('m3dParamsOverlay'); if (ov && ov.classList.contains('show') && !ov.contains(e.target)) ov.classList.remove('show') })
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

  /* ── 自定义材质预设：收集滑条值 → 存 config.materialCustomPresets ── */
  const matSave = $('m3dMatSaveBtn'); if (matSave) matSave.addEventListener('click', async () => {
    const name = $('m3dMatPresetName').value.trim()
    if (!name) { showToast(t('m3d.matPresetNameEmpty')); return }
    const cfg = await window.api.getConfig()
    const presets = (cfg && cfg.materialCustomPresets) || []
    presets.push({ name, config: getMaterialPresetFromUI() })
    await window.api.setConfig({ materialCustomPresets: presets })
    $('m3dMatPresetName').value = ''
    renderMatCustomList(presets); showToast(t('m3d.matPresetSaved'))
  })

  /* ── HDR 预设网格初始化 ── */
  try { await initHdrPreset() } catch (e) { console.error('[preview-panel] initHdrPreset', e) }

  /* ── 自定义灯光/天空/材质预设列表 ── */
  try {
    const cfg = (await window.api.getConfig()) || {}
    renderSkyCustomList(cfg.skyCustomPresets || [])
    renderLightCustomList(cfg.lightCustomPresets || [])
    renderMatCustomList(cfg.materialCustomPresets || [])
  } catch (e) { console.error('[preview-panel] load presets', e) }

  /* ── 防时序：若 3D 已先就绪，主动刷新一次灯光编辑器 ── */
  if (isMaterial3DReady()) renderLightEditor(getCustomLightConfig())
}