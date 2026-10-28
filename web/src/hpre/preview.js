/**
 * matoga - HDRI 预设面板：preview
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 从 hdri-preset.js 按职责搬出，逻辑未改。
 */
import { $, showToast } from '../core.js'
import { fileUrl } from '../utils.js'
import { parseEnvPixels, detectExt, extFromUrl } from '../hdr-env-loader.js'
import { loadHDREnv } from '../material3d.js'
import { t } from '../i18n.js'
import { S } from './state.js'
import { workerParse } from './worker.js'

export function previewOnDown(x, y) { previewDragging = true; previewLastX = x; previewLastY = y }
export function previewOnMove(x, y) {
  if (!previewDragging) return
  S.previewYaw -= (x - previewLastX) * 0.005
  previewPitch = Math.max(-1.4, Math.min(1.4, previewPitch - (y - previewLastY) * 0.005))
  previewLastX = x; previewLastY = y
  updatePreviewCamera()
}

export function resetHdrPreviewView() {
  S.previewYaw = 0; previewPitch = 0
  if (previewCamera) { previewCamera.fov = 75; previewCamera.updateProjectionMatrix() }
  updatePreviewCamera()
}

export function toggleHdrPreviewFullscreen() {
  const modal = $('hdrPreviewModal')
  if (!modal) return
  if (!document.fullscreenElement) { if (modal.requestFullscreen) modal.requestFullscreen() }
  else { if (document.exitFullscreen) document.exitFullscreen() }
}

export function applyPreviewHdrToScene() {
  if (!S.previewState || !S.previewState.entry || !S.previewState.entry.fullPath) return
  const name = S.previewState.entry.name
  const fullPath = S.previewState.entry.fullPath
  loadHDREnv(fileUrl(fullPath))
  S.currentSelectedPath = fullPath
  const grid = $('m3dHdrPresetGrid')
  if (grid) grid.querySelectorAll('.hdri-preset-item').forEach(el => el.classList.toggle('active', el.dataset.path === fullPath))
  const modal = $('hdrPreviewModal')
  if (modal) modal.classList.remove('show')
  disposeHdrPreview()
  const seg = $('m3dEnvModeSeg')
  if (seg) {
    seg.querySelectorAll('button').forEach(b => b.classList.toggle('active', b.dataset.envmode === 'hdri'))
    document.querySelectorAll('.m3d-env-subpane').forEach(p => p.classList.toggle('active', p.dataset.envpane === 'hdri'))
  }
  showToast(t('toast.loadedHdr', { name }))
}

export function ensureSpherePreview(canvas) {
  if (S.previewRenderer && S.previewRenderer.domElement === canvas) return
  if (S.previewRenderer) { S.previewRenderer.dispose(); S.previewRenderer = null }
  S.previewRenderer = new THREE.WebGLRenderer({ canvas, antialias: true })
  S.previewRenderer.toneMapping = THREE.ACESFilmicToneMapping
  S.previewRenderer.toneMappingExposure = 1
  S.previewRenderer.outputColorSpace = THREE.SRGBColorSpace
  previewScene = new THREE.Scene()
  previewCamera = new THREE.PerspectiveCamera(75, 2, 0.1, 110)
  previewCamera.position.set(0, 0, 0)
  const geo = new THREE.SphereGeometry(50, 80, 40)
  previewMesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ side: THREE.BackSide }))
  previewScene.add(previewMesh)
  S.previewYaw = 0; previewPitch = 0
  canvas.addEventListener('mousedown', (e) => previewOnDown(e.clientX, e.clientY))
  canvas.addEventListener('touchstart', (e) => { if (e.touches[0]) previewOnDown(e.touches[0].clientX, e.touches[0].clientY) }, { passive: true })
  canvas.addEventListener('touchmove', (e) => { if (e.touches[0]) { previewOnMove(e.touches[0].clientX, e.touches[0].clientY); e.preventDefault() } }, { passive: false })
  canvas.addEventListener('touchend', () => { previewDragging = false })
  canvas.addEventListener('wheel', (e) => {
    if (!previewCamera) return
    previewCamera.fov = Math.max(20, Math.min(100, previewCamera.fov + e.deltaY * 0.05))
    previewCamera.updateProjectionMatrix()
    renderSpherePreview()
  }, { passive: true })
  if (typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(() => resizePreview(canvas)).observe(canvas)
  }
  if (!S.previewKeyBound) {
    S.previewKeyBound = true
    window.addEventListener('mousemove', (e) => previewOnMove(e.clientX, e.clientY))
    window.addEventListener('mouseup', () => { previewDragging = false })
    window.addEventListener('keydown', (e) => {
      const modal = $('hdrPreviewModal')
      if (!modal || !modal.classList.contains('show')) return
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return
      switch (e.key) {
        case 'ArrowLeft': S.previewYaw -= 0.1; updatePreviewCamera(); break
        case 'ArrowRight': S.previewYaw += 0.1; updatePreviewCamera(); break
        case 'ArrowUp': previewPitch = Math.max(-1.4, previewPitch - 0.1); updatePreviewCamera(); break
        case 'ArrowDown': previewPitch = Math.min(1.4, previewPitch + 0.1); updatePreviewCamera(); break
        case 'r': case 'R': resetHdrPreviewView(); break
        case 'f': case 'F': toggleHdrPreviewFullscreen(); break
      }
    })
  }
  updatePreviewCamera()
}

