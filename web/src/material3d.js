/**
 * matoga - 材质贴图对比工具
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 */

import * as THREE from 'three'
import { S, FLY_KEYS, FLY_SPEED, FLY_BOOST } from './m3d/state.js'
import { fileUrl, isImageFile } from './utils.js'
import { HDRLoader } from './hdr-loader.js'
import { loadEnvTexture, extFromUrl } from './hdr-env-loader.js'
import { Sky } from './sky.js'
import { t as _t } from './i18n.js'




import { geometries } from './m3d/geometry.js'
import { applyHeightFilter, detectFormat, extractChannel, extractEmissive, extractHeight, extractHeightFromNormal, extractMetalness, extractRoughness, imgH, imgW, reconstructNormal } from './m3d/texture-extract.js'
import { hideLoading, setLoadingProgress, showLoading } from './m3d/loading.js'
import { LIGHT_PRESETS, applyCustomLightConfig, applyLightPreset, cloneLightConfig } from './m3d/lighting.js'
import { applyHDREnvMode, ensureRotatedTexture, scheduleSkyBake, setEnvMode, updateSkySunPosition } from './m3d/sky.js'
import { findVisibleHost, isHostVisible, moveViewportWidgets, refreshHostHints, registerMaterial3DHost, setContainer } from './m3d/host.js'
import { applyFilterToAllTextures, applyOpacityMode, applyTextureFilter, createLabel, makeMaterial } from './m3d/material.js'
import { animate, handleResize, lookAtOrigin, setupControls } from './m3d/controls.js'
import { clamp01, disposeAllMaterialTextures, disposeGroupDeep, disposeTexture } from './m3d/dispose-utils.js'
import { applySourceSide, applyTexturesToMesh } from './m3d/textures.js'
import { clearCustomModel } from './m3d/custom-model.js'
export function initMaterial3D(containerEl) {
  registerMaterial3DHost(containerEl)
  if (S.initialized) {
    if (containerEl !== S.container) {
      const target = isHostVisible(containerEl) ? containerEl : (findVisibleHost() || containerEl)
      setContainer(target)
    } else { refreshHostHints() }
    return
  }
  S.container = isHostVisible(containerEl) ? containerEl : (findVisibleHost() || containerEl)
  const width = S.container.clientWidth || 300, height = S.container.clientHeight || 200
  S.scene = new THREE.Scene(); S.scene.background = new THREE.Color(LIGHT_PRESETS.studio.bg)
  S.camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 100); S.camera.position.set(0, 0.5, S.camDist)
  S.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
  S.isWebGL2 = S.renderer.capabilities.isWebGL2
  S.maxAnisotropy = S.renderer.capabilities.getMaxAnisotropy() || 1
  S.renderer.setSize(width, height); S.renderer.setPixelRatio(window.devicePixelRatio)
  S.renderer.toneMapping = THREE.ACESFilmicToneMapping; S.renderer.toneMappingExposure = 2.2
  S.renderer.shadowMap.enabled = true; S.renderer.shadowMap.type = THREE.PCFShadowMap
  S.container.appendChild(S.renderer.domElement)
  S.pmrem = new THREE.PMREMGenerator(S.renderer)
  S.lightGroup = new THREE.Group(); S.scene.add(S.lightGroup)
  const geo = geometries[S.currentGeo]()
  S.meshLeft = new THREE.Mesh(geo, makeMaterial()); S.meshLeft.castShadow = true; S.meshLeft.receiveShadow = true; S.scene.add(S.meshLeft)
  S.meshRight = new THREE.Mesh(geo.clone(), makeMaterial()); S.meshRight.castShadow = true; S.meshRight.receiveShadow = true; S.scene.add(S.meshRight)
  S.labelLeft = createLabel(_t('common.left'), '#2b6cff'); S.labelRight = createLabel(_t('common.right'), '#d97706')
  S.scene.add(S.labelLeft); S.scene.add(S.labelRight)
  const groundGeo = new THREE.PlaneGeometry(8, 8)
  const groundMat = new THREE.MeshStandardMaterial({ color: 0x2a2a3e, roughness: 0.8, metalness: 0.0 })
  S.groundMesh = new THREE.Mesh(groundGeo, groundMat); S.groundMesh.rotation.x = -Math.PI / 2; S.groundMesh.position.y = -1.3; S.groundMesh.receiveShadow = true; S.groundMesh.visible = S.groundVisible; S.scene.add(S.groundMesh)
  S.gridHelper = new THREE.GridHelper(8, 32, 0x444466, 0x222244)
  S.gridHelper.position.y = -1.29; S.gridHelper.material.transparent = true; S.gridHelper.material.opacity = 0.3; S.gridHelper.visible = S.groundVisible; S.scene.add(S.gridHelper)
  setupControls()
  if (S.containerResizeObserver) S.containerResizeObserver.disconnect()
  S.containerResizeObserver = new ResizeObserver(handleResize)
  for (const h of S.hosts) S.containerResizeObserver.observe(h)
  S.lastFrameTime = performance.now()
  animate(); S.initialized = true
  moveViewportWidgets(S.container)
  refreshHostHints()
  applyLightPreset('studio')
  applySourceSide()
  document.dispatchEvent(new CustomEvent('material3d:ready'))
}

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
export function screenshot() {
  if (!S.initialized || !S.renderer) return
  S.renderer.render(S.scene, S.camera)
  const url = S.renderer.domElement.toDataURL('image/png')
  const a = document.createElement('a')
  a.href = url; a.download = `material3d_${Date.now()}.png`
  document.body.appendChild(a); a.click(); document.body.removeChild(a)
}
export function toggleFullscreen() {
  if (!S.container) return
  S.container.classList.toggle('fullscreen')
  setTimeout(handleResize, 50)
}
export async function loadHDREnv(filePath) {
  if (!S.initialized || !filePath) return
  try {
    const tex = await loadEnvTexture(filePath, extFromUrl(filePath))
    tex.mapping = THREE.EquirectangularReflectionMapping
    if (S.hdrTextureOriginal) { S.hdrTextureOriginal.dispose(); S.hdrTextureOriginal = null }
    if (S.hdrTextureRotated) { S.hdrTextureRotated.dispose(); S.hdrTextureRotated = null }

    if (S.envTexture) { S.envTexture.dispose(); S.envTexture = null }
    S.hdrTextureOriginal = tex
    S.hdrTexture = tex
    S.hdrInfo = {
      width: tex.image.width || 0,
      height: tex.image.height || 0,
      format: tex._srcFormat || 'HDR (RGBE)',
      size: tex.image.data ? tex.image.data.byteLength : 0
    }
    ensureRotatedTexture()
    S.currentEnvMode = 'hdri'
    applyHDREnvMode()
    window.dispatchEvent(new CustomEvent('material3d:hdrLoaded', { detail: S.hdrInfo }))
  } catch (e) {
    window.dispatchEvent(new CustomEvent('material3d:hdrLoadFailed', { detail: { message: e.message } }))
  }
}
export function clearHDREnv() {
  if (S.hdrTextureOriginal) { S.hdrTextureOriginal.dispose(); S.hdrTextureOriginal = null }
  if (S.hdrTextureRotated) { S.hdrTextureRotated.dispose(); S.hdrTextureRotated = null }

  S.hdrTexture = null
  S.hdrInfo = null
  if (S.scene) S.scene.environmentRotation.set(0, 0, 0)
  if (S.currentEnvMode === 'hdri') setEnvMode('custom')
  else applyHDREnvMode()
}
export function getCurrentLightPreset() { return S.currentLightPreset }
export function getCurrentEnvMode() { return S.currentEnvMode }
export function setEnvModeExport(mode) { setEnvMode(mode) }
export function setHdrRotation(val) {
  S.hdrRotation = val
  if (S.hdrRotateTimer) clearTimeout(S.hdrRotateTimer)
  S.hdrRotateTimer = setTimeout(() => {
    S.hdrRotateTimer = null
    if (S.initialized && S.currentEnvMode === 'hdri') {
      ensureRotatedTexture()
      applyHDREnvMode()
    }
  }, 30)
}

export function setHdrUsage(mode) { if (!['both', 'env', 'bg'].includes(mode)) return; S.hdrUsage = mode; if (S.initialized && S.currentEnvMode === 'hdri') applyHDREnvMode() }
export function getHdrInfo() { return S.hdrInfo }
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
// 兼容既有导入路径：这两个导出已迁至 ./m3d/host.js
export { activateMaterial3DHost, registerMaterial3DHost } from './m3d/host.js'

export { showCustomModel, showCustomModelPair, clearCustomModel, isCustomModelActive } from './m3d/custom-model.js'
export { applyPbrMapsToModelMaterial, applyNodePBR, applyNodePBRSide, getMaterial3DInfo } from './m3d/pbr.js'
export { applyTexturesToMesh, setMainTextureFromUrl, setNormalMapFromUrl, clearMainTexture, clearNormalMap, setSpecularFromUrl, clearSpecularTexture, setBaseColor, setEmissiveColor } from './m3d/textures.js'

