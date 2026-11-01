/**
 * matoga - 材质贴图对比工具
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 */

import * as THREE from 'three'
import { fileUrl, isImageFile } from './utils.js'
import { t as _t } from './i18n.js'
import { attachTextureAnimOnly, unloadTextureAnim } from './mc-model-viewer.js'
import { computeTangents } from './m3d/geometry.js'
import { LIGHT_PRESETS } from './m3d/presets.js'
import { detectFormat, reconstructNormal, applySourceSide, setHooks as setGeoUtilsHooks } from './m3d/geo-utils.js'
import { parseIncludes, makeMaterial, setHooks as setMaterialHooks } from './m3d/material.js'
import { setupControls, disposeAllMaterialTextures, disposeMaterial3D, setHooks as setHooks } from './m3d/controls.js'
import { extractChannel, extractRoughness, extractMetalness, extractEmissive } from './m3d/channel-extract.js'
import { createLabel, applyOpacityMode, applyHeightFilter, applyTextureFilter, setHooks as setMaterialFiltersHooks } from './m3d/material-filters.js'
import { imgW, imgH, extractHeight, extractHeightFromNormal } from './m3d/height-extract.js'
import { normalizeHeightChannels } from './m3d/height-channels.js'
import { createEnvTexture, cloneLightConfig, rebuildLights, applyLightPreset, applyCustomLightConfig, updateSkySunPosition, bakeSkyEnvironment, scheduleSkyBake, applyProceduralSky, applyHDREnvMode, ensureRotatedTexture, setEnvMode, setLightPreset, setEnvIntensity, loadHDREnv, clearHDREnv, getCurrentLightPreset, getCurrentEnvMode, setEnvModeExport, setHdrRotation, setHdrUsage, setSkyTurbidity, setSkyRayleigh, setSkyMieCoefficient, setSkyMieDirectionalG, setSkySunElevation, setSkySunAzimuth, setSkyTint, setHooks as setEnvironmentLightingHooks } from './m3d/env-light.js'
/* 门面 re-export（§2.3） */
export { createEnvTexture, cloneLightConfig, rebuildLights, applyLightPreset, applyCustomLightConfig, updateSkySunPosition, bakeSkyEnvironment, scheduleSkyBake, applyProceduralSky, applyHDREnvMode, ensureRotatedTexture, setEnvMode, setLightPreset, setEnvIntensity, loadHDREnv, clearHDREnv, getCurrentLightPreset, getCurrentEnvMode, setEnvModeExport, setHdrRotation, setHdrUsage, setSkyTurbidity, setSkyRayleigh, setSkyMieCoefficient, setSkyMieDirectionalG, setSkySunElevation, setSkySunAzimuth, setSkyTint } from './m3d/env-light.js'
/* 门面 re-export（§2.3） */
export { imgW, imgH, extractHeight, extractHeightFromNormal } from './m3d/height-extract.js'
/* 门面 re-export（§2.3） */
export { createLabel, applyOpacityMode, applyHeightFilter, applyTextureFilter } from './m3d/material-filters.js'
/* 门面 re-export（§2.3） */
export { extractChannel, extractRoughness, extractMetalness, extractEmissive } from './m3d/channel-extract.js'
/* 门面 re-export（§2.3） */
export { setupControls, disposeAllMaterialTextures, disposeMaterial3D } from './m3d/controls.js'
/* 门面 re-export（§2.3） */
export { parseIncludes, makeMaterial } from './m3d/material.js'
/* 门面 re-export（§2.3） */
export { rotateTextureData, detectFormat, reconstructNormal, applySourceSide } from './m3d/geo-utils.js'

let scene, camera, renderer, animationId, pmrem, envTexture, pmremTexture
let isWebGL2 = false

let meshLeft, meshRight, labelLeft, labelRight
let groundMesh, gridHelper, lightGroup
let customModelGroup = null /* 自定义模型（MC .json / .bbmodel）托管容器，非空时内置预览 mesh 隐藏 */
let container = null
let initialized = false
const hosts = new Set()
let hostObserver = null
let containerResizeObserver = null
let currentGeo = 'cube'

function _loadingEls() {
  if (container) {
    const el = container.querySelector('.m3d-loading')
    return el ? [el] : []
  }
  return document.querySelectorAll('.m3d-loading')
}

function showLoading(text) {
  _loadingEls().forEach(el => {
    const t = el.querySelector('.m3d-loading-text')
    if (t && text) t.textContent = text
    el.classList.add('show')
  })
}
function hideLoading() {
  _loadingEls().forEach(el => el.classList.remove('show'))
}
function setLoadingProgress(pct) {
  _loadingEls().forEach(el => {
    const f = el.querySelector('.m3d-loading-fill')
    if (f) f.style.width = Math.round(pct * 100) + '%'
  })
}
let emissiveIntensity = 1.0
let normalScale = 1.0
let materialFormat = 'labpbr'
let channelView = 'all'
let formatDetectCallback = null
let heightDetectCallback = null
let sourceSide = 'dual'
let parallaxScale = 0.05
let parallaxSteps = 32.0
let parallaxMode = 2.0
let parallaxAdaptive = 1.0
let parallaxEnabled = true
let parallaxShadow = 0.0
const _lightDirTmp = new THREE.Vector3()
let currentLightPreset = 'studio'
let currentEnvMode = 'custom'
let groundVisible = false
let envIntensity = 0.5
let hdrTexture = null
let hdrTextureOriginal = null
let hdrTextureRotated = null
let hdrRotation = 0
let hdrUsage = 'both'
let hdrInfo = null
let hdrRotateTimer = null
let skyMesh = null
let skyEnvTexture = null
let skySunLight = null
let skyTurbidity = 3
let skyRayleigh = 2.5
let skyMieCoefficient = 0.005
let skyMieDirectionalG = 0.8
let skySunElevation = 15
let skySunAzimuth = 180

let skyTintHex = 0xa0c0ff
let skyBakeTimer = null
const _skyTint = new THREE.Color()
let opacityMode = 'auto'
let opacityValue = 1.0
let transmissionValue = 0.0
let iorValue = 1.5
let clearcoatValue = 0.0
let textureFilter = 'nearest'
let mipmapsEnabled = true
let anisotropyLevel = 4
let alignOfficial = false
let maxAnisotropy = 1

let rotX = 0,
  rotY = 0,
  targetRotX = 0,
  targetRotY = 0
let isDragging = false,
  lastX = 0,
  lastY = 0
let camDist = 3,
  targetCamDist = 3
let autoRotate = false

let camPanX = 0,
  camPanY = 0,
  targetPanX = 0,
  targetPanY = 0
let dragMode = null
let freeCamMode = false
const flyPos = new THREE.Vector3(0, 0.5, 3)
let flyYaw = 0,
  flyPitch = 0
const flyKeys = Object.create(null)
const FLY_KEYS = new Set([
  'KeyW',
  'KeyA',
  'KeyS',
  'KeyD',
  'KeyQ',
  'KeyE',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'ShiftLeft',
  'ShiftRight'
])
const FLY_SPEED = 3,
  FLY_BOOST = 2.5
let lastFrameTime = 0
const _flyForward = new THREE.Vector3()
const _flyRight = new THREE.Vector3()
const _flyMove = new THREE.Vector3()

export { normalizeHeightChannels } from './m3d/height-channels.js'

function scaleUV(geometry, su, sv) {
  const uv = geometry.attributes.uv
  if (!uv) return geometry
  for (let i = 0; i < uv.count; i++) {
    uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv)
  }
  uv.needsUpdate = true
  return geometry
}

function withTangents(geo) {
  computeTangents(geo)
  return geo
}

