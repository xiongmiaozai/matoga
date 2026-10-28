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
import { S } from './hpre/state.js'

import { enqueueThumb, selectPreset, updateThumbProgress } from './hpre/thumbs.js'
import { requestHdrPreview } from './hpre/preview.js'

/* 预览视图接口：原文件即从本模块导出（renderer.js 与设置面板依赖）。 */
export { resetHdrPreviewView, toggleHdrPreviewFullscreen, applyPreviewHdrToScene, openHdrPreview, disposeHdrPreview } from './hpre/preview.js'

export async function initHdrPreset() {
  await refreshHdrPreset()
}

export async function refreshHdrPreset() {
  const grid = $('m3dHdrPresetGrid')
  if (!grid) return
  S.thumbQueue = []
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
  S.thumbTotal = entries.length
  S.thumbLoaded = 0
  S.activeThumbCount = 0
  updateThumbProgress()
  for (const entry of entries) {
    const item = document.createElement('div')
    item.className = 'hdri-preset-item'
    item.title = entry.name
    item.dataset.path = entry.fullPath
    if (entry.fullPath === S.currentSelectedPath) item.classList.add('active')
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

export function clearHdrPresetSelection() {
  S.currentSelectedPath = null
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