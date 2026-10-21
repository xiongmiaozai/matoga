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

let scene, camera, renderer, animationId, pmrem, envTexture, pmremTexture
let isWebGL2 = false

function showLoading(text) { const el = document.getElementById('m3dLoading'); if (!el) return; const t = el.querySelector('.m3d-loading-text'); if (t && text) t.textContent = text; el.classList.add('show') }
function hideLoading() { const el = document.getElementById('m3dLoading'); if (el) el.classList.remove('show') }
function setLoadingProgress(pct) { const el = document.getElementById('m3dLoading'); if (!el) return; const f = el.querySelector('.m3d-loading-fill'); if (f) f.style.width = Math.round(pct * 100) + '%' }
let meshLeft, meshRight, labelLeft, labelRight
let groundMesh, gridHelper, lightGroup
let container = null
let initialized = false
let currentGeo = 'cube'
let emissiveIntensity = 1.0
let normalScale = 1.0
let materialFormat = 'auto'
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
let groundVisible = true
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
let maxAnisotropy = 1

let rotX = 0, rotY = 0, targetRotX = 0, targetRotY = 0
let isDragging = false, lastX = 0, lastY = 0
let camDist = 3, targetCamDist = 3
let autoRotate = true

const LIGHT_PRESETS = {
  studio: {
    name: '工作室',
    ambient: { color: 0xffffff, intensity: 0.25 },
    lights: [
      { color: 0xffffff, intensity: 1.2, pos: [3, 3, 4] },
      { color: 0xffffff, intensity: 0.8, pos: [-3, 2, 3] },
      { color: 0xccddff, intensity: 0.5, pos: [0, -3, 2] },
    ],
    env: { colors: ['#4a5a7a', '#2a2a4e', '#1a1a2e'], light: { color: 'rgba(255,240,200,0.98)', x: 128, y: 50, r: 30 } },
    bg: 0x1a1a2e
  },
  outdoor: {
    name: '户外阳光',
    ambient: { color: 0x88aacc, intensity: 0.4 },
    lights: [
      { color: 0xffffee, intensity: 2.5, pos: [4, 5, 2] },
      { color: 0x88aacc, intensity: 0.8, pos: [-4, 3, 3] },
      { color: 0xaaccff, intensity: 0.5, pos: [0, -2, 4] },
    ],
    env: { colors: ['#87ceeb', '#4682b4', '#2a3a5a'], light: { color: 'rgba(255,255,220,1.0)', x: 200, y: 30, r: 45 } },
    bg: 0x2a3a5a
  },
  soft: {
    name: '柔和均匀',
    ambient: { color: 0xffffff, intensity: 0.5 },
    lights: [
      { color: 0xffffff, intensity: 0.7, pos: [3, 2, 4] },
      { color: 0xffffff, intensity: 0.7, pos: [-3, 2, 4] },
      { color: 0xffffff, intensity: 0.5, pos: [0, -3, 3] },
      { color: 0xffffff, intensity: 0.5, pos: [0, 3, -3] },
    ],
    env: { colors: ['#606080', '#404060', '#303050'], light: null },
    bg: 0x303050
  },
  warm: {
    name: '暖光',
    ambient: { color: 0xffaa66, intensity: 0.3 },
    lights: [
      { color: 0xffaa66, intensity: 1.5, pos: [3, 2, 4] },
      { color: 0xffcc88, intensity: 0.8, pos: [-3, 3, 3] },
      { color: 0xff8844, intensity: 0.4, pos: [0, -2, 2] },
    ],
    env: { colors: ['#5a3a2a', '#3a2a1a', '#2a1a0a'], light: { color: 'rgba(255,180,100,0.9)', x: 128, y: 60, r: 35 } },
    bg: 0x2a1a0a
  },
  cool: {
    name: '冷光',
    ambient: { color: 0x66aaff, intensity: 0.3 },
    lights: [
      { color: 0x88ccff, intensity: 1.5, pos: [3, 3, 4] },
      { color: 0x4488ff, intensity: 0.8, pos: [-3, 2, 3] },
      { color: 0x66aaff, intensity: 0.4, pos: [0, -2, 2] },
    ],
    env: { colors: ['#2a3a5a', '#1a2a4a', '#0a1a3a'], light: { color: 'rgba(150,200,255,0.9)', x: 128, y: 50, r: 35 } },
    bg: 0x0a1a3a
  }
}

function scaleUV(geometry, su, sv) {
  const uv = geometry.attributes.uv
  if (!uv) return geometry
  for (let i = 0; i < uv.count; i++) { uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv) }
  uv.needsUpdate = true
  return geometry
}

function computeTangents(geometry) {
  const index = geometry.index
  const positionAttribute = geometry.attributes.position
  const normalAttribute = geometry.attributes.normal
  const uvAttribute = geometry.attributes.uv
  if (!positionAttribute || !normalAttribute || !uvAttribute) return geometry
  const vertexCount = positionAttribute.count
  const tan1 = new Float32Array(vertexCount * 3)
  const tan2 = new Float32Array(vertexCount * 3)
  const vA = new THREE.Vector3(), vB = new THREE.Vector3(), vC = new THREE.Vector3()
  const uvA = new THREE.Vector2(), uvB = new THREE.Vector2(), uvC = new THREE.Vector2()
  const sdir = new THREE.Vector3(), tdir = new THREE.Vector3()
  const handleTriangle = (a, b, c) => {
    vA.fromBufferAttribute(positionAttribute, a); vB.fromBufferAttribute(positionAttribute, b); vC.fromBufferAttribute(positionAttribute, c)
    uvA.fromBufferAttribute(uvAttribute, a); uvB.fromBufferAttribute(uvAttribute, b); uvC.fromBufferAttribute(uvAttribute, c)
    const x1 = vB.x - vA.x, x2 = vC.x - vA.x, y1 = vB.y - vA.y, y2 = vC.y - vA.y, z1 = vB.z - vA.z, z2 = vC.z - vA.z
    const s1 = uvB.x - uvA.x, s2 = uvC.x - uvA.x, t1 = uvB.y - uvA.y, t2 = uvC.y - uvA.y
    const det = s1 * t2 - s2 * t1, r = det === 0 ? 0 : 1 / det
    sdir.set((t2 * x1 - t1 * x2) * r, (t2 * y1 - t1 * y2) * r, (t2 * z1 - t1 * z2) * r)
    tdir.set((s1 * x2 - s2 * x1) * r, (s1 * y2 - s2 * y1) * r, (s1 * z2 - s2 * z1) * r)
    for (const i of [a, b, c]) { tan1[i * 3] += sdir.x; tan1[i * 3 + 1] += sdir.y; tan1[i * 3 + 2] += sdir.z; tan2[i * 3] += tdir.x; tan2[i * 3 + 1] += tdir.y; tan2[i * 3 + 2] += tdir.z }
  }
  if (index) { for (let i = 0; i < index.count; i += 3) handleTriangle(index.getX(i), index.getX(i + 1), index.getX(i + 2)) }
  else { for (let i = 0; i < vertexCount; i += 3) handleTriangle(i, i + 1, i + 2) }
  const tangentArray = new Float32Array(vertexCount * 4)
  const t = new THREE.Vector3(), n = new THREE.Vector3(), tmp = new THREE.Vector3(), tmp2 = new THREE.Vector3()
  for (let i = 0; i < vertexCount; i++) {
    n.fromBufferAttribute(normalAttribute, i)
    t.set(tan1[i * 3], tan1[i * 3 + 1], tan1[i * 3 + 2])
    tmp.copy(n).multiplyScalar(n.dot(t)); t.sub(tmp).normalize()
    tmp2.set(tan2[i * 3], tan2[i * 3 + 1], tan2[i * 3 + 2])
    const w = n.cross(t).dot(tmp2) < 0 ? -1 : 1
    tangentArray[i * 4] = t.x; tangentArray[i * 4 + 1] = t.y; tangentArray[i * 4 + 2] = t.z; tangentArray[i * 4 + 3] = w
  }
  geometry.setAttribute('tangent', new THREE.BufferAttribute(tangentArray, 4))
  return geometry
}