const geometries = {
  sphere: () => withTangents(scaleUV(new THREE.SphereGeometry(1, 64, 64), 4.0, 1.25)),
  cube: () => withTangents(new THREE.BoxGeometry(1.4, 1.4, 1.4)),
  plane: () => withTangents(new THREE.PlaneGeometry(1.6, 1.6)),
  torus: () => withTangents(scaleUV(new THREE.TorusGeometry(0.8, 0.3, 32, 64), 3.0, 1.0)),
  cylinder: () => withTangents(scaleUV(new THREE.CylinderGeometry(0.7, 0.7, 1.6, 48), 2.75, 1.0)),
  capsule: () => withTangents(scaleUV(new THREE.CapsuleGeometry(0.6, 1.0, 16, 32), 2.5, 1.25))
}

let customLightConfig = null

/* 已抽至 env-light.js（applyLightPreset/applyCustomLightConfig/updateSkySunPosition/bakeSkyEnvironment/scheduleSkyBake/applyProceduralSky/applyHDREnvMode/ensureRotatedTexture/setEnvMode）、geo-utils.js（rotateTextureData）、height-extract.js（imgW/imgH）、channel-extract.js（worker 基础设施 getM3dWorker/runPixelOp/bitmapToTexture + extractChannel） */
function applyChannelViewToMaterial(material) {
  const baseMap = material.userData.baseMap
  if (!baseMap) return
  if (channelView === 'all') {
    if (material.map !== baseMap) {
      disposeTexture(material.map)
      material.map = baseMap
      material.needsUpdate = true
    }
    return
  }
  const img = baseMap.image
  if (!img) return
  const w = img.width || img.naturalWidth,
    h = img.height || img.naturalHeight
  if (!w || !h) return
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  ctx.drawImage(img, 0, 0)
  const imageData = ctx.getImageData(0, 0, w, h)
  const d = imageData.data
  const ci = { r: 0, g: 1, b: 2, a: 3 }[channelView]
  for (let i = 0; i < d.length; i += 4) {
    const v = d[i + ci]
    d[i] = v
    d[i + 1] = v
    d[i + 2] = v
    d[i + 3] = 255
  }
  ctx.putImageData(imageData, 0, 0)
  const tex = new THREE.CanvasTexture(canvas)
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  tex.colorSpace = THREE.SRGBColorSpace
  applyTextureFilter(tex)
  if (material.map !== baseMap) disposeTexture(material.map)
  material.map = tex
  material.needsUpdate = true
}

export function setChannelView(ch) {
  channelView = ch
  if (!initialized) return
  for (const mesh of [meshLeft, meshRight]) {
    if (!mesh || !mesh.material) continue
    applyChannelViewToMaterial(mesh.material)
  }
  if (channelView === 'all') refreshMaterial3DTint()
}

/* 已抽至 geo-utils.js（detectFormat/reconstructNormal）、channel-extract.js（extractRoughness/extractMetalness/extractEmissive）、height-extract.js（extractHeight/extractHeightFromNormal）、material-filters.js（createLabel/applyOpacityMode/applyHeightFilter/applyTextureFilter）、material.js（parseIncludes） */
function collectMaterialTextures(m) {
  const list = []
  if (m.map) list.push(m.map)
  if (m.normalMap) list.push(m.normalMap)
  if (m.roughnessMap) list.push(m.roughnessMap)
  if (m.metalnessMap) list.push(m.metalnessMap)
  if (m.emissiveMap) list.push(m.emissiveMap)
  if (m.userData.shaderRefs && m.userData.shaderRefs.heightMap && m.userData.shaderRefs.heightMap.value)
    list.push(m.userData.shaderRefs.heightMap.value)
  return list
}

function applyFilterToAllTextures() {
  if (!initialized) return
  for (const mesh of [meshLeft, meshRight]) {
    if (!mesh || !mesh.material) continue
    for (const tex of collectMaterialTextures(mesh.material)) applyTextureFilter(tex)
    mesh.material.needsUpdate = true
  }
}

/* 已抽至 material.js（makeMaterial） */
function isHostVisible(el) {
  if (!el || !el.isConnected) return false
  const r = el.getBoundingClientRect()
  return r.width > 1 && r.height > 1
}

function findVisibleHost() {
  for (const h of hosts) {
    if (isHostVisible(h)) return h
  }
  return null
}

function activeHost() {
  return (renderer && renderer.domElement.parentElement) || null
}

function refreshHostHints() {
  const active = initialized ? activeHost() : null
  for (const h of hosts) {
    h.classList.toggle('m3d-host-active', h === active)
    const hint = h.querySelector('.m3d-host-empty')
    if (hint) hint.style.display = initialized && h !== active ? '' : 'none'
  }
}

function moveViewportWidgets(target) {
  document.querySelectorAll('.m3d-toolbar-float, .m3d-drawer').forEach(w => {
    if (w.parentElement !== target) {
      target.appendChild(w)
      if (w.classList.contains('m3d-drawer')) {
        w.style.left = ''
        w.style.top = ''
        w.style.right = ''
        w.style.bottom = ''
      }
    }
  })
}

function setContainer(el) {
  if (!el || el === container) {
    refreshHostHints()
    return
  }
  container = el
  if (renderer) {
    el.appendChild(renderer.domElement)
    moveViewportWidgets(el)
    handleResize()
    setTimeout(handleResize, 16)
    setTimeout(handleResize, 50)
  }
  refreshHostHints()
}

export function activateMaterial3DHost(el) {
  if (!el || !hosts.has(el)) return
  if (!initialized) {
    initMaterial3D(el)
    return
  }
  setContainer(el)
}

function reevaluateActiveHost() {
  if (!initialized) return
  const active = activeHost()
  if (active && isHostVisible(active)) return
  const visible = findVisibleHost()
  if (visible) setContainer(visible)
}

function ensureHostObserver() {
  if (hostObserver) return hostObserver
  hostObserver = new IntersectionObserver(entries => {
    if (!initialized) return
    for (const entry of entries) {
      if (entry.isIntersecting && isHostVisible(entry.target)) setContainer(entry.target)
    }
    reevaluateActiveHost()
  })
  return hostObserver
}

let _hostReevalRAF = 0
if (typeof window !== 'undefined') {
  window.addEventListener('resize', () => {
    handleResize()
    if (_hostReevalRAF) return
    _hostReevalRAF = requestAnimationFrame(() => {
      _hostReevalRAF = 0
      reevaluateActiveHost()
      handleResize()
    })
  })
}

export function registerMaterial3DHost(el) {
  if (!el || hosts.has(el)) return
  hosts.add(el)
  ensureHostObserver().observe(el)
  if (containerResizeObserver) containerResizeObserver.observe(el)
  el.addEventListener(
    'pointerdown',
    () => {
      if (initialized) setContainer(el)
    },
    true
  )
  if (initialized) {
    const active = activeHost()
    if ((!active || !isHostVisible(active)) && isHostVisible(el)) setContainer(el)
    else refreshHostHints()
  } else {
    refreshHostHints()
  }
}

