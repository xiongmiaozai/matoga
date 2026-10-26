/**
 * matoga - 材质 3D 视口：sky
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 从 material3d.js 原样搬出，逻辑未改。
 */
import { S, FLY_KEYS, FLY_SPEED, FLY_BOOST } from './state.js'
import { Sky } from '../sky.js'
import { applyLightPreset } from './lighting.js'

export function updateSkySunPosition() {
  if (!S.skyMesh) return
  const u = S.skyMesh.material.uniforms
  const elevation = S.skySunElevation * Math.PI / 180
  const azimuth = S.skySunAzimuth * Math.PI / 180
  const phi = Math.PI / 2 - elevation
  const sun = new THREE.Vector3()
  sun.setFromSphericalCoords(1, phi, azimuth)
  u.sunPosition.value.copy(sun)
  u.turbidity.value = S.skyTurbidity
  u.rayleigh.value = S.skyRayleigh
  u.mieCoefficient.value = S.skyMieCoefficient
  u.mieDirectionalG.value = S.skyMieDirectionalG

  S._skyTint.setHex(S.skyTintHex)
  u.skyTint.value.set(S._skyTint.r, S._skyTint.g, S._skyTint.b)
  if (S.skySunLight) {
    S.skySunLight.position.copy(sun).multiplyScalar(10)
    const dayFactor = Math.max(0, Math.sin(elevation))
    S.skySunLight.intensity = 2.5 * dayFactor
  }
}

export function bakeSkyEnvironment() {
  if (!S.skyMesh || !S.pmrem) return
  const u = S.skyMesh.material.uniforms
  const prevSunDisc = u.showSunDisc.value
  u.showSunDisc.value = 0
  const skyScene = new THREE.Scene()
  S.scene.remove(S.skyMesh)
  skyScene.add(S.skyMesh)
  if (S.skyEnvTexture) S.skyEnvTexture.dispose()
  S.skyEnvTexture = S.pmrem.fromScene(skyScene)
  S.scene.environment = S.skyEnvTexture.texture
  skyScene.remove(S.skyMesh)
  S.scene.add(S.skyMesh)
  u.showSunDisc.value = prevSunDisc
  if (S.scene) S.scene.environmentIntensity = S.envIntensity; for (const m of [S.meshLeft, S.meshRight]) { if (m) m.material.envMapIntensity = S.envIntensity }
}

export function scheduleSkyBake() {
  clearTimeout(S.skyBakeTimer)
  S.skyBakeTimer = setTimeout(() => {
    S.skyBakeTimer = null
    if (S.initialized && S.currentEnvMode === 'sky') bakeSkyEnvironment()
  }, 120)
}

export function applyProceduralSky() {
  if (!S.initialized) return
  if (S.hdrTexture) { S.hdrTexture.dispose(); S.hdrTexture = null }
  if (S.envTexture) { S.envTexture.dispose(); S.envTexture = null }
  if (S.pmremTexture) { S.pmremTexture.dispose(); S.pmremTexture = null }
  if (S.lightGroup) { while (S.lightGroup.children.length) S.lightGroup.remove(S.lightGroup.children[0]) }
  const ambient = new THREE.AmbientLight(0xffffff, 0.15)
  S.lightGroup.add(ambient)
  if (!S.skySunLight) {
    S.skySunLight = new THREE.DirectionalLight(0xffffff, 2.5)
    S.skySunLight.castShadow = true
    S.skySunLight.shadow.mapSize.set(1024, 1024)
    S.skySunLight.shadow.camera.left = -3; S.skySunLight.shadow.camera.right = 3
    S.skySunLight.shadow.camera.top = 3; S.skySunLight.shadow.camera.bottom = -3
    S.skySunLight.shadow.camera.near = 0.1; S.skySunLight.shadow.camera.far = 50
  }
  S.lightGroup.add(S.skySunLight)
  if (!S.skyMesh) {
    S.skyMesh = new Sky()
    S.skyMesh.scale.setScalar(10000)
    S.scene.add(S.skyMesh)
  }
  updateSkySunPosition()
  S.scene.background = null
  bakeSkyEnvironment()
}

export function applyHDREnvMode() {
  if (!S.initialized) return
  if (S.skyMesh) { S.scene.remove(S.skyMesh); S.skyMesh = null }
  if (S.skyEnvTexture) { S.skyEnvTexture.dispose(); S.skyEnvTexture = null }
  if (S.skySunLight) { S.lightGroup.remove(S.skySunLight); S.skySunLight = null }
  if (S.envTexture) { S.envTexture.dispose(); S.envTexture = null }
  if (S.pmremTexture) { S.pmremTexture.dispose(); S.pmremTexture = null }
  if (S.lightGroup) { while (S.lightGroup.children.length) S.lightGroup.remove(S.lightGroup.children[0]) }
  const ambient = new THREE.AmbientLight(0xffffff, 0.1)
  S.lightGroup.add(ambient)
  if (S.scene) S.scene.environmentRotation.set(0, 0, 0)
  if (S.hdrTextureOriginal) {
    const src = S.hdrTextureRotated || S.hdrTextureOriginal
    S.hdrTexture = src
    if (S.hdrUsage === 'env' || S.hdrUsage === 'both') S.scene.environment = src
    else S.scene.environment = null
    if (S.hdrUsage === 'bg' || S.hdrUsage === 'both') {
      S.scene.background = src
    } else {
      S.scene.background = new THREE.Color(0x1a1a2e)
    }
  } else {
    S.hdrTexture = null
    S.scene.environment = null
    S.scene.background = new THREE.Color(0x1a1a2e)
  }
  if (S.scene) S.scene.environmentIntensity = S.envIntensity; for (const m of [S.meshLeft, S.meshRight]) { if (m) m.material.envMapIntensity = S.envIntensity }
}

export function ensureRotatedTexture() {
  if (S.hdrTextureRotated) { S.hdrTextureRotated.dispose(); S.hdrTextureRotated = null }
  if (S.hdrTextureOriginal && (S.hdrRotation % 360)) {
    S.hdrTextureRotated = rotateTextureData(S.hdrTextureOriginal, S.hdrRotation)
  }
}

export function rotateTextureData(tex, angleDeg) {
  const img = tex && tex.image
  if (!img) return tex
  const src = img.data
  const srcW = img.width, srcH = img.height
  if (!src || !srcW || !srcH) return tex
  const n = ((angleDeg % 360) + 360) % 360
  const shift = Math.round(n / 360 * srcW)
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


export function setEnvMode(mode) {
  if (!S.initialized || !['custom', 'sky', 'hdri'].includes(mode)) return
  S.currentEnvMode = mode
  if (mode === 'sky') {
    applyProceduralSky()
  } else if (mode === 'hdri') {
    applyHDREnvMode()
  } else {
    if (S.skyMesh) { S.scene.remove(S.skyMesh); S.skyMesh = null }
    if (S.skyEnvTexture) { S.skyEnvTexture.dispose(); S.skyEnvTexture = null }
    if (S.skySunLight) { S.lightGroup.remove(S.skySunLight); S.skySunLight = null }
    applyLightPreset(S.currentLightPreset)
  }
}

