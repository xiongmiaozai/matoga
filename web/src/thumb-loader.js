/**
 * matoga - 材质贴图对比工具
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 */

import { fileUrl, apiUrl } from './utils.js'

const THUMB_W = 160
const memCache = new Map()
const generating = new Map()

let io = null
function getIO() {
  if (io) return io
  io = new IntersectionObserver(
    entries => {
      for (const e of entries) {
        if (e.isIntersecting) {
          const img = e.target
          const p = img.dataset.thumb
          if (p) {
            io.unobserve(img)
            loadThumb(img, p)
          }
        }
      }
    },
    { rootMargin: '300px' }
  )
  return io
}

export function observeThumbs(root) {
  const imgs = root.querySelectorAll('img[data-thumb]:not([src])')
  for (const img of imgs) getIO().observe(img)
}

async function loadThumb(img, fullPath) {
  if (img.src) return
  if (memCache.has(fullPath)) {
    img.src = memCache.get(fullPath)
    return
  }
  const thumbUrl = apiUrl('/api/file/thumb?path=' + encodeURIComponent(fullPath))
  img.src = thumbUrl
  if (!generating.has(fullPath)) {
    generating.set(fullPath, verifyAndRefresh(fullPath, img, thumbUrl))
  }
  generating
    .get(fullPath)
    .catch(() => {})
    .finally(() => generating.delete(fullPath))
}

async function verifyAndRefresh(fullPath, img, optimisticUrl) {
  let info
  try {
    info = await batchThumbInfo(fullPath)
  } catch {}
  if (info && info.exists && !info.stale) {
    memCache.set(fullPath, optimisticUrl)
    return
  }
  try {
    const dataUrl = await generateThumbDataUrl(fileUrl(fullPath), fullPath)
    const saved = await window.api.saveThumb(fullPath, dataUrl)
    const url = saved && saved.success && saved.thumbUrl ? saved.thumbUrl : dataUrl
    memCache.set(fullPath, url)
    img.src = url
  } catch {
    img.src = fileUrl(fullPath)
  }
}

const batchQueue = []
let batchTimer = null
function batchThumbInfo(fullPath) {
  return new Promise((resolve, reject) => {
    batchQueue.push({ fullPath, resolve, reject })
    if (batchQueue.length >= 32) flushBatch()
    else if (!batchTimer) batchTimer = setTimeout(flushBatch, 16)
  })
}
async function flushBatch() {
  if (batchTimer) {
    clearTimeout(batchTimer)
    batchTimer = null
  }
  const batch = batchQueue.splice(0)
  const paths = batch.map(b => b.fullPath)
  try {
    const results = await window.api.thumbInfoBatch(paths)
    for (const b of batch) b.resolve(results[b.fullPath] || { exists: false, stale: true })
  } catch (e) {
    for (const b of batch) b.reject(e)
  }
}

/* 读取动画贴图元数据（同目录 <name>.png.mcmeta；非动画 / 读取失败 → null）。
    仅竖长条贴图（h ≥ 2w，MC 动画贴图形态）探测，普通贴图零额外请求 */
async function fetchAnimFrameSize(fullPath, w, h) {
  if (h < w * 2) return null
  try {
    const res = await fetch('/api/file/raw?path=' + encodeURIComponent(fullPath + '.mcmeta'))
    if (!res.ok) return null
    const meta = await res.json()
    const anim = meta && meta.animation
    if (!anim || typeof anim !== 'object') return null
    const fw = Number.isFinite(+anim.width) && +anim.width > 0 ? Math.floor(+anim.width) : w
    const fh = Number.isFinite(+anim.height) && +anim.height > 0 ? Math.floor(+anim.height) : fw
    if (fw <= 0 || fh <= 0 || fw > w || fh > h) return null
    return { fw, fh }
  } catch {
    return null
  }
}

/* 生成缩略图：动画贴图（竖长条 + mcmeta animation）裁剪首帧（顶部 fw×fh 区域），
    否则整幅等比缩放 */
function generateThumbDataUrl(srcUrl, fullPath) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = async () => {
      try {
        const anim = fullPath ? await fetchAnimFrameSize(fullPath, img.naturalWidth, img.naturalHeight) : null
        const srcW = anim ? anim.fw : img.naturalWidth
        const srcH = anim ? anim.fh : img.naturalHeight
        const scale = Math.min(THUMB_W / srcW, THUMB_W / srcH, 1)
        const w = Math.max(1, Math.round(srcW * scale))
        const h = Math.max(1, Math.round(srcH * scale))
        const canvas = document.createElement('canvas')
        canvas.width = w
        canvas.height = h
        const ctx = canvas.getContext('2d')
        if (anim) ctx.drawImage(img, 0, 0, anim.fw, anim.fh, 0, 0, w, h)
        else ctx.drawImage(img, 0, 0, w, h)
        resolve(canvas.toDataURL('image/jpeg', 0.8))
      } catch (e) {
        reject(e)
      }
    }
    img.onerror = reject
    img.src = srcUrl
  })
}