export function initMaterial3D(containerEl) {
  registerMaterial3DHost(containerEl)
  if (initialized) {
    if (containerEl !== container) {
      const target = isHostVisible(containerEl) ? containerEl : findVisibleHost() || containerEl
      setContainer(target)
    } else {
      refreshHostHints()
    }
    return
  }
  container = isHostVisible(containerEl) ? containerEl : findVisibleHost() || containerEl
  const width = container.clientWidth || 300,
    height = container.clientHeight || 200
  _lastDPR = window.devicePixelRatio
  scene = new THREE.Scene()
  scene.background = new THREE.Color(LIGHT_PRESETS.studio.bg)
  camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 100)
  camera.position.set(0, 0.5, camDist)
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
  isWebGL2 = renderer.capabilities.isWebGL2
  maxAnisotropy = renderer.capabilities.getMaxAnisotropy() || 1
  renderer.setSize(width, height)
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5))
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 2.2
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFShadowMap
  container.appendChild(renderer.domElement)
  pmrem = new THREE.PMREMGenerator(renderer)
  lightGroup = new THREE.Group()
  scene.add(lightGroup)
  const geo = geometries[currentGeo]()
  meshLeft = new THREE.Mesh(geo, makeMaterial())
  meshLeft.castShadow = true
  meshLeft.receiveShadow = true
  scene.add(meshLeft)
  meshRight = new THREE.Mesh(geo.clone(), makeMaterial())
  meshRight.castShadow = true
  meshRight.receiveShadow = true
  scene.add(meshRight)
  labelLeft = createLabel(_t('common.left'), '#2b6cff')
  labelRight = createLabel(_t('common.right'), '#d97706')
  scene.add(labelLeft)
  scene.add(labelRight)
  const groundGeo = new THREE.PlaneGeometry(8, 8)
  const groundMat = new THREE.MeshStandardMaterial({ color: 0x2a2a3e, roughness: 0.8, metalness: 0.0 })
  groundMesh = new THREE.Mesh(groundGeo, groundMat)
  groundMesh.rotation.x = -Math.PI / 2
  groundMesh.position.y = -1.3
  groundMesh.receiveShadow = true
  groundMesh.visible = groundVisible
  scene.add(groundMesh)
  gridHelper = new THREE.GridHelper(8, 32, 0x444466, 0x222244)
  gridHelper.position.y = -1.29
  gridHelper.material.transparent = true
  gridHelper.material.opacity = 0.3
  gridHelper.visible = groundVisible
  scene.add(gridHelper)
  setupControls()
  if (containerResizeObserver) containerResizeObserver.disconnect()
  containerResizeObserver = new ResizeObserver(handleResize)
  for (const h of hosts) containerResizeObserver.observe(h)
  lastFrameTime = performance.now()
  animate()
  initialized = true
  moveViewportWidgets(container)
  refreshHostHints()
  applyLightPreset('studio')
  applySourceSide()
  setTimeout(handleResize, 16)
  setTimeout(handleResize, 50)
  setTimeout(handleResize, 120)
  document.dispatchEvent(new CustomEvent('material3d:ready'))
}

function clampFlyPos() {
  flyPos.x = Math.max(-40, Math.min(40, flyPos.x))
  flyPos.y = Math.max(-20, Math.min(40, flyPos.y))
  flyPos.z = Math.max(-40, Math.min(40, flyPos.z))
}

function lookAtOrigin() {
  _flyForward.set(0, 0, 0).sub(flyPos)
  if (_flyForward.lengthSq() < 1e-8) _flyForward.set(0, 0, -1)
  _flyForward.normalize()
  flyPitch = Math.asin(Math.max(-1, Math.min(1, _flyForward.y)))
  flyYaw = Math.atan2(-_flyForward.x, -_flyForward.z)
}

function resetFreeView() {
  flyPos.set(0, 0.5, 3)
  lookAtOrigin()
}

function updateFlyMovement(dt) {
  _flyMove.set(0, 0, 0)
  _flyForward.set(0, 0, -1).applyEuler(camera.rotation)
  _flyRight.set(1, 0, 0).applyEuler(camera.rotation)
  if (flyKeys.KeyW || flyKeys.ArrowUp) _flyMove.add(_flyForward)
  if (flyKeys.KeyS || flyKeys.ArrowDown) _flyMove.sub(_flyForward)
  if (flyKeys.KeyD || flyKeys.ArrowRight) _flyMove.add(_flyRight)
  if (flyKeys.KeyA || flyKeys.ArrowLeft) _flyMove.sub(_flyRight)
  if (flyKeys.KeyE) _flyMove.y += 1
  if (flyKeys.KeyQ) _flyMove.y -= 1
  if (_flyMove.lengthSq() > 0) {
    const speed = FLY_SPEED * (flyKeys.ShiftLeft || flyKeys.ShiftRight ? FLY_BOOST : 1)
    _flyMove.normalize().multiplyScalar(speed * dt)
    flyPos.add(_flyMove)
    clampFlyPos()
  }
}

let _resizeRAF = 0
let _lastDPR = 0
function handleResize() {
  if (_resizeRAF) return
  _resizeRAF = requestAnimationFrame(() => {
    _resizeRAF = 0
    if (!container || !renderer || !camera) return
    const w = container.clientWidth,
      h = container.clientHeight
    if (w > 0 && h > 0) {
      camera.aspect = w / h
      camera.updateProjectionMatrix()
      renderer.setSize(w, h)
      const dpr = Math.min(window.devicePixelRatio, 1.5)
      if (dpr !== _lastDPR) {
        renderer.setPixelRatio(dpr)
        _lastDPR = dpr
      }
    }
  })
}

function animate() {
  animationId = requestAnimationFrame(animate)
  if (!container || container.clientWidth < 2 || container.clientHeight < 2) {
    lastFrameTime = performance.now()
    return
  }
  const now = performance.now()
  const dt = Math.min(0.05, Math.max(0, (now - lastFrameTime) / 1000))
  lastFrameTime = now

  if (freeCamMode) {
    camera.rotation.set(flyPitch, flyYaw, 0)
    updateFlyMovement(dt)
    camera.position.copy(flyPos)
  } else {
    if (autoRotate) targetRotY += 0.005
    rotX += (targetRotX - rotX) * 0.1
    rotY += (targetRotY - rotY) * 0.1
    camDist += (targetCamDist - camDist) * 0.1
    camPanX += (targetPanX - camPanX) * 0.18
    camPanY += (targetPanY - camPanY) * 0.18
    meshLeft.rotation.x = rotX
    meshLeft.rotation.y = rotY
    meshRight.rotation.x = rotX
    meshRight.rotation.y = rotY
    if (customModelGroup) {
      customModelGroup.rotation.x = rotX
      customModelGroup.rotation.y = rotY
    }
    camera.position.set(camPanX, 0.5 + camPanY, camDist)
    camera.rotation.set(0, 0, 0)
  }

  camera.updateMatrixWorld()

  if (parallaxShadow > 0.0) {
    let lDir = null
    if (skySunLight && currentEnvMode === 'sky') lDir = skySunLight.position
    else {
      for (const c of lightGroup.children) {
        if (c.isDirectionalLight) {
          lDir = c.position
          break
        }
      }
    }
    if (lDir) {
      _lightDirTmp.copy(lDir).normalize().transformDirection(camera.matrixWorldInverse)
      for (const m of collectAllShaderMats()) {
        if (m.userData.shaderRefs) m.userData.shaderRefs.uHeightLightDir.value.copy(_lightDirTmp)
      }
    }
  }
  renderer.render(scene, camera)
}

