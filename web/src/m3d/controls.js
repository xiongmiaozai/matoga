/**
 * matoga - MC 模型：控制与生命周期
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 从 mc-model-viewer.js 按领域搬出（正文逐字未改）。
 * 职责：OrbitControls 配置、资源释放
 */

/* 主文件函数（注入） */
let _clampFlyPos = (...a) => undefined
let _resetFreeView = (...a) => undefined
let _disposeTexture = (...a) => undefined
let _disposeGroupDeep = (...a) => undefined
let _markShaderMatsDirty = (...a) => undefined

/* 模块状态：只读用 getter；可写用 get/set 成对（§2.2） */
let _get_renderer = () => undefined
let _get_freeCamMode = () => undefined
let _get_camDist = () => undefined
let _get__flyForward = () => undefined
let _get_camera = () => undefined
let _get_flyPos = () => undefined
let _get_FLY_KEYS = () => undefined
let _get_flyKeys = () => undefined
let _get_animationId = () => undefined
let _get_scene = () => undefined
let _get_meshLeft = () => undefined
let _get_meshRight = () => undefined
let _get_groundMesh = () => undefined
let _get_gridHelper = () => undefined
let _get_envTexture = () => undefined
let _get_pmremTexture = () => undefined
let _get_hdrTextureOriginal = () => undefined
let _get_hdrTextureRotated = () => undefined
let _get_skyEnvTexture = () => undefined
let _get_pmrem = () => undefined
let _get_isDragging = () => undefined
let _set_isDragging = () => {}
let _get_autoRotate = () => undefined
let _set_autoRotate = () => {}
let _get_lastX = () => undefined
let _set_lastX = () => {}
let _get_lastY = () => undefined
let _set_lastY = () => {}
let _get_dragMode = () => undefined
let _set_dragMode = () => {}
let _get_flyYaw = () => undefined
let _set_flyYaw = () => {}
let _get_flyPitch = () => undefined
let _set_flyPitch = () => {}
let _get_targetRotY = () => undefined
let _set_targetRotY = () => {}
let _get_targetRotX = () => undefined
let _set_targetRotX = () => {}
let _get_targetPanX = () => undefined
let _set_targetPanX = () => {}
let _get_targetPanY = () => undefined
let _set_targetPanY = () => {}
let _get_targetCamDist = () => undefined
let _set_targetCamDist = () => {}
let _get_skyBakeTimer = () => undefined
let _set_skyBakeTimer = () => {}
let _get_hdrRotateTimer = () => undefined
let _set_hdrRotateTimer = () => {}
let _get_customModelGroup = () => undefined
let _set_customModelGroup = () => {}
let _get_skyMesh = () => undefined
let _set_skyMesh = () => {}
let _get_initialized = () => undefined
let _set_initialized = () => {}

