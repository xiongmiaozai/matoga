/**
 * matoga - 材质 3D 视口：texture-extract
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 从 material3d.js 原样搬出，逻辑未改。
 */

export function imgW(img) { return img.naturalWidth || img.width }
export function imgH(img) { return img.naturalHeight || img.height }

export function extractChannel(image, channelIndex, invert) {
  const canvas = document.createElement('canvas')
  canvas.width = image.naturalWidth; canvas.height = image.naturalHeight
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  ctx.drawImage(image, 0, 0)
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const data = imageData.data
  for (let i = 0; i < data.length; i += 4) {
    let v = data[i + channelIndex]
    if (invert) v = 255 - v
    data[i] = v; data[i + 1] = v; data[i + 2] = v; data[i + 3] = 255
  }
  ctx.putImageData(imageData, 0, 0)
  const tex = new THREE.CanvasTexture(canvas)
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  return tex
}

export function detectFormat(image) {
  const canvas = document.createElement('canvas')
  const w = Math.min(image.naturalWidth, 64), h = Math.min(image.naturalHeight, 64)
  canvas.width = w; canvas.height = h
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  ctx.drawImage(image, 0, 0, w, h)
  const data = ctx.getImageData(0, 0, w, h).data
  const total = w * h
  let alphaNonFull = 0, alphaMidrange = 0
  let blueSum = 0, blueSumSq = 0
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3]
    if (a < 250) {
      alphaNonFull++
      if (a > 10 && a < 245) alphaMidrange++
    }
    const b = data[i + 2]
    blueSum += b; blueSumSq += b * b
  }
  const alphaNonFullRatio = alphaNonFull / total
  const alphaMidRatio = alphaNonFull > 0 ? alphaMidrange / alphaNonFull : 0
  const blueMean = blueSum / total
  const blueVar = blueSumSq / total - blueMean * blueMean
  const blueStd = Math.sqrt(Math.max(0, blueVar))
  if ((alphaNonFullRatio > 0.02 && alphaMidRatio < 0.3) || (blueStd > 20 && blueMean > 25)) return 'labpbr'
  return 'old'
}

export function extractRoughness(image) {
  const c = document.createElement('canvas'); c.width = image.naturalWidth; c.height = image.naturalHeight
  const ctx = c.getContext('2d', { willReadFrequently: true }); ctx.drawImage(image, 0, 0)
  const imageData = ctx.getImageData(0, 0, c.width, c.height), d = imageData.data
  for (let i = 0; i < d.length; i += 4) { const r = 255 - d[i]; d[i] = r; d[i + 1] = r; d[i + 2] = r; d[i + 3] = 255 }
  ctx.putImageData(imageData, 0, 0)
  const tex = new THREE.CanvasTexture(c); tex.wrapS = tex.wrapT = THREE.RepeatWrapping; return tex
}

export function extractMetalness(image) {
  const c = document.createElement('canvas'); c.width = image.naturalWidth; c.height = image.naturalHeight
  const ctx = c.getContext('2d', { willReadFrequently: true }); ctx.drawImage(image, 0, 0)
  const imageData = ctx.getImageData(0, 0, c.width, c.height), d = imageData.data
  for (let i = 0; i < d.length; i += 4) { const v = d[i + 1]; d[i] = v; d[i + 1] = v; d[i + 2] = v; d[i + 3] = 255 }
  ctx.putImageData(imageData, 0, 0)
  const tex = new THREE.CanvasTexture(c); tex.wrapS = tex.wrapT = THREE.RepeatWrapping; return tex
}

export function extractEmissive(specImage, mainImage) {
  const w = specImage.naturalWidth, h = specImage.naturalHeight
  const c = document.createElement('canvas'); c.width = w; c.height = h
  const ctx = c.getContext('2d', { willReadFrequently: true }); ctx.drawImage(specImage, 0, 0)
  const specData = ctx.getImageData(0, 0, w, h).data
  let mainData = null
  if (mainImage) {
    const mc = document.createElement('canvas'); mc.width = w; mc.height = h
    const mctx = mc.getContext('2d', { willReadFrequently: true }); mctx.drawImage(mainImage, 0, 0, w, h)
    mainData = mctx.getImageData(0, 0, w, h).data
  }
  const imageData = ctx.createImageData(w, h), d = imageData.data
  for (let i = 0; i < d.length; i += 4) {
    let a = specData[i + 3]; if (a === 255) a = 0
    const mask = a / 254
    if (mainData) { d[i] = Math.round(mainData[i] * mask); d[i + 1] = Math.round(mainData[i + 1] * mask); d[i + 2] = Math.round(mainData[i + 2] * mask) }
    else { d[i] = d[i + 1] = d[i + 2] = Math.round(255 * mask) }
    d[i + 3] = 255
  }
  ctx.putImageData(imageData, 0, 0)
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.wrapS = tex.wrapT = THREE.RepeatWrapping; return tex
}