export function setGeometry(geoType) {
  if (!initialized || !geometries[geoType]) return
  clearCustomModel()
  currentGeo = geoType
  meshLeft.geometry.dispose()
  meshRight.geometry.dispose()
  meshLeft.geometry = geometries[geoType]()
  meshRight.geometry = geometries[geoType]()
}
export function setMetalness(val) {
  if (initialized) {
    meshLeft.material.metalness = val
    meshRight.material.metalness = val
  }
}
export function setRoughness(val) {
  if (initialized) {
    meshLeft.material.roughness = val
    meshRight.material.roughness = val
  }
}
export function setNormalScale(val) {
  normalScale = val
  if (initialized) {
    meshLeft.material.normalScale.set(val, val)
    meshRight.material.normalScale.set(val, val)
  }
}
export function setEmissiveIntensity(val) {
  emissiveIntensity = val
  if (initialized) {
    meshLeft.material.emissiveIntensity = val
    meshRight.material.emissiveIntensity = val
  }
}
export function setMaterialFormat(fmt) {
  materialFormat = fmt
}
export function setFormatDetectCallback(cb) {
  formatDetectCallback = cb
}
export function setHeightDetectCallback(cb) {
  heightDetectCallback = cb
}
export function setSourceSide(side) {
  sourceSide = side
  applySourceSide()
}
let _shaderMatsCache = null
function markShaderMatsDirty() {
  _shaderMatsCache = null
}
function collectAllShaderMats() {
  if (_shaderMatsCache) return _shaderMatsCache
  const out = []
  for (const m of [meshLeft, meshRight]) if (m && m.material) out.push(m.material)
  if (customModelGroup) {
    customModelGroup.traverse(o => {
      if (!o.material) return
      const mats = Array.isArray(o.material) ? o.material : [o.material]
      for (const m of mats) if (m.userData && m.userData.shaderRefs) out.push(m)
    })
  }
  _shaderMatsCache = out
  return out
}
export function setParallaxScale(val) {
  parallaxScale = val
  if (initialized) {
    for (const m of collectAllShaderMats()) {
      if (m.userData.shaderRefs) m.userData.shaderRefs.parallaxScale.value = val
    }
  }
}
export function setParallaxSteps(val) {
  parallaxSteps = val
  if (initialized) {
    for (const m of collectAllShaderMats()) {
      if (m.userData.shaderRefs) m.userData.shaderRefs.parallaxSteps.value = val
    }
  }
}
export function setParallaxMode(val) {
  parallaxMode = val
  if (initialized) {
    for (const m of collectAllShaderMats()) {
      if (m.userData.shaderRefs) m.userData.shaderRefs.parallaxMode.value = val
    }
  }
}
export function setParallaxAdaptive(val) {
  parallaxAdaptive = val
  if (initialized) {
    for (const m of collectAllShaderMats()) {
      if (m.userData.shaderRefs) m.userData.shaderRefs.parallaxAdaptive.value = val
    }
  }
}
export function isParallaxEnabled() {
  return parallaxEnabled
}
export function setParallaxEnabled(on) {
  parallaxEnabled = on
  if (initialized) {
    for (const m of collectAllShaderMats()) {
      if (m.userData.shaderRefs) {
        const ht = m.userData.shaderRefs.heightMap.value
        m.userData.shaderRefs.hasHeightMap.value = ht && on ? 1.0 : 0.0
        if (ht) {
          ht.needsUpdate = true
          m.needsUpdate = true
        }
      }
    }
  }
}
export function setParallaxShadow(val) {
  parallaxShadow = val
  if (initialized) {
    for (const m of collectAllShaderMats()) {
      if (m.userData.shaderRefs) m.userData.shaderRefs.parallaxShadow.value = val
    }
  }
}
export function getCustomLightConfig() {
  return customLightConfig ? cloneLightConfig(customLightConfig) : null
}
export function applyCustomLightConfigExport(config) {
  if (currentEnvMode !== 'custom') setEnvMode('custom')
  applyCustomLightConfig(config)
}
export function setExposure(val) {
  if (initialized && renderer) renderer.toneMappingExposure = val
}
export function toggleGround(visible) {
  groundVisible = visible
  if (initialized) {
    if (groundMesh) groundMesh.visible = visible
    if (gridHelper) gridHelper.visible = visible
  }
}
export function setAutoRotate(on) {
  autoRotate = on
}
export function isFreeCameraMode() {
  return freeCamMode
}
export function setFreeCameraMode(on) {
  if (!initialized) return
  on = !!on
  if (freeCamMode === on) return
  freeCamMode = on
  if (freeCamMode) {
    flyPos.copy(camera.position)
    lookAtOrigin()
    camera.rotation.order = 'YXZ'
    autoRotate = false
    for (const k in flyKeys) delete flyKeys[k]
    renderer.domElement.style.cursor = 'crosshair'
  } else {
    camPanX = 0
    camPanY = 0
    targetPanX = 0
    targetPanY = 0
    camera.rotation.set(0, 0, 0)
    renderer.domElement.style.cursor = 'grab'
  }
  document.dispatchEvent(new CustomEvent('material3d:freecam', { detail: { enabled: freeCamMode } }))
}
export function setWireframe(on) {
  if (initialized) {
    meshLeft.material.wireframe = on
    meshRight.material.wireframe = on
  }
}
export function setOpacityMode(mode) {
  opacityMode = mode
  if (initialized) {
    for (const m of [meshLeft, meshRight]) {
      if (m) applyOpacityMode(m.material)
    }
  }
}
export function setOpacity(val) {
  opacityValue = val
  if (initialized) {
    for (const m of [meshLeft, meshRight]) {
      if (m) applyOpacityMode(m.material)
    }
  }
}
export function setTransmission(val) {
  transmissionValue = val
  if (initialized) {
    for (const m of [meshLeft, meshRight]) {
      if (m) {
        m.material.transmission = val
        if (val > 0) {
          m.material.transparent = true
          m.material.alphaTest = 0
        }
        m.material.needsUpdate = true
      }
    }
  }
}
export function setIOR(val) {
  iorValue = val
  if (initialized) {
    for (const m of [meshLeft, meshRight]) {
      if (m) m.material.ior = val
    }
  }
}
export function setClearcoat(val) {
  clearcoatValue = val
  if (initialized) {
    for (const m of [meshLeft, meshRight]) {
      if (m) m.material.clearcoat = val
    }
  }
}
export function setTextureFilter(mode) {
  textureFilter = mode
  applyFilterToAllTextures()
}
export function setMipmapsEnabled(on) {
  mipmapsEnabled = on
  applyFilterToAllTextures()
}
export function setAnisotropyLevel(val) {
  anisotropyLevel = Math.max(1, Math.round(val))
  applyFilterToAllTextures()
}
export function setAlignOfficial(val) {
  alignOfficial = !!val
  applyFilterToAllTextures()
}

export function screenshot() {
  if (!initialized || !renderer) return
  renderer.render(scene, camera)
  const url = renderer.domElement.toDataURL('image/png')
  const a = document.createElement('a')
  a.href = url
  a.download = `material3d_${Date.now()}.png`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
}
export function toggleFullscreen() {
  if (!container) return
  container.classList.toggle('fullscreen')
  handleResize()
  setTimeout(handleResize, 16)
  setTimeout(handleResize, 50)
  setTimeout(handleResize, 120)
}
function disposeTexture(tex) {
  if (tex && tex.dispose) {
    unloadTextureAnim(tex)
    tex.dispose()
  }
}
/* ── 3D 普通贴图模式染色：贴图文件（非 MC 模型）3D 预览时，按贴图名推断 tint，
    采样当前生物群系颜色设到 material.color（three.js 自动 color × map）。动态 import
    mc-model-viewer 避免循环依赖。biome 切换时 refreshMaterial3DTint 重染当前贴图 */
let currentTintPaths = { left: null, right: null }
function applyTintToMaterial(material, texPath, myVer) {
  if (channelView !== 'all') {
    material.color.set(0xffffff)
    material.needsUpdate = true
    return
  }
  import('./mc-model-viewer.js')
    .then(m => m.sampleTintForTexture(texPath))
    .then(tint => {
      if (material.userData.loadVer !== myVer) return
      if (tint) material.color.setRGB(tint.r, tint.g, tint.b)
      else material.color.set(0xffffff)
      material.needsUpdate = true
    })
    .catch(() => {})
}
export function refreshMaterial3DTint() {
  if (!initialized) return
  if (currentTintPaths.left)
    applyTintToMaterial(meshLeft.material, currentTintPaths.left, meshLeft.material.userData.loadVer || 0)
  if (currentTintPaths.right)
    applyTintToMaterial(meshRight.material, currentTintPaths.right, meshRight.material.userData.loadVer || 0)
}