export function setHooks(h) {
  if (h.clampFlyPos) _clampFlyPos = h.clampFlyPos
  if (h.resetFreeView) _resetFreeView = h.resetFreeView
  if (h.disposeTexture) _disposeTexture = h.disposeTexture
  if (h.disposeGroupDeep) _disposeGroupDeep = h.disposeGroupDeep
  if (h.markShaderMatsDirty) _markShaderMatsDirty = h.markShaderMatsDirty
  if (h.get_renderer) _get_renderer = h.get_renderer
  if (h.get_freeCamMode) _get_freeCamMode = h.get_freeCamMode
  if (h.get_camDist) _get_camDist = h.get_camDist
  if (h.get__flyForward) _get__flyForward = h.get__flyForward
  if (h.get_camera) _get_camera = h.get_camera
  if (h.get_flyPos) _get_flyPos = h.get_flyPos
  if (h.get_FLY_KEYS) _get_FLY_KEYS = h.get_FLY_KEYS
  if (h.get_flyKeys) _get_flyKeys = h.get_flyKeys
  if (h.get_animationId) _get_animationId = h.get_animationId
  if (h.get_scene) _get_scene = h.get_scene
  if (h.get_meshLeft) _get_meshLeft = h.get_meshLeft
  if (h.get_meshRight) _get_meshRight = h.get_meshRight
  if (h.get_groundMesh) _get_groundMesh = h.get_groundMesh
  if (h.get_gridHelper) _get_gridHelper = h.get_gridHelper
  if (h.get_envTexture) _get_envTexture = h.get_envTexture
  if (h.get_pmremTexture) _get_pmremTexture = h.get_pmremTexture
  if (h.get_hdrTextureOriginal) _get_hdrTextureOriginal = h.get_hdrTextureOriginal
  if (h.get_hdrTextureRotated) _get_hdrTextureRotated = h.get_hdrTextureRotated
  if (h.get_skyEnvTexture) _get_skyEnvTexture = h.get_skyEnvTexture
  if (h.get_pmrem) _get_pmrem = h.get_pmrem
  if (h.get_isDragging) _get_isDragging = h.get_isDragging
  if (h.set_isDragging) _set_isDragging = h.set_isDragging
  if (h.get_autoRotate) _get_autoRotate = h.get_autoRotate
  if (h.set_autoRotate) _set_autoRotate = h.set_autoRotate
  if (h.get_lastX) _get_lastX = h.get_lastX
  if (h.set_lastX) _set_lastX = h.set_lastX
  if (h.get_lastY) _get_lastY = h.get_lastY
  if (h.set_lastY) _set_lastY = h.set_lastY
  if (h.get_dragMode) _get_dragMode = h.get_dragMode
  if (h.set_dragMode) _set_dragMode = h.set_dragMode
  if (h.get_flyYaw) _get_flyYaw = h.get_flyYaw
  if (h.set_flyYaw) _set_flyYaw = h.set_flyYaw
  if (h.get_flyPitch) _get_flyPitch = h.get_flyPitch
  if (h.set_flyPitch) _set_flyPitch = h.set_flyPitch
  if (h.get_targetRotY) _get_targetRotY = h.get_targetRotY
  if (h.set_targetRotY) _set_targetRotY = h.set_targetRotY
  if (h.get_targetRotX) _get_targetRotX = h.get_targetRotX
  if (h.set_targetRotX) _set_targetRotX = h.set_targetRotX
  if (h.get_targetPanX) _get_targetPanX = h.get_targetPanX
  if (h.set_targetPanX) _set_targetPanX = h.set_targetPanX
  if (h.get_targetPanY) _get_targetPanY = h.get_targetPanY
  if (h.set_targetPanY) _set_targetPanY = h.set_targetPanY
  if (h.get_targetCamDist) _get_targetCamDist = h.get_targetCamDist
  if (h.set_targetCamDist) _set_targetCamDist = h.set_targetCamDist
  if (h.get_skyBakeTimer) _get_skyBakeTimer = h.get_skyBakeTimer
  if (h.set_skyBakeTimer) _set_skyBakeTimer = h.set_skyBakeTimer
  if (h.get_hdrRotateTimer) _get_hdrRotateTimer = h.get_hdrRotateTimer
  if (h.set_hdrRotateTimer) _set_hdrRotateTimer = h.set_hdrRotateTimer
  if (h.get_customModelGroup) _get_customModelGroup = h.get_customModelGroup
  if (h.set_customModelGroup) _set_customModelGroup = h.set_customModelGroup
  if (h.get_skyMesh) _get_skyMesh = h.get_skyMesh
  if (h.set_skyMesh) _set_skyMesh = h.set_skyMesh
  if (h.get_initialized) _get_initialized = h.get_initialized
  if (h.set_initialized) _set_initialized = h.set_initialized
}

