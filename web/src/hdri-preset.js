/**
 * matoga - 材质贴图对比工具
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 */

import { $, showToast } from './core.js'
import { fileUrl } from './utils.js'
import { parseEnvPixels, detectExt, extFromUrl } from './hdr-env-loader.js'
import { loadHDREnv } from './material3d.js'
import { blurhashToDataUrl } from './blurhash.js'
import * as THREE from 'three'
import { t } from './i18n.js'

let previewWorker = null
let previewWorkerSeq = 0
const previewWorkerCallbacks = new Map()

function getPreviewWorker() {
  if (previewWorker) return previewWorker
  previewWorker = new Worker(new URL('./hdr-preview-worker.js', import.meta.url), { type: 'module' })
  previewWorker.onmessage = (e) => {
    const cb = previewWorkerCallbacks.get(e.data.id)
    if (cb) { previewWorkerCallbacks.delete(e.data.id); cb(e.data) }
  }
  return previewWorker
}

function workerParse(buffer, ext) {
  return new Promise((resolve) => {
    const id = ++previewWorkerSeq
    previewWorkerCallbacks.set(id, resolve)
    getPreviewWorker().postMessage({ id, buffer, ext }, [buffer])
  })
}


const THUMB_CONCURRENCY = 4

let currentSelectedPath = null
let thumbQueue = []
let activeThumbCount = 0
let thumbTotal = 0
let thumbLoaded = 0

function updateThumbProgress() {
  const bar = $('m3dHdrThumbProgress')
  if (!bar) return
  if (thumbTotal === 0 || thumbLoaded >= thumbTotal) {
    bar.classList.remove('show')
    return
  }
  bar.classList.add('show')
  const pct = Math.round((thumbLoaded / thumbTotal) * 100)
  const fill = bar.querySelector('.hdri-thumb-progress-bar')
  const text = bar.querySelector('.hdri-thumb-progress-text')
  if (fill) fill.style.width = pct + '%'
  if (text) text.textContent = thumbLoaded + '/' + thumbTotal
}

export async function initHdrPreset() {
  await refreshHdrPreset()
}

export async function refreshHdrPreset() {
  const grid = $('m3dHdrPresetGrid')
  if (!grid) return
  thumbQueue = []
  const res = await window.api.listHdrPresets()
  if (!res || !res.success) {
    grid.innerHTML = `<div class="hdri-preset-empty">${t('toast.cannotReadPreset')}</div>`
    return
  }
  const entries = res.entries || []
  if (!entries.length) {
    grid.innerHTML = `<div class="hdri-preset-empty">${t('toast.presetEmpty')}</div>`
    return
  }
  grid.innerHTML = ''
  thumbTotal = entries.length
  thumbLoaded = 0
  activeThumbCount = 0
  updateThumbProgress()
  for (const entry of entries) {
    const item = document.createElement('div')
    item.className = 'hdri-preset-item'
    item.title = entry.name
    item.dataset.path = entry.fullPath
    if (entry.fullPath === currentSelectedPath) item.classList.add('active')
    const img = document.createElement('img')
    img.className = 'hdri-preset-thumb'
    img.alt = entry.name
    img.loading = 'lazy'
    const label = document.createElement('span')
    label.className = 'hdri-preset-label'
    label.textContent = entry.name.replace(/\.(hdr|exr)$/i, '')
    const spinner = document.createElement('div')
    spinner.className = 'hdri-preset-spinner'
    item.appendChild(spinner)
    item.appendChild(img)
    item.appendChild(label)
    const previewBtn = document.createElement('button')
    previewBtn.className = 'hdri-preset-preview-btn'
    previewBtn.innerHTML = '<svg class="ico ico-sm"><use href="#i-maximize"/></svg>'
    previewBtn.title = t('m3d.hdrPreview')
    item.appendChild(previewBtn)
    grid.appendChild(item)
    item.addEventListener('click', () => selectPreset(entry.fullPath, item))
    previewBtn.addEventListener('click', (e) => { e.stopPropagation(); requestHdrPreview(entry) })
    enqueueThumb(entry, img, spinner)
  }
  if (window.api && window.api.cleanupHdrThumbs) window.api.cleanupHdrThumbs()
}

function enqueueThumb(entry, img, spinner) {
  thumbQueue.push({ entry, img, spinner })
  processThumbQueue()
}

function processThumbQueue() {
  while (thumbQueue.length && activeThumbCount < THUMB_CONCURRENCY) {
    const { entry, img, spinner } = thumbQueue.shift()
    activeThumbCount++
    loadThumb(entry, img, spinner).then(nextThumb).catch(nextThumb)
  }
}

