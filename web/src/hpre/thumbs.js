/**
 * matoga - HDRI 预设面板：thumbs
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 从 hdri-preset.js 按职责搬出，逻辑未改。
 */
import { $, showToast } from '../core.js'
import { fileUrl } from '../utils.js'
import { loadHDREnv } from '../material3d.js'
import { blurhashToDataUrl } from '../blurhash.js'
import { t } from '../i18n.js'
import { S } from './state.js'

export const THUMB_CONCURRENCY = 4







export function updateThumbProgress() {
  const bar = $('m3dHdrThumbProgress')
  if (!bar) return
  if (S.thumbTotal === 0 || S.thumbLoaded >= S.thumbTotal) {
    bar.classList.remove('show')
    return
  }
  bar.classList.add('show')
  const pct = Math.round((S.thumbLoaded / S.thumbTotal) * 100)
  const fill = bar.querySelector('.hdri-thumb-progress-bar')
  const text = bar.querySelector('.hdri-thumb-progress-text')
  if (fill) fill.style.width = pct + '%'
  if (text) text.textContent = S.thumbLoaded + '/' + S.thumbTotal
}


export function enqueueThumb(entry, img, spinner) {
  S.thumbQueue.push({ entry, img, spinner })
  processThumbQueue()
}

export function processThumbQueue() {
  while (S.thumbQueue.length && S.activeThumbCount < THUMB_CONCURRENCY) {
    const { entry, img, spinner } = S.thumbQueue.shift()
    S.activeThumbCount++
    loadThumb(entry, img, spinner).then(nextThumb).catch(nextThumb)
  }
}

export function nextThumb() {
  S.activeThumbCount--
  S.thumbLoaded++
  updateThumbProgress()
  processThumbQueue()
}

export async function loadThumb(entry, img, spinner) {
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


export function selectPreset(fullPath, item) {
  const grid = $('m3dHdrPresetGrid')
  if (grid) grid.querySelectorAll('.hdri-preset-item').forEach(el => el.classList.remove('active'))
  item.classList.add('active')
  S.currentSelectedPath = fullPath
  loadHDREnv(fileUrl(fullPath))
  const seg = $('m3dEnvModeSeg')
  if (seg) {
    seg.querySelectorAll('button').forEach(b => b.classList.toggle('active', b.dataset.envmode === 'hdri'))
    document.querySelectorAll('.m3d-env-subpane').forEach(p => p.classList.toggle('active', p.dataset.envpane === 'hdri'))
  }
  showToast(t('toast.loadedHdr', { name: item.title }))
}

