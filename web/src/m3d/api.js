/**
 * matoga - 材质 3D 视口：api
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 从 material3d.js 原样搬出，逻辑未改。
 */
import { S, FLY_KEYS, FLY_SPEED, FLY_BOOST } from './state.js'
import { geometries } from './geometry.js'
import { LIGHT_PRESETS, applyCustomLightConfig, applyLightPreset, cloneLightConfig } from './lighting.js'
import { applyHDREnvMode, ensureRotatedTexture, scheduleSkyBake, setEnvMode, updateSkySunPosition } from './sky.js'
import { findVisibleHost, isHostVisible, moveViewportWidgets, refreshHostHints, registerMaterial3DHost, setContainer } from './host.js'
import { applyFilterToAllTextures, applyOpacityMode, applyTextureFilter, createLabel, makeMaterial } from './material.js'
import { animate, handleResize, lookAtOrigin, setupControls } from './controls.js'
import { clamp01, disposeAllMaterialTextures, disposeGroupDeep, disposeTexture } from './dispose-utils.js'
import { applySourceSide, applyTexturesToMesh } from './textures.js'
import { clearCustomModel } from './custom-model.js'

export function setGeometry(geoType) {
  if (!S.initialized || !geometries[geoType]) return
  clearCustomModel()
  S.currentGeo = geoType; S.meshLeft.geometry.dispose(); S.meshRight.geometry.dispose()
  S.meshLeft.geometry = geometries[geoType](); S.meshRight.geometry = geometries[geoType]()
}
export function setMetalness(val) { if (S.initialized) { S.meshLeft.material.metalness = val; S.meshRight.material.metalness = val } }
export function setRoughness(val) { if (S.initialized) { S.meshLeft.material.roughness = val; S.meshRight.material.roughness = val } }
export function setNormalScale(val) { S.normalScale = val; if (S.initialized) { S.meshLeft.material.normalScale.set(val, val); S.meshRight.material.normalScale.set(val, val) } }
export function setEmissiveIntensity(val) { S.emissiveIntensity = val; if (S.initialized) { S.meshLeft.material.emissiveIntensity = val; S.meshRight.material.emissiveIntensity = val } }
export function setMaterialFormat(fmt) { S.materialFormat = fmt }
export function setFormatDetectCallback(cb) { S.formatDetectCallback = cb }
export function setHeightDetectCallback(cb) { S.heightDetectCallback = cb }
export function setSourceSide(side) { S.sourceSide = side; applySourceSide() }
export function setParallaxScale(val) { S.parallaxScale = val; if (S.initialized) { for (const m of [S.meshLeft, S.meshRight]) { if (m && m.material && m.material.userData.shaderRefs) m.material.userData.shaderRefs.parallaxScale.value = val } } }
export function setParallaxSteps(val) { S.parallaxSteps = val; if (S.initialized) { for (const m of [S.meshLeft, S.meshRight]) { if (m && m.material && m.material.userData.shaderRefs) m.material.userData.shaderRefs.parallaxSteps.value = val } } }
export function setParallaxMode(val) { S.parallaxMode = val; if (S.initialized) { for (const m of [S.meshLeft, S.meshRight]) { if (m && m.material && m.material.userData.shaderRefs) m.material.userData.shaderRefs.parallaxMode.value = val } } }
export function setParallaxAdaptive(val) { S.parallaxAdaptive = val; if (S.initialized) { for (const m of [S.meshLeft, S.meshRight]) { if (m && m.material && m.material.userData.shaderRefs) m.material.userData.shaderRefs.parallaxAdaptive.value = val } } }
export function setParallaxEnabled(on) { S.parallaxEnabled = on; if (S.initialized) { for (const m of [S.meshLeft, S.meshRight]) { if (m && m.material && m.material.userData.shaderRefs) { const ht = m.material.userData.shaderRefs.heightMap.value; m.material.userData.shaderRefs.hasHeightMap.value = (ht && on) ? 1.0 : 0.0; if (ht) { ht.needsUpdate = true; m.material.needsUpdate = true } } } } }
export function setParallaxShadow(val) { S.parallaxShadow = val; if (S.initialized) { for (const m of [S.meshLeft, S.meshRight]) { if (m && m.material && m.material.userData.shaderRefs) m.material.userData.shaderRefs.parallaxShadow.value = val } } }
export function setLightPreset(presetKey) { applyLightPreset(presetKey); if (S.currentEnvMode !== 'custom') setEnvMode('custom') }
export function getCustomLightConfig() { return S.customLightConfig ? cloneLightConfig(S.customLightConfig) : null }
export function applyCustomLightConfigExport(config) { if (S.currentEnvMode !== 'custom') setEnvMode('custom'); applyCustomLightConfig(config) }
export function setEnvIntensity(val) { S.envIntensity = val; if (S.initialized) { if (S.scene) S.scene.environmentIntensity = val; for (const m of [S.meshLeft, S.meshRight]) { if (m) m.material.envMapIntensity = val } } }
export function setExposure(val) { if (S.initialized && S.renderer) S.renderer.toneMappingExposure = val }
export function toggleGround(visible) { S.groundVisible = visible; if (S.initialized) { if (S.groundMesh) S.groundMesh.visible = visible; if (S.gridHelper) S.gridHelper.visible = visible } }
export function setAutoRotate(on) { S.autoRotate = on }
export function isFreeCameraMode() { return S.freeCamMode }
export function setFreeCameraMode(on) {
  if (!S.initialized) return
  on = !!on
  if (S.freeCamMode === on) return
  S.freeCamMode = on
  if (S.freeCamMode) {
    S.flyPos.copy(S.camera.position)
    lookAtOrigin()
    S.camera.rotation.order = 'YXZ'
    S.autoRotate = false
    for (const k in S.flyKeys) delete S.flyKeys[k]
    S.renderer.domElement.style.cursor = 'crosshair'
  } else {
    S.camPanX = 0; S.camPanY = 0; S.targetPanX = 0; S.targetPanY = 0
    S.camera.rotation.set(0, 0, 0)
    S.renderer.domElement.style.cursor = 'grab'
  }
  document.dispatchEvent(new CustomEvent('material3d:freecam', { detail: { enabled: S.freeCamMode } }))
}
export function setWireframe(on) { if (S.initialized) { S.meshLeft.material.wireframe = on; S.meshRight.material.wireframe = on } }
export function setOpacityMode(mode) { S.opacityMode = mode; if (S.initialized) { for (const m of [S.meshLeft, S.meshRight]) { if (m) applyOpacityMode(m.material) } } }
export function setOpacity(val) { S.opacityValue = val; if (S.initialized) { for (const m of [S.meshLeft, S.meshRight]) { if (m) applyOpacityMode(m.material) } } }
export function setTransmission(val) { S.transmissionValue = val; if (S.initialized) { for (const m of [S.meshLeft, S.meshRight]) { if (m) { m.material.transmission = val; if (val > 0) { m.material.transparent = true; m.material.alphaTest = 0 } m.material.needsUpdate = true } } } }
export function setIOR(val) { S.iorValue = val; if (S.initialized) { for (const m of [S.meshLeft, S.meshRight]) { if (m) m.material.ior = val } } }
export function setClearcoat(val) { S.clearcoatValue = val; if (S.initialized) { for (const m of [S.meshLeft, S.meshRight]) { if (m) m.material.clearcoat = val } } }
export function setTextureFilter(mode) { S.textureFilter = mode; applyFilterToAllTextures() }
export function setMipmapsEnabled(on) { S.mipmapsEnabled = on; applyFilterToAllTextures() }
export function setAnisotropyLevel(val) { S.anisotropyLevel = Math.max(1, Math.round(val)); applyFilterToAllTextures() }
export function setAlignOfficial(val) { S.alignOfficial = !!val; applyFilterToAllTextures() }
export function getMaxAnisotropy() { return S.maxAnisotropy }