function nextThumb() {
  activeThumbCount--
  thumbLoaded++
  updateThumbProgress()
  processThumbQueue()
}

async function loadThumb(entry, img, spinner) {
  const fallbackUrl = '/api/hdri/thumb?path=' + encodeURIComponent(entry.fullPath)
  const finish = (url) => {
    img.onload = () => { if (spinner.parentNode) spinner.remove(); img.style.backgroundImage = '' }
    img.onerror = () => { spinner.classList.add('error'); spinner.textContent = '!' }
    img.src = url
  }
  try {
    const info = await window.api.hdrThumbInfo(entry.fullPath)
    if (info && info.blurhash) {
      const ph = blurhashToDataUrl(info.blurhash, 32, 16)
      if (ph) { img.style.backgroundImage = 'url(' + ph + ')'; img.style.backgroundSize = 'cover' }
    }
    finish((info && info.thumbUrl) || fallbackUrl)
  } catch {
    finish(fallbackUrl)
  }
}


function selectPreset(fullPath, item) {
  const grid = $('m3dHdrPresetGrid')
  if (grid) grid.querySelectorAll('.hdri-preset-item').forEach(el => el.classList.remove('active'))
  item.classList.add('active')
  currentSelectedPath = fullPath
  loadHDREnv(fileUrl(fullPath))
  const seg = $('m3dEnvModeSeg')
  if (seg) {
    seg.querySelectorAll('button').forEach(b => b.classList.toggle('active', b.dataset.envmode === 'hdri'))
    document.querySelectorAll('.m3d-env-subpane').forEach(p => p.classList.toggle('active', p.dataset.envpane === 'hdri'))
  }
  showToast(t('toast.loadedHdr', { name: item.title }))
}

export function clearHdrPresetSelection() {
  currentSelectedPath = null
  const grid = $('m3dHdrPresetGrid')
  if (grid) grid.querySelectorAll('.hdri-preset-item').forEach(el => el.classList.remove('active'))
}
export function filterHdrPresets(query) {
  const grid = $('m3dHdrPresetGrid')
  if (!grid) return
  const q = (query || '').trim().toLowerCase()
  grid.querySelectorAll('.hdri-preset-item').forEach(item => {
    const label = item.querySelector('.hdri-preset-label')
    const name = label ? label.textContent.toLowerCase() : ''
    item.style.display = (!q || name.includes(q)) ? '' : 'none'
  })
}

let previewState = null
let previewRenderer = null, previewScene = null, previewCamera = null, previewMesh = null
let previewYaw = 0, previewPitch = 0, previewDragging = false, previewLastX = 0, previewLastY = 0
let previewAutoExposure = 1

function ensureSpherePreview(canvas) {
  if (previewRenderer && previewRenderer.domElement === canvas) return
  if (previewRenderer) { previewRenderer.dispose(); previewRenderer = null }
  previewRenderer = new THREE.WebGLRenderer({ canvas, antialias: true })
  previewRenderer.toneMapping = THREE.ACESFilmicToneMapping
  previewRenderer.toneMappingExposure = 1
  previewRenderer.outputColorSpace = THREE.SRGBColorSpace
  previewScene = new THREE.Scene()
  previewCamera = new THREE.PerspectiveCamera(75, 2, 0.1, 110)
  previewCamera.position.set(0, 0, 0)
  const geo = new THREE.SphereGeometry(50, 80, 40)
  previewMesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ side: THREE.BackSide }))
  previewScene.add(previewMesh)
  previewYaw = 0; previewPitch = 0
  const onDown = (x, y) => { previewDragging = true; previewLastX = x; previewLastY = y }
  const onMove = (x, y) => {
    if (!previewDragging) return
    previewYaw -= (x - previewLastX) * 0.005
    previewPitch = Math.max(-1.4, Math.min(1.4, previewPitch - (y - previewLastY) * 0.005))
    previewLastX = x; previewLastY = y
    updatePreviewCamera()
  }
  canvas.addEventListener('mousedown', (e) => onDown(e.clientX, e.clientY))
  window.addEventListener('mousemove', (e) => onMove(e.clientX, e.clientY))
  window.addEventListener('mouseup', () => { previewDragging = false })
  canvas.addEventListener('touchstart', (e) => { if (e.touches[0]) onDown(e.touches[0].clientX, e.touches[0].clientY) }, { passive: true })
  canvas.addEventListener('touchmove', (e) => { if (e.touches[0]) { onMove(e.touches[0].clientX, e.touches[0].clientY); e.preventDefault() } }, { passive: false })
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
  updatePreviewCamera()
}