export function reconstructNormal(image) {
  const c = document.createElement('canvas'); c.width = imgW(image); c.height = imgH(image)
  const ctx = c.getContext('2d', { willReadFrequently: true }); ctx.drawImage(image, 0, 0)
  const imageData = ctx.getImageData(0, 0, c.width, c.height), d = imageData.data
  for (let i = 0; i < d.length; i += 4) {
    const nx = (d[i] / 255) * 2 - 1, ny = (d[i + 1] / 255) * 2 - 1
    const nz = Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny))
    d[i] = Math.round((nx + 1) * 127.5); d[i + 1] = Math.round((ny + 1) * 127.5); d[i + 2] = Math.round((nz + 1) * 127.5); d[i + 3] = 255
  }
  ctx.putImageData(imageData, 0, 0)
  const tex = new THREE.CanvasTexture(c); tex.wrapS = tex.wrapT = THREE.RepeatWrapping; return tex
}

export function extractHeight(image) {
  const c = document.createElement('canvas'); c.width = imgW(image); c.height = imgH(image)
  const ctx = c.getContext('2d', { willReadFrequently: true }); ctx.drawImage(image, 0, 0)
  const imageData = ctx.getImageData(0, 0, c.width, c.height), d = imageData.data
  let minA = 255, maxA = 0
  const buckets = new Set()
  for (let i = 3; i < d.length; i += 4) { if (d[i] < minA) minA = d[i]; if (d[i] > maxA) maxA = d[i]; if (buckets.size < 8) buckets.add(d[i]) }
  const range = maxA - minA
  if (range < 1 || buckets.size <= 2) return null
  for (let i = 0; i < d.length; i += 4) { const v = Math.round((d[i + 3] - minA) / range * 255); d[i] = v; d[i + 1] = v; d[i + 2] = v; d[i + 3] = 255 }
  ctx.putImageData(imageData, 0, 0)
  const tex = new THREE.CanvasTexture(c); tex.wrapS = tex.wrapT = THREE.RepeatWrapping; applyHeightFilter(tex); return tex
}

export function extractHeightFromNormal(image) {
  const maxDim = 256
  const ow = imgW(image), oh = imgH(image)
  const sc = Math.min(1, maxDim / Math.max(ow, oh))
  const w = Math.max(1, Math.round(ow * sc)), h = Math.max(1, Math.round(oh * sc))
  const c = document.createElement('canvas'); c.width = w; c.height = h
  const ctx = c.getContext('2d', { willReadFrequently: true })
  ctx.drawImage(image, 0, 0, w, h)
  const src = ctx.getImageData(0, 0, w, h).data
  const n = w * h
  const gx = new Float32Array(n), gy = new Float32Array(n)
  for (let i = 0; i < n; i++) { const j = i * 4; gx[i] = (src[j] - 127.5) / 127.5; gy[i] = (src[j + 1] - 127.5) / 127.5 }
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
    const r1 = y * w, r0 = (y - 1) * w
    let diff = 0
    for (let x = 0; x < w; x++) diff += (gy[r0 + x] + gy[r1 + x]) * 0.5
    rowOff[y] = rowOff[y - 1] + diff / w
  }
  let minH = Infinity, maxH = -Infinity
  for (let y = 0; y < h; y++) {
    const row = y * w, off = rowOff[y]
    for (let x = 0; x < w; x++) { const v = height[row + x] + off; height[row + x] = v; if (v < minH) minH = v; if (v > maxH) maxH = v }
  }
  const range = maxH - minH
  if (range < 1e-4) return null
  const out = ctx.createImageData(w, h), od = out.data
  for (let i = 0; i < n; i++) { const v = Math.round((height[i] - minH) / range * 255); od[i * 4] = v; od[i * 4 + 1] = v; od[i * 4 + 2] = v; od[i * 4 + 3] = 255 }
  ctx.putImageData(out, 0, 0)
  const tex = new THREE.CanvasTexture(c); tex.wrapS = tex.wrapT = THREE.RepeatWrapping; applyHeightFilter(tex); return tex
}


export function applyHeightFilter(tex) {
  if (!tex) return
  tex.generateMipmaps = true
  tex.magFilter = THREE.LinearFilter
  tex.minFilter = THREE.LinearMipmapLinearFilter
  tex.anisotropy = 1
  tex.needsUpdate = true
}

