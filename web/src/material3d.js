/**
 * matoga - 材质贴图对比工具
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 */

import * as THREE from 'three'
import { fileUrl, isImageFile } from './utils.js'
import { HDRLoader } from './hdr-loader.js'
import { loadEnvTexture, extFromUrl } from './hdr-env-loader.js'
import { Sky } from './sky.js'
import { t as _t } from './i18n.js'
import { attachTextureAnimOnly, unloadTextureAnim } from './mc-model-viewer.js'
import { computeTangents } from './m3d/geometry.js'
import { LIGHT_PRESETS } from './m3d/presets.js'
import { rotateTextureData, detectFormat, reconstructNormal, applySourceSide, setHooks as setGeoUtilsHooks } from './m3d/geo-utils.js'
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

function createEnvTexture(presetKey) {
  const preset = LIGHT_PRESETS[presetKey] || LIGHT_PRESETS.studio
  const env = preset.env
  const w = 512,
    h = 256
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  const grad = ctx.createLinearGradient(0, 0, 0, h)
  grad.addColorStop(0, env.colors[0])
  grad.addColorStop(0.5, env.colors[1])
  grad.addColorStop(1, env.colors[2])
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, w, h)
  const bandY = h * 0.22,
    bandH = h * 0.18
  for (let i = 0; i < 4; i++) {
    const cx = w * (0.125 + i * 0.25),
      halfW = w * 0.05
    const lg = ctx.createLinearGradient(cx - halfW, 0, cx + halfW, 0)
    lg.addColorStop(0, 'rgba(255,255,255,0)')
    lg.addColorStop(0.5, 'rgba(255,255,255,0.55)')
    lg.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = lg
    ctx.fillRect(cx - halfW, bandY, halfW * 2, bandH)
  }
  const bandY2 = h * 0.72,
    bandH2 = h * 0.1
  for (let i = 0; i < 3; i++) {
    const cx = w * (0.17 + i * 0.33),
      halfW = w * 0.04
    const lg = ctx.createLinearGradient(cx - halfW, 0, cx + halfW, 0)
    lg.addColorStop(0, 'rgba(255,255,255,0)')
    lg.addColorStop(0.5, 'rgba(255,255,255,0.25)')
    lg.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = lg
    ctx.fillRect(cx - halfW, bandY2, halfW * 2, bandH2)
  }
  if (env.light) {
    const sx = w / 256,
      sy = h / 256
    const lx = env.light.x * sx,
      ly = env.light.y * sy,
      lr = env.light.r * sx
    const rg = ctx.createRadialGradient(lx, ly, 0, lx, ly, lr)
    rg.addColorStop(0, env.light.color)
    rg.addColorStop(0.6, env.light.color)
    rg.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.fillStyle = rg
    ctx.fillRect(0, 0, w, h)
  }
  const tex = new THREE.CanvasTexture(canvas)
  tex.mapping = THREE.EquirectangularReflectionMapping
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

function cloneLightConfig(config) {
  return {
    ambient: { color: config.ambient.color, intensity: config.ambient.intensity },
    lights: config.lights.map(l => ({ color: l.color, intensity: l.intensity, pos: [l.pos[0], l.pos[1], l.pos[2]] })),
    bg: config.bg
  }
}

function rebuildLights(config) {
  if (!lightGroup) return
  while (lightGroup.children.length) lightGroup.remove(lightGroup.children[0])
  const ambient = new THREE.AmbientLight(config.ambient.color, config.ambient.intensity)
  lightGroup.add(ambient)
  for (let i = 0; i < config.lights.length; i++) {
    const l = config.lights[i]
    const dir = new THREE.DirectionalLight(l.color, l.intensity)
    dir.position.set(l.pos[0], l.pos[1], l.pos[2])
    dir.castShadow = i === 0
    dir.shadow.mapSize.set(512, 512)
    dir.shadow.camera.left = -3
    dir.shadow.camera.right = 3
    dir.shadow.camera.top = 3
    dir.shadow.camera.bottom = -3
    dir.shadow.camera.near = 0.1
    dir.shadow.camera.far = 15
    lightGroup.add(dir)
  }
}

let customLightConfig = null

function applyLightPreset(presetKey) {
  if (!initialized || !LIGHT_PRESETS[presetKey]) return
  currentLightPreset = presetKey
  const preset = LIGHT_PRESETS[presetKey]
  customLightConfig = cloneLightConfig(preset)
  rebuildLights(preset)
  if (currentEnvMode === 'custom') {
    if (envTexture) envTexture.dispose()
    envTexture = createEnvTexture(presetKey)
    if (pmremTexture) pmremTexture.dispose()
    pmremTexture = pmrem.fromEquirectangular(envTexture)
    scene.environment = pmremTexture.texture
    scene.background = new THREE.Color(preset.bg)
  }
  if (scene) scene.environmentIntensity = envIntensity
  for (const m of [meshLeft, meshRight]) {
    if (m) m.material.envMapIntensity = envIntensity
  }
}

function applyCustomLightConfig(config) {
  if (!initialized || !config || !config.ambient || !Array.isArray(config.lights)) return
  customLightConfig = cloneLightConfig(config)
  rebuildLights(customLightConfig)
  if (currentEnvMode === 'custom') {
    scene.background = new THREE.Color(customLightConfig.bg)
  }
  if (scene) scene.environmentIntensity = envIntensity
  for (const m of [meshLeft, meshRight]) {
    if (m) m.material.envMapIntensity = envIntensity
  }
}