function updatePreviewCamera() {
  if (!previewCamera) return
  previewCamera.rotation.order = 'YXZ'
  previewCamera.rotation.y = previewYaw
  previewCamera.rotation.x = previewPitch
  renderSpherePreview()
}

function resizePreview(canvas) {
  if (!previewRenderer) return
  const w = canvas.clientWidth || 960, h = canvas.clientHeight || 480
  previewRenderer.setSize(w, h, false)
  previewCamera.aspect = w / h
  previewCamera.updateProjectionMatrix()
}

function setPreviewTexture(data, width, height) {
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
  previewAutoExposure = Math.exp(-logAvg) * 0.18
  previewRenderer.toneMappingExposure = previewAutoExposure
}

function renderSpherePreview() {
  if (!previewRenderer || !previewScene || !previewCamera) return
  previewRenderer.render(previewScene, previewCamera)
}


function requestHdrPreview(entry) {
  const modal = $('hdrPreviewModal')
  const canvas = $('hdrPreviewCanvas')
  const expSlider = $('hdrPreviewExposure')
  const expVal = $('hdrPreviewExposureVal')
  const infoEl = $('hdrPreviewInfo')
  if (!modal || !canvas) return
  modal.classList.add('show')
  expSlider.value = 0
  expVal.textContent = '0.0'
  infoEl.textContent = entry.name
  canvas.width = 960; canvas.height = 480

  fetch(fileUrl(entry.fullPath)).then(r => r.arrayBuffer()).then(async buf => {
    const ext = detectExt(buf, extFromUrl(entry.fullPath))
    const res = await workerParse(buf, ext)
    if (!res.ok) throw new Error(res.error)
    const data = new Float32Array(res.data)
    previewState = { data, width: res.width, height: res.height, entry }
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
    infoEl.textContent = name || ''
    canvas.width = 960; canvas.height = 480

    fetch(url).then(r => r.arrayBuffer()).then(async buf => {
      const ext = detectExt(buf, extFromUrl(url))
      const res = await workerParse(buf, ext)
      if (!res.ok) throw new Error(res.error)
      const data = new Float32Array(res.data)
      previewState = { data, width: res.width, height: res.height, entry: { name } }
      infoEl.textContent = `${name || ''} · ${res.width}×${res.height}`
      ensureSpherePreview(canvas)
      resizePreview(canvas)
      setPreviewTexture(data, res.width, res.height)
      renderSpherePreview()
    }).catch(() => {
      infoEl.textContent = (name || '') + ' — ' + t('m3d.hdrPreviewLoadFailed')
    })
  } else if (exposure !== undefined && previewState && previewRenderer) {
    previewRenderer.toneMappingExposure = previewAutoExposure * Math.exp(exposure)
    renderSpherePreview()
  }
}

export function disposeHdrPreview() {
  if (previewMesh) { if (previewMesh.material.map) previewMesh.material.map.dispose(); previewMesh.material.dispose(); previewMesh.geometry.dispose(); previewMesh = null }
  if (previewRenderer) { previewRenderer.dispose(); previewRenderer = null }
  previewScene = null; previewCamera = null; previewState = null
}

export function initHdrDragDrop(grid) {
  if (!grid) return
  const pane = grid.closest('.m3d-env-subpane')
  const target = pane || grid
  target.addEventListener('dragover', (e) => {
    e.preventDefault()
    e.stopPropagation()
    target.classList.add('hdr-drag-over')
  })
  target.addEventListener('dragleave', (e) => {
    if (e.target === target) target.classList.remove('hdr-drag-over')
  })
  target.addEventListener('drop', async (e) => {
    e.preventDefault()
    e.stopPropagation()
    target.classList.remove('hdr-drag-over')
    const files = Array.from(e.dataTransfer.files).filter(f => /\.(hdr|exr)$/i.test(f.name))
    if (!files.length) return
    const file = files[0]
    try {
      const url = URL.createObjectURL(file)
      loadHDREnv(url)
      clearHdrPresetSelection()
      const seg = $('m3dEnvModeSeg')
      if (seg) {
        seg.querySelectorAll('button').forEach(b => b.classList.toggle('active', b.dataset.envmode === 'hdri'))
        document.querySelectorAll('.m3d-env-subpane').forEach(p => p.classList.toggle('active', p.dataset.envpane === 'hdri'))
      }
      showToast(t('toast.loadedHdr', { name: file.name }))
    } catch {
      showToast(t('toast.loadHdrFailed'))
    }
  })
}