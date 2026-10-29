/**
 * matoga - 材质 3D 视口：pbr
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 从 material3d.js 原样搬出，逻辑未改。
 */

import * as THREE from 'three'

import { S, FLY_KEYS, FLY_SPEED, FLY_BOOST } from './state.js'
import { applyHeightFilter, detectFormat, extractChannel, extractEmissive, extractHeight, extractHeightFromNormal, extractMetalness, extractRoughness, imgH, imgW, reconstructNormal } from './texture-extract.js'
import { applyFilterToAllTextures, applyOpacityMode, applyTextureFilter, createLabel, makeMaterial } from './material.js'
import { clamp01, disposeAllMaterialTextures, disposeGroupDeep, disposeTexture } from './dispose-utils.js'
import { clearCustomModel } from './custom-model.js'
import { applySpecTextureToMaterial, clearMainTexture, clearNormalMap, clearSpecTexture, clearSpecularTexture, setBaseColor, setEmissiveColor, setMainTextureFromUrl, setNormalMapFromUrl, setSpecularFromUrl } from './textures.js'
import { setEnvIntensity, setExposure, setGeometry, setLightPreset, setMetalness, setNormalScale, setOpacity, setRoughness } from '../material3d.js'

/* force=true 跳过 replaced 守卫（编辑器替换主图后强制覆盖旧 PBR；模型加载流程保持 replaced 守卫阻断竞态） */
export function applyPbrMapsToModelMaterial(mat, normalUrl, specUrl, force) {
  if (!mat) return
  const blocked = () => !force && mat.userData && mat.userData.replaced
  if (normalUrl) {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      if (blocked()) return
      disposeTexture(mat.normalMap)
      const nTex = reconstructNormal(img)
      nTex.magFilter = THREE.NearestFilter; nTex.minFilter = THREE.NearestFilter
      mat.normalMap = nTex
      if (mat.normalScale) mat.normalScale.set(1.0, 1.0)
      mat.needsUpdate = true
    }
    img.src = normalUrl
  }
  if (specUrl) {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      if (blocked()) return
      disposeTexture(mat.roughnessMap); disposeTexture(mat.metalnessMap)
      const rTex = extractRoughness(img)
      const mTex = extractMetalness(img)
      rTex.magFilter = THREE.NearestFilter; rTex.minFilter = THREE.NearestFilter
      mTex.magFilter = THREE.NearestFilter; mTex.minFilter = THREE.NearestFilter
      mat.roughnessMap = rTex
      mat.metalnessMap = mTex
      mat.needsUpdate = true
    }
    img.src = specUrl
  }
}
export function applyNodePBR(p) {
  if (!S.initialized || !p) return
  if (p.mainTextureUrl) clearCustomModel()
  if (p.baseColor) setBaseColor(p.baseColor)
  if (typeof p.roughness === 'number') setRoughness(clamp01(p.roughness))
  if (typeof p.metallic === 'number') setMetalness(clamp01(p.metallic))
  if (typeof p.normalScale === 'number') setNormalScale(p.normalScale)
  if (typeof p.envIntensity === 'number') setEnvIntensity(p.envIntensity)
  if (typeof p.exposure === 'number') setExposure(p.exposure)
  if (typeof p.opacity === 'number') setOpacity(p.opacity)
  if (p.emissive) setEmissiveColor(p.emissive)
  if (p.mainTextureUrl) setMainTextureFromUrl(p.mainTextureUrl)
  else if (p.mainTextureUrl === null) clearMainTexture()
  if (p.normalMapUrl) setNormalMapFromUrl(p.normalMapUrl)
  else if (p.normalMapUrl === null) clearNormalMap()
  if (p.specTextureUrl) setSpecularFromUrl(p.specTextureUrl)
  else if (p.specTextureUrl === null) clearSpecularTexture()
  if (p.lightPreset) setLightPreset(p.lightPreset)
  if (p.geometry) setGeometry(p.geometry)
}
export function applyNodePBRSide(p, side) {
  if (!S.initialized || !p) return
  if (p.mainTextureUrl) clearCustomModel()
  const mesh = side === 'left' ? S.meshLeft : S.meshRight
  if (!mesh) return
  const mat = mesh.material
  if (p.baseColor && Array.isArray(p.baseColor)) {
    mat.color.setRGB(clamp01(p.baseColor[0]), clamp01(p.baseColor[1]), clamp01(p.baseColor[2])); mat.needsUpdate = true
  }
  if (typeof p.roughness === 'number') mat.roughness = clamp01(p.roughness)
  if (typeof p.metallic === 'number') mat.metalness = clamp01(p.metallic)
  if (typeof p.normalScale === 'number') mat.normalScale.set(p.normalScale, p.normalScale)
  if (typeof p.opacity === 'number') { S.opacityValue = p.opacity; applyOpacityMode(mat) }
  if (p.emissive && Array.isArray(p.emissive)) {
    mat.emissive.setRGB(clamp01(p.emissive[0]), clamp01(p.emissive[1]), clamp01(p.emissive[2])); mat.needsUpdate = true
  }
  if (p.mainTextureUrl) {
    const loader = new THREE.TextureLoader()
    loader.load(p.mainTextureUrl, (tex) => {
      tex.colorSpace = THREE.SRGBColorSpace; tex.wrapS = tex.wrapT = THREE.RepeatWrapping
      disposeTexture(mat.map); mat.map = tex; applyTextureFilter(tex); mat.needsUpdate = true
    })
  } else if (p.mainTextureUrl === null) { disposeTexture(mat.map); mat.map = null; mat.needsUpdate = true }
  if (p.normalMapUrl) {
    const loader = new THREE.TextureLoader()
    loader.load(p.normalMapUrl, (tex) => {
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping
      disposeTexture(mat.normalMap); mat.normalMap = tex; mat.normalScale.set(S.normalScale, S.normalScale); applyTextureFilter(tex); mat.needsUpdate = true
    })
  } else if (p.normalMapUrl === null) { disposeTexture(mat.normalMap); mat.normalMap = null; mat.needsUpdate = true }
  if (p.specTextureUrl) {
    applySpecTextureToMaterial(mat, p.specTextureUrl)
  } else if (p.specTextureUrl === null) { clearSpecTexture(mat) }
  if (typeof p.envIntensity === 'number') setEnvIntensity(p.envIntensity)
  if (typeof p.exposure === 'number') setExposure(p.exposure)
  if (p.lightPreset) setLightPreset(p.lightPreset)
  if (p.geometry) setGeometry(p.geometry)
}
export function getMaterial3DInfo() {
  if (!S.initialized) return null
  const m = S.meshLeft.material
  return {
    color: [m.color.r, m.color.g, m.color.b],
    roughness: m.roughness, metalness: m.metalness,
    normalScale: S.normalScale, emissiveIntensity: S.emissiveIntensity, envIntensity: S.envIntensity,
    hasMap: !!m.map, hasNormalMap: !!m.normalMap
  }
}