function updateSkySunPosition() {
  if (!skyMesh) return
  const u = skyMesh.material.uniforms
  const elevation = (skySunElevation * Math.PI) / 180
  const azimuth = (skySunAzimuth * Math.PI) / 180
  const phi = Math.PI / 2 - elevation
  const sun = new THREE.Vector3()
  sun.setFromSphericalCoords(1, phi, azimuth)
  u.sunPosition.value.copy(sun)
  u.turbidity.value = skyTurbidity
  u.rayleigh.value = skyRayleigh
  u.mieCoefficient.value = skyMieCoefficient
  u.mieDirectionalG.value = skyMieDirectionalG

  _skyTint.setHex(skyTintHex)
  u.skyTint.value.set(_skyTint.r, _skyTint.g, _skyTint.b)
  if (skySunLight) {
    skySunLight.position.copy(sun).multiplyScalar(10)
    const dayFactor = Math.max(0, Math.sin(elevation))
    skySunLight.intensity = 2.5 * dayFactor
  }
}

function bakeSkyEnvironment() {
  if (!skyMesh || !pmrem) return
  const u = skyMesh.material.uniforms
  const prevSunDisc = u.showSunDisc.value
  u.showSunDisc.value = 0
  const skyScene = new THREE.Scene()
  scene.remove(skyMesh)
  skyScene.add(skyMesh)
  if (skyEnvTexture) skyEnvTexture.dispose()
  skyEnvTexture = pmrem.fromScene(skyScene)
  scene.environment = skyEnvTexture.texture
  skyScene.remove(skyMesh)
  scene.add(skyMesh)
  u.showSunDisc.value = prevSunDisc
  if (scene) scene.environmentIntensity = envIntensity
  for (const m of [meshLeft, meshRight]) {
    if (m) m.material.envMapIntensity = envIntensity
  }
}

function scheduleSkyBake() {
  clearTimeout(skyBakeTimer)
  skyBakeTimer = setTimeout(() => {
    skyBakeTimer = null
    if (initialized && currentEnvMode === 'sky') bakeSkyEnvironment()
  }, 120)
}

function applyProceduralSky() {
  if (!initialized) return
  if (hdrTexture) {
    hdrTexture.dispose()
    hdrTexture = null
  }
  if (envTexture) {
    envTexture.dispose()
    envTexture = null
  }
  if (pmremTexture) {
    pmremTexture.dispose()
    pmremTexture = null
  }
  if (lightGroup) {
    while (lightGroup.children.length) lightGroup.remove(lightGroup.children[0])
  }
  const ambient = new THREE.AmbientLight(0xffffff, 0.15)
  lightGroup.add(ambient)
  if (!skySunLight) {
    skySunLight = new THREE.DirectionalLight(0xffffff, 2.5)
    skySunLight.castShadow = true
    skySunLight.shadow.mapSize.set(1024, 1024)
    skySunLight.shadow.camera.left = -3
    skySunLight.shadow.camera.right = 3
    skySunLight.shadow.camera.top = 3
    skySunLight.shadow.camera.bottom = -3
    skySunLight.shadow.camera.near = 0.1
    skySunLight.shadow.camera.far = 50
  }
  lightGroup.add(skySunLight)
  if (!skyMesh) {
    skyMesh = new Sky()
    skyMesh.scale.setScalar(10000)
    scene.add(skyMesh)
  }
  updateSkySunPosition()
  scene.background = null
  bakeSkyEnvironment()
}

function applyHDREnvMode() {
  if (!initialized) return
  if (skyMesh) {
    scene.remove(skyMesh)
    skyMesh = null
  }
  if (skyEnvTexture) {
    skyEnvTexture.dispose()
    skyEnvTexture = null
  }
  if (skySunLight) {
    lightGroup.remove(skySunLight)
    skySunLight = null
  }
  if (envTexture) {
    envTexture.dispose()
    envTexture = null
  }
  if (pmremTexture) {
    pmremTexture.dispose()
    pmremTexture = null
  }
  if (lightGroup) {
    while (lightGroup.children.length) lightGroup.remove(lightGroup.children[0])
  }
  const ambient = new THREE.AmbientLight(0xffffff, 0.1)
  lightGroup.add(ambient)
  if (hdrTextureOriginal) {
    const rad = (hdrRotation * Math.PI) / 180
    hdrTexture = hdrTextureOriginal
    if (hdrUsage === 'env' || hdrUsage === 'both') {
      scene.environment = hdrTextureOriginal
      scene.environmentRotation.set(0, rad, 0)
    } else {
      scene.environment = null
      scene.environmentRotation.set(0, 0, 0)
    }
    if (hdrUsage === 'bg' || hdrUsage === 'both') {
      ensureRotatedTexture()
      scene.background = hdrTextureRotated || hdrTextureOriginal
    } else {
      scene.background = new THREE.Color(0x1a1a2e)
    }
  } else {
    hdrTexture = null
    scene.environment = null
    scene.environmentRotation.set(0, 0, 0)
    scene.background = new THREE.Color(0x1a1a2e)
  }
  if (scene) scene.environmentIntensity = envIntensity
  for (const m of [meshLeft, meshRight]) {
    if (m) m.material.envMapIntensity = envIntensity
  }
}

