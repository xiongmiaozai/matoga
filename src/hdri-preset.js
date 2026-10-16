/**
 * matoga - 材质贴图对比工具
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 */

import { $, showToast } from './core.js'
import { fileUrl } from './utils.js'
import { HDRLoader } from './hdr-loader.js'
import { loadHDREnv } from './material3d.js'
import { FloatType } from '../node_modules/three/build/three.module.js'
import { t } from './i18n.js'

const THUMB_W = 320
const THUMB_H = 160

let currentSelectedPath = null
let thumbQueue = []
let thumbProcessing = false

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
    grid.appendChild(item)
    item.addEventListener('click', () => selectPreset(entry.fullPath, item))
    enqueueThumb(entry, img, spinner)
  }
}

function enqueueThumb(entry, img, spinner) {
  thumbQueue.push({ entry, img, spinner })
  processThumbQueue()
}

async function processThumbQueue() {
  if (thumbProcessing) return
  thumbProcessing = true
  while (thumbQueue.length) {
    const { entry, img, spinner } = thumbQueue.shift()
    await loadThumb(entry, img, spinner)
  }
  thumbProcessing = false
}

async function loadThumb(entry, img, spinner) {
  try {
    const info = await window.api.hdrThumbInfo(entry.fullPath)
    if (info && info.exists && !info.stale && info.thumbUrl) {
      img.src = info.thumbUrl
      img.onload = () => { if (spinner.parentNode) spinner.remove() }
      img.onerror = () => { spinner.classList.add('error'); spinner.textContent = '!' }
      return
    }
  } catch {}
  try {
    const dataUrl = await generateThumb(fileUrl(entry.fullPath))
    const saved = await window.api.saveHdrThumb(entry.fullPath, dataUrl)
    img.src = (saved && saved.success && saved.thumbUrl) ? saved.thumbUrl : dataUrl
    img.onload = () => { if (spinner.parentNode) spinner.remove() }
    img.onerror = () => { spinner.classList.add('error'); spinner.textContent = '!' }
  } catch {
    spinner.classList.add('error')
    spinner.textContent = '!'
  }
}

async function generateThumb(url) {
  const resp = await fetch(url)
  const arrayBuffer = await resp.arrayBuffer()
  const loader = new HDRLoader()
  loader.setDataType(FloatType)
  const result = loader.parse(arrayBuffer)
  const srcW = result.width, srcH = result.height
  const data = result.data
  const samples = new Float32Array(THUMB_W * THUMB_H * 3)
  let logSum = 0, logCount = 0
  for (let dy = 0; dy < THUMB_H; dy++) {
    for (let dx = 0; dx < THUMB_W; dx++) {
      const sx0 = Math.floor(dx * srcW / THUMB_W)
      const sy0 = Math.floor(dy * srcH / THUMB_H)
      const sx1 = Math.min(srcW - 1, sx0 + 1)
      const sy1 = Math.min(srcH - 1, sy0 + 1)
      let r = 0, g = 0, b = 0
      const s00 = (sy0 * srcW + sx0) * 4
      const s01 = (sy0 * srcW + sx1) * 4
      const s10 = (sy1 * srcW + sx0) * 4
      const s11 = (sy1 * srcW + sx1) * 4
      r = data[s00] + data[s01] + data[s10] + data[s11]
      g = data[s00 + 1] + data[s01 + 1] + data[s10 + 1] + data[s11 + 1]
      b = data[s00 + 2] + data[s01 + 2] + data[s10 + 2] + data[s11 + 2]
      r *= 0.25; g *= 0.25; b *= 0.25
      const di = (dy * THUMB_W + dx) * 3
      samples[di] = r; samples[di + 1] = g; samples[di + 2] = b
      const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b
      if (lum > 1e-6) { logSum += Math.log(lum); logCount++ }
    }
  }
  const logAvg = logCount > 0 ? logSum / logCount : 0
  const exposure = Math.exp(-logAvg) * 0.8
  const canvas = document.createElement('canvas')
  canvas.width = THUMB_W
  canvas.height = THUMB_H
  const ctx = canvas.getContext('2d')
  const imageData = ctx.createImageData(THUMB_W, THUMB_H)
  const dst = imageData.data
  for (let i = 0; i < THUMB_W * THUMB_H; i++) {
    const si = i * 3
    const di = i * 4
    dst[di] = srgbEncode(aces(samples[si] * exposure))
    dst[di + 1] = srgbEncode(aces(samples[si + 1] * exposure))
    dst[di + 2] = srgbEncode(aces(samples[si + 2] * exposure))
    dst[di + 3] = 255
  }
  ctx.putImageData(imageData, 0, 0)
  return canvas.toDataURL('image/jpeg', 0.85)
}

function aces(c) {
  const a = 2.51, b = 0.03, c2 = 2.43, d = 0.59, e = 0.14
  const v = (a * c + b) / (c * c + d * c + e)
  return v < 0 ? 0 : v > 1 ? 1 : v
}

function srgbEncode(c) {
  if (c < 0) c = 0; else if (c > 1) c = 1
  return c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055
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