export function getCurrentLightPreset() { return S.currentLightPreset }
export function getCurrentEnvMode() { return S.currentEnvMode }
export function setEnvModeExport(mode) { setEnvMode(mode) }

export function setSkyTurbidity(val) { S.skyTurbidity = val; if (S.initialized && S.currentEnvMode === 'sky') { updateSkySunPosition(); scheduleSkyBake() } }
export function setSkyRayleigh(val) { S.skyRayleigh = val; if (S.initialized && S.currentEnvMode === 'sky') { updateSkySunPosition(); scheduleSkyBake() } }
export function setSkyMieCoefficient(val) { S.skyMieCoefficient = val; if (S.initialized && S.currentEnvMode === 'sky') { updateSkySunPosition(); scheduleSkyBake() } }
export function setSkyMieDirectionalG(val) { S.skyMieDirectionalG = val; if (S.initialized && S.currentEnvMode === 'sky') { updateSkySunPosition(); scheduleSkyBake() } }
export function setSkySunElevation(val) { S.skySunElevation = val; if (S.initialized && S.currentEnvMode === 'sky') { updateSkySunPosition(); scheduleSkyBake() } }
export function setSkySunAzimuth(val) { S.skySunAzimuth = val; if (S.initialized && S.currentEnvMode === 'sky') { updateSkySunPosition(); scheduleSkyBake() } }

