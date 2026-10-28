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
  function renderLightEditor(config) {
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
  const acEl = $('m3dAmbientColor'); if (acEl) acEl.addEventListener('input', (e) => { const c = getCustomLightConfig(); if (!c) return; c.ambient.color = hexToNum(e.target.value); applyCustomLightConfigExport(c) })
  const aiEl = $('m3dAmbientIntensity'); if (aiEl) aiEl.addEventListener('input', (e) => { const v = parseFloat(e.target.value); const aiv2 = $('m3dAmbientIntensityVal'); if (aiv2) aiv2.textContent = v.toFixed(2); const c = getCustomLightConfig(); if (!c) return; c.ambient.intensity = v; applyCustomLightConfigExport(c) })
  const bgEl = $('m3dBgColor'); if (bgEl) bgEl.addEventListener('input', (e) => { const c = getCustomLightConfig(); if (!c) return; c.bg = hexToNum(e.target.value); applyCustomLightConfigExport(c) })
  const addLight = $('m3dAddLight'); if (addLight) addLight.addEventListener('click', () => { const c = getCustomLightConfig(); if (!c) return; c.lights.push({ color: 0xffffff, intensity: 1.0, pos: [3, 3, 4] }); applyCustomLightConfigExport(c); renderLightEditor(c) })
  function renderLightCustomList(customPresets) {
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
  function applySkyPreset(p) {
    const apply = (id, val, valId, text, fn) => { $(id).value = val; $(valId).textContent = text; fn(val) }
    apply('m3dSkyElevation', p.elevation, 'm3dSkyElevationVal', p.elevation + '°', setSkySunElevation)
    apply('m3dSkyAzimuth', p.azimuth, 'm3dSkyAzimuthVal', p.azimuth + '°', setSkySunAzimuth)
    apply('m3dSkyTurbidity', p.turbidity, 'm3dSkyTurbidityVal', p.turbidity.toFixed(1), setSkyTurbidity)
    apply('m3dSkyRayleigh', p.rayleigh, 'm3dSkyRayleighVal', p.rayleigh.toFixed(2), setSkyRayleigh)
    apply('m3dSkyMie', p.mie, 'm3dSkyMieVal', p.mie.toFixed(3), setSkyMieCoefficient)
    apply('m3dSkyMieG', p.mieG, 'm3dSkyMieGVal', p.mieG.toFixed(3), setSkyMieDirectionalG)
    $('m3dSkyTint').value = p.tint; setSkyTint(p.tint)
  }
  function getSkyPresetFromUI() {
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
  function renderSkyCustomList(customPresets) {
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
  ;(() => {
    const modal = $('hdrPreviewModal'), canvas = $('hdrPreviewCanvas'), closeBtn = $('hdrPreviewClose')
    const expSlider = $('hdrPreviewExposure'), expVal = $('hdrPreviewExposureVal'), infoEl = $('hdrPreviewInfo')
    if (!modal || !canvas || !closeBtn) return
    const closePreview = () => { modal.classList.remove('show'); disposeHdrPreview() }
    closeBtn.addEventListener('click', closePreview)
    modal.addEventListener('click', (e) => { if (e.target === modal) closePreview() })
    expSlider.addEventListener('input', (e) => { const v = parseFloat(e.target.value); expVal.textContent = v.toFixed(1); openHdrPreview(null, v) })
    window.addEventListener('hdr:preview', (e) => { const { url, name, info } = e.detail; openHdrPreview({ url, name, info, canvas, modal, expSlider, expVal, infoEl }) })
  })()

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

  ;(() => {
    const ov = $('m3dParamsOverlay'), drag = $('m3dParamsDrag'), container = $('material3dContainer')
    if (!ov || !drag || !container) return
    let dragging = false, sx = 0, sy = 0, sl = 0, st = 0
    drag.addEventListener('mousedown', (e) => {
      if (e.target.closest('.m3d-params-close')) return
      e.preventDefault(); dragging = true
      const r = ov.getBoundingClientRect(), cr = container.getBoundingClientRect()
      sl = r.left - cr.left; st = r.top - cr.top; sx = e.clientX; sy = e.clientY
      ov.style.right = 'auto'; ov.style.bottom = 'auto'; ov.style.left = sl + 'px'; ov.style.top = st + 'px'
      document.body.style.cursor = 'grabbing'; document.body.style.userSelect = 'none'
    })
    document.addEventListener('mousemove', (e) => {
      if (!dragging) return
      const cr = container.getBoundingClientRect()
      const nl = Math.max(0, Math.min(cr.width - ov.offsetWidth, sl + e.clientX - sx))
      const nt = Math.max(0, Math.min(cr.height - ov.offsetHeight, st + e.clientY - sy))
      ov.style.left = nl + 'px'; ov.style.top = nt + 'px'
    })
    document.addEventListener('mouseup', () => { if (!dragging) return; dragging = false; document.body.style.cursor = ''; document.body.style.userSelect = '' })
  })()
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
  function getMaterialPresetFromUI() {
    const p = {}
    MAT_PRESET_INPUTS.forEach(id => { const el = $(id); if (el) p[id] = parseFloat(el.value) })
    return p
  }
  function applyMaterialPreset(p) {
    if (!p) return
    MAT_PRESET_INPUTS.forEach(id => {
      if (p[id] === undefined || p[id] === null) return
      const el = $(id)
      if (el) { el.value = p[id]; el.dispatchEvent(new Event('input', { bubbles: true })) }
    })
  }
  function renderMatCustomList(customPresets) {
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