function ensureRotatedTexture() {
  if (hdrTextureRotated) {
    hdrTextureRotated.dispose()
    hdrTextureRotated = null
  }
  if (hdrTextureOriginal && hdrRotation % 360) {
    hdrTextureRotated = rotateTextureData(hdrTextureOriginal, hdrRotation)
  }
}

function setEnvMode(mode) {
  if (!initialized || !['custom', 'sky', 'hdri'].includes(mode)) return
  currentEnvMode = mode
  if (mode === 'sky') {
    applyProceduralSky()
  } else if (mode === 'hdri') {
    applyHDREnvMode()
  } else {
    if (skyMesh) {
      scene.remove(skyMesh)
      skyMesh = null
    }
    if (skyEnvTexture) {
      skyEnvTexture.dispose()
      skyEnvTexture = null
    }
    if (skySunLight) {
      lightGroup.remove(skySunLight)
      skySunLight = null
    }
    applyLightPreset(currentLightPreset)
  }
}

function imgW(img) {
  return img.naturalWidth || img.width
}
function imgH(img) {
  return img.naturalHeight || img.height
}

function extractChannel(image, channelIndex, invert) {
  const canvas = document.createElement('canvas')
  canvas.width = image.naturalWidth
  canvas.height = image.naturalHeight
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  ctx.drawImage(image, 0, 0)
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const data = imageData.data
  for (let i = 0; i < data.length; i += 4) {
    let v = data[i + channelIndex]
    if (invert) v = 255 - v
    data[i] = v
    data[i + 1] = v
    data[i + 2] = v
    data[i + 3] = 255
  }
  ctx.putImageData(imageData, 0, 0)
  const tex = new THREE.CanvasTexture(canvas)
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  return tex
}

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

function extractRoughness(image) {
  const c = document.createElement('canvas')
  c.width = image.naturalWidth
  c.height = image.naturalHeight
  const ctx = c.getContext('2d', { willReadFrequently: true })
  ctx.drawImage(image, 0, 0)
  const imageData = ctx.getImageData(0, 0, c.width, c.height),
    d = imageData.data
  for (let i = 0; i < d.length; i += 4) {
    const r = 255 - d[i]
    d[i] = r
    d[i + 1] = r
    d[i + 2] = r
    d[i + 3] = 255
  }
  ctx.putImageData(imageData, 0, 0)
  const tex = new THREE.CanvasTexture(c)
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  return tex
}

function extractMetalness(image) {
  const c = document.createElement('canvas')
  c.width = image.naturalWidth
  c.height = image.naturalHeight
  const ctx = c.getContext('2d', { willReadFrequently: true })
  ctx.drawImage(image, 0, 0)
  const imageData = ctx.getImageData(0, 0, c.width, c.height),
    d = imageData.data
  for (let i = 0; i < d.length; i += 4) {
    const v = d[i + 1]
    d[i] = v
    d[i + 1] = v
    d[i + 2] = v
    d[i + 3] = 255
  }
  ctx.putImageData(imageData, 0, 0)
  const tex = new THREE.CanvasTexture(c)
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  return tex
}

function extractEmissive(specImage, mainImage) {
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

function extractHeight(image) {
  const c = document.createElement('canvas')
  c.width = imgW(image)
  c.height = imgH(image)
  const ctx = c.getContext('2d', { willReadFrequently: true })
  ctx.drawImage(image, 0, 0)
  const imageData = ctx.getImageData(0, 0, c.width, c.height),
    d = imageData.data
  let minA = 255,
    maxA = 0
  const buckets = new Set()
  for (let i = 3; i < d.length; i += 4) {
    if (d[i] < minA) minA = d[i]
    if (d[i] > maxA) maxA = d[i]
    if (buckets.size < 8) buckets.add(d[i])
  }
  const range = maxA - minA
  if (range < 1 || buckets.size <= 2) return null
  for (let i = 0; i < d.length; i += 4) {
    const v = Math.round(((d[i + 3] - minA) / range) * 255)
    d[i] = v
    d[i + 1] = v
    d[i + 2] = v
    d[i + 3] = 255
  }
  ctx.putImageData(imageData, 0, 0)
  const tex = new THREE.CanvasTexture(c)
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  applyHeightFilter(tex)
  return tex
}

function extractHeightFromNormal(image) {
  const maxDim = 256
  const ow = imgW(image),
    oh = imgH(image)
  const sc = Math.min(1, maxDim / Math.max(ow, oh))
  const w = Math.max(1, Math.round(ow * sc)),
    h = Math.max(1, Math.round(oh * sc))
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const ctx = c.getContext('2d', { willReadFrequently: true })
  ctx.drawImage(image, 0, 0, w, h)
  const src = ctx.getImageData(0, 0, w, h).data
  const n = w * h
  const gx = new Float32Array(n),
    gy = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const j = i * 4
    gx[i] = (src[j] - 127.5) / 127.5
    gy[i] = (src[j + 1] - 127.5) / 127.5
  }
  const height = new Float32Array(n)
  for (let y = 0; y < h; y++) {
    const row = y * w
    let rowSum = 0
    for (let x = 0; x < w; x++) rowSum += gx[row + x]
    const mean = rowSum / w
    height[row] = 0
    for (let x = 1; x < w; x++) height[row + x] = height[row + x - 1] + (gx[row + x - 1] + gx[row + x]) * 0.5 - mean
  }
  const rowOff = new Float32Array(h)
  for (let y = 1; y < h; y++) {
    const r1 = y * w,
      r0 = (y - 1) * w
    let diff = 0
    for (let x = 0; x < w; x++) diff += (gy[r0 + x] + gy[r1 + x]) * 0.5
    rowOff[y] = rowOff[y - 1] + diff / w
  }
  let minH = Infinity,
    maxH = -Infinity
  for (let y = 0; y < h; y++) {
    const row = y * w,
      off = rowOff[y]
    for (let x = 0; x < w; x++) {
      const v = height[row + x] + off
      height[row + x] = v
      if (v < minH) minH = v
      if (v > maxH) maxH = v
    }
  }
  const range = maxH - minH
  if (range < 1e-4) return null
  const out = ctx.createImageData(w, h),
    od = out.data
  for (let i = 0; i < n; i++) {
    const v = Math.round(((height[i] - minH) / range) * 255)
    od[i * 4] = v
    od[i * 4 + 1] = v
    od[i * 4 + 2] = v
    od[i * 4 + 3] = 255
  }
  ctx.putImageData(out, 0, 0)
  const tex = new THREE.CanvasTexture(c)
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  applyHeightFilter(tex)
  return tex
}

