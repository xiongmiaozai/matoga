/**
 * matoga - MC 模型：高度图提取
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 从 mc-model-viewer.js 按领域搬出（正文逐字未改）。
 * 职责：从法线/alpha 提取高度图
 */

import { applyHeightFilter } from '../m3d/material-filters.js'

export function imgW(img) {
  return img.naturalWidth || img.width
}

export function imgH(img) {
  return img.naturalHeight || img.height
}

export function extractHeight(image) {
  const c = document.createElement('canvas')
  c.width = imgW(image)
  c.height = imgH(image)
  const ctx = c.getContext('2d', { willReadFrequently: true })
  ctx.drawImage(image, 0, 0)
  const imageData = ctx.getImageData(0, 0, c.width, c.height),
    d = imageData.data
  let minA = 255,
    maxA = 0
  const buckets = new Set()
  for (let i = 3; i < d.length; i += 4) {
    if (d[i] < minA) minA = d[i]
    if (d[i] > maxA) maxA = d[i]
    if (buckets.size < 8) buckets.add(d[i])
  }
  const range = maxA - minA
  if (range < 1 || buckets.size <= 2) return null
  for (let i = 0; i < d.length; i += 4) {
    const v = Math.round(((d[i + 3] - minA) / range) * 255)
    d[i] = v
    d[i + 1] = v
    d[i + 2] = v
    d[i + 3] = 255
  }
  ctx.putImageData(imageData, 0, 0)
  const tex = new THREE.CanvasTexture(c)
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  applyHeightFilter(tex)
  return tex
}

export function extractHeightFromNormal(image) {
  const maxDim = 256
  const ow = imgW(image),
    oh = imgH(image)
  const sc = Math.min(1, maxDim / Math.max(ow, oh))
  const w = Math.max(1, Math.round(ow * sc)),
    h = Math.max(1, Math.round(oh * sc))
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const ctx = c.getContext('2d', { willReadFrequently: true })
  ctx.drawImage(image, 0, 0, w, h)
  const src = ctx.getImageData(0, 0, w, h).data
  const n = w * h
  const gx = new Float32Array(n),
    gy = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const j = i * 4
    gx[i] = (src[j] - 127.5) / 127.5
    gy[i] = (src[j + 1] - 127.5) / 127.5
  }
  const height = new Float32Array(n)
  for (let y = 0; y < h; y++) {
    const row = y * w
    let rowSum = 0
    for (let x = 0; x < w; x++) rowSum += gx[row + x]
    const mean = rowSum / w
    height[row] = 0
    for (let x = 1; x < w; x++) height[row + x] = height[row + x - 1] + (gx[row + x - 1] + gx[row + x]) * 0.5 - mean
  }
  const rowOff = new Float32Array(h)
  for (let y = 1; y < h; y++) {
    const r1 = y * w,
      r0 = (y - 1) * w
    let diff = 0
    for (let x = 0; x < w; x++) diff += (gy[r0 + x] + gy[r1 + x]) * 0.5
    rowOff[y] = rowOff[y - 1] + diff / w
  }
  let minH = Infinity,
    maxH = -Infinity
  for (let y = 0; y < h; y++) {
    const row = y * w,
      off = rowOff[y]
    for (let x = 0; x < w; x++) {
      const v = height[row + x] + off
      height[row + x] = v
      if (v < minH) minH = v
      if (v > maxH) maxH = v
    }
  }
  const range = maxH - minH
  if (range < 1e-4) return null
  const out = ctx.createImageData(w, h),
    od = out.data
  for (let i = 0; i < n; i++) {
    const v = Math.round(((height[i] - minH) / range) * 255)
    od[i * 4] = v
    od[i * 4 + 1] = v
    od[i * 4 + 2] = v
    od[i * 4 + 3] = 255
  }
  ctx.putImageData(out, 0, 0)
  const tex = new THREE.CanvasTexture(c)
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  applyHeightFilter(tex)
  return tex
}