function withTangents(geo) { computeTangents(geo); return geo }

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
  const w = 512, h = 256
  const canvas = document.createElement('canvas')
  canvas.width = w; canvas.height = h
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  const grad = ctx.createLinearGradient(0, 0, 0, h)
  grad.addColorStop(0, env.colors[0]); grad.addColorStop(0.5, env.colors[1]); grad.addColorStop(1, env.colors[2])
  ctx.fillStyle = grad; ctx.fillRect(0, 0, w, h)
  const bandY = h * 0.22, bandH = h * 0.18
  for (let i = 0; i < 4; i++) {
    const cx = w * (0.125 + i * 0.25), halfW = w * 0.05
    const lg = ctx.createLinearGradient(cx - halfW, 0, cx + halfW, 0)
    lg.addColorStop(0, 'rgba(255,255,255,0)'); lg.addColorStop(0.5, 'rgba(255,255,255,0.55)'); lg.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = lg; ctx.fillRect(cx - halfW, bandY, halfW * 2, bandH)
  }
  const bandY2 = h * 0.72, bandH2 = h * 0.1
  for (let i = 0; i < 3; i++) {
    const cx = w * (0.17 + i * 0.33), halfW = w * 0.04
    const lg = ctx.createLinearGradient(cx - halfW, 0, cx + halfW, 0)
    lg.addColorStop(0, 'rgba(255,255,255,0)'); lg.addColorStop(0.5, 'rgba(255,255,255,0.25)'); lg.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = lg; ctx.fillRect(cx - halfW, bandY2, halfW * 2, bandH2)
  }
  if (env.light) {
    const sx = w / 256, sy = h / 256
    const lx = env.light.x * sx, ly = env.light.y * sy, lr = env.light.r * sx
    const rg = ctx.createRadialGradient(lx, ly, 0, lx, ly, lr)
    rg.addColorStop(0, env.light.color); rg.addColorStop(0.6, env.light.color); rg.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.fillStyle = rg; ctx.fillRect(0, 0, w, h)
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
  for (const l of config.lights) {
    const dir = new THREE.DirectionalLight(l.color, l.intensity)
    dir.position.set(l.pos[0], l.pos[1], l.pos[2])
    dir.castShadow = true
    dir.shadow.mapSize.set(1024, 1024)
    dir.shadow.camera.left = -3; dir.shadow.camera.right = 3
    dir.shadow.camera.top = 3; dir.shadow.camera.bottom = -3
    dir.shadow.camera.near = 0.1; dir.shadow.camera.far = 15
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
  if (scene) scene.environmentIntensity = envIntensity; for (const m of [meshLeft, meshRight]) { if (m) m.material.envMapIntensity = envIntensity }
}

function applyCustomLightConfig(config) {
  if (!initialized || !config || !config.ambient || !Array.isArray(config.lights)) return
  customLightConfig = cloneLightConfig(config)
  rebuildLights(customLightConfig)
  if (currentEnvMode === 'custom') {
    scene.background = new THREE.Color(customLightConfig.bg)
  }
  if (scene) scene.environmentIntensity = envIntensity; for (const m of [meshLeft, meshRight]) { if (m) m.material.envMapIntensity = envIntensity }
}

function updateSkySunPosition() {
  if (!skyMesh) return
  const u = skyMesh.material.uniforms
  const elevation = skySunElevation * Math.PI / 180
  const azimuth = skySunAzimuth * Math.PI / 180
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
  if (scene) scene.environmentIntensity = envIntensity; for (const m of [meshLeft, meshRight]) { if (m) m.material.envMapIntensity = envIntensity }
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
  if (hdrTexture) { hdrTexture.dispose(); hdrTexture = null }
  if (envTexture) { envTexture.dispose(); envTexture = null }
  if (pmremTexture) { pmremTexture.dispose(); pmremTexture = null }
  if (lightGroup) { while (lightGroup.children.length) lightGroup.remove(lightGroup.children[0]) }
  const ambient = new THREE.AmbientLight(0xffffff, 0.15)
  lightGroup.add(ambient)
  if (!skySunLight) {
    skySunLight = new THREE.DirectionalLight(0xffffff, 2.5)
    skySunLight.castShadow = true
    skySunLight.shadow.mapSize.set(1024, 1024)
    skySunLight.shadow.camera.left = -3; skySunLight.shadow.camera.right = 3
    skySunLight.shadow.camera.top = 3; skySunLight.shadow.camera.bottom = -3
    skySunLight.shadow.camera.near = 0.1; skySunLight.shadow.camera.far = 50
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
  if (skyMesh) { scene.remove(skyMesh); skyMesh = null }
  if (skyEnvTexture) { skyEnvTexture.dispose(); skyEnvTexture = null }
  if (skySunLight) { lightGroup.remove(skySunLight); skySunLight = null }
  if (envTexture) { envTexture.dispose(); envTexture = null }
  if (pmremTexture) { pmremTexture.dispose(); pmremTexture = null }
  if (lightGroup) { while (lightGroup.children.length) lightGroup.remove(lightGroup.children[0]) }
  const ambient = new THREE.AmbientLight(0xffffff, 0.1)
  lightGroup.add(ambient)
  if (scene) scene.environmentRotation.set(0, 0, 0)
  if (hdrTextureOriginal) {
    const src = hdrTextureRotated || hdrTextureOriginal
    hdrTexture = src
    if (hdrUsage === 'env' || hdrUsage === 'both') scene.environment = src
    else scene.environment = null
    if (hdrUsage === 'bg' || hdrUsage === 'both') {
      scene.background = src
    } else {
      scene.background = new THREE.Color(0x1a1a2e)
    }
  } else {
    hdrTexture = null
    scene.environment = null
    scene.background = new THREE.Color(0x1a1a2e)
  }
  if (scene) scene.environmentIntensity = envIntensity; for (const m of [meshLeft, meshRight]) { if (m) m.material.envMapIntensity = envIntensity }
}

function ensureRotatedTexture() {
  if (hdrTextureRotated) { hdrTextureRotated.dispose(); hdrTextureRotated = null }
  if (hdrTextureOriginal && (hdrRotation % 360)) {
    hdrTextureRotated = rotateTextureData(hdrTextureOriginal, hdrRotation)
  }
}

function rotateTextureData(tex, angleDeg) {
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


function setEnvMode(mode) {
  if (!initialized || !['custom', 'sky', 'hdri'].includes(mode)) return
  currentEnvMode = mode
  if (mode === 'sky') {
    applyProceduralSky()
  } else if (mode === 'hdri') {
    applyHDREnvMode()
  } else {
    if (skyMesh) { scene.remove(skyMesh); skyMesh = null }
    if (skyEnvTexture) { skyEnvTexture.dispose(); skyEnvTexture = null }
    if (skySunLight) { lightGroup.remove(skySunLight); skySunLight = null }
    applyLightPreset(currentLightPreset)
  }
}

function imgW(img) { return img.naturalWidth || img.width }
function imgH(img) { return img.naturalHeight || img.height }

function extractChannel(image, channelIndex, invert) {
  const canvas = document.createElement('canvas')
  canvas.width = image.naturalWidth; canvas.height = image.naturalHeight
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  ctx.drawImage(image, 0, 0)
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const data = imageData.data
  for (let i = 0; i < data.length; i += 4) {
    let v = data[i + channelIndex]
    if (invert) v = 255 - v
    data[i] = v; data[i + 1] = v; data[i + 2] = v; data[i + 3] = 255
  }
  ctx.putImageData(imageData, 0, 0)
  const tex = new THREE.CanvasTexture(canvas)
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  return tex
}

function detectFormat(image) {
  const canvas = document.createElement('canvas')
  const w = Math.min(image.naturalWidth, 64), h = Math.min(image.naturalHeight, 64)
  canvas.width = w; canvas.height = h
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  ctx.drawImage(image, 0, 0, w, h)
  const data = ctx.getImageData(0, 0, w, h).data
  let alphaNon255 = 0, blueHigh = 0, total = 0
  for (let i = 0; i < data.length; i += 4) { total++; if (data[i + 3] < 250) alphaNon255++; if (data[i + 2] > 64) blueHigh++ }
  const alphaRatio = alphaNon255 / total, blueRatio = blueHigh / total
  if (alphaRatio > 0.05 || blueRatio > 0.5) return 'labpbr'
  return 'old'
}

function extractRoughness(image) {
  const c = document.createElement('canvas'); c.width = image.naturalWidth; c.height = image.naturalHeight
  const ctx = c.getContext('2d', { willReadFrequently: true }); ctx.drawImage(image, 0, 0)
  const imageData = ctx.getImageData(0, 0, c.width, c.height), d = imageData.data
  for (let i = 0; i < d.length; i += 4) { const r = 255 - d[i]; d[i] = r; d[i + 1] = r; d[i + 2] = r; d[i + 3] = 255 }
  ctx.putImageData(imageData, 0, 0)
  const tex = new THREE.CanvasTexture(c); tex.wrapS = tex.wrapT = THREE.RepeatWrapping; return tex
}

function extractMetalness(image) {
  const c = document.createElement('canvas'); c.width = image.naturalWidth; c.height = image.naturalHeight
  const ctx = c.getContext('2d', { willReadFrequently: true }); ctx.drawImage(image, 0, 0)
  const imageData = ctx.getImageData(0, 0, c.width, c.height), d = imageData.data
  for (let i = 0; i < d.length; i += 4) { const v = d[i + 1]; d[i] = v; d[i + 1] = v; d[i + 2] = v; d[i + 3] = 255 }
  ctx.putImageData(imageData, 0, 0)
  const tex = new THREE.CanvasTexture(c); tex.wrapS = tex.wrapT = THREE.RepeatWrapping; return tex
}

function extractEmissive(specImage, mainImage) {
  const w = specImage.naturalWidth, h = specImage.naturalHeight
  const c = document.createElement('canvas'); c.width = w; c.height = h
  const ctx = c.getContext('2d', { willReadFrequently: true }); ctx.drawImage(specImage, 0, 0)
  const specData = ctx.getImageData(0, 0, w, h).data
  let mainData = null
  if (mainImage) {
    const mc = document.createElement('canvas'); mc.width = w; mc.height = h
    const mctx = mc.getContext('2d', { willReadFrequently: true }); mctx.drawImage(mainImage, 0, 0, w, h)
    mainData = mctx.getImageData(0, 0, w, h).data
  }
  const imageData = ctx.createImageData(w, h), d = imageData.data
  for (let i = 0; i < d.length; i += 4) {
    let a = specData[i + 3]; if (a === 255) a = 0
    const mask = a / 254
    if (mainData) { d[i] = Math.round(mainData[i] * mask); d[i + 1] = Math.round(mainData[i + 1] * mask); d[i + 2] = Math.round(mainData[i + 2] * mask) }
    else { d[i] = d[i + 1] = d[i + 2] = Math.round(255 * mask) }
    d[i + 3] = 255
  }
  ctx.putImageData(imageData, 0, 0)
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.wrapS = tex.wrapT = THREE.RepeatWrapping; return tex
}

function reconstructNormal(image) {
  const c = document.createElement('canvas'); c.width = imgW(image); c.height = imgH(image)
  const ctx = c.getContext('2d', { willReadFrequently: true }); ctx.drawImage(image, 0, 0)
  const imageData = ctx.getImageData(0, 0, c.width, c.height), d = imageData.data
  for (let i = 0; i < d.length; i += 4) {
    const nx = (d[i] / 255) * 2 - 1, ny = (d[i + 1] / 255) * 2 - 1
    const nz = Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny))
    d[i] = Math.round((nx + 1) * 127.5); d[i + 1] = Math.round((ny + 1) * 127.5); d[i + 2] = Math.round((nz + 1) * 127.5); d[i + 3] = 255
  }
  ctx.putImageData(imageData, 0, 0)
  const tex = new THREE.CanvasTexture(c); tex.wrapS = tex.wrapT = THREE.RepeatWrapping; return tex
}

function extractHeight(image) {
  const c = document.createElement('canvas'); c.width = imgW(image); c.height = imgH(image)
  const ctx = c.getContext('2d', { willReadFrequently: true }); ctx.drawImage(image, 0, 0)
  const imageData = ctx.getImageData(0, 0, c.width, c.height), d = imageData.data
  let minA = 255, maxA = 0
  const buckets = new Set()
  for (let i = 3; i < d.length; i += 4) { if (d[i] < minA) minA = d[i]; if (d[i] > maxA) maxA = d[i]; if (buckets.size < 8) buckets.add(d[i]) }
  const range = maxA - minA
  if (range < 1 || buckets.size <= 2) return null
  for (let i = 0; i < d.length; i += 4) { const v = Math.round((d[i + 3] - minA) / range * 255); d[i] = v; d[i + 1] = v; d[i + 2] = v; d[i + 3] = 255 }
  ctx.putImageData(imageData, 0, 0)
  const tex = new THREE.CanvasTexture(c); tex.wrapS = tex.wrapT = THREE.RepeatWrapping; applyHeightFilter(tex); return tex
}

function extractHeightFromNormal(image) {
  const maxDim = 256
  const ow = imgW(image), oh = imgH(image)
  const sc = Math.min(1, maxDim / Math.max(ow, oh))
  const w = Math.max(1, Math.round(ow * sc)), h = Math.max(1, Math.round(oh * sc))
  const c = document.createElement('canvas'); c.width = w; c.height = h
  const ctx = c.getContext('2d', { willReadFrequently: true })
  ctx.drawImage(image, 0, 0, w, h)
  const src = ctx.getImageData(0, 0, w, h).data
  const n = w * h
  const gx = new Float32Array(n), gy = new Float32Array(n)
  for (let i = 0; i < n; i++) { const j = i * 4; gx[i] = (src[j] - 128) / 127.5; gy[i] = (src[j + 1] - 128) / 127.5 }
  const height = new Float32Array(n)
  for (let y = 0; y < h; y++) {
    const row = y * w
    let rowSum = 0
    for (let x = 0; x < w; x++) rowSum += gx[row + x]
    const mean = rowSum / w
    for (let x = 1; x < w; x++) height[row + x] = height[row + x - 1] + gx[row + x] - mean
  }
  const rowOff = new Float32Array(h)
  for (let y = 1; y < h; y++) {
    const r1 = y * w
    let diff = 0
    for (let x = 0; x < w; x++) diff += gy[r1 + x]
    rowOff[y] = rowOff[y - 1] + diff / w
  }
  let minH = Infinity, maxH = -Infinity
  for (let y = 0; y < h; y++) {
    const row = y * w, off = rowOff[y]
    for (let x = 0; x < w; x++) { const v = height[row + x] + off; height[row + x] = v; if (v < minH) minH = v; if (v > maxH) maxH = v }
  }
  const range = maxH - minH
  if (range < 1e-4) return null
  const out = ctx.createImageData(w, h), od = out.data
  for (let i = 0; i < n; i++) { const v = Math.round((height[i] - minH) / range * 255); od[i * 4] = v; od[i * 4 + 1] = v; od[i * 4 + 2] = v; od[i * 4 + 3] = 255 }
  ctx.putImageData(out, 0, 0)
  const tex = new THREE.CanvasTexture(c); tex.wrapS = tex.wrapT = THREE.RepeatWrapping; applyHeightFilter(tex); return tex
}

function createLabel(text, color) {
  const c = document.createElement('canvas'); c.width = 128; c.height = 32
  const ctx = c.getContext('2d', { willReadFrequently: true })
  ctx.fillStyle = color; ctx.fillRect(0, 0, 128, 32)
  ctx.fillStyle = '#fff'; ctx.font = 'bold 16px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
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
  const useMipmap = mipmapsEnabled && (textureFilter === 'trilinear' || textureFilter === 'anisotropic')
  tex.generateMipmaps = useMipmap
  if (textureFilter === 'nearest') {
    tex.magFilter = THREE.NearestFilter
    tex.minFilter = useMipmap ? THREE.NearestMipmapNearestFilter : THREE.NearestFilter
  } else {
    tex.magFilter = THREE.LinearFilter
    tex.minFilter = useMipmap ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter
  }
  tex.anisotropy = (textureFilter === 'anisotropic' && useMipmap) ? Math.min(anisotropyLevel, maxAnisotropy) : 1
  tex.needsUpdate = true
}

function collectMaterialTextures(m) {
  const list = []
  if (m.map) list.push(m.map)
  if (m.normalMap) list.push(m.normalMap)
  if (m.roughnessMap) list.push(m.roughnessMap)
  if (m.metalnessMap) list.push(m.metalnessMap)
  if (m.emissiveMap) list.push(m.emissiveMap)
  if (m.userData.shaderRefs && m.userData.shaderRefs.heightMap && m.userData.shaderRefs.heightMap.value) list.push(m.userData.shaderRefs.heightMap.value)
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

function makeMaterial() {
  const mat = new THREE.MeshPhysicalMaterial({ color: 0x888888, roughness: 0.5, metalness: 0.1, envMapIntensity: 1.0, emissive: new THREE.Color(0x000000), emissiveIntensity: 1.0, transmission: 0.0, ior: 1.5, thickness: 0.5, clearcoat: 0.0, clearcoatRoughness: 0.0 })
  mat.userData.shaderRefs = null
  mat.userData.pendingHeightMap = null
  mat.onBeforeCompile = (shader) => {
    const prev = mat.userData.shaderRefs
    shader.uniforms.heightMap = { value: prev ? prev.heightMap.value : mat.userData.pendingHeightMap }
    shader.uniforms.hasHeightMap = { value: prev ? prev.hasHeightMap.value : (mat.userData.pendingHeightMap && parallaxEnabled ? 1.0 : 0.0) }
    shader.uniforms.parallaxScale = { value: parallaxScale }
    shader.uniforms.parallaxSteps = { value: parallaxSteps }
    shader.uniforms.parallaxMode = { value: parallaxMode }
    shader.uniforms.parallaxAdaptive = { value: parallaxAdaptive }
    shader.uniforms.parallaxShadow = { value: parallaxShadow }
    shader.uniforms.uHeightLightDir = { value: prev ? prev.uHeightLightDir.value : new THREE.Vector3(0, 1, 0) }
    shader.uniforms.uHeightTexSize = { value: prev ? prev.uHeightTexSize.value : (mat.userData.pendingHeightMap ? new THREE.Vector2(mat.userData.pendingHeightMap.image.width, mat.userData.pendingHeightMap.image.height) : new THREE.Vector2(256, 256)) }
    mat.userData.shaderRefs = shader.uniforms
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', 'uniform sampler2D heightMap;\nuniform vec2 uHeightTexSize;\nuniform vec3 uHeightLightDir;\nuniform float hasHeightMap;\nuniform float parallaxScale;\nuniform float parallaxSteps;\nuniform float parallaxMode;\nuniform float parallaxAdaptive;\nuniform float parallaxShadow;\n#include <common>')
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
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
        }`)
      .replace('#include <lights_fragment_begin>', '#include <lights_fragment_begin>\n        reflectedLight.directDiffuse *= parallaxShadowFactor;')
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

export function initMaterial3D(containerEl) {
  if (initialized) {
    if (containerEl !== container) { container.innerHTML = ''; container = containerEl; container.appendChild(renderer.domElement); handleResize() }
    return
  }
  container = containerEl
  const width = container.clientWidth || 300, height = container.clientHeight || 200
  scene = new THREE.Scene(); scene.background = new THREE.Color(LIGHT_PRESETS.studio.bg)
  camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 100); camera.position.set(0, 0.5, camDist)
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
  isWebGL2 = renderer.capabilities.isWebGL2
  maxAnisotropy = renderer.capabilities.getMaxAnisotropy() || 1
  renderer.setSize(width, height); renderer.setPixelRatio(window.devicePixelRatio)
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 2.2
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap
  container.appendChild(renderer.domElement)
  pmrem = new THREE.PMREMGenerator(renderer)
  lightGroup = new THREE.Group(); scene.add(lightGroup)
  const geo = geometries[currentGeo]()
  meshLeft = new THREE.Mesh(geo, makeMaterial()); meshLeft.castShadow = true; meshLeft.receiveShadow = true; scene.add(meshLeft)
  meshRight = new THREE.Mesh(geo.clone(), makeMaterial()); meshRight.castShadow = true; meshRight.receiveShadow = true; scene.add(meshRight)
  labelLeft = createLabel(_t('common.left'), '#2b6cff'); labelRight = createLabel(_t('common.right'), '#d97706')
  scene.add(labelLeft); scene.add(labelRight)
  const groundGeo = new THREE.PlaneGeometry(8, 8)
  const groundMat = new THREE.MeshStandardMaterial({ color: 0x2a2a3e, roughness: 0.8, metalness: 0.0 })
  groundMesh = new THREE.Mesh(groundGeo, groundMat); groundMesh.rotation.x = -Math.PI / 2; groundMesh.position.y = -1.3; groundMesh.receiveShadow = true; scene.add(groundMesh)
  gridHelper = new THREE.GridHelper(8, 32, 0x444466, 0x222244)
  gridHelper.position.y = -1.29; gridHelper.material.transparent = true; gridHelper.material.opacity = 0.3; scene.add(gridHelper)
  setupControls(); new ResizeObserver(handleResize).observe(container); animate(); initialized = true
  applyLightPreset('studio')
  applySourceSide()
  document.dispatchEvent(new CustomEvent('material3d:ready'))
}

function applySourceSide() {
  if (!initialized) return
  if (sourceSide === 'dual') {
    meshLeft.visible = true; meshRight.visible = true; meshLeft.position.x = -1.1; meshRight.position.x = 1.1
    meshLeft.scale.setScalar(0.75); meshRight.scale.setScalar(0.75)
    labelLeft.visible = true; labelRight.visible = true
    labelLeft.position.set(-1.1, -0.95, 0); labelRight.position.set(1.1, -0.95, 0)
  } else if (sourceSide === 'left') {
    meshLeft.visible = true; meshRight.visible = false; meshLeft.position.x = 0
    meshLeft.scale.setScalar(1.0)
    labelLeft.visible = false; labelRight.visible = false
  } else {
    meshLeft.visible = false; meshRight.visible = true; meshRight.position.x = 0
    meshRight.scale.setScalar(1.0)
    labelLeft.visible = false; labelRight.visible = false
  }
}

function setupControls() {
  const canvas = renderer.domElement; canvas.style.cursor = 'grab'
  canvas.addEventListener('mousedown', (e) => { isDragging = true; autoRotate = false; lastX = e.clientX; lastY = e.clientY; canvas.style.cursor = 'grabbing' })
  canvas.addEventListener('mousemove', (e) => { if (!isDragging) return; targetRotY += (e.clientX - lastX) * 0.01; targetRotX += (e.clientY - lastY) * 0.01; targetRotX = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, targetRotX)); lastX = e.clientX; lastY = e.clientY })
  window.addEventListener('mouseup', () => { if (isDragging) { isDragging = false; canvas.style.cursor = 'grab' } })
  canvas.addEventListener('wheel', (e) => { e.preventDefault(); targetCamDist = Math.max(1.5, Math.min(8, targetCamDist + e.deltaY * 0.003)) }, { passive: false })
  canvas.addEventListener('dblclick', () => { autoRotate = !autoRotate; targetRotX = 0; targetRotY = 0 })
}

let _resizeRAF = 0
function handleResize() {
  if (_resizeRAF) return
  _resizeRAF = requestAnimationFrame(() => {
    _resizeRAF = 0
    if (!container || !renderer || !camera) return
    const w = container.clientWidth, h = container.clientHeight
    if (w > 0 && h > 0) { camera.aspect = w / h; camera.updateProjectionMatrix(); renderer.setSize(w, h) }
  })
}

function animate() {
  animationId = requestAnimationFrame(animate)
  if (autoRotate) targetRotY += 0.005
  rotX += (targetRotX - rotX) * 0.1; rotY += (targetRotY - rotY) * 0.1; camDist += (targetCamDist - camDist) * 0.1
  meshLeft.rotation.x = rotX; meshLeft.rotation.y = rotY
  meshRight.rotation.x = rotX; meshRight.rotation.y = rotY

  camera.position.z = camDist
  camera.updateMatrixWorld()
  if (parallaxShadow > 0.0) {
    let lDir = null
    if (skySunLight && currentEnvMode === 'sky') lDir = skySunLight.position
    else { for (const c of lightGroup.children) { if (c.isDirectionalLight) { lDir = c.position; break } } }
    if (lDir) {
      _lightDirTmp.copy(lDir).normalize().transformDirection(camera.matrixWorldInverse)
      for (const m of [meshLeft, meshRight]) { if (m && m.material && m.material.userData.shaderRefs) m.material.userData.shaderRefs.uHeightLightDir.value.copy(_lightDirTmp) }
    }
  }
  renderer.render(scene, camera)
}

export function setGeometry(geoType) {
  if (!initialized || !geometries[geoType]) return
  currentGeo = geoType; meshLeft.geometry.dispose(); meshRight.geometry.dispose()
  meshLeft.geometry = geometries[geoType](); meshRight.geometry = geometries[geoType]()
}
export function setMetalness(val) { if (initialized) { meshLeft.material.metalness = val; meshRight.material.metalness = val } }
export function setRoughness(val) { if (initialized) { meshLeft.material.roughness = val; meshRight.material.roughness = val } }
export function setNormalScale(val) { normalScale = val; if (initialized) { meshLeft.material.normalScale.set(val, val); meshRight.material.normalScale.set(val, val) } }
export function setEmissiveIntensity(val) { emissiveIntensity = val; if (initialized) { meshLeft.material.emissiveIntensity = val; meshRight.material.emissiveIntensity = val } }
export function setMaterialFormat(fmt) { materialFormat = fmt }
export function setFormatDetectCallback(cb) { formatDetectCallback = cb }
export function setHeightDetectCallback(cb) { heightDetectCallback = cb }
export function setSourceSide(side) { sourceSide = side; applySourceSide() }
export function setParallaxScale(val) { parallaxScale = val; if (initialized) { for (const m of [meshLeft, meshRight]) { if (m && m.material && m.material.userData.shaderRefs) m.material.userData.shaderRefs.parallaxScale.value = val } } }
export function setParallaxSteps(val) { parallaxSteps = val; if (initialized) { for (const m of [meshLeft, meshRight]) { if (m && m.material && m.material.userData.shaderRefs) m.material.userData.shaderRefs.parallaxSteps.value = val } } }
export function setParallaxMode(val) { parallaxMode = val; if (initialized) { for (const m of [meshLeft, meshRight]) { if (m && m.material && m.material.userData.shaderRefs) m.material.userData.shaderRefs.parallaxMode.value = val } } }
export function setParallaxAdaptive(val) { parallaxAdaptive = val; if (initialized) { for (const m of [meshLeft, meshRight]) { if (m && m.material && m.material.userData.shaderRefs) m.material.userData.shaderRefs.parallaxAdaptive.value = val } } }
export function setParallaxEnabled(on) { parallaxEnabled = on; if (initialized) { for (const m of [meshLeft, meshRight]) { if (m && m.material && m.material.userData.shaderRefs) { const ht = m.material.userData.shaderRefs.heightMap.value; m.material.userData.shaderRefs.hasHeightMap.value = (ht && on) ? 1.0 : 0.0; if (ht) { ht.needsUpdate = true; m.material.needsUpdate = true } } } } }
export function setParallaxShadow(val) { parallaxShadow = val; if (initialized) { for (const m of [meshLeft, meshRight]) { if (m && m.material && m.material.userData.shaderRefs) m.material.userData.shaderRefs.parallaxShadow.value = val } } }
export function setLightPreset(presetKey) { applyLightPreset(presetKey); if (currentEnvMode !== 'custom') setEnvMode('custom') }
export function getCustomLightConfig() { return customLightConfig ? cloneLightConfig(customLightConfig) : null }
export function applyCustomLightConfigExport(config) { if (currentEnvMode !== 'custom') setEnvMode('custom'); applyCustomLightConfig(config) }
export function setEnvIntensity(val) { envIntensity = val; if (initialized) { if (scene) scene.environmentIntensity = val; for (const m of [meshLeft, meshRight]) { if (m) m.material.envMapIntensity = val } } }
export function setExposure(val) { if (initialized && renderer) renderer.toneMappingExposure = val }
export function toggleGround(visible) { groundVisible = visible; if (initialized) { if (groundMesh) groundMesh.visible = visible; if (gridHelper) gridHelper.visible = visible } }
export function setAutoRotate(on) { autoRotate = on }
export function setWireframe(on) { if (initialized) { meshLeft.material.wireframe = on; meshRight.material.wireframe = on } }
export function setOpacityMode(mode) { opacityMode = mode; if (initialized) { for (const m of [meshLeft, meshRight]) { if (m) applyOpacityMode(m.material) } } }
export function setOpacity(val) { opacityValue = val; if (initialized) { for (const m of [meshLeft, meshRight]) { if (m) applyOpacityMode(m.material) } } }
export function setTransmission(val) { transmissionValue = val; if (initialized) { for (const m of [meshLeft, meshRight]) { if (m) { m.material.transmission = val; if (val > 0) { m.material.transparent = true; m.material.alphaTest = 0 } m.material.needsUpdate = true } } } }
export function setIOR(val) { iorValue = val; if (initialized) { for (const m of [meshLeft, meshRight]) { if (m) m.material.ior = val } } }
export function setClearcoat(val) { clearcoatValue = val; if (initialized) { for (const m of [meshLeft, meshRight]) { if (m) m.material.clearcoat = val } } }
export function setTextureFilter(mode) { textureFilter = mode; applyFilterToAllTextures() }
export function setMipmapsEnabled(on) { mipmapsEnabled = on; applyFilterToAllTextures() }
export function setAnisotropyLevel(val) { anisotropyLevel = Math.max(1, Math.round(val)); applyFilterToAllTextures() }
export function getMaxAnisotropy() { return maxAnisotropy }
export function screenshot() {
  if (!initialized || !renderer) return
  renderer.render(scene, camera)
  const url = renderer.domElement.toDataURL('image/png')
  const a = document.createElement('a')
  a.href = url; a.download = `material3d_${Date.now()}.png`
  document.body.appendChild(a); a.click(); document.body.removeChild(a)
}
export function toggleFullscreen() {
  if (!container) return
  container.classList.toggle('fullscreen')
  setTimeout(handleResize, 50)
}
export async function loadHDREnv(filePath) {
  if (!initialized || !filePath) return
  try {
    const tex = await loadEnvTexture(filePath, extFromUrl(filePath))
    tex.mapping = THREE.EquirectangularReflectionMapping
    if (hdrTextureOriginal) { hdrTextureOriginal.dispose(); hdrTextureOriginal = null }
    if (hdrTextureRotated) { hdrTextureRotated.dispose(); hdrTextureRotated = null }

    if (envTexture) { envTexture.dispose(); envTexture = null }
    hdrTextureOriginal = tex
    hdrTexture = tex
    hdrInfo = {
      width: tex.image.width || 0,
      height: tex.image.height || 0,
      format: tex._srcFormat || 'HDR (RGBE)',
      size: tex.image.data ? tex.image.data.byteLength : 0
    }
    ensureRotatedTexture()
    currentEnvMode = 'hdri'
    applyHDREnvMode()
    window.dispatchEvent(new CustomEvent('material3d:hdrLoaded', { detail: hdrInfo }))
  } catch (e) {
    window.dispatchEvent(new CustomEvent('material3d:hdrLoadFailed', { detail: { message: e.message } }))
  }
}
export function clearHDREnv() {
  if (hdrTextureOriginal) { hdrTextureOriginal.dispose(); hdrTextureOriginal = null }
  if (hdrTextureRotated) { hdrTextureRotated.dispose(); hdrTextureRotated = null }

  hdrTexture = null
  hdrInfo = null
  if (scene) scene.environmentRotation.set(0, 0, 0)
  if (currentEnvMode === 'hdri') setEnvMode('custom')
  else applyHDREnvMode()
}
export function getCurrentLightPreset() { return currentLightPreset }
export function getCurrentEnvMode() { return currentEnvMode }
export function setEnvModeExport(mode) { setEnvMode(mode) }
export function setHdrRotation(val) {
  hdrRotation = val
  if (hdrRotateTimer) clearTimeout(hdrRotateTimer)
  hdrRotateTimer = setTimeout(() => {
    hdrRotateTimer = null
    if (initialized && currentEnvMode === 'hdri') {
      ensureRotatedTexture()
      applyHDREnvMode()
    }
  }, 30)
}

export function setHdrUsage(mode) { if (!['both', 'env', 'bg'].includes(mode)) return; hdrUsage = mode; if (initialized && currentEnvMode === 'hdri') applyHDREnvMode() }
export function getHdrInfo() { return hdrInfo }
export function setSkyTurbidity(val) { skyTurbidity = val; if (initialized && currentEnvMode === 'sky') { updateSkySunPosition(); scheduleSkyBake() } }
export function setSkyRayleigh(val) { skyRayleigh = val; if (initialized && currentEnvMode === 'sky') { updateSkySunPosition(); scheduleSkyBake() } }
export function setSkyMieCoefficient(val) { skyMieCoefficient = val; if (initialized && currentEnvMode === 'sky') { updateSkySunPosition(); scheduleSkyBake() } }
export function setSkyMieDirectionalG(val) { skyMieDirectionalG = val; if (initialized && currentEnvMode === 'sky') { updateSkySunPosition(); scheduleSkyBake() } }
export function setSkySunElevation(val) { skySunElevation = val; if (initialized && currentEnvMode === 'sky') { updateSkySunPosition(); scheduleSkyBake() } }
export function setSkySunAzimuth(val) { skySunAzimuth = val; if (initialized && currentEnvMode === 'sky') { updateSkySunPosition(); scheduleSkyBake() } }

export function setSkyTint(hex) { const n = parseInt(hex.slice(1), 16); if (Number.isNaN(n)) return; skyTintHex = n; if (initialized && currentEnvMode === 'sky') { updateSkySunPosition(); scheduleSkyBake() } }

function disposeTexture(tex) { if (tex && tex.dispose) tex.dispose() }
function disposeAllMaterialTextures(m) { disposeTexture(m.map); disposeTexture(m.normalMap); disposeTexture(m.roughnessMap); disposeTexture(m.metalnessMap); disposeTexture(m.emissiveMap); if (m.userData.shaderRefs) { disposeTexture(m.userData.shaderRefs.heightMap.value); m.userData.shaderRefs.heightMap.value = null; m.userData.shaderRefs.hasHeightMap.value = 0.0 } disposeTexture(m.userData.pendingHeightMap); m.userData.pendingHeightMap = null; m.map = null; m.normalMap = null; m.roughnessMap = null; m.metalnessMap = null; m.emissiveMap = null }

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
      if (side === 'left' && heightDetectCallback) heightDetectCallback('loading')
      requestAnimationFrame(() => {
        setLoadingProgress(0.2)
        disposeTexture(material.normalMap); material.normalMap = reconstructNormal(src); applyTextureFilter(material.normalMap); material.normalScale.set(normalScale, normalScale)
        requestAnimationFrame(() => {
          setLoadingProgress(0.4)
          let heightTex = extractHeight(src); let hStatus = heightTex ? 'alpha' : false
          if (!heightTex) { heightTex = extractHeightFromNormal(src); hStatus = heightTex ? 'normal' : false }
          setLoadingProgress(0.9)
          if (material.userData.shaderRefs) { disposeTexture(material.userData.shaderRefs.heightMap.value); material.userData.shaderRefs.heightMap.value = heightTex; material.userData.shaderRefs.hasHeightMap.value = (heightTex && parallaxEnabled) ? 1.0 : 0.0; if (heightTex) { applyHeightFilter(heightTex); material.userData.shaderRefs.uHeightTexSize.value.set(heightTex.image.width, heightTex.image.height) } }
          else { disposeTexture(material.userData.pendingHeightMap); material.userData.pendingHeightMap = heightTex }
          if (side === 'left' && heightDetectCallback) heightDetectCallback(hStatus)
          material.needsUpdate = true
          if (side === 'left') { setLoadingProgress(1.0); setTimeout(hideLoading, 200) }
        })
      })
    }
    if (typeof createImageBitmap !== 'undefined') {
      fetch(nUrl).then(r => r.blob()).then(blob => createImageBitmap(blob, { premultiplyAlpha: 'none' })).then(bitmap => { processNormal(bitmap); if (bitmap.close) bitmap.close() }).catch(() => { const img = new Image(); img.onload = () => processNormal(img); img.src = nUrl })
    } else { const img = new Image(); img.onload = () => processNormal(img); img.src = nUrl }
  } else { if (side === 'left' && heightDetectCallback) heightDetectCallback(false) }

  if (specEntry) {
    const specImg = new Image(); specImg.onload = () => {
      let fmt = materialFormat
      if (fmt === 'auto') { fmt = detectFormat(specImg); if (formatDetectCallback) formatDetectCallback(fmt) }
      disposeTexture(material.roughnessMap); disposeTexture(material.metalnessMap); disposeTexture(material.emissiveMap)
      if (fmt === 'old') {
        material.roughnessMap = extractChannel(specImg, 0, true); material.metalnessMap = extractChannel(specImg, 1, false); material.emissiveMap = extractChannel(specImg, 2, false); applyTextureFilter(material.roughnessMap); applyTextureFilter(material.metalnessMap); applyTextureFilter(material.emissiveMap)
        material.emissive.set(0xffffff); material.emissiveIntensity = emissiveIntensity; material.needsUpdate = true
      } else {
         material.roughnessMap = extractRoughness(specImg); material.metalnessMap = extractMetalness(specImg); applyTextureFilter(material.roughnessMap); applyTextureFilter(material.metalnessMap)
        if (mainEntry) {
          const mainImg = new Image(); mainImg.onload = () => {
             disposeTexture(material.emissiveMap); material.emissiveMap = extractEmissive(specImg, mainImg); applyTextureFilter(material.emissiveMap)
            material.emissive.set(0xffffff); material.emissiveIntensity = emissiveIntensity; material.needsUpdate = true
          }; mainImg.src = fileUrl(mainEntry.fullPath)
        } else { material.emissive.set(0x000000) }
        material.needsUpdate = true
      }
    }; specImg.src = fileUrl(specEntry.fullPath)
  } else { material.emissive.set(0x000000) }
  material.needsUpdate = true
}

export function updateMaterial3D(group) {
  if (!initialized) return
  if (!group && heightDetectCallback) heightDetectCallback(false)
  applyTexturesToMesh(meshLeft, group, 'left')
  applyTexturesToMesh(meshRight, group, 'right')
}

export function clearMaterial3D() { updateMaterial3D(null) }

/* ════════════════════════════════════════════════════════════
   节点编辑器联动 API
   ════════════════════════════════════════════════════════════ */
export function isMaterial3DReady() { return initialized }
export function setBaseColor(rgb) {
  if (!initialized || !Array.isArray(rgb)) return
  const r = clamp01(rgb[0]), g = clamp01(rgb[1]), b = clamp01(rgb[2])
  meshLeft.material.color.setRGB(r, g, b)
  meshRight.material.color.setRGB(r, g, b)
  meshLeft.material.needsUpdate = meshRight.material.needsUpdate = true
}
export function setEmissiveColor(rgb) {
  if (!initialized || !Array.isArray(rgb)) return
  const r = clamp01(rgb[0]), g = clamp01(rgb[1]), b = clamp01(rgb[2])
  meshLeft.material.emissive.setRGB(r, g, b)
  meshRight.material.emissive.setRGB(r, g, b)
  meshLeft.material.needsUpdate = meshRight.material.needsUpdate = true
}
function clamp01(v) { return Math.max(0, Math.min(1, v)) }
export function setMainTextureFromUrl(url) {
  if (!initialized || !url) return
  const loader = new THREE.TextureLoader()
  for (const m of [meshLeft, meshRight]) {
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
  if (!initialized || !url) return
  const loader = new THREE.TextureLoader()
  for (const m of [meshLeft, meshRight]) {
    loader.load(url, (tex) => {
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
    disposeTexture(m.material.map); m.material.map = null; m.material.needsUpdate = true
  }
}
export function clearNormalMap() {
  if (!initialized) return
  for (const m of [meshLeft, meshRight]) {
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
  if (!initialized || !url) return
  for (const m of [meshLeft, meshRight]) applySpecTextureToMaterial(m.material, url)
}
export function clearSpecularTexture() {
  if (!initialized) return
  for (const m of [meshLeft, meshRight]) clearSpecTexture(m.material)
}
export function applyNodePBR(p) {
  if (!initialized || !p) return
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
  const mesh = side === 'left' ? meshLeft : meshRight
  if (!mesh) return
  const mat = mesh.material
  if (p.baseColor && Array.isArray(p.baseColor)) {
    mat.color.setRGB(clamp01(p.baseColor[0]), clamp01(p.baseColor[1]), clamp01(p.baseColor[2])); mat.needsUpdate = true
  }
  if (typeof p.roughness === 'number') mat.roughness = clamp01(p.roughness)
  if (typeof p.metallic === 'number') mat.metalness = clamp01(p.metallic)
  if (typeof p.normalScale === 'number') mat.normalScale.set(p.normalScale, p.normalScale)
  if (typeof p.opacity === 'number') { opacityValue = p.opacity; applyOpacityMode(mat) }
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
      disposeTexture(mat.normalMap); mat.normalMap = tex; mat.normalScale.set(normalScale, normalScale); applyTextureFilter(tex); mat.needsUpdate = true
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
  if (!initialized) return null
  const m = meshLeft.material
  return {
    color: [m.color.r, m.color.g, m.color.b],
    roughness: m.roughness, metalness: m.metalness,
    normalScale, emissiveIntensity, envIntensity,
    hasMap: !!m.map, hasNormalMap: !!m.normalMap
  }
}

export function disposeMaterial3D() {
  if (animationId) cancelAnimationFrame(animationId)
  if (skyBakeTimer) { clearTimeout(skyBakeTimer); skyBakeTimer = null }
  if (hdrRotateTimer) { clearTimeout(hdrRotateTimer); hdrRotateTimer = null }
  for (const m of [meshLeft, meshRight]) { if (m) { if (m.material) { disposeAllMaterialTextures(m.material); m.material.dispose() }; if (m.geometry) m.geometry.dispose() } }
  if (groundMesh) { groundMesh.geometry.dispose(); groundMesh.material.dispose() }
  if (gridHelper) { gridHelper.geometry.dispose(); gridHelper.material.dispose() }
  if (envTexture) envTexture.dispose()
  if (pmremTexture) pmremTexture.dispose()
  if (hdrTextureOriginal) hdrTextureOriginal.dispose()
  if (hdrTextureRotated) hdrTextureRotated.dispose()
  if (skyEnvTexture) skyEnvTexture.dispose()
  if (skyMesh) { skyMesh.geometry.dispose(); skyMesh.material.dispose(); skyMesh = null }
  if (pmrem) pmrem.dispose(); if (renderer) renderer.dispose()
  initialized = false
}