function createLabel(text, color) {
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

function parseIncludes(src) {
  const pattern = /#include <(\w+)>/g
  function replace(match, name) {
    const chunk = THREE.ShaderChunk[name]
    if (!chunk) return match
    return parseIncludes(chunk)
  }
  return src.replace(pattern, replace)
}

function applyOpacityMode(material) {
  const hasAlpha = material.userData.hasAlpha || false
  const hasSemiTrans = material.userData.hasSemiTrans || false
  const mode = opacityMode
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
    material.transmission = transmissionValue
    material.ior = iorValue
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
  if (opacityValue < 1.0) {
    material.transparent = true
    material.opacity = opacityValue
  } else {
    material.opacity = 1.0
  }
  material.needsUpdate = true
}

function applyHeightFilter(tex) {
  if (!tex) return
  tex.generateMipmaps = true
  tex.magFilter = THREE.LinearFilter
  tex.minFilter = THREE.LinearMipmapLinearFilter
  tex.anisotropy = 1
  tex.needsUpdate = true
}

function applyTextureFilter(tex) {
  if (!tex) return
  if (alignOfficial) {
    tex.generateMipmaps = true
    tex.magFilter = THREE.NearestFilter
    tex.minFilter = THREE.NearestMipmapLinearFilter
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping
    tex.anisotropy = Math.min(anisotropyLevel, maxAnisotropy)
    tex.needsUpdate = true
    return
  }
  const useMipmap = mipmapsEnabled && (textureFilter === 'trilinear' || textureFilter === 'anisotropic')
  tex.generateMipmaps = useMipmap
  if (textureFilter === 'nearest') {
    tex.magFilter = THREE.NearestFilter
    tex.minFilter = useMipmap ? THREE.NearestMipmapNearestFilter : THREE.NearestFilter
  } else {
    tex.magFilter = THREE.LinearFilter
    tex.minFilter = useMipmap ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter
  }
  tex.anisotropy = textureFilter === 'anisotropic' && useMipmap ? Math.min(anisotropyLevel, maxAnisotropy) : 1
  tex.needsUpdate = true
}

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

export function makeMaterial() {
  const mat = new THREE.MeshPhysicalMaterial({
    color: 0x888888,
    roughness: 0.5,
    metalness: 0.1,
    envMapIntensity: 1.0,
    emissive: new THREE.Color(0x000000),
    emissiveIntensity: 1.0,
    transmission: 0.0,
    ior: 1.5,
    thickness: 0.5,
    clearcoat: 0.0,
    clearcoatRoughness: 0.0
  })
  mat.userData.shaderRefs = null
  mat.userData.pendingHeightMap = null
  mat.onBeforeCompile = shader => {
    const prev = mat.userData.shaderRefs
    shader.uniforms.heightMap = { value: prev ? prev.heightMap.value : mat.userData.pendingHeightMap }
    shader.uniforms.hasHeightMap = {
      value: prev ? prev.hasHeightMap.value : mat.userData.pendingHeightMap && parallaxEnabled ? 1.0 : 0.0
    }
    shader.uniforms.parallaxScale = { value: parallaxScale }
    shader.uniforms.parallaxSteps = { value: parallaxSteps }
    shader.uniforms.parallaxMode = { value: parallaxMode }
    shader.uniforms.parallaxAdaptive = { value: parallaxAdaptive }
    shader.uniforms.parallaxShadow = { value: parallaxShadow }
    shader.uniforms.uHeightLightDir = { value: prev ? prev.uHeightLightDir.value : new THREE.Vector3(0, 1, 0) }
    shader.uniforms.uHeightTexSize = {
      value: prev
        ? prev.uHeightTexSize.value
        : mat.userData.pendingHeightMap
          ? new THREE.Vector2(mat.userData.pendingHeightMap.image.width, mat.userData.pendingHeightMap.image.height)
          : new THREE.Vector2(256, 256)
    }
    mat.userData.shaderRefs = shader.uniforms
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        'uniform sampler2D heightMap;\nuniform vec2 uHeightTexSize;\nuniform vec3 uHeightLightDir;\nuniform float hasHeightMap;\nuniform float parallaxScale;\nuniform float parallaxSteps;\nuniform float parallaxMode;\nuniform float parallaxAdaptive;\nuniform float parallaxShadow;\n#include <common>'
      )
      .replace(
        '#include <clipping_planes_fragment>',
        `#include <clipping_planes_fragment>
        vec2 parallaxUv;
        #if defined(USE_MAP)
          parallaxUv = vMapUv;
        #elif defined(USE_NORMALMAP)
          parallaxUv = vNormalMapUv;
        #elif defined(USE_ROUGHNESSMAP)
          parallaxUv = vRoughnessMapUv;
        #else
          parallaxUv = vec2(0.0);
        #endif
        float parallaxShadowFactor = 1.0;
        if (abs(parallaxScale) > 0.0 && hasHeightMap > 0.5) {
          vec3 viewDir = normalize(vViewPosition);
          vec2 P;
          float viewDotN;
          vec3 tLight;
          #if defined(USE_TANGENT)
            vec3 t = normalize( vTangent );
            vec3 n = normalize( vNormal );
            vec3 b = normalize( vBitangent );
            vec3 tView;
            tView.x = dot(t, viewDir);
            tView.y = dot(b, viewDir);
            tView.z = dot(n, viewDir);
            tLight.x = dot(t, uHeightLightDir);
            tLight.y = dot(b, uHeightLightDir);
            tLight.z = dot(n, uHeightLightDir);
          #else
            vec3 n = normalize( vNormal );
            if ( !gl_FrontFacing ) n = -n;
            vec3 sp = -vViewPosition;
            vec3 dp1 = dFdx( sp );
            vec3 dp2 = dFdy( sp );
            vec2 duv1 = dFdx( parallaxUv );
            vec2 duv2 = dFdy( parallaxUv );
            vec3 dp2perp = cross( dp2, n );
            vec3 dp1perp = cross( n, dp1 );
            vec3 T = dp2perp * duv1.x + dp1perp * duv2.x;
            vec3 B = dp2perp * duv1.y + dp1perp * duv2.y;
            float invmax = inversesqrt( max( dot(T, T), dot(B, B) ) + 1e-8 );
            vec3 tView;
            tView.x = dot( T * invmax, viewDir );
            tView.y = dot( B * invmax, viewDir );
            tView.z = dot( n, viewDir );
            tLight.x = dot( T * invmax, uHeightLightDir );
            tLight.y = dot( B * invmax, uHeightLightDir );
            tLight.z = dot( n, uHeightLightDir );
          #endif
          viewDotN = clamp(abs(tView.z), 0.0, 1.0);
          P = tView.xy / max(abs(tView.z), 0.05) * parallaxScale;
          float Plen = length(P);
          P *= 1.0 / (1.0 + max(Plen - 0.1, 0.0) * 4.0);
          float uvFade = 1.0;
          ${isWebGL2 ? 'uvFade = 1.0 - smoothstep(0.15, 0.45, length(fwidth(parallaxUv)));' : ''}
          P *= uvFade;
          P *= smoothstep(0.0, 0.2, viewDotN);
          float hMip = 0.0;
          ${isWebGL2 ? 'hMip = log2(max(max(fwidth(parallaxUv.x) * uHeightTexSize.x, fwidth(parallaxUv.y) * uHeightTexSize.y), 1.0));' : ''}
          if (parallaxMode < 0.5) {
            float height = ${isWebGL2 ? 'textureLod( heightMap, parallaxUv, hMip )' : 'texture2D( heightMap, parallaxUv )'}.r;
            parallaxUv = parallaxUv - P * height;
          } else {
            float numLayers = parallaxSteps;
            if (parallaxAdaptive > 0.5) {
              numLayers = mix(parallaxSteps, max(parallaxSteps * 0.3, 4.0), viewDotN);
            }
            numLayers = clamp(numLayers, 4.0, 64.0);
            float layerDepth = 1.0 / numLayers;
            float currentLayerDepth = 0.0;
            vec2 deltaTexCoords = P / numLayers;
            vec2 currentTexCoords = parallaxUv;
            float currentDepthValue = ${isWebGL2 ? 'textureLod( heightMap, currentTexCoords, hMip )' : 'texture2D( heightMap, currentTexCoords )'}.r;
            for (int i = 0; i < 64; i++) {
              if (currentLayerDepth >= currentDepthValue) break;
              currentTexCoords -= deltaTexCoords;
              currentDepthValue = ${isWebGL2 ? 'textureLod( heightMap, currentTexCoords, hMip )' : 'texture2D( heightMap, currentTexCoords )'}.r;
              currentLayerDepth += layerDepth;
            }
            if (parallaxMode < 1.5) {
              parallaxUv = currentTexCoords;
            } else if (parallaxMode < 2.5) {
              vec2 prevTexCoords = currentTexCoords + deltaTexCoords;
              float beforeDepth = ${isWebGL2 ? 'textureLod( heightMap, prevTexCoords, hMip )' : 'texture2D( heightMap, prevTexCoords )'}.r - currentLayerDepth + layerDepth;
              float afterDepth = currentDepthValue - currentLayerDepth;
              float weight = afterDepth / (afterDepth - beforeDepth);
              parallaxUv = mix(currentTexCoords, prevTexCoords, weight);
            } else {
              vec2 prevTexCoords = currentTexCoords + deltaTexCoords;
              float prevLayerDepth = currentLayerDepth - layerDepth;
              for (int j = 0; j < 5; j++) {
                deltaTexCoords *= 0.5;
                layerDepth *= 0.5;
                vec2 midTexCoords = prevTexCoords - deltaTexCoords;
                float midLayerDepth = prevLayerDepth + layerDepth;
                float midDepthValue = ${isWebGL2 ? 'textureLod( heightMap, midTexCoords, hMip )' : 'texture2D( heightMap, midTexCoords )'}.r;
                if (midLayerDepth < midDepthValue) {
                  prevTexCoords = midTexCoords;
                  prevLayerDepth = midLayerDepth;
                } else {
                  currentTexCoords = midTexCoords;
                  currentLayerDepth = midLayerDepth;
                }
              }
              parallaxUv = prevTexCoords;
            }
          }
          if (parallaxShadow > 0.0 && tLight.z > 0.01) {
            float numSS = 8.0;
            vec2 ssDelta = tLight.xy / max(abs(tLight.z), 0.05) * abs(parallaxScale) / numSS;
            float hRay = ${isWebGL2 ? 'textureLod( heightMap, parallaxUv, hMip )' : 'texture2D( heightMap, parallaxUv )'}.r;
            vec2 ssUv = parallaxUv;
            for (int i = 0; i < 8; i++) {
              ssUv += ssDelta;
              hRay += 1.0 / numSS;
              float hSurf = ${isWebGL2 ? 'textureLod( heightMap, ssUv, hMip )' : 'texture2D( heightMap, ssUv )'}.r;
              parallaxShadowFactor = min(parallaxShadowFactor, smoothstep(0.0, 0.06, hRay - hSurf));
            }
            parallaxShadowFactor = mix(1.0, parallaxShadowFactor, parallaxShadow);
          }
        }`
      )
      .replace(
        '#include <lights_fragment_begin>',
        '#include <lights_fragment_begin>\n        reflectedLight.directDiffuse *= parallaxShadowFactor;'
      )
    shader.fragmentShader = parseIncludes(shader.fragmentShader)
    shader.fragmentShader = shader.fragmentShader
      .replace(/texture2D\(\s*map\s*,\s*vMapUv\s*\)/g, 'texture2D( map, parallaxUv )')
      .replace(/texture2D\(\s*normalMap\s*,\s*vNormalMapUv\s*\)/g, 'texture2D( normalMap, parallaxUv )')
      .replace(/texture2D\(\s*roughnessMap\s*,\s*vRoughnessMapUv\s*\)/g, 'texture2D( roughnessMap, parallaxUv )')
      .replace(/texture2D\(\s*metalnessMap\s*,\s*vMetalnessMapUv\s*\)/g, 'texture2D( metalnessMap, parallaxUv )')
      .replace(/texture2D\(\s*emissiveMap\s*,\s*vEmissiveMapUv\s*\)/g, 'texture2D( emissiveMap, parallaxUv )')
  }
  return mat
}

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