function applyTexturesToMesh(mesh, group, side) {
  const material = mesh.material
  disposeAllMaterialTextures(material)
  const myVer = (material.userData.loadVer = (material.userData.loadVer || 0) + 1)
  if (!group) {
    currentTintPaths[side] = null
    material.color.set(0x888888)
    material.emissive.set(0x000000)
    material.needsUpdate = true
    return
  }

  const loader = new THREE.TextureLoader()
  const getEntry = role => {
    const e = group[side] && group[side][role]
    return e && !e.isDirectory && isImageFile(e.name) ? e : null
  }
  const mainEntry = getEntry('main'),
    normalEntry = getEntry('normal'),
    specEntry = getEntry('specular'),
    heightEntry = getEntry('height')

  if (mainEntry) {
    const mainUrl = fileUrl(mainEntry.fullPath)
    const mcmetaUrl = fileUrl(mainEntry.fullPath + '.mcmeta')
    loader.load(mainUrl, tex => {
      if (material.userData.loadVer !== myVer) {
        tex.dispose()
        return
      }
      tex.colorSpace = THREE.SRGBColorSpace
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping
      disposeTexture(material.map)
      material.map = tex
      material.userData.baseMap = tex
      applyTextureFilter(tex)
      material.color.set(0xffffff)
      currentTintPaths[side] = mainEntry.fullPath
      if (channelView !== 'all') applyChannelViewToMaterial(material)
      else applyTintToMaterial(material, mainEntry.fullPath, myVer)
      attachTextureAnimOnly(
        tex,
        fetch(mcmetaUrl)
          .then(r => (r.ok ? r.json() : null))
          .catch(() => null)
      ).then(anim => {
        if (material.userData.loadVer !== myVer) return
        if (anim) {
          tex.wrapS = tex.wrapT = THREE.RepeatWrapping
          tex.needsUpdate = true
        }
      })
      const mi = new Image()
      mi.onload = () => {
        if (material.userData.loadVer !== myVer) return
        const w = Math.min(mi.naturalWidth, 64),
          h = Math.min(mi.naturalHeight, 64)
        const tc = document.createElement('canvas')
        tc.width = w
        tc.height = h
        const tctx = tc.getContext('2d', { willReadFrequently: true })
        tctx.drawImage(mi, 0, 0, w, h)
        const td = tctx.getImageData(0, 0, w, h).data
        let hasAlpha = false,
          semiCount = 0,
          total = 0
        for (let i = 3; i < td.length; i += 4) {
          total++
          const a = td[i]
          if (a < 250) hasAlpha = true
          if (a > 5 && a < 250) semiCount++
        }
        material.userData.hasAlpha = hasAlpha
        material.userData.hasSemiTrans = semiCount / total > 0.02
        applyOpacityMode(material)
      }
      mi.src = mainUrl
      material.needsUpdate = true
    })
  } else {
    currentTintPaths[side] = null
    material.color.set(0x444466)
    material.userData.hasAlpha = false
    material.userData.hasSemiTrans = false
    applyOpacityMode(material)
  }

  if (normalEntry) {
    const nUrl = fileUrl(normalEntry.fullPath)
    const processNormal = source => {
      if (material.userData.loadVer !== myVer) return
      const sc = document.createElement('canvas')
      sc.width = imgW(source)
      sc.height = imgH(source)
      const sctx = sc.getContext('2d', { willReadFrequently: true })
      sctx.drawImage(source, 0, 0)
      const src = sc
      if (side === 'left') showLoading(_t('m3d.loading'))
      if (side === 'left' && heightDetectCallback) heightDetectCallback('loading')
      requestAnimationFrame(() => {
        if (material.userData.loadVer !== myVer) return
        setLoadingProgress(0.2)
        disposeTexture(material.normalMap)
        material.normalMap = reconstructNormal(src)
        applyTextureFilter(material.normalMap)
        material.normalScale.set(normalScale, normalScale)
        requestAnimationFrame(() => {
          if (material.userData.loadVer !== myVer) return
          setLoadingProgress(0.4)
          let heightTex = null
          let hStatus = false
          if (!heightEntry) {
            heightTex = extractHeight(src)
            hStatus = heightTex ? 'alpha' : false
            if (!heightTex) {
              heightTex = extractHeightFromNormal(src)
              hStatus = heightTex ? 'normal' : false
            }
          }
          setLoadingProgress(0.9)
          if (material.userData.shaderRefs) {
            disposeTexture(material.userData.shaderRefs.heightMap.value)
            material.userData.shaderRefs.heightMap.value = heightTex
            material.userData.shaderRefs.hasHeightMap.value = heightTex && parallaxEnabled ? 1.0 : 0.0
            if (heightTex) {
              applyHeightFilter(heightTex)
              material.userData.shaderRefs.uHeightTexSize.value.set(heightTex.image.width, heightTex.image.height)
            }
          } else {
            disposeTexture(material.userData.pendingHeightMap)
            material.userData.pendingHeightMap = heightTex
          }
          if (side === 'left' && heightDetectCallback) heightDetectCallback(hStatus)
          material.needsUpdate = true
          if (side === 'left') {
            setLoadingProgress(1.0)
            setTimeout(hideLoading, 200)
          }
        })
      })
    }
    if (typeof createImageBitmap !== 'undefined') {
      fetch(nUrl)
        .then(r => r.blob())
        .then(blob => createImageBitmap(blob, { premultiplyAlpha: 'none' }))
        .then(bitmap => {
          processNormal(bitmap)
          if (bitmap.close) bitmap.close()
        })
        .catch(() => {
          const img = new Image()
          img.onload = () => processNormal(img)
          img.src = nUrl
        })
    } else {
      const img = new Image()
      img.onload = () => processNormal(img)
      img.src = nUrl
    }
  } else if (!heightEntry) {
    if (side === 'left' && heightDetectCallback) heightDetectCallback(false)
  }

  if (heightEntry) {
    const hUrl = fileUrl(heightEntry.fullPath)
    const hImg = new Image()
    hImg.crossOrigin = 'anonymous'
    hImg.onload = () => {
      if (material.userData.loadVer !== myVer) return
      const canvas = document.createElement('canvas')
      canvas.width = hImg.naturalWidth
      canvas.height = hImg.naturalHeight
      const ctx = canvas.getContext('2d', { willReadFrequently: true })
      ctx.drawImage(hImg, 0, 0)
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height)
      normalizeHeightChannels(data)
      ctx.putImageData(data, 0, 0)
      const hTex = new THREE.CanvasTexture(canvas)
      hTex.colorSpace = THREE.NoColorSpace
      hTex.wrapS = hTex.wrapT = THREE.RepeatWrapping
      applyHeightFilter(hTex)
      if (material.userData.shaderRefs) {
        disposeTexture(material.userData.shaderRefs.heightMap.value)
        material.userData.shaderRefs.heightMap.value = hTex
        material.userData.shaderRefs.hasHeightMap.value = hTex && parallaxEnabled ? 1.0 : 0.0
        material.userData.shaderRefs.uHeightTexSize.value.set(hTex.image.width, hTex.image.height)
      } else {
        disposeTexture(material.userData.pendingHeightMap)
        material.userData.pendingHeightMap = hTex
      }
      if (side === 'left' && heightDetectCallback) heightDetectCallback('file')
      material.needsUpdate = true
    }
    hImg.src = hUrl
  }

  if (specEntry) {
    const specImg = new Image()
    specImg.onload = async () => {
      if (material.userData.loadVer !== myVer) return
      let fmt = materialFormat
      if (fmt === 'auto') {
        fmt = detectFormat(specImg)
        if (formatDetectCallback) formatDetectCallback(fmt)
      }
      disposeTexture(material.roughnessMap)
      disposeTexture(material.metalnessMap)
      disposeTexture(material.emissiveMap)
      if (fmt === 'old') {
        ;[material.roughnessMap, material.metalnessMap, material.emissiveMap] = await Promise.all([
          extractChannel(specImg, 0, true),
          extractChannel(specImg, 1, false),
          extractChannel(specImg, 2, false),
        ])
        applyTextureFilter(material.roughnessMap)
        applyTextureFilter(material.metalnessMap)
        applyTextureFilter(material.emissiveMap)
        material.emissive.set(0xffffff)
        material.emissiveIntensity = emissiveIntensity
        material.needsUpdate = true
      } else {
        ;[material.roughnessMap, material.metalnessMap] = await Promise.all([
          extractRoughness(specImg),
          extractMetalness(specImg),
        ])
        applyTextureFilter(material.roughnessMap)
        applyTextureFilter(material.metalnessMap)
        if (mainEntry) {
          const mainImg = new Image()
          mainImg.onload = () => {
            if (material.userData.loadVer !== myVer) return
            disposeTexture(material.emissiveMap)
            material.emissiveMap = extractEmissive(specImg, mainImg)
            applyTextureFilter(material.emissiveMap)
            material.emissive.set(0xffffff)
            material.emissiveIntensity = emissiveIntensity
            material.needsUpdate = true
          }
          mainImg.src = fileUrl(mainEntry.fullPath)
        } else {
          material.emissive.set(0x000000)
        }
        material.needsUpdate = true
      }
    }
    specImg.src = fileUrl(specEntry.fullPath)
  } else {
    material.emissive.set(0x000000)
  }
  material.needsUpdate = true
}