export function setSkyTint(hex) { const n = parseInt(hex.slice(1), 16); if (Number.isNaN(n)) return; S.skyTintHex = n; if (S.initialized && S.currentEnvMode === 'sky') { updateSkySunPosition(); scheduleSkyBake() } }

export function updateMaterial3D(group) {
  if (!S.initialized) return
  if (group) clearCustomModel()
  if (!group && S.heightDetectCallback) S.heightDetectCallback(false)
  applyTexturesToMesh(S.meshLeft, group, 'left')
  applyTexturesToMesh(S.meshRight, group, 'right')
}

export function clearMaterial3D() { updateMaterial3D(null) }

/* ── 自定义模型（MC .json / .bbmodel）：3D 视口渲染通道 ──────────
   group 的内容需以自身原点为几何中心（缩放适配与贴地由本函数完成），
   wrapper 原点保持在模型中心，旋转（拖拽/自动旋转）围绕中心进行。 */
export function hasVisibleViewport() {
  if (!S.initialized) return false
  return !!findVisibleHost()
}

export function isMaterial3DReady() { return S.initialized }
export function disposeMaterial3D() {
  if (S.animationId) cancelAnimationFrame(S.animationId)
  if (S.skyBakeTimer) { clearTimeout(S.skyBakeTimer); S.skyBakeTimer = null }
  if (S.hdrRotateTimer) { clearTimeout(S.hdrRotateTimer); S.hdrRotateTimer = null }
  if (S.customModelGroup) { S.scene.remove(S.customModelGroup); disposeGroupDeep(S.customModelGroup); S.customModelGroup = null }
  for (const m of [S.meshLeft, S.meshRight]) { if (m) { if (m.material) { disposeAllMaterialTextures(m.material); m.material.dispose() }; if (m.geometry) m.geometry.dispose() } }
  if (S.groundMesh) { S.groundMesh.geometry.dispose(); S.groundMesh.material.dispose() }
  if (S.gridHelper) { S.gridHelper.geometry.dispose(); S.gridHelper.material.dispose() }
  if (S.envTexture) S.envTexture.dispose()
  if (S.pmremTexture) S.pmremTexture.dispose()
  if (S.hdrTextureOriginal) S.hdrTextureOriginal.dispose()
  if (S.hdrTextureRotated) S.hdrTextureRotated.dispose()
  if (S.skyEnvTexture) S.skyEnvTexture.dispose()
  if (S.skyMesh) { S.skyMesh.geometry.dispose(); S.skyMesh.material.dispose(); S.skyMesh = null }
  if (S.pmrem) S.pmrem.dispose(); if (S.renderer) S.renderer.dispose()
  S.initialized = false
}