export function setupControls() {
  const canvas = _get_renderer().domElement
  canvas.style.cursor = 'grab'
  canvas.addEventListener('contextmenu', e => e.preventDefault())
  canvas.addEventListener('mousedown', e => {
    _set_isDragging(true)
    _set_autoRotate(false)
    _set_lastX(e.clientX)
    _set_lastY(e.clientY)
    if (_get_freeCamMode()) _set_dragMode('look')
    else if (e.button === 0 && !e.shiftKey) _set_dragMode('rotate')
    else _set_dragMode('pan')
    canvas.style.cursor = 'grabbing'
    if (e.button === 1) e.preventDefault()
  })
  canvas.addEventListener('mousemove', e => {
    if (!_get_isDragging()) return
    const dx = e.clientX - _get_lastX(),
      dy = e.clientY - _get_lastY()
    _set_lastX(e.clientX)
    _set_lastY(e.clientY)
    if (_get_dragMode() === 'look') {
      _set_flyYaw(_get_flyYaw() - dx * 0.005)
      _set_flyPitch(Math.max(-1.55, Math.min(1.55, _get_flyPitch() - dy * 0.005)))
    } else if (_get_dragMode() === 'rotate') {
      _set_targetRotY(_get_targetRotY() + dx * 0.01)
      _set_targetRotX(_get_targetRotX() + dy * 0.01)
      _set_targetRotX(Math.max(-Math.PI / 2, Math.min(Math.PI / 2, _get_targetRotX())))
    } else {
      const k = _get_camDist() * 0.0015
      _set_targetPanX(_get_targetPanX() - dx * k)
      _set_targetPanY(_get_targetPanY() + dy * k)
    }
  })
  window.addEventListener('mouseup', () => {
    if (_get_isDragging()) {
      _set_isDragging(false)
      _set_dragMode(null)
      canvas.style.cursor = _get_freeCamMode() ? 'crosshair' : 'grab'
    }
  })
  canvas.addEventListener(
    'wheel',
    e => {
      e.preventDefault()
      if (_get_freeCamMode()) {
        _get__flyForward().set(0, 0, -1).applyEuler(_get_camera().rotation)
        _get_flyPos().addScaledVector(_get__flyForward(), -e.deltaY * 0.01)
        _clampFlyPos()
      } else {
        _set_targetCamDist(Math.max(1.5, Math.min(8, _get_targetCamDist() + e.deltaY * 0.003)))
      }
    },
    { passive: false }
  )
  canvas.addEventListener('dblclick', () => {
    if (_get_freeCamMode()) {
      _resetFreeView()
      return
    }
    _set_autoRotate(!_get_autoRotate())
    _set_targetRotX(0)
    _set_targetRotY(0)
    _set_targetPanX(0)
    _set_targetPanY(0)
  })
  window.addEventListener('keydown', e => {
    if (!_get_freeCamMode()) return
    if (
      e.target &&
      (e.target.tagName === 'INPUT' ||
        e.target.tagName === 'TEXTAREA' ||
        e.target.tagName === 'SELECT' ||
        e.target.isContentEditable)
    )
      return
    if (_get_FLY_KEYS().has(e.code)) {
      _get_flyKeys()[e.code] = true
      e.preventDefault()
    }
  })
  window.addEventListener('keyup', e => {
    delete _get_flyKeys()[e.code]
  })
  window.addEventListener('blur', () => {
    for (const k in _get_flyKeys()) delete _get_flyKeys()[k]
  })
}

export function disposeAllMaterialTextures(m) {
  _disposeTexture(m.map)
  _disposeTexture(m.userData.baseMap)
  m.userData.baseMap = null
  _disposeTexture(m.normalMap)
  _disposeTexture(m.roughnessMap)
  _disposeTexture(m.metalnessMap)
  _disposeTexture(m.emissiveMap)
  if (m.userData.shaderRefs) {
    _disposeTexture(m.userData.shaderRefs.heightMap.value)
    m.userData.shaderRefs.heightMap.value = null
    m.userData.shaderRefs.hasHeightMap.value = 0.0
  }
  _disposeTexture(m.userData.pendingHeightMap)
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

export function disposeMaterial3D() {
  if (_get_animationId()) cancelAnimationFrame(_get_animationId())
  if (_get_skyBakeTimer()) {
    clearTimeout(_get_skyBakeTimer())
    _set_skyBakeTimer(null)
  }
  if (_get_hdrRotateTimer()) {
    clearTimeout(_get_hdrRotateTimer())
    _set_hdrRotateTimer(null)
  }
  if (_get_customModelGroup()) {
    _get_scene().remove(_get_customModelGroup())
    _disposeGroupDeep(_get_customModelGroup())
    _set_customModelGroup(null)
    _markShaderMatsDirty()
  }
  for (const m of [_get_meshLeft(), _get_meshRight()]) {
    if (m) {
      if (m.material) {
        disposeAllMaterialTextures(m.material)
        m.material.dispose()
      }
      if (m.geometry) m.geometry.dispose()
    }
  }
  if (_get_groundMesh()) {
    _get_groundMesh().geometry.dispose()
    _get_groundMesh().material.dispose()
  }
  if (_get_gridHelper()) {
    _get_gridHelper().geometry.dispose()
    _get_gridHelper().material.dispose()
  }
  if (_get_envTexture()) _get_envTexture().dispose()
  if (_get_pmremTexture()) _get_pmremTexture().dispose()
  if (_get_hdrTextureOriginal()) _get_hdrTextureOriginal().dispose()
  if (_get_hdrTextureRotated()) _get_hdrTextureRotated().dispose()
  if (_get_skyEnvTexture()) _get_skyEnvTexture().dispose()
  if (_get_skyMesh()) {
    _get_skyMesh().geometry.dispose()
    _get_skyMesh().material.dispose()
    _set_skyMesh(null)
  }
  if (_get_pmrem()) _get_pmrem().dispose()
  if (_get_renderer()) _get_renderer().dispose()
  _set_initialized(false)
}
