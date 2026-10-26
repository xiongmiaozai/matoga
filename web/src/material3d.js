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

function applySourceSide() {
  if (!S.initialized) return
  if (S.customModelGroup) return

  if (S.sourceSide === 'dual') {
    S.meshLeft.visible = true; S.meshRight.visible = true; S.meshLeft.position.x = -1.1; S.meshRight.position.x = 1.1
    S.meshLeft.scale.setScalar(0.75); S.meshRight.scale.setScalar(0.75)
    S.labelLeft.visible = true; S.labelRight.visible = true
    S.labelLeft.position.set(-1.1, -0.95, 0); S.labelRight.position.set(1.1, -0.95, 0)
  } else if (S.sourceSide === 'left') {
    S.meshLeft.visible = true; S.meshRight.visible = false; S.meshLeft.position.x = 0
    S.meshLeft.scale.setScalar(1.0)
    S.labelLeft.visible = false; S.labelRight.visible = false
  } else {
    S.meshLeft.visible = false; S.meshRight.visible = true; S.meshRight.position.x = 0
    S.meshRight.scale.setScalar(1.0)
    S.labelLeft.visible = false; S.labelRight.visible = false
  }
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

function applyTexturesToMesh(mesh, group, side) {
  const material = mesh.material
  disposeAllMaterialTextures(material)
  if (!group) { material.color.set(0x888888); material.emissive.set(0x000000); material.needsUpdate = true; return }

  const loader = new THREE.TextureLoader()
  const getEntry = (role) => { const e = group[side] && group[side][role]; return (e && !e.isDirectory && isImageFile(e.name)) ? e : null }
  const mainEntry = getEntry('main'), normalEntry = getEntry('normal'), specEntry = getEntry('specular')

  if (mainEntry) {
    loader.load(fileUrl(mainEntry.fullPath), (tex) => { tex.colorSpace = THREE.SRGBColorSpace; tex.wrapS = tex.wrapT = THREE.RepeatWrapping; disposeTexture(material.map); material.map = tex; applyTextureFilter(tex); material.color.set(0xffffff); const mi = new Image(); mi.onload = () => { const w = Math.min(mi.naturalWidth, 64), h = Math.min(mi.naturalHeight, 64); const tc = document.createElement('canvas'); tc.width = w; tc.height = h; const tctx = tc.getContext('2d', { willReadFrequently: true }); tctx.drawImage(mi, 0, 0, w, h); const td = tctx.getImageData(0, 0, w, h).data; let hasAlpha = false, semiCount = 0, total = 0; for (let i = 3; i < td.length; i += 4) { total++; const a = td[i]; if (a < 250) hasAlpha = true; if (a > 5 && a < 250) semiCount++ } material.userData.hasAlpha = hasAlpha; material.userData.hasSemiTrans = semiCount / total > 0.02; applyOpacityMode(material) }; mi.src = fileUrl(mainEntry.fullPath); material.needsUpdate = true })
  } else { material.color.set(0x444466); material.userData.hasAlpha = false; material.userData.hasSemiTrans = false; applyOpacityMode(material) }

  if (normalEntry) {
    const nUrl = fileUrl(normalEntry.fullPath)
    const processNormal = (source) => {
      const sc = document.createElement('canvas'); sc.width = imgW(source); sc.height = imgH(source)
      const sctx = sc.getContext('2d', { willReadFrequently: true }); sctx.drawImage(source, 0, 0)
      const src = sc
      if (side === 'left') showLoading(_t('m3d.loading'))
      if (side === 'left' && S.heightDetectCallback) S.heightDetectCallback('loading')
      requestAnimationFrame(() => {
        setLoadingProgress(0.2)
        disposeTexture(material.normalMap); material.normalMap = reconstructNormal(src); applyTextureFilter(material.normalMap); material.normalScale.set(S.normalScale, S.normalScale)
        requestAnimationFrame(() => {
          setLoadingProgress(0.4)
          let heightTex = extractHeight(src); let hStatus = heightTex ? 'alpha' : false
          if (!heightTex) { heightTex = extractHeightFromNormal(src); hStatus = heightTex ? 'normal' : false }
          setLoadingProgress(0.9)
          if (material.userData.shaderRefs) { disposeTexture(material.userData.shaderRefs.heightMap.value); material.userData.shaderRefs.heightMap.value = heightTex; material.userData.shaderRefs.hasHeightMap.value = (heightTex && S.parallaxEnabled) ? 1.0 : 0.0; if (heightTex) { applyHeightFilter(heightTex); material.userData.shaderRefs.uHeightTexSize.value.set(heightTex.image.width, heightTex.image.height) } }
          else { disposeTexture(material.userData.pendingHeightMap); material.userData.pendingHeightMap = heightTex }
          if (side === 'left' && S.heightDetectCallback) S.heightDetectCallback(hStatus)
          material.needsUpdate = true
          if (side === 'left') { setLoadingProgress(1.0); setTimeout(hideLoading, 200) }
        })
      })
    }
    if (typeof createImageBitmap !== 'undefined') {
      fetch(nUrl).then(r => r.blob()).then(blob => createImageBitmap(blob, { premultiplyAlpha: 'none' })).then(bitmap => { processNormal(bitmap); if (bitmap.close) bitmap.close() }).catch(() => { const img = new Image(); img.onload = () => processNormal(img); img.src = nUrl })
    } else { const img = new Image(); img.onload = () => processNormal(img); img.src = nUrl }
  } else { if (side === 'left' && S.heightDetectCallback) S.heightDetectCallback(false) }

  if (specEntry) {
    const specImg = new Image(); specImg.onload = () => {
      let fmt = S.materialFormat
      if (fmt === 'auto') { fmt = detectFormat(specImg); if (S.formatDetectCallback) S.formatDetectCallback(fmt) }
      disposeTexture(material.roughnessMap); disposeTexture(material.metalnessMap); disposeTexture(material.emissiveMap)
      if (fmt === 'old') {
        material.roughnessMap = extractChannel(specImg, 0, true); material.metalnessMap = extractChannel(specImg, 1, false); material.emissiveMap = extractChannel(specImg, 2, false); applyTextureFilter(material.roughnessMap); applyTextureFilter(material.metalnessMap); applyTextureFilter(material.emissiveMap)
        material.emissive.set(0xffffff); material.emissiveIntensity = S.emissiveIntensity; material.needsUpdate = true
      } else {
         material.roughnessMap = extractRoughness(specImg); material.metalnessMap = extractMetalness(specImg); applyTextureFilter(material.roughnessMap); applyTextureFilter(material.metalnessMap)
        if (mainEntry) {
          const mainImg = new Image(); mainImg.onload = () => {
             disposeTexture(material.emissiveMap); material.emissiveMap = extractEmissive(specImg, mainImg); applyTextureFilter(material.emissiveMap)
            material.emissive.set(0xffffff); material.emissiveIntensity = S.emissiveIntensity; material.needsUpdate = true
          }; mainImg.src = fileUrl(mainEntry.fullPath)
        } else { material.emissive.set(0x000000) }
        material.needsUpdate = true
      }
    }; specImg.src = fileUrl(specEntry.fullPath)
  } else { material.emissive.set(0x000000) }
  material.needsUpdate = true
}

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
export function showCustomModel(group) {
  if (!S.initialized || !group) return false
  clearCustomModel()
  try {
    const box = new THREE.Box3().setFromObject(group)
    if (box.isEmpty()) return false
    const size = box.getSize(new THREE.Vector3())
    const center = box.getCenter(new THREE.Vector3())
    const maxDim = Math.max(size.x, size.y, size.z) || 1
    const scale = 2.0 / maxDim
    group.position.set(-center.x, -center.y, -center.z)
    group.scale.setScalar(scale)
    const wrapper = new THREE.Group()
    wrapper.add(group)
    /* 底面贴地（地面 y=-1.3）：wrapper 原点在缩放后模型中心 */
    const halfY = (size.y * scale) / 2
    wrapper.position.y = -1.28 + halfY
    S.meshLeft.visible = false; S.meshRight.visible = false
    S.labelLeft.visible = false; S.labelRight.visible = false
    S.customModelGroup = wrapper
    S.scene.add(wrapper)

    return true
  } catch { return false }
}

export function showCustomModelPair(leftGroup, rightGroup) {
  if (!S.initialized) return false
  if (!leftGroup && !rightGroup) return false
  clearCustomModel()
  try {
    const wrapper = new THREE.Group()
    let added = 0
    const place = (grp, x) => {
      if (!grp) return
      const box = new THREE.Box3().setFromObject(grp)
      if (box.isEmpty()) return
      const size = box.getSize(new THREE.Vector3())
      const center = box.getCenter(new THREE.Vector3())
      const maxDim = Math.max(size.x, size.y, size.z) || 1
      const scale = 1.5 / maxDim
      grp.position.set(-center.x, -center.y, -center.z)
      grp.scale.setScalar(scale)
      const sub = new THREE.Group()
      sub.add(grp)
      const halfY = (size.y * scale) / 2
      sub.position.set(x, -1.28 + halfY, 0)
      wrapper.add(sub)
      added++
    }
    place(leftGroup, -1.1)
    place(rightGroup, 1.1)
    if (added === 0) return false
    S.meshLeft.visible = false; S.meshRight.visible = false
    S.labelLeft.visible = true; S.labelRight.visible = true
    S.labelLeft.position.set(-1.1, -0.95, 0); S.labelRight.position.set(1.1, -0.95, 0)
    S.customModelGroup = wrapper
    S.scene.add(wrapper)

    return true
  } catch { return false }
}

export function clearCustomModel() {
  if (!S.customModelGroup) return
  S.scene.remove(S.customModelGroup)
  disposeGroupDeep(S.customModelGroup)
  S.customModelGroup = null
  if (S.initialized) applySourceSide()
}

export function isCustomModelActive() { return !!S.customModelGroup }

export function hasVisibleViewport() {
  if (!S.initialized) return false
  return !!findVisibleHost()
}

export function isMaterial3DReady() { return S.initialized }
export function setBaseColor(rgb) {
  if (!S.initialized || !Array.isArray(rgb)) return
  const r = clamp01(rgb[0]), g = clamp01(rgb[1]), b = clamp01(rgb[2])
  S.meshLeft.material.color.setRGB(r, g, b)
  S.meshRight.material.color.setRGB(r, g, b)
  S.meshLeft.material.needsUpdate = S.meshRight.material.needsUpdate = true
}
export function setEmissiveColor(rgb) {
  if (!S.initialized || !Array.isArray(rgb)) return
  const r = clamp01(rgb[0]), g = clamp01(rgb[1]), b = clamp01(rgb[2])
  S.meshLeft.material.emissive.setRGB(r, g, b)
  S.meshRight.material.emissive.setRGB(r, g, b)
  S.meshLeft.material.needsUpdate = S.meshRight.material.needsUpdate = true
}
export function setMainTextureFromUrl(url) {
  if (!S.initialized || !url) return
  const loader = new THREE.TextureLoader()
  for (const m of [S.meshLeft, S.meshRight]) {
    loader.load(url, (tex) => {
      tex.colorSpace = THREE.SRGBColorSpace
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping
      disposeTexture(m.material.map)
      m.material.map = tex
      applyTextureFilter(tex)
      m.material.needsUpdate = true
    })
  }
}
export function setNormalMapFromUrl(url) {
  if (!S.initialized || !url) return
  const loader = new THREE.TextureLoader()
  for (const m of [S.meshLeft, S.meshRight]) {
    loader.load(url, (tex) => {
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping
      disposeTexture(m.material.normalMap)
      m.material.normalMap = tex
      m.material.normalScale.set(S.normalScale, S.normalScale)
      applyTextureFilter(tex)
      m.material.needsUpdate = true
    })
  }
}
export function clearMainTexture() {
  if (!S.initialized) return
  for (const m of [S.meshLeft, S.meshRight]) {
    disposeTexture(m.material.map); m.material.map = null; m.material.needsUpdate = true
  }
}
export function clearNormalMap() {
  if (!S.initialized) return
  for (const m of [S.meshLeft, S.meshRight]) {
    disposeTexture(m.material.normalMap); m.material.normalMap = null; m.material.needsUpdate = true
  }
}
/* 高光/镜面贴图（-s）：R 通道反转→粗糙度，G 通道→金属度（与 labpbr 格式一致） */
function applySpecTextureToMaterial(mat, url) {
  if (!mat || !url) return
  const specImg = new Image()
  specImg.crossOrigin = 'anonymous'
  specImg.onload = () => {
    disposeTexture(mat.roughnessMap); disposeTexture(mat.metalnessMap)
    mat.roughnessMap = extractRoughness(specImg)
    mat.metalnessMap = extractMetalness(specImg)
    applyTextureFilter(mat.roughnessMap); applyTextureFilter(mat.metalnessMap)
    mat.needsUpdate = true
  }
  specImg.src = url
}
function clearSpecTexture(mat) {
  if (!mat) return
  disposeTexture(mat.roughnessMap); disposeTexture(mat.metalnessMap)
  mat.roughnessMap = null; mat.metalnessMap = null; mat.needsUpdate = true
}
export function setSpecularFromUrl(url) {
  if (!S.initialized || !url) return
  for (const m of [S.meshLeft, S.meshRight]) applySpecTextureToMaterial(m.material, url)
}
export function clearSpecularTexture() {
  if (!S.initialized) return
  for (const m of [S.meshLeft, S.meshRight]) clearSpecTexture(m.material)
}

export function applyPbrMapsToModelMaterial(mat, normalUrl, specUrl) {
  if (!mat) return
  if (normalUrl) {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      if (mat.userData.replaced) return
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
      if (mat.userData.replaced) return
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

