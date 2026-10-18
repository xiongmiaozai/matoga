/**
 * matoga - 材质贴图对比工具
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 */

import { fileUrl } from './utils.js'

const THUMB_W = 160
const memCache = new Map()
const generating = new Map()

let io = null
function getIO() {
  if (io) return io
  io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (e.isIntersecting) {
        const img = e.target
        const p = img.dataset.thumb
        if (p) { io.unobserve(img); loadThumb(img, p) }
      }
    }
  }, { rootMargin: '300px' })
  return io
}

export function observeThumbs(root) {
  const imgs = root.querySelectorAll('img[data-thumb]:not([src])')
  for (const img of imgs) getIO().observe(img)
}

async function loadThumb(img, fullPath) {
  if (img.src) return
  if (memCache.has(fullPath)) { img.src = memCache.get(fullPath); return }
  if (!generating.has(fullPath)) generating.set(fullPath, generateAndSave(fullPath))
  try {
    const thumbUrl = await generating.get(fullPath)
    memCache.set(fullPath, thumbUrl)
    img.src = thumbUrl
  } catch {
    img.src = fileUrl(fullPath)
  } finally {
    generating.delete(fullPath)
  }
}

async function generateAndSave(fullPath) {
  try {
    const info = await window.api.thumbInfo(fullPath)
    if (info && info.exists && !info.stale && info.thumbUrl) return info.thumbUrl
  } catch {}
  const dataUrl = await generateThumbDataUrl(fileUrl(fullPath))
  try {
    const saved = await window.api.saveThumb(fullPath, dataUrl)
    if (saved && saved.success && saved.thumbUrl) return saved.thumbUrl
  } catch {}
  return dataUrl
}

function generateThumbDataUrl(srcUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      const scale = Math.min(THUMB_W / img.naturalWidth, THUMB_W / img.naturalHeight, 1)
      const w = Math.max(1, Math.round(img.naturalWidth * scale))
      const h = Math.max(1, Math.round(img.naturalHeight * scale))
      const canvas = document.createElement('canvas')
      canvas.width = w; canvas.height = h
      const ctx = canvas.getContext('2d')
      ctx.drawImage(img, 0, 0, w, h)
      try { resolve(canvas.toDataURL('image/jpeg', 0.8)) }
      catch (e) { reject(e) }
    }
    img.onerror = reject
    img.src = srcUrl
  })
}