/**
 * matoga - 材质贴图对比工具
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 感知哈希（aHash / dHash + 汉明距离）：前后端各一份，后端 file-service.js 须保持同步。
 */

const POPCOUNT = [0, 1, 1, 2, 1, 2, 2, 3, 1, 2, 2, 3, 2, 3, 3, 4]

function _downsampleToGray(rgba, width, height, dstW, dstH) {
  const gray = new Uint8Array(dstW * dstH)
  for (let y = 0; y < dstH; y++) {
    for (let x = 0; x < dstW; x++) {
      const sx = ((x + 0.5) / dstW) * width
      const sy = ((y + 0.5) / dstH) * height
      const ix = Math.min(width - 1, Math.floor(sx))
      const iy = Math.min(height - 1, Math.floor(sy))
      const j = (iy * width + ix) * 4
      gray[y * dstW + x] = (rgba[j] * 0.299 + rgba[j + 1] * 0.587 + rgba[j + 2] * 0.114 + 0.5) | 0
    }
  }
  return gray
}


export function computeAHash(rgba, width, height) {
  const size = 8
  const gray = _downsampleToGray(rgba, width, height, size, size)
  let sum = 0
  for (let i = 0; i < gray.length; i++) sum += gray[i]
  const avg = sum / gray.length
  let hex = '', nibble = 0
  for (let i = 0; i < gray.length; i++) {
    nibble = (nibble << 1) | (gray[i] > avg ? 1 : 0)
    if ((i & 3) === 3) { hex += nibble.toString(16); nibble = 0 }
  }
  return hex
}

export function computeDHash(rgba, width, height) {
  const dw = 9, dh = 8
  const gray = _downsampleToGray(rgba, width, height, dw, dh)
  let hex = '', nibble = 0, bit = 0
  for (let y = 0; y < dh; y++) {
    for (let x = 0; x < dw - 1; x++) {
      nibble = (nibble << 1) | (gray[y * dw + x + 1] > gray[y * dw + x] ? 1 : 0)
      if (++bit === 4) { hex += nibble.toString(16); nibble = 0; bit = 0 }
    }
  }
  return hex
}

export function hammingDistance(h1, h2) {
  if (typeof h1 !== 'string' || typeof h2 !== 'string' || h1.length !== h2.length) return -1
  let dist = 0
  for (let i = 0; i < h1.length; i++) {
    dist += POPCOUNT[parseInt(h1[i], 16) ^ parseInt(h2[i], 16)]
  }
  return dist
}

export async function loadImageDHash(url) {
  return new Promise((resolve) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      try {
        const w = img.naturalWidth, h = img.naturalHeight
        if (!w || !h) return resolve(null)
        const canvas = document.createElement('canvas')
        canvas.width = w
        canvas.height = h
        const ctx = canvas.getContext('2d')
        ctx.drawImage(img, 0, 0)
        const { data } = ctx.getImageData(0, 0, w, h)
        resolve(computeDHash(data, w, h))
      } catch { resolve(null) }
    }
    img.onerror = () => resolve(null)
    img.src = url
  })
}

export const SIMILAR_THRESHOLD = 5