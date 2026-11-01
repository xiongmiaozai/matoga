/**
 * matoga - MC 模型：EnvironmentLighting
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 从 mc-model-viewer.js 按领域搬出（正文逐字未改）。
 * 职责：环境贴图/光照预设/天空/HDR 管理
 */

import { LIGHT_PRESETS } from '../m3d/presets.js'
import * as THREE from 'three'
import { Sky } from '../sky.js'
import { rotateTextureData } from '../m3d/geo-utils.js'
import { loadEnvTexture, extFromUrl } from '../hdr-env-loader.js'

/* 模块状态：只读用 getter；可写用 get/set 成对（§2.2） */
let _get_lightGroup = () => undefined
let _get_initialized = () => undefined
let _get_pmrem = () => undefined
let _get_scene = () => undefined
let _get_meshLeft = () => undefined
let _get_meshRight = () => undefined
let _get__skyTint = () => undefined
let _get_currentLightPreset = () => undefined
let _set_currentLightPreset = () => {}
let _get_customLightConfig = () => undefined
let _set_customLightConfig = () => {}
let _get_currentEnvMode = () => undefined
let _set_currentEnvMode = () => {}
let _get_envTexture = () => undefined
let _set_envTexture = () => {}
let _get_pmremTexture = () => undefined
let _set_pmremTexture = () => {}
let _get_envIntensity = () => undefined
let _set_envIntensity = () => {}
let _get_skyMesh = () => undefined
let _set_skyMesh = () => {}
let _get_skySunElevation = () => undefined
let _set_skySunElevation = () => {}
let _get_skySunAzimuth = () => undefined
let _set_skySunAzimuth = () => {}
let _get_skyTurbidity = () => undefined
let _set_skyTurbidity = () => {}
let _get_skyRayleigh = () => undefined
let _set_skyRayleigh = () => {}
let _get_skyMieCoefficient = () => undefined
let _set_skyMieCoefficient = () => {}
let _get_skyMieDirectionalG = () => undefined
let _set_skyMieDirectionalG = () => {}
let _get_skyTintHex = () => undefined
let _set_skyTintHex = () => {}
let _get_skySunLight = () => undefined
let _set_skySunLight = () => {}
let _get_skyEnvTexture = () => undefined
let _set_skyEnvTexture = () => {}
let _get_skyBakeTimer = () => undefined
let _set_skyBakeTimer = () => {}
let _get_hdrTexture = () => undefined
let _set_hdrTexture = () => {}
let _get_hdrTextureOriginal = () => undefined
let _set_hdrTextureOriginal = () => {}
let _get_hdrRotation = () => undefined
let _set_hdrRotation = () => {}
let _get_hdrUsage = () => undefined
let _set_hdrUsage = () => {}
let _get_hdrTextureRotated = () => undefined
let _set_hdrTextureRotated = () => {}
let _get_hdrInfo = () => undefined
let _set_hdrInfo = () => {}
let _get_hdrRotateTimer = () => undefined
let _set_hdrRotateTimer = () => {}