function setupControls() {
  const canvas = renderer.domElement
  canvas.style.cursor = 'grab'
  canvas.addEventListener('contextmenu', e => e.preventDefault())
  canvas.addEventListener('mousedown', e => {
    isDragging = true
    autoRotate = false
    lastX = e.clientX
    lastY = e.clientY
    if (freeCamMode) dragMode = 'look'
    else if (e.button === 0 && !e.shiftKey) dragMode = 'rotate'
    else dragMode = 'pan'
    canvas.style.cursor = 'grabbing'
    if (e.button === 1) e.preventDefault()
  })
  canvas.addEventListener('mousemove', e => {
    if (!isDragging) return
    const dx = e.clientX - lastX,
      dy = e.clientY - lastY
    lastX = e.clientX
    lastY = e.clientY
    if (dragMode === 'look') {
      flyYaw -= dx * 0.005
      flyPitch = Math.max(-1.55, Math.min(1.55, flyPitch - dy * 0.005))
    } else if (dragMode === 'rotate') {
      targetRotY += dx * 0.01
      targetRotX += dy * 0.01
      targetRotX = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, targetRotX))
    } else {
      const k = camDist * 0.0015
      targetPanX -= dx * k
      targetPanY += dy * k
    }
  })
  window.addEventListener('mouseup', () => {
    if (isDragging) {
      isDragging = false
      dragMode = null
      canvas.style.cursor = freeCamMode ? 'crosshair' : 'grab'
    }
  })
  canvas.addEventListener(
    'wheel',
    e => {
      e.preventDefault()
      if (freeCamMode) {
        _flyForward.set(0, 0, -1).applyEuler(camera.rotation)
        flyPos.addScaledVector(_flyForward, -e.deltaY * 0.01)
        clampFlyPos()
      } else {
        targetCamDist = Math.max(1.5, Math.min(8, targetCamDist + e.deltaY * 0.003))
      }
    },
    { passive: false }
  )
  canvas.addEventListener('dblclick', () => {
    if (freeCamMode) {
      resetFreeView()
      return
    }
    autoRotate = !autoRotate
    targetRotX = 0
    targetRotY = 0
    targetPanX = 0
    targetPanY = 0
  })
  window.addEventListener('keydown', e => {
    if (!freeCamMode) return
    if (
      e.target &&
      (e.target.tagName === 'INPUT' ||
        e.target.tagName === 'TEXTAREA' ||
        e.target.tagName === 'SELECT' ||
        e.target.isContentEditable)
    )
      return
    if (FLY_KEYS.has(e.code)) {
      flyKeys[e.code] = true
      e.preventDefault()
    }
  })
  window.addEventListener('keyup', e => {
    delete flyKeys[e.code]
  })
  window.addEventListener('blur', () => {
    for (const k in flyKeys) delete flyKeys[k]
  })
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
export function setLightPreset(presetKey) {
  applyLightPreset(presetKey)
  if (currentEnvMode !== 'custom') setEnvMode('custom')
}
export function getCustomLightConfig() {
  return customLightConfig ? cloneLightConfig(customLightConfig) : null
}
export function applyCustomLightConfigExport(config) {
  if (currentEnvMode !== 'custom') setEnvMode('custom')
  applyCustomLightConfig(config)
}
export function setEnvIntensity(val) {
  envIntensity = val
  if (initialized) {
    if (scene) scene.environmentIntensity = val
    for (const m of [meshLeft, meshRight]) {
      if (m) m.material.envMapIntensity = val
    }
  }
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
export async function loadHDREnv(filePath) {
  if (!initialized || !filePath) return
  window.dispatchEvent(new CustomEvent('material3d:hdrLoading', { detail: { url: filePath } }))
  try {
    const tex = await loadEnvTexture(filePath, extFromUrl(filePath))
    tex.mapping = THREE.EquirectangularReflectionMapping
    if (hdrTextureOriginal) {
      hdrTextureOriginal.dispose()
      hdrTextureOriginal = null
    }
    if (hdrTextureRotated) {
      hdrTextureRotated.dispose()
      hdrTextureRotated = null
    }

    if (envTexture) {
      envTexture.dispose()
      envTexture = null
    }
    hdrTextureOriginal = tex
    hdrTexture = tex
    hdrInfo = {
      width: tex.image.width || 0,
      height: tex.image.height || 0,
      format: tex._srcFormat || 'HDR (RGBE)',
      size: tex.image.data ? tex.image.data.byteLength : 0
    }

    currentEnvMode = 'hdri'
    applyHDREnvMode()
    window.dispatchEvent(new CustomEvent('material3d:hdrLoaded', { detail: hdrInfo }))
  } catch (e) {
    window.dispatchEvent(new CustomEvent('material3d:hdrLoadFailed', { detail: { message: e.message } }))
  }
}
export function clearHDREnv() {
  if (hdrTextureOriginal) {
    hdrTextureOriginal.dispose()
    hdrTextureOriginal = null
  }
  if (hdrTextureRotated) {
    hdrTextureRotated.dispose()
    hdrTextureRotated = null
  }

  hdrTexture = null
  hdrInfo = null
  if (scene) scene.environmentRotation.set(0, 0, 0)
  if (currentEnvMode === 'hdri') setEnvMode('custom')
  else applyHDREnvMode()
}
export function getCurrentLightPreset() {
  return currentLightPreset
}
export function getCurrentEnvMode() {
  return currentEnvMode
}
export function setEnvModeExport(mode) {
  setEnvMode(mode)
}
export function setHdrRotation(val) {
  hdrRotation = val
  if (!initialized || currentEnvMode !== 'hdri') return
  if (hdrUsage === 'env' || hdrUsage === 'both') {
    scene.environmentRotation.set(0, (hdrRotation * Math.PI) / 180, 0)
  }
  if (hdrUsage === 'bg' || hdrUsage === 'both') {
    if (hdrRotateTimer) clearTimeout(hdrRotateTimer)
    hdrRotateTimer = setTimeout(() => {
      hdrRotateTimer = null
      if (currentEnvMode === 'hdri' && (hdrUsage === 'bg' || hdrUsage === 'both')) {
        ensureRotatedTexture()
        scene.background = hdrTextureRotated || hdrTextureOriginal
      }
    }, 80)
  }
}

export function setHdrUsage(mode) {
  if (!['both', 'env', 'bg'].includes(mode)) return
  hdrUsage = mode
  if (initialized && currentEnvMode === 'hdri') applyHDREnvMode()
}

export function setSkyTurbidity(val) {
  skyTurbidity = val
  if (initialized && currentEnvMode === 'sky') {
    updateSkySunPosition()
    scheduleSkyBake()
  }
}
export function setSkyRayleigh(val) {
  skyRayleigh = val
  if (initialized && currentEnvMode === 'sky') {
    updateSkySunPosition()
    scheduleSkyBake()
  }
}
export function setSkyMieCoefficient(val) {
  skyMieCoefficient = val
  if (initialized && currentEnvMode === 'sky') {
    updateSkySunPosition()
    scheduleSkyBake()
  }
}
export function setSkyMieDirectionalG(val) {
  skyMieDirectionalG = val
  if (initialized && currentEnvMode === 'sky') {
    updateSkySunPosition()
    scheduleSkyBake()
  }
}
export function setSkySunElevation(val) {
  skySunElevation = val
  if (initialized && currentEnvMode === 'sky') {
    updateSkySunPosition()
    scheduleSkyBake()
  }
}
export function setSkySunAzimuth(val) {
  skySunAzimuth = val
  if (initialized && currentEnvMode === 'sky') {
    updateSkySunPosition()
    scheduleSkyBake()
  }
}

export function setSkyTint(hex) {
  const n = parseInt(hex.slice(1), 16)
  if (Number.isNaN(n)) return
  skyTintHex = n
  if (initialized && currentEnvMode === 'sky') {
    updateSkySunPosition()
    scheduleSkyBake()
  }
}

function disposeTexture(tex) {
  if (tex && tex.dispose) {
    unloadTextureAnim(tex)
    tex.dispose()
  }
}
function disposeAllMaterialTextures(m) {
  disposeTexture(m.map)
  disposeTexture(m.userData.baseMap)
  m.userData.baseMap = null
  disposeTexture(m.normalMap)
  disposeTexture(m.roughnessMap)
  disposeTexture(m.metalnessMap)
  disposeTexture(m.emissiveMap)
  if (m.userData.shaderRefs) {
    disposeTexture(m.userData.shaderRefs.heightMap.value)
    m.userData.shaderRefs.heightMap.value = null
    m.userData.shaderRefs.hasHeightMap.value = 0.0
  }
  disposeTexture(m.userData.pendingHeightMap)
  m.userData.pendingHeightMap = null
  m.map = null
  m.normalMap = null
  m.roughnessMap = null
  m.metalnessMap = null
  m.emissiveMap = null
  m.emissive.set(0x000000)
  m.emissiveIntensity = 1.0
  m.color.set(0x888888)
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
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data
      for (let i = 0; i < data.length; i += 4) {
        const v = data[i]
        data[i + 1] = v
        data[i + 2] = v
        data[i + 3] = 255
      }
      ctx.putImageData(ctx.getImageData(0, 0, canvas.width, canvas.height), 0, 0)
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
    specImg.onload = () => {
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
        material.roughnessMap = extractChannel(specImg, 0, true)
        material.metalnessMap = extractChannel(specImg, 1, false)
        material.emissiveMap = extractChannel(specImg, 2, false)
        applyTextureFilter(material.roughnessMap)
        applyTextureFilter(material.metalnessMap)
        applyTextureFilter(material.emissiveMap)
        material.emissive.set(0xffffff)
        material.emissiveIntensity = emissiveIntensity
        material.needsUpdate = true
      } else {
        material.roughnessMap = extractRoughness(specImg)
        material.metalnessMap = extractMetalness(specImg)
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
  specImg.onload = () => {
    disposeTexture(mat.roughnessMap)
    disposeTexture(mat.metalnessMap)
    mat.roughnessMap = extractRoughness(specImg)
    mat.metalnessMap = extractMetalness(specImg)
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

/* 应用 PBR 贴图到模型面材质（法线/高光）。
     normalUrl/specUrl：非空字符串 → 加载应用；空串 → 清除对应 map；null/undefined → 不动。
     force=true 跳过 replaced 守卫（编辑器替换主图后强制覆盖旧 PBR；模型加载流程保持 replaced 守卫阻断竞态） */
export function applyPbrMapsToModelMaterial(mat, normalUrl, specUrl, force, heightUrl) {
  if (!mat) return
  const blocked = () => !force && mat.userData && mat.userData.replaced
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
      img.onload = () => {
        if (blocked()) return
        disposeTexture(mat.roughnessMap)
        disposeTexture(mat.metalnessMap)
        const rTex = extractRoughness(img)
        const mTex = extractMetalness(img)
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
        const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data
        for (let i = 0; i < data.length; i += 4) {
          const v = data[i]
          data[i + 1] = v
          data[i + 2] = v
          data[i + 3] = 255
        }
        ctx.putImageData(ctx.getImageData(0, 0, canvas.width, canvas.height), 0, 0)
        const hTex = new THREE.CanvasTexture(canvas)
        hTex.colorSpace = THREE.NoColorSpace
        hTex.wrapS = hTex.wrapT = THREE.RepeatWrapping
        applyHeightFilter(hTex)
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
      img.src = heightUrl
    }
  }
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

export function disposeMaterial3D() {
  if (animationId) cancelAnimationFrame(animationId)
  if (skyBakeTimer) {
    clearTimeout(skyBakeTimer)
    skyBakeTimer = null
  }
  if (hdrRotateTimer) {
    clearTimeout(hdrRotateTimer)
    hdrRotateTimer = null
  }
  if (customModelGroup) {
    scene.remove(customModelGroup)
    disposeGroupDeep(customModelGroup)
    customModelGroup = null
    markShaderMatsDirty()
  }
  for (const m of [meshLeft, meshRight]) {
    if (m) {
      if (m.material) {
        disposeAllMaterialTextures(m.material)
        m.material.dispose()
      }
      if (m.geometry) m.geometry.dispose()
    }
  }
  if (groundMesh) {
    groundMesh.geometry.dispose()
    groundMesh.material.dispose()
  }
  if (gridHelper) {
    gridHelper.geometry.dispose()
    gridHelper.material.dispose()
  }
  if (envTexture) envTexture.dispose()
  if (pmremTexture) pmremTexture.dispose()
  if (hdrTextureOriginal) hdrTextureOriginal.dispose()
  if (hdrTextureRotated) hdrTextureRotated.dispose()
  if (skyEnvTexture) skyEnvTexture.dispose()
  if (skyMesh) {
    skyMesh.geometry.dispose()
    skyMesh.material.dispose()
    skyMesh = null
  }
  if (pmrem) pmrem.dispose()
  if (renderer) renderer.dispose()
  initialized = false
}


/* 几何与格式工具 依赖注入 */
setGeoUtilsHooks({
  imgW: imgW,
  imgH: imgH,
  get_initialized: () => initialized,
  get_customModelGroup: () => customModelGroup,
  get_sourceSide: () => sourceSide
})