export function updateMaterial3D(group) {
  if (!initialized) return
  if (group) clearCustomModel()
  if (!group && heightDetectCallback) heightDetectCallback(false)
  applyTexturesToMesh(meshLeft, group, 'left')
  applyTexturesToMesh(meshRight, group, 'right')
}

export function clearMaterial3D() {
  updateMaterial3D(null)
}

/* ── 自定义模型（MC .json / .bbmodel）：3D 视口渲染通道 ──────────
   group 的内容需以自身原点为几何中心（缩放适配与贴地由本函数完成），
   wrapper 原点保持在模型中心，旋转（拖拽/自动旋转）围绕中心进行。 */
export function showCustomModel(group) {
  if (!initialized || !group) return false
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
    meshLeft.visible = false
    meshRight.visible = false
    labelLeft.visible = false
    labelRight.visible = false
    customModelGroup = wrapper
    markShaderMatsDirty()
    scene.add(wrapper)

    return true
  } catch {
    return false
  }
}

export function showCustomModelPair(leftGroup, rightGroup) {
  if (!initialized) return false
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
    meshLeft.visible = false
    meshRight.visible = false
    labelLeft.visible = true
    labelRight.visible = true
    labelLeft.position.set(-1.1, -0.95, 0)
    labelRight.position.set(1.1, -0.95, 0)
    customModelGroup = wrapper
    markShaderMatsDirty()
    scene.add(wrapper)

    return true
  } catch {
    return false
  }
}

export function clearCustomModel() {
  if (!customModelGroup) return
  scene.remove(customModelGroup)
  disposeGroupDeep(customModelGroup)
  customModelGroup = null
  markShaderMatsDirty()
  if (initialized) applySourceSide()
}

export function isCustomModelActive() {
  return !!customModelGroup
}

/* 空模型提示（air / structure_void 等无 elements 且无 textures 的方块）：
   在当前活跃视口上叠加一行说明文字，避免空白视口令人困惑。
   text 为空字符串 → 隐藏所有 host 上的提示 */
export function setModelEmptyHint(text) {
  if (!initialized) return
  const active = activeHost()
  for (const h of hosts) {
    let el = h.querySelector('.m3d-model-empty')
    if (h !== active || !text) {
      if (el) el.style.display = 'none'
      continue
    }
    if (!el) {
      el = document.createElement('div')
      el.className = 'm3d-model-empty'
      h.appendChild(el)
    }
    el.textContent = text
    el.style.display = ''
  }
}

export function hasVisibleViewport() {
  if (!initialized) return false
  return !!findVisibleHost()
}

function disposeGroupDeep(root) {
  root.traverse(o => {
    if (o.geometry) o.geometry.dispose()
    const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : []
    /* userData.shared 标记的跨模型共享材质（隐藏面/占位）不 dispose */
    for (const m of mats) {
      if (!(m && m.userData && m.userData.shared)) m.dispose()
    }
  })
}

/* ════════════════════════════════════════════════════════════
   节点编辑器联动 API
   ════════════════════════════════════════════════════════════ */