export function setHooks(h) {
  if (h.get_lightGroup) _get_lightGroup = h.get_lightGroup
  if (h.get_initialized) _get_initialized = h.get_initialized
  if (h.get_pmrem) _get_pmrem = h.get_pmrem
  if (h.get_scene) _get_scene = h.get_scene
  if (h.get_meshLeft) _get_meshLeft = h.get_meshLeft
  if (h.get_meshRight) _get_meshRight = h.get_meshRight
  if (h.get__skyTint) _get__skyTint = h.get__skyTint
  if (h.get_currentLightPreset) _get_currentLightPreset = h.get_currentLightPreset
  if (h.set_currentLightPreset) _set_currentLightPreset = h.set_currentLightPreset
  if (h.get_customLightConfig) _get_customLightConfig = h.get_customLightConfig
  if (h.set_customLightConfig) _set_customLightConfig = h.set_customLightConfig
  if (h.get_currentEnvMode) _get_currentEnvMode = h.get_currentEnvMode
  if (h.set_currentEnvMode) _set_currentEnvMode = h.set_currentEnvMode
  if (h.get_envTexture) _get_envTexture = h.get_envTexture
  if (h.set_envTexture) _set_envTexture = h.set_envTexture
  if (h.get_pmremTexture) _get_pmremTexture = h.get_pmremTexture
  if (h.set_pmremTexture) _set_pmremTexture = h.set_pmremTexture
  if (h.get_envIntensity) _get_envIntensity = h.get_envIntensity
  if (h.set_envIntensity) _set_envIntensity = h.set_envIntensity
  if (h.get_skyMesh) _get_skyMesh = h.get_skyMesh
  if (h.set_skyMesh) _set_skyMesh = h.set_skyMesh
  if (h.get_skySunElevation) _get_skySunElevation = h.get_skySunElevation
  if (h.set_skySunElevation) _set_skySunElevation = h.set_skySunElevation
  if (h.get_skySunAzimuth) _get_skySunAzimuth = h.get_skySunAzimuth
  if (h.set_skySunAzimuth) _set_skySunAzimuth = h.set_skySunAzimuth
  if (h.get_skyTurbidity) _get_skyTurbidity = h.get_skyTurbidity
  if (h.set_skyTurbidity) _set_skyTurbidity = h.set_skyTurbidity
  if (h.get_skyRayleigh) _get_skyRayleigh = h.get_skyRayleigh
  if (h.set_skyRayleigh) _set_skyRayleigh = h.set_skyRayleigh
  if (h.get_skyMieCoefficient) _get_skyMieCoefficient = h.get_skyMieCoefficient
  if (h.set_skyMieCoefficient) _set_skyMieCoefficient = h.set_skyMieCoefficient
  if (h.get_skyMieDirectionalG) _get_skyMieDirectionalG = h.get_skyMieDirectionalG
  if (h.set_skyMieDirectionalG) _set_skyMieDirectionalG = h.set_skyMieDirectionalG
  if (h.get_skyTintHex) _get_skyTintHex = h.get_skyTintHex
  if (h.set_skyTintHex) _set_skyTintHex = h.set_skyTintHex
  if (h.get_skySunLight) _get_skySunLight = h.get_skySunLight
  if (h.set_skySunLight) _set_skySunLight = h.set_skySunLight
  if (h.get_skyEnvTexture) _get_skyEnvTexture = h.get_skyEnvTexture
  if (h.set_skyEnvTexture) _set_skyEnvTexture = h.set_skyEnvTexture
  if (h.get_skyBakeTimer) _get_skyBakeTimer = h.get_skyBakeTimer
  if (h.set_skyBakeTimer) _set_skyBakeTimer = h.set_skyBakeTimer
  if (h.get_hdrTexture) _get_hdrTexture = h.get_hdrTexture
  if (h.set_hdrTexture) _set_hdrTexture = h.set_hdrTexture
  if (h.get_hdrTextureOriginal) _get_hdrTextureOriginal = h.get_hdrTextureOriginal
  if (h.set_hdrTextureOriginal) _set_hdrTextureOriginal = h.set_hdrTextureOriginal
  if (h.get_hdrRotation) _get_hdrRotation = h.get_hdrRotation
  if (h.set_hdrRotation) _set_hdrRotation = h.set_hdrRotation
  if (h.get_hdrUsage) _get_hdrUsage = h.get_hdrUsage
  if (h.set_hdrUsage) _set_hdrUsage = h.set_hdrUsage
  if (h.get_hdrTextureRotated) _get_hdrTextureRotated = h.get_hdrTextureRotated
  if (h.set_hdrTextureRotated) _set_hdrTextureRotated = h.set_hdrTextureRotated
  if (h.get_hdrInfo) _get_hdrInfo = h.get_hdrInfo
  if (h.set_hdrInfo) _set_hdrInfo = h.set_hdrInfo
  if (h.get_hdrRotateTimer) _get_hdrRotateTimer = h.get_hdrRotateTimer
  if (h.set_hdrRotateTimer) _set_hdrRotateTimer = h.set_hdrRotateTimer
}

