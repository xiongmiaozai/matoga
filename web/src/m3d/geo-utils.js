/**
 * matoga - MC 模型：几何与格式工具
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 从 mc-model-viewer.js 按领域搬出（正文逐字未改）。
 * 职责：纹理旋转、格式探测、法线重建、源侧应用
 */

/* 主文件函数（注入） */
let _imgW = (...a) => undefined
let _imgH = (...a) => undefined

/* 模块状态：只读用 getter；可写用 get/set 成对（§2.2） */
let _get_labelRight = () => undefined
let _get_labelLeft = () => undefined
let _get_meshRight = () => undefined
let _get_meshLeft = () => undefined
let _get_initialized = () => undefined
let _get_customModelGroup = () => undefined
let _get_sourceSide = () => undefined

export function setHooks(h) {
  if (h.get_labelRight) _get_labelRight = h.get_labelRight
  if (h.get_labelLeft) _get_labelLeft = h.get_labelLeft
  if (h.get_meshRight) _get_meshRight = h.get_meshRight
  if (h.get_meshLeft) _get_meshLeft = h.get_meshLeft
  if (h.imgW) _imgW = h.imgW
  if (h.imgH) _imgH = h.imgH
  if (h.get_initialized) _get_initialized = h.get_initialized
  if (h.get_customModelGroup) _get_customModelGroup = h.get_customModelGroup
  if (h.get_sourceSide) _get_sourceSide = h.get_sourceSide
}

export function rotateTextureData(tex, angleDeg) {
  const img = tex && tex.image
  if (!img) return tex
  const src = img.data
  const srcW = img.width,
    srcH = img.height
  if (!src || !srcW || !srcH) return tex
  const n = ((angleDeg % 360) + 360) % 360
  const shift = Math.round((n / 360) * srcW)
  if (shift === 0 || shift === srcW) return tex
  const stride = src.length / (srcW * srcH)
  const newData = new src.constructor(src.length)
  newData.set(src)
  for (let y = 0; y < srcH; y++) {
    const rowStart = y * srcW * stride
    for (let x = 0; x < srcW; x++) {
      const dst = rowStart + x * stride
      const s = rowStart + ((x - shift + srcW * 100) % srcW) * stride
      newData[dst] = src[s]
      newData[dst + 1] = src[s + 1]
      newData[dst + 2] = src[s + 2]
      newData[dst + 3] = src[s + 3]
    }
  }
  const newTex = new THREE.DataTexture(newData, srcW, srcH)
  newTex.mapping = THREE.EquirectangularReflectionMapping
  newTex.type = tex.type
  newTex.colorSpace = tex.colorSpace
  newTex.flipY = tex.flipY
  newTex.needsUpdate = true
  return newTex
}

export function detectFormat(image) {
  const canvas = document.createElement('canvas')
  const w = Math.min(image.naturalWidth, 64),
    h = Math.min(image.naturalHeight, 64)
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  ctx.drawImage(image, 0, 0, w, h)
  const data = ctx.getImageData(0, 0, w, h).data
  const total = w * h
  let alphaNonFull = 0,
    alphaMidrange = 0
  let blueSum = 0,
    blueSumSq = 0
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3]
    if (a < 250) {
      alphaNonFull++
      if (a > 10 && a < 245) alphaMidrange++
    }
    const b = data[i + 2]
    blueSum += b
    blueSumSq += b * b
  }
  const alphaNonFullRatio = alphaNonFull / total
  const alphaMidRatio = alphaNonFull > 0 ? alphaMidrange / alphaNonFull : 0
  const blueMean = blueSum / total
  const blueVar = blueSumSq / total - blueMean * blueMean
  const blueStd = Math.sqrt(Math.max(0, blueVar))
  if ((alphaNonFullRatio > 0.02 && alphaMidRatio < 0.3) || (blueStd > 20 && blueMean > 25)) return 'labpbr'
  return 'old'
}

export function reconstructNormal(image) {
  const c = document.createElement('canvas')
  c.width = _imgW(image)
  c.height = _imgH(image)
  const ctx = c.getContext('2d', { willReadFrequently: true })
  ctx.drawImage(image, 0, 0)
  const imageData = ctx.getImageData(0, 0, c.width, c.height),
    d = imageData.data
  for (let i = 0; i < d.length; i += 4) {
    const nx = (d[i] / 255) * 2 - 1,
      ny = (d[i + 1] / 255) * 2 - 1
    const nz = Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny))
    d[i] = Math.round((nx + 1) * 127.5)
    d[i + 1] = Math.round((ny + 1) * 127.5)
    d[i + 2] = Math.round((nz + 1) * 127.5)
    d[i + 3] = 255
  }
  ctx.putImageData(imageData, 0, 0)
  const tex = new THREE.CanvasTexture(c)
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  return tex
}

export function applySourceSide() {
  if (!_get_initialized()) return
  if (_get_customModelGroup()) return

  if (_get_sourceSide() === 'dual') {
    _get_meshLeft().visible = true
    _get_meshRight().visible = true
    _get_meshLeft().position.x = -1.1
    _get_meshRight().position.x = 1.1
    _get_meshLeft().scale.setScalar(0.75)
    _get_meshRight().scale.setScalar(0.75)
    _get_labelLeft().visible = true
    _get_labelRight().visible = true
    _get_labelLeft().position.set(-1.1, -0.95, 0)
    _get_labelRight().position.set(1.1, -0.95, 0)
  } else if (_get_sourceSide() === 'left') {
    _get_meshLeft().visible = true
    _get_meshRight().visible = false
    _get_meshLeft().position.x = 0
    _get_meshLeft().scale.setScalar(1.0)
    _get_labelLeft().visible = false
    _get_labelRight().visible = false
  } else {
    _get_meshLeft().visible = false
    _get_meshRight().visible = true
    _get_meshRight().position.x = 0
    _get_meshRight().scale.setScalar(1.0)
    _get_labelLeft().visible = false
    _get_labelRight().visible = false
  }
}