export function isMaterial3DReady() {
  return initialized
}
export function setBaseColor(rgb) {
  if (!initialized || !Array.isArray(rgb)) return
  const r = clamp01(rgb[0]),
    g = clamp01(rgb[1]),
    b = clamp01(rgb[2])
  meshLeft.material.color.setRGB(r, g, b)
  meshRight.material.color.setRGB(r, g, b)
  meshLeft.material.needsUpdate = meshRight.material.needsUpdate = true
}
export function setEmissiveColor(rgb) {
  if (!initialized || !Array.isArray(rgb)) return
  const r = clamp01(rgb[0]),
    g = clamp01(rgb[1]),
    b = clamp01(rgb[2])
  meshLeft.material.emissive.setRGB(r, g, b)
  meshRight.material.emissive.setRGB(r, g, b)
  meshLeft.material.needsUpdate = meshRight.material.needsUpdate = true
}
function clamp01(v) {
  return Math.max(0, Math.min(1, v))
}
export function setMainTextureFromUrl(url) {
  if (!initialized || !url) return
  const loader = new THREE.TextureLoader()
  for (const m of [meshLeft, meshRight]) {
    loader.load(url, tex => {
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
  if (!initialized || !url) return
  const loader = new THREE.TextureLoader()
  for (const m of [meshLeft, meshRight]) {
    loader.load(url, tex => {
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping
      disposeTexture(m.material.normalMap)
      m.material.normalMap = tex
      m.material.normalScale.set(normalScale, normalScale)
      applyTextureFilter(tex)
      m.material.needsUpdate = true
    })
  }
}
export function clearMainTexture() {
  if (!initialized) return
  for (const m of [meshLeft, meshRight]) {
    disposeTexture(m.material.map)
    m.material.map = null
    m.material.needsUpdate = true
  }
}
export function clearNormalMap() {
  if (!initialized) return
  for (const m of [meshLeft, meshRight]) {
    disposeTexture(m.material.normalMap)
    m.material.normalMap = null
    m.material.needsUpdate = true
  }
}
/* 高光/镜面贴图（-s）：R 通道反转→粗糙度，G 通道→金属度（与 labpbr 格式一致） */
function applySpecTextureToMaterial(mat, url) {
  if (!mat || !url) return
  const specImg = new Image()
  specImg.crossOrigin = 'anonymous'
  specImg.onload = async () => {
    disposeTexture(mat.roughnessMap)
    disposeTexture(mat.metalnessMap)
    ;[mat.roughnessMap, mat.metalnessMap] = await Promise.all([
      extractRoughness(specImg),
      extractMetalness(specImg),
    ])
    applyTextureFilter(mat.roughnessMap)
    applyTextureFilter(mat.metalnessMap)
    mat.needsUpdate = true
  }
  specImg.src = url
}
function clearSpecTexture(mat) {
  if (!mat) return
  disposeTexture(mat.roughnessMap)
  disposeTexture(mat.metalnessMap)
  mat.roughnessMap = null
  mat.metalnessMap = null
  mat.needsUpdate = true
}
export function setSpecularFromUrl(url) {
  if (!initialized || !url) return
  for (const m of [meshLeft, meshRight]) applySpecTextureToMaterial(m.material, url)
}
export function clearSpecularTexture() {
  if (!initialized) return
  for (const m of [meshLeft, meshRight]) clearSpecTexture(m.material)
}

/* 从法线贴图提取高度并写入视差 uniform（模型通道回退）。
     仅在视差材质（有 shaderRefs 或 pendingHeightMap 机制）且未成功加载显式 _h 贴图时生效。
     shaderRefs 未就绪（onBeforeCompile 尚未调用）时存入 pendingHeightMap，由 makeMaterial 的 onBeforeCompile 接管。 */
function applyHeightFromNormalFallback(mat, image) {
  if (!mat.userData) return
  if (mat.userData.explicitHeightLoaded) return
  if (mat.userData.shaderRefs == null && mat.userData.pendingHeightMap === undefined) return
  let hTex = extractHeight(image)
  if (!hTex) hTex = extractHeightFromNormal(image)
  if (!hTex) return
  if (mat.userData.shaderRefs) {
    disposeTexture(mat.userData.shaderRefs.heightMap.value)
    mat.userData.shaderRefs.heightMap.value = hTex
    mat.userData.shaderRefs.hasHeightMap.value = parallaxEnabled ? 1.0 : 0.0
    mat.userData.shaderRefs.uHeightTexSize.value.set(hTex.image.width, hTex.image.height)
  } else {
    disposeTexture(mat.userData.pendingHeightMap)
    mat.userData.pendingHeightMap = hTex
  }
  mat.needsUpdate = true
}

/* 应用 PBR 贴图到模型面材质（法线/高光）。
     normalUrl/specUrl：非空字符串 → 加载应用；空串 → 清除对应 map；null/undefined → 不动。
     force=true 跳过 replaced 守卫（编辑器替换主图后强制覆盖旧 PBR；模型加载流程保持 replaced 守卫阻断竞态） */
export function applyPbrMapsToModelMaterial(mat, normalUrl, specUrl, force, heightUrl) {
  if (!mat) return

  const blocked = () => !force && mat.userData && mat.userData.replaced
  let normalImgLoaded = null
  let heightFallbackPending = false
  if (normalUrl != null) {
    if (normalUrl === '') {
      disposeTexture(mat.normalMap)
      mat.normalMap = null
      mat.needsUpdate = true
    } else {
      const img = new Image()
      img.crossOrigin = 'anonymous'
      img.onload = () => {
        if (blocked()) return
        disposeTexture(mat.normalMap)
        const nTex = reconstructNormal(img)
        nTex.magFilter = THREE.NearestFilter
        nTex.minFilter = THREE.NearestFilter
        mat.normalMap = nTex
        if (mat.normalScale) mat.normalScale.set(1.0, 1.0)
        mat.needsUpdate = true
        normalImgLoaded = img
        if (heightUrl == null) applyHeightFromNormalFallback(mat, img)
        else if (heightFallbackPending) applyHeightFromNormalFallback(mat, img)
      }
      img.src = normalUrl
    }
  }
  if (specUrl != null) {
    if (specUrl === '') {
      disposeTexture(mat.roughnessMap)
      disposeTexture(mat.metalnessMap)
      mat.roughnessMap = null
      mat.metalnessMap = null
      mat.needsUpdate = true
    } else {
      const img = new Image()
      img.crossOrigin = 'anonymous'
      img.onload = async () => {
        if (blocked()) return
        disposeTexture(mat.roughnessMap)
        disposeTexture(mat.metalnessMap)
        const [rTex, mTex] = await Promise.all([extractRoughness(img), extractMetalness(img)])
        rTex.magFilter = THREE.NearestFilter
        rTex.minFilter = THREE.NearestFilter
        mTex.magFilter = THREE.NearestFilter
        mTex.minFilter = THREE.NearestFilter
        mat.roughnessMap = rTex
        mat.metalnessMap = mTex
        mat.needsUpdate = true
      }
      img.src = specUrl
    }
  }
  if (heightUrl != null) {
    if (heightUrl === '') {
      if (mat.userData.shaderRefs) {
        disposeTexture(mat.userData.shaderRefs.heightMap.value)
        mat.userData.shaderRefs.heightMap.value = null
        mat.userData.shaderRefs.hasHeightMap.value = 0.0
      }
      disposeTexture(mat.userData.pendingHeightMap)
      mat.userData.pendingHeightMap = null
      mat.needsUpdate = true
    } else {
      const img = new Image()
      img.crossOrigin = 'anonymous'
      img.onload = () => {
        if (blocked()) return
        const canvas = document.createElement('canvas')
        canvas.width = img.naturalWidth
        canvas.height = img.naturalHeight
        const ctx = canvas.getContext('2d', { willReadFrequently: true })
        ctx.drawImage(img, 0, 0)
        const data = ctx.getImageData(0, 0, canvas.width, canvas.height)
        normalizeHeightChannels(data)
        ctx.putImageData(data, 0, 0)
        const hTex = new THREE.CanvasTexture(canvas)
        hTex.colorSpace = THREE.NoColorSpace
        hTex.wrapS = hTex.wrapT = THREE.RepeatWrapping
        applyHeightFilter(hTex)
        if (mat.userData) mat.userData.explicitHeightLoaded = true
        if (mat.userData.shaderRefs) {
          disposeTexture(mat.userData.shaderRefs.heightMap.value)
          mat.userData.shaderRefs.heightMap.value = hTex
          mat.userData.shaderRefs.hasHeightMap.value = hTex && parallaxEnabled ? 1.0 : 0.0
          mat.userData.shaderRefs.uHeightTexSize.value.set(hTex.image.width, hTex.image.height)
        } else {
          disposeTexture(mat.userData.pendingHeightMap)
          mat.userData.pendingHeightMap = hTex
        }
        mat.needsUpdate = true
      }
      img.onerror = () => {

        if (blocked()) return
        if (normalImgLoaded) applyHeightFromNormalFallback(mat, normalImgLoaded)
        else heightFallbackPending = true
      }
      img.src = heightUrl
    }
  }
  markShaderMatsDirty()
}
export function applyNodePBR(p) {
  if (!initialized || !p) return
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
  if (!initialized || !p) return
  if (p.mainTextureUrl) clearCustomModel()
  const mesh = side === 'left' ? meshLeft : meshRight
  if (!mesh) return
  const mat = mesh.material
  if (p.baseColor && Array.isArray(p.baseColor)) {
    mat.color.setRGB(clamp01(p.baseColor[0]), clamp01(p.baseColor[1]), clamp01(p.baseColor[2]))
    mat.needsUpdate = true
  }
  if (typeof p.roughness === 'number') mat.roughness = clamp01(p.roughness)
  if (typeof p.metallic === 'number') mat.metalness = clamp01(p.metallic)
  if (typeof p.normalScale === 'number') mat.normalScale.set(p.normalScale, p.normalScale)
  if (typeof p.opacity === 'number') {
    opacityValue = p.opacity
    applyOpacityMode(mat)
  }
  if (p.emissive && Array.isArray(p.emissive)) {
    mat.emissive.setRGB(clamp01(p.emissive[0]), clamp01(p.emissive[1]), clamp01(p.emissive[2]))
    mat.needsUpdate = true
  }
  if (p.mainTextureUrl) {
    const loader = new THREE.TextureLoader()
    loader.load(p.mainTextureUrl, tex => {
      tex.colorSpace = THREE.SRGBColorSpace
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping
      disposeTexture(mat.map)
      mat.map = tex
      applyTextureFilter(tex)
      mat.needsUpdate = true
    })
  } else if (p.mainTextureUrl === null) {
    disposeTexture(mat.map)
    mat.map = null
    mat.needsUpdate = true
  }
  if (p.normalMapUrl) {
    const loader = new THREE.TextureLoader()
    loader.load(p.normalMapUrl, tex => {
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping
      disposeTexture(mat.normalMap)
      mat.normalMap = tex
      mat.normalScale.set(normalScale, normalScale)
      applyTextureFilter(tex)
      mat.needsUpdate = true
    })
  } else if (p.normalMapUrl === null) {
    disposeTexture(mat.normalMap)
    mat.normalMap = null
    mat.needsUpdate = true
  }
  if (p.specTextureUrl) {
    applySpecTextureToMaterial(mat, p.specTextureUrl)
  } else if (p.specTextureUrl === null) {
    clearSpecTexture(mat)
  }
  if (typeof p.envIntensity === 'number') setEnvIntensity(p.envIntensity)
  if (typeof p.exposure === 'number') setExposure(p.exposure)
  if (p.lightPreset) setLightPreset(p.lightPreset)
  if (p.geometry) setGeometry(p.geometry)
}
export function getMaterial3DInfo() {
  if (!initialized) return null
  const m = meshLeft.material
  return {
    color: [m.color.r, m.color.g, m.color.b],
    roughness: m.roughness,
    metalness: m.metalness,
    normalScale,
    emissiveIntensity,
    envIntensity,
    hasMap: !!m.map,
    hasNormalMap: !!m.normalMap
  }
}

/* 几何与格式工具 依赖注入 */
setGeoUtilsHooks({
  imgW: imgW,
  imgH: imgH,
  get_initialized: () => initialized,
  get_customModelGroup: () => customModelGroup,
  get_sourceSide: () => sourceSide,
  get_meshLeft: () => meshLeft,
  get_meshRight: () => meshRight,
  get_labelLeft: () => labelLeft,
  get_labelRight: () => labelRight
})

/* 材质构建 依赖注入 */
setMaterialHooks({
  get_emissiveIntensity: () => emissiveIntensity,
  get_parallaxEnabled: () => parallaxEnabled,
  get_parallaxScale: () => parallaxScale,
  get_parallaxSteps: () => parallaxSteps,
  get_parallaxMode: () => parallaxMode,
  get_parallaxAdaptive: () => parallaxAdaptive,
  get_parallaxShadow: () => parallaxShadow,
  get_isWebGL2: () => isWebGL2
})

/* 控制与生命周期 依赖注入 */
setHooks({
  clampFlyPos: clampFlyPos,
  resetFreeView: resetFreeView,
  disposeTexture: disposeTexture,
  disposeGroupDeep: disposeGroupDeep,
  markShaderMatsDirty: markShaderMatsDirty,
  get_renderer: () => renderer,
  get_freeCamMode: () => freeCamMode,
  get_camDist: () => camDist,
  get__flyForward: () => _flyForward,
  get_camera: () => camera,
  get_flyPos: () => flyPos,
  get_FLY_KEYS: () => FLY_KEYS,
  get_flyKeys: () => flyKeys,
  get_animationId: () => animationId,
  get_scene: () => scene,
  get_meshLeft: () => meshLeft,
  get_meshRight: () => meshRight,
  get_groundMesh: () => groundMesh,
  get_gridHelper: () => gridHelper,
  get_envTexture: () => envTexture,
  get_pmremTexture: () => pmremTexture,
  get_hdrTextureOriginal: () => hdrTextureOriginal,
  get_hdrTextureRotated: () => hdrTextureRotated,
  get_skyEnvTexture: () => skyEnvTexture,
  get_pmrem: () => pmrem,
  get_isDragging: () => isDragging,
  set_isDragging: v => { isDragging = v },
  get_autoRotate: () => autoRotate,
  set_autoRotate: v => { autoRotate = v },
  get_lastX: () => lastX,
  set_lastX: v => { lastX = v },
  get_lastY: () => lastY,
  set_lastY: v => { lastY = v },
  get_dragMode: () => dragMode,
  set_dragMode: v => { dragMode = v },
  get_flyYaw: () => flyYaw,
  set_flyYaw: v => { flyYaw = v },
  get_flyPitch: () => flyPitch,
  set_flyPitch: v => { flyPitch = v },
  get_targetRotY: () => targetRotY,
  set_targetRotY: v => { targetRotY = v },
  get_targetRotX: () => targetRotX,
  set_targetRotX: v => { targetRotX = v },
  get_targetPanX: () => targetPanX,
  set_targetPanX: v => { targetPanX = v },
  get_targetPanY: () => targetPanY,
  set_targetPanY: v => { targetPanY = v },
  get_targetCamDist: () => targetCamDist,
  set_targetCamDist: v => { targetCamDist = v },
  get_skyBakeTimer: () => skyBakeTimer,
  set_skyBakeTimer: v => { skyBakeTimer = v },
  get_hdrRotateTimer: () => hdrRotateTimer,
  set_hdrRotateTimer: v => { hdrRotateTimer = v },
  get_customModelGroup: () => customModelGroup,
  set_customModelGroup: v => { customModelGroup = v },
  get_skyMesh: () => skyMesh,
  set_skyMesh: v => { skyMesh = v },
  get_initialized: () => initialized,
  set_initialized: v => { initialized = v }
})

/* 材质滤镜与透明度 依赖注入 */
setMaterialFiltersHooks({
  get_opacityMode: () => opacityMode,
  get_transmissionValue: () => transmissionValue,
  get_iorValue: () => iorValue,
  get_opacityValue: () => opacityValue,
  get_alignOfficial: () => alignOfficial,
  get_anisotropyLevel: () => anisotropyLevel,
  get_maxAnisotropy: () => maxAnisotropy,
  get_mipmapsEnabled: () => mipmapsEnabled,
  get_textureFilter: () => textureFilter,
  set_textureFilter: v => { textureFilter = v }
})

/* EnvironmentLighting 依赖注入 */
setEnvironmentLightingHooks({
  get_lightGroup: () => lightGroup,
  get_initialized: () => initialized,
  get_pmrem: () => pmrem,
  get_scene: () => scene,
  get_meshLeft: () => meshLeft,
  get_meshRight: () => meshRight,
  get__skyTint: () => _skyTint,
  get_currentLightPreset: () => currentLightPreset,
  set_currentLightPreset: v => { currentLightPreset = v },
  get_customLightConfig: () => customLightConfig,
  set_customLightConfig: v => { customLightConfig = v },
  get_currentEnvMode: () => currentEnvMode,
  set_currentEnvMode: v => { currentEnvMode = v },
  get_envTexture: () => envTexture,
  set_envTexture: v => { envTexture = v },
  get_pmremTexture: () => pmremTexture,
  set_pmremTexture: v => { pmremTexture = v },
  get_envIntensity: () => envIntensity,
  set_envIntensity: v => { envIntensity = v },
  get_skyMesh: () => skyMesh,
  set_skyMesh: v => { skyMesh = v },
  get_skySunElevation: () => skySunElevation,
  set_skySunElevation: v => { skySunElevation = v },
  get_skySunAzimuth: () => skySunAzimuth,
  set_skySunAzimuth: v => { skySunAzimuth = v },
  get_skyTurbidity: () => skyTurbidity,
  set_skyTurbidity: v => { skyTurbidity = v },
  get_skyRayleigh: () => skyRayleigh,
  set_skyRayleigh: v => { skyRayleigh = v },
  get_skyMieCoefficient: () => skyMieCoefficient,
  set_skyMieCoefficient: v => { skyMieCoefficient = v },
  get_skyMieDirectionalG: () => skyMieDirectionalG,
  set_skyMieDirectionalG: v => { skyMieDirectionalG = v },
  get_skyTintHex: () => skyTintHex,
  set_skyTintHex: v => { skyTintHex = v },
  get_skySunLight: () => skySunLight,
  set_skySunLight: v => { skySunLight = v },
  get_skyEnvTexture: () => skyEnvTexture,
  set_skyEnvTexture: v => { skyEnvTexture = v },
  get_skyBakeTimer: () => skyBakeTimer,
  set_skyBakeTimer: v => { skyBakeTimer = v },
  get_hdrTexture: () => hdrTexture,
  set_hdrTexture: v => { hdrTexture = v },
  get_hdrTextureOriginal: () => hdrTextureOriginal,
  set_hdrTextureOriginal: v => { hdrTextureOriginal = v },
  get_hdrRotation: () => hdrRotation,
  set_hdrRotation: v => { hdrRotation = v },
  get_hdrUsage: () => hdrUsage,
  set_hdrUsage: v => { hdrUsage = v },
  get_hdrTextureRotated: () => hdrTextureRotated,
  set_hdrTextureRotated: v => { hdrTextureRotated = v },
  get_hdrInfo: () => hdrInfo,
  set_hdrInfo: v => { hdrInfo = v },
  get_hdrRotateTimer: () => hdrRotateTimer,
  set_hdrRotateTimer: v => { hdrRotateTimer = v }
})