export function createEnvTexture(presetKey) {
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

export function cloneLightConfig(config) {
  return {
    ambient: { color: config.ambient.color, intensity: config.ambient.intensity },
    lights: config.lights.map(l => ({ color: l.color, intensity: l.intensity, pos: [l.pos[0], l.pos[1], l.pos[2]] })),
    bg: config.bg
  }
}

export function rebuildLights(config) {
  if (!_get_lightGroup()) return
  while (_get_lightGroup().children.length) _get_lightGroup().remove(_get_lightGroup().children[0])
  const ambient = new THREE.AmbientLight(config.ambient.color, config.ambient.intensity)
  _get_lightGroup().add(ambient)
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
    _get_lightGroup().add(dir)
  }
}

export function applyLightPreset(presetKey) {
  if (!_get_initialized() || !LIGHT_PRESETS[presetKey]) return
  _set_currentLightPreset(presetKey)
  const preset = LIGHT_PRESETS[presetKey]
  _set_customLightConfig(cloneLightConfig(preset))
  rebuildLights(preset)
  if (_get_currentEnvMode() === 'custom') {
    if (_get_envTexture()) _get_envTexture().dispose()
    _set_envTexture(createEnvTexture(presetKey))
    if (_get_pmremTexture()) _get_pmremTexture().dispose()
    _set_pmremTexture(_get_pmrem().fromEquirectangular(_get_envTexture()))
    _get_scene().environment = _get_pmremTexture().texture
    _get_scene().background = new THREE.Color(preset.bg)
  }
  if (_get_scene()) _get_scene().environmentIntensity = _get_envIntensity()
  for (const m of [_get_meshLeft(), _get_meshRight()]) {
    if (m) m.material.envMapIntensity = _get_envIntensity()
  }
}

export function applyCustomLightConfig(config) {
  if (!_get_initialized() || !config || !config.ambient || !Array.isArray(config.lights)) return
  _set_customLightConfig(cloneLightConfig(config))
  rebuildLights(_get_customLightConfig())
  if (_get_currentEnvMode() === 'custom') {
    _get_scene().background = new THREE.Color(_get_customLightConfig().bg)
  }
  if (_get_scene()) _get_scene().environmentIntensity = _get_envIntensity()
  for (const m of [_get_meshLeft(), _get_meshRight()]) {
    if (m) m.material.envMapIntensity = _get_envIntensity()
  }
}

export function updateSkySunPosition() {
  if (!_get_skyMesh()) return
  const u = _get_skyMesh().material.uniforms
  const elevation = (_get_skySunElevation() * Math.PI) / 180
  const azimuth = (_get_skySunAzimuth() * Math.PI) / 180
  const phi = Math.PI / 2 - elevation
  const sun = new THREE.Vector3()
  sun.setFromSphericalCoords(1, phi, azimuth)
  u.sunPosition.value.copy(sun)
  u.turbidity.value = _get_skyTurbidity()
  u.rayleigh.value = _get_skyRayleigh()
  u.mieCoefficient.value = _get_skyMieCoefficient()
  u.mieDirectionalG.value = _get_skyMieDirectionalG()

  _get__skyTint().setHex(_get_skyTintHex())
  u.skyTint.value.set(_get__skyTint().r, _get__skyTint().g, _get__skyTint().b)
  if (_get_skySunLight()) {
    _get_skySunLight().position.copy(sun).multiplyScalar(10)
    const dayFactor = Math.max(0, Math.sin(elevation))
    _get_skySunLight().intensity = 2.5 * dayFactor
  }
}

export function bakeSkyEnvironment() {
  if (!_get_skyMesh() || !_get_pmrem()) return
  const u = _get_skyMesh().material.uniforms
  const prevSunDisc = u.showSunDisc.value
  u.showSunDisc.value = 0
  const skyScene = new THREE.Scene()
  _get_scene().remove(_get_skyMesh())
  skyScene.add(_get_skyMesh())
  if (_get_skyEnvTexture()) _get_skyEnvTexture().dispose()
  _set_skyEnvTexture(_get_pmrem().fromScene(skyScene))
  _get_scene().environment = _get_skyEnvTexture().texture
  skyScene.remove(_get_skyMesh())
  _get_scene().add(_get_skyMesh())
  u.showSunDisc.value = prevSunDisc
  if (_get_scene()) _get_scene().environmentIntensity = _get_envIntensity()
  for (const m of [_get_meshLeft(), _get_meshRight()]) {
    if (m) m.material.envMapIntensity = _get_envIntensity()
  }
}

export function scheduleSkyBake() {
  clearTimeout(_get_skyBakeTimer())
  _set_skyBakeTimer(
    setTimeout(() => {
      _set_skyBakeTimer(null)
      if (_get_initialized() && _get_currentEnvMode() === 'sky') bakeSkyEnvironment()
    }, 120)
  )
}

export function applyProceduralSky() {
  if (!_get_initialized()) return
  if (_get_hdrTexture()) {
    _get_hdrTexture().dispose()
    _set_hdrTexture(null)
  }
  if (_get_envTexture()) {
    _get_envTexture().dispose()
    _set_envTexture(null)
  }
  if (_get_pmremTexture()) {
    _get_pmremTexture().dispose()
    _set_pmremTexture(null)
  }
  if (_get_lightGroup()) {
    while (_get_lightGroup().children.length) _get_lightGroup().remove(_get_lightGroup().children[0])
  }
  const ambient = new THREE.AmbientLight(0xffffff, 0.15)
  _get_lightGroup().add(ambient)
  if (!_get_skySunLight()) {
    _set_skySunLight(new THREE.DirectionalLight(0xffffff, 2.5))
    _get_skySunLight().castShadow = true
    _get_skySunLight().shadow.mapSize.set(1024, 1024)
    _get_skySunLight().shadow.camera.left = -3
    _get_skySunLight().shadow.camera.right = 3
    _get_skySunLight().shadow.camera.top = 3
    _get_skySunLight().shadow.camera.bottom = -3
    _get_skySunLight().shadow.camera.near = 0.1
    _get_skySunLight().shadow.camera.far = 50
  }
  _get_lightGroup().add(_get_skySunLight())
  if (!_get_skyMesh()) {
    _set_skyMesh(new Sky())
    _get_skyMesh().scale.setScalar(10000)
    _get_scene().add(_get_skyMesh())
  }
  updateSkySunPosition()
  _get_scene().background = null
  bakeSkyEnvironment()
}

export function applyHDREnvMode() {
  if (!_get_initialized()) return
  if (_get_skyMesh()) {
    _get_scene().remove(_get_skyMesh())
    _set_skyMesh(null)
  }
  if (_get_skyEnvTexture()) {
    _get_skyEnvTexture().dispose()
    _set_skyEnvTexture(null)
  }
  if (_get_skySunLight()) {
    _get_lightGroup().remove(_get_skySunLight())
    _set_skySunLight(null)
  }
  if (_get_envTexture()) {
    _get_envTexture().dispose()
    _set_envTexture(null)
  }
  if (_get_pmremTexture()) {
    _get_pmremTexture().dispose()
    _set_pmremTexture(null)
  }
  if (_get_lightGroup()) {
    while (_get_lightGroup().children.length) _get_lightGroup().remove(_get_lightGroup().children[0])
  }
  const ambient = new THREE.AmbientLight(0xffffff, 0.1)
  _get_lightGroup().add(ambient)
  if (_get_hdrTextureOriginal()) {
    const rad = (_get_hdrRotation() * Math.PI) / 180
    _set_hdrTexture(_get_hdrTextureOriginal())
    if (_get_hdrUsage() === 'env' || _get_hdrUsage() === 'both') {
      _get_scene().environment = _get_hdrTextureOriginal()
      _get_scene().environmentRotation.set(0, rad, 0)
    } else {
      _get_scene().environment = null
      _get_scene().environmentRotation.set(0, 0, 0)
    }
    if (_get_hdrUsage() === 'bg' || _get_hdrUsage() === 'both') {
      ensureRotatedTexture()
      _get_scene().background = _get_hdrTextureRotated() || _get_hdrTextureOriginal()
    } else {
      _get_scene().background = new THREE.Color(0x1a1a2e)
    }
  } else {
    _set_hdrTexture(null)
    _get_scene().environment = null
    _get_scene().environmentRotation.set(0, 0, 0)
    _get_scene().background = new THREE.Color(0x1a1a2e)
  }
  if (_get_scene()) _get_scene().environmentIntensity = _get_envIntensity()
  for (const m of [_get_meshLeft(), _get_meshRight()]) {
    if (m) m.material.envMapIntensity = _get_envIntensity()
  }
}

export function ensureRotatedTexture() {
  if (_get_hdrTextureRotated()) {
    _get_hdrTextureRotated().dispose()
    _set_hdrTextureRotated(null)
  }
  if (_get_hdrTextureOriginal() && _get_hdrRotation() % 360) {
    _set_hdrTextureRotated(rotateTextureData(_get_hdrTextureOriginal(), _get_hdrRotation()))
  }
}

export function setEnvMode(mode) {
  if (!_get_initialized() || !['custom', 'sky', 'hdri'].includes(mode)) return
  _set_currentEnvMode(mode)
  if (mode === 'sky') {
    applyProceduralSky()
  } else if (mode === 'hdri') {
    applyHDREnvMode()
  } else {
    if (_get_skyMesh()) {
      _get_scene().remove(_get_skyMesh())
      _set_skyMesh(null)
    }
    if (_get_skyEnvTexture()) {
      _get_skyEnvTexture().dispose()
      _set_skyEnvTexture(null)
    }
    if (_get_skySunLight()) {
      _get_lightGroup().remove(_get_skySunLight())
      _set_skySunLight(null)
    }
    if (_get_hdrTextureOriginal()) {
      _get_hdrTextureOriginal().dispose()
      _set_hdrTextureOriginal(null)
    }
    if (_get_hdrTextureRotated()) {
      _get_hdrTextureRotated().dispose()
      _set_hdrTextureRotated(null)
    }
    _set_hdrTexture(null)
    if (_get_scene()) _get_scene().environmentRotation.set(0, 0, 0)
    applyLightPreset(_get_currentLightPreset())
  }
}

export function setLightPreset(presetKey) {
  applyLightPreset(presetKey)
  if (_get_currentEnvMode() !== 'custom') setEnvMode('custom')
}

export function setEnvIntensity(val) {
  _set_envIntensity(val)
  if (_get_initialized()) {
    if (_get_scene()) _get_scene().environmentIntensity = val
    for (const m of [_get_meshLeft(), _get_meshRight()]) {
      if (m) m.material.envMapIntensity = val
    }
  }
}

export async function loadHDREnv(filePath) {
  if (!_get_initialized() || !filePath) return
  window.dispatchEvent(new CustomEvent('material3d:hdrLoading', { detail: { url: filePath } }))
  try {
    const tex = await loadEnvTexture(filePath, extFromUrl(filePath))
    tex.mapping = THREE.EquirectangularReflectionMapping
    if (_get_hdrTextureOriginal()) {
      _get_hdrTextureOriginal().dispose()
      _set_hdrTextureOriginal(null)
    }
    if (_get_hdrTextureRotated()) {
      _get_hdrTextureRotated().dispose()
      _set_hdrTextureRotated(null)
    }

    if (_get_envTexture()) {
      _get_envTexture().dispose()
      _set_envTexture(null)
    }
    _set_hdrTextureOriginal(tex)
    _set_hdrTexture(tex)
    _set_hdrInfo({
      width: tex.image.width || 0,
      height: tex.image.height || 0,
      format: tex._srcFormat || 'HDR (RGBE)',
      size: tex.image.data ? tex.image.data.byteLength : 0
    })

    _set_currentEnvMode('hdri')
    applyHDREnvMode()
    window.dispatchEvent(new CustomEvent('material3d:hdrLoaded', { detail: _get_hdrInfo() }))
  } catch (e) {
    window.dispatchEvent(new CustomEvent('material3d:hdrLoadFailed', { detail: { message: e.message } }))
  }
}

export function clearHDREnv() {
  if (_get_hdrTextureOriginal()) {
    _get_hdrTextureOriginal().dispose()
    _set_hdrTextureOriginal(null)
  }
  if (_get_hdrTextureRotated()) {
    _get_hdrTextureRotated().dispose()
    _set_hdrTextureRotated(null)
  }

  _set_hdrTexture(null)
  _set_hdrInfo(null)
  if (_get_scene()) _get_scene().environmentRotation.set(0, 0, 0)
  if (_get_currentEnvMode() === 'hdri') setEnvMode('custom')

}

export function getCurrentLightPreset() {
  return _get_currentLightPreset()
}

export function getCurrentEnvMode() {
  return _get_currentEnvMode()
}

export function setEnvModeExport(mode) {
  setEnvMode(mode)
}

export function setHdrRotation(val) {
  _set_hdrRotation(val)
  if (!_get_initialized() || _get_currentEnvMode() !== 'hdri') return
  if (_get_hdrUsage() === 'env' || _get_hdrUsage() === 'both') {
    _get_scene().environmentRotation.set(0, (_get_hdrRotation() * Math.PI) / 180, 0)
  }
  if (_get_hdrUsage() === 'bg' || _get_hdrUsage() === 'both') {
    if (_get_hdrRotateTimer()) clearTimeout(_get_hdrRotateTimer())
    _set_hdrRotateTimer(
      setTimeout(() => {
        _set_hdrRotateTimer(null)
        if (_get_currentEnvMode() === 'hdri' && (_get_hdrUsage() === 'bg' || _get_hdrUsage() === 'both')) {
          ensureRotatedTexture()
          _get_scene().background = _get_hdrTextureRotated() || _get_hdrTextureOriginal()
        }
      }, 80)
    )
  }
}

export function setHdrUsage(mode) {
  if (!['both', 'env', 'bg'].includes(mode)) return
  _set_hdrUsage(mode)
  if (_get_initialized() && _get_currentEnvMode() === 'hdri') applyHDREnvMode()
}

export function setSkyTurbidity(val) {
  _set_skyTurbidity(val)
  if (_get_initialized() && _get_currentEnvMode() === 'sky') {
    updateSkySunPosition()
    scheduleSkyBake()
  }
}

export function setSkyRayleigh(val) {
  _set_skyRayleigh(val)
  if (_get_initialized() && _get_currentEnvMode() === 'sky') {
    updateSkySunPosition()
    scheduleSkyBake()
  }
}

export function setSkyMieCoefficient(val) {
  _set_skyMieCoefficient(val)
  if (_get_initialized() && _get_currentEnvMode() === 'sky') {
    updateSkySunPosition()
    scheduleSkyBake()
  }
}

export function setSkyMieDirectionalG(val) {
  _set_skyMieDirectionalG(val)
  if (_get_initialized() && _get_currentEnvMode() === 'sky') {
    updateSkySunPosition()
    scheduleSkyBake()
  }
}

export function setSkySunElevation(val) {
  _set_skySunElevation(val)
  if (_get_initialized() && _get_currentEnvMode() === 'sky') {
    updateSkySunPosition()
    scheduleSkyBake()
  }
}

export function setSkySunAzimuth(val) {
  _set_skySunAzimuth(val)
  if (_get_initialized() && _get_currentEnvMode() === 'sky') {
    updateSkySunPosition()
    scheduleSkyBake()
  }
}

export function setSkyTint(hex) {
  const n = parseInt(hex.slice(1), 16)
  if (Number.isNaN(n)) return
  _set_skyTintHex(n)
  if (_get_initialized() && _get_currentEnvMode() === 'sky') {
    updateSkySunPosition()
    scheduleSkyBake()
  }
}