export function updatePreviewCamera() {
  if (!previewCamera) return
  previewCamera.rotation.order = 'YXZ'
  previewCamera.rotation.y = S.previewYaw
  previewCamera.rotation.x = previewPitch
  renderSpherePreview()
}

export function resizePreview(canvas) {
  if (!S.previewRenderer) return
  const w = canvas.clientWidth || 960, h = canvas.clientHeight || 480
  S.previewRenderer.setSize(w, h, false)
  previewCamera.aspect = w / h
  previewCamera.updateProjectionMatrix()
}

export function setPreviewTexture(data, width, height) {
  const tex = new THREE.DataTexture(data, width, height, THREE.RGBAFormat, THREE.FloatType)
  tex.colorSpace = THREE.LinearSRGBColorSpace
  tex.minFilter = THREE.LinearFilter
  tex.magFilter = THREE.LinearFilter
  tex.generateMipmaps = false
  tex.flipY = true
  tex.needsUpdate = true
  if (previewMesh.material.map) previewMesh.material.map.dispose()
  previewMesh.material.map = tex
  previewMesh.material.needsUpdate = true
  let logSum = 0, logCount = 0
  for (let i = 0; i < width * height; i++) {
    const lum = 0.2126 * data[i * 4] + 0.7152 * data[i * 4 + 1] + 0.0722 * data[i * 4 + 2]
    if (lum > 1e-6) { logSum += Math.log(lum); logCount++ }
  }
  const logAvg = logCount > 0 ? logSum / logCount : 0
  S.previewAutoExposure = Math.exp(-logAvg) * 0.18
  S.previewRenderer.toneMappingExposure = S.previewAutoExposure
}

export function renderSpherePreview() {
  if (!S.previewRenderer || !previewScene || !previewCamera) return
  S.previewRenderer.render(previewScene, previewCamera)
}


export function setApplyBtnVisible(visible) {
  const btn = $('hdrPreviewApplyBtn')
  if (btn) btn.style.display = visible ? '' : 'none'
}

export function requestHdrPreview(entry) {
  const modal = $('hdrPreviewModal')
  const canvas = $('hdrPreviewCanvas')
  const expSlider = $('hdrPreviewExposure')
  const expVal = $('hdrPreviewExposureVal')
  const infoEl = $('hdrPreviewInfo')
  if (!modal || !canvas) return
  modal.classList.add('show')
  expSlider.value = 0
  expVal.textContent = '0.0'
  infoEl.textContent = t('m3d.hdrPreviewLoading')
  setApplyBtnVisible(true)
  canvas.width = 960; canvas.height = 480

  fetch(fileUrl(entry.fullPath)).then(r => r.arrayBuffer()).then(async buf => {
    const ext = detectExt(buf, extFromUrl(entry.fullPath))
    const res = await workerParse(buf, ext)
    if (!res.ok) throw new Error(res.error)
    const data = new Float32Array(res.data)
    S.previewState = { data, width: res.width, height: res.height, entry }
    infoEl.textContent = `${entry.name} · ${res.width}×${res.height}`
    ensureSpherePreview(canvas)
    resizePreview(canvas)
    setPreviewTexture(data, res.width, res.height)
    renderSpherePreview()
  }).catch(() => {
    infoEl.textContent = entry.name + ' — ' + t('m3d.hdrPreviewLoadFailed')
  })
}

export function openHdrPreview(opts, exposure) {
  if (opts && opts.url) {
    const { url, name, canvas, modal, expSlider, expVal, infoEl } = opts
    modal.classList.add('show')
    expSlider.value = 0; expVal.textContent = '0.0'
    infoEl.textContent = t('m3d.hdrPreviewLoading')
    setApplyBtnVisible(!!opts.fullPath)
    canvas.width = 960; canvas.height = 480

    fetch(url).then(r => r.arrayBuffer()).then(async buf => {
      const ext = detectExt(buf, extFromUrl(url))
      const res = await workerParse(buf, ext)
      if (!res.ok) throw new Error(res.error)
      const data = new Float32Array(res.data)
      S.previewState = { data, width: res.width, height: res.height, entry: { name, fullPath: opts.fullPath } }
      infoEl.textContent = `${name || ''} · ${res.width}×${res.height}`
      ensureSpherePreview(canvas)
      resizePreview(canvas)
      setPreviewTexture(data, res.width, res.height)
      renderSpherePreview()
    }).catch(() => {
      infoEl.textContent = (name || '') + ' — ' + t('m3d.hdrPreviewLoadFailed')
    })
  } else if (exposure !== undefined && S.previewState && S.previewRenderer) {
    S.previewRenderer.toneMappingExposure = S.previewAutoExposure * Math.exp(exposure)
    renderSpherePreview()
  }
}

export function disposeHdrPreview() {
  if (previewMesh) { if (previewMesh.material.map) previewMesh.material.map.dispose(); previewMesh.material.dispose(); previewMesh.geometry.dispose(); previewMesh = null }
  if (S.previewRenderer) { S.previewRenderer.dispose(); S.previewRenderer = null }
  previewScene = null; previewCamera = null; S.previewState = null
}

