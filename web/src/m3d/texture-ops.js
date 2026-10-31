/**
 * matoga - MC 模型：贴图处理
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 从 mc-model-viewer.js 按领域搬出（正文逐字未改）。
 * 职责：通道提取、透明度模式、格式探测、纹理旋转、法线重建
 */

/* 主文件函数（注入） */
let _imgW = (...a) => undefined
let _imgH = (...a) => undefined

/* 模块状态：只读用 getter；可写用 get/set 成对（§2.2） */
let _get_opacityMode = () => undefined
let _get_transmissionValue = () => undefined
let _get_iorValue = () => undefined
let _get_opacityValue = () => undefined
let _get_alignOfficial = () => undefined
let _get_anisotropyLevel = () => undefined
let _get_maxAnisotropy = () => undefined
let _get_mipmapsEnabled = () => undefined
let _get_textureFilter = () => undefined

export function setHooks(h) {
  if (h.imgW) _imgW = h.imgW
  if (h.imgH) _imgH = h.imgH
  if (h.get_opacityMode) _get_opacityMode = h.get_opacityMode
  if (h.get_transmissionValue) _get_transmissionValue = h.get_transmissionValue
  if (h.get_iorValue) _get_iorValue = h.get_iorValue
  if (h.get_opacityValue) _get_opacityValue = h.get_opacityValue
  if (h.get_alignOfficial) _get_alignOfficial = h.get_alignOfficial
  if (h.get_anisotropyLevel) _get_anisotropyLevel = h.get_anisotropyLevel
  if (h.get_maxAnisotropy) _get_maxAnisotropy = h.get_maxAnisotropy
  if (h.get_mipmapsEnabled) _get_mipmapsEnabled = h.get_mipmapsEnabled
  if (h.get_textureFilter) _get_textureFilter = h.get_textureFilter
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

export function extractEmissive(specImage, mainImage) {
  const w = specImage.naturalWidth,
    h = specImage.naturalHeight
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const ctx = c.getContext('2d', { willReadFrequently: true })
  ctx.drawImage(specImage, 0, 0)
  const specData = ctx.getImageData(0, 0, w, h).data
  let mainData = null
  if (mainImage) {
    const mc = document.createElement('canvas')
    mc.width = w
    mc.height = h
    const mctx = mc.getContext('2d', { willReadFrequently: true })
    mctx.drawImage(mainImage, 0, 0, w, h)
    mainData = mctx.getImageData(0, 0, w, h).data
  }
  const imageData = ctx.createImageData(w, h),
    d = imageData.data
  for (let i = 0; i < d.length; i += 4) {
    let a = specData[i + 3]
    if (a === 255) a = 0
    const mask = a / 254
    if (mainData) {
      d[i] = Math.round(mainData[i] * mask)
      d[i + 1] = Math.round(mainData[i + 1] * mask)
      d[i + 2] = Math.round(mainData[i + 2] * mask)
    } else {
      d[i] = d[i + 1] = d[i + 2] = Math.round(255 * mask)
    }
    d[i + 3] = 255
  }
  ctx.putImageData(imageData, 0, 0)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  return tex
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

export function applyOpacityMode(material) {
  const hasAlpha = material.userData.hasAlpha || false
  const hasSemiTrans = material.userData.hasSemiTrans || false
  const mode = _get_opacityMode()
  if (mode === 'cutout') {
    material.transparent = false
    material.alphaTest = hasAlpha ? 0.5 : 0
    material.transmission = 0
  } else if (mode === 'blend') {
    material.transparent = hasAlpha
    material.alphaTest = 0
    material.transmission = 0
  } else if (mode === 'glass') {
    material.transparent = true
    material.alphaTest = 0
    material.transmission = _get_transmissionValue()
    material.ior = _get_iorValue()
    material.thickness = 0.5
  } else {
    if (hasSemiTrans) {
      material.transparent = true
      material.alphaTest = 0
    } else if (hasAlpha) {
      material.transparent = false
      material.alphaTest = 0.5
    } else {
      material.transparent = false
      material.alphaTest = 0
    }
    material.transmission = 0
  }
  if (_get_opacityValue() < 1.0) {
    material.transparent = true
    material.opacity = _get_opacityValue()
  } else {
    material.opacity = 1.0
  }
  material.needsUpdate = true
}

export function applyTextureFilter(tex) {
  if (!tex) return
  if (_get_alignOfficial()) {
    tex.generateMipmaps = true
    tex.magFilter = THREE.NearestFilter
    tex.minFilter = THREE.NearestMipmapLinearFilter
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping
    tex.anisotropy = Math.min(_get_anisotropyLevel(), _get_maxAnisotropy())
    tex.needsUpdate = true
    return
  }
  const useMipmap =
    _get_mipmapsEnabled() && (_get_textureFilter() === 'trilinear' || _get_textureFilter() === 'anisotropic')
  tex.generateMipmaps = useMipmap
  if (_get_textureFilter() === 'nearest') {
    tex.magFilter = THREE.NearestFilter
    tex.minFilter = useMipmap ? THREE.NearestMipmapNearestFilter : THREE.NearestFilter
  } else {
    tex.magFilter = THREE.LinearFilter
    tex.minFilter = useMipmap ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter
  }
  tex.anisotropy =
    _get_textureFilter() === 'anisotropic' && useMipmap ? Math.min(_get_anisotropyLevel(), _get_maxAnisotropy()) : 1
  tex.needsUpdate = true
}
