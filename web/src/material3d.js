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

// 公共门面：子模块的导出在此重新导出，保持既有导入路径（'./material3d.js'）可用
export { activateMaterial3DHost, registerMaterial3DHost } from './m3d/host.js'
export { showCustomModel, showCustomModelPair, clearCustomModel, isCustomModelActive } from './m3d/custom-model.js'
export { applyPbrMapsToModelMaterial, applyNodePBR, applyNodePBRSide, getMaterial3DInfo } from './m3d/pbr.js'
export { applyTexturesToMesh, setMainTextureFromUrl, setNormalMapFromUrl, clearMainTexture, clearNormalMap, setSpecularFromUrl, clearSpecularTexture, setBaseColor, setEmissiveColor } from './m3d/textures.js'
export { loadHDREnv, clearHDREnv, setHdrRotation, setHdrUsage, getHdrInfo } from './m3d/hdr.js'
export { screenshot, toggleFullscreen } from './m3d/screenshot.js'
export { setGeometry, setMetalness, setRoughness, setNormalScale, setEmissiveIntensity, setMaterialFormat, setFormatDetectCallback, setHeightDetectCallback, setSourceSide, setParallaxScale, setParallaxSteps, setParallaxMode, setParallaxAdaptive, setParallaxEnabled, setParallaxShadow, setLightPreset, getCustomLightConfig, applyCustomLightConfigExport, setEnvIntensity, setExposure, toggleGround, setAutoRotate, isFreeCameraMode, setFreeCameraMode, setWireframe, setOpacityMode, setOpacity, setTransmission, setIOR, setClearcoat, setTextureFilter, setMipmapsEnabled, setAnisotropyLevel, setAlignOfficial, getMaxAnisotropy, getCurrentLightPreset, getCurrentEnvMode, setEnvModeExport, setSkyTurbidity, setSkyRayleigh, setSkyMieCoefficient, setSkyMieDirectionalG, setSkySunElevation, setSkySunAzimuth, setSkyTint, updateMaterial3D, clearMaterial3D, hasVisibleViewport, isMaterial3DReady, disposeMaterial3D } from './m3d/api.js'

