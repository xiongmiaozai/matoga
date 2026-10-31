/**
 * matoga - MC 模型：材质滤镜与透明度
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 从 mc-model-viewer.js 按领域搬出（正文逐字未改）。
 * 职责：纹理采样过滤、透明度模式、标签精灵
 */
import * as THREE from 'three'

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
let _set_textureFilter = () => {}

export function setHooks(h) {
  if (h.get_opacityMode) _get_opacityMode = h.get_opacityMode
  if (h.get_transmissionValue) _get_transmissionValue = h.get_transmissionValue
  if (h.get_iorValue) _get_iorValue = h.get_iorValue
  if (h.get_opacityValue) _get_opacityValue = h.get_opacityValue
  if (h.get_alignOfficial) _get_alignOfficial = h.get_alignOfficial
  if (h.get_anisotropyLevel) _get_anisotropyLevel = h.get_anisotropyLevel
  if (h.get_maxAnisotropy) _get_maxAnisotropy = h.get_maxAnisotropy
  if (h.get_mipmapsEnabled) _get_mipmapsEnabled = h.get_mipmapsEnabled
  if (h.get_textureFilter) _get_textureFilter = h.get_textureFilter
  if (h.set_textureFilter) _set_textureFilter = h.set_textureFilter
}

export function createLabel(text, color) {
  const c = document.createElement('canvas')
  c.width = 128
  c.height = 32
  const ctx = c.getContext('2d', { willReadFrequently: true })
  ctx.fillStyle = color
  ctx.fillRect(0, 0, 128, 32)
  ctx.fillStyle = '#fff'
  ctx.font = 'bold 16px sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(text, 64, 16)
  const tex = new THREE.CanvasTexture(c)
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true })
  const sprite = new THREE.Sprite(mat)
  sprite.scale.set(0.6, 0.15, 1)
  return sprite
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

export function applyHeightFilter(tex) {
  if (!tex) return
  tex.generateMipmaps = true
  tex.magFilter = THREE.LinearFilter
  tex.minFilter = THREE.LinearMipmapLinearFilter
  tex.anisotropy = 1
  tex.needsUpdate = true
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
