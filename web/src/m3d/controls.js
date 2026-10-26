/**
 * matoga - 材质 3D 视口：controls
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 从 material3d.js 原样搬出，逻辑未改。
 */
import { S, FLY_KEYS, FLY_SPEED, FLY_BOOST } from './state.js'

export function setupControls() {
  const canvas = S.renderer.domElement; canvas.style.cursor = 'grab'
  canvas.addEventListener('contextmenu', (e) => e.preventDefault())
  canvas.addEventListener('mousedown', (e) => {
    S.isDragging = true; S.autoRotate = false; S.lastX = e.clientX; S.lastY = e.clientY
    if (S.freeCamMode) S.dragMode = 'look'
    else if (e.button === 0 && !e.shiftKey) S.dragMode = 'rotate'
    else S.dragMode = 'pan'
    canvas.style.cursor = 'grabbing'
    if (e.button === 1) e.preventDefault()
  })
  canvas.addEventListener('mousemove', (e) => {
    if (!S.isDragging) return
    const dx = e.clientX - S.lastX, dy = e.clientY - S.lastY
    S.lastX = e.clientX; S.lastY = e.clientY
    if (S.dragMode === 'look') {
      S.flyYaw -= dx * 0.005
      S.flyPitch = Math.max(-1.55, Math.min(1.55, S.flyPitch - dy * 0.005))
    } else if (S.dragMode === 'rotate') {
      S.targetRotY += dx * 0.01; S.targetRotX += dy * 0.01
      S.targetRotX = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, S.targetRotX))
    } else {
      const k = S.camDist * 0.0015
      S.targetPanX -= dx * k; S.targetPanY += dy * k
    }
  })
  window.addEventListener('mouseup', () => { if (S.isDragging) { S.isDragging = false; S.dragMode = null; canvas.style.cursor = S.freeCamMode ? 'crosshair' : 'grab' } })
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault()
    if (S.freeCamMode) {
      S._flyForward.set(0, 0, -1).applyEuler(S.camera.rotation)
      S.flyPos.addScaledVector(S._flyForward, -e.deltaY * 0.01)
      clampFlyPos()
    } else {
      S.targetCamDist = Math.max(1.5, Math.min(8, S.targetCamDist + e.deltaY * 0.003))
    }
  }, { passive: false })
  canvas.addEventListener('dblclick', () => {
    if (S.freeCamMode) { resetFreeView(); return }
    S.autoRotate = !S.autoRotate; S.targetRotX = 0; S.targetRotY = 0; S.targetPanX = 0; S.targetPanY = 0
  })
  window.addEventListener('keydown', (e) => {
    if (!S.freeCamMode) return
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT' || e.target.isContentEditable)) return
    if (FLY_KEYS.has(e.code)) { S.flyKeys[e.code] = true; e.preventDefault() }
  })
  window.addEventListener('keyup', (e) => { delete S.flyKeys[e.code] })
  window.addEventListener('blur', () => { for (const k in S.flyKeys) delete S.flyKeys[k] })
}

export function clampFlyPos() {
  S.flyPos.x = Math.max(-40, Math.min(40, S.flyPos.x))
  S.flyPos.y = Math.max(-20, Math.min(40, S.flyPos.y))
  S.flyPos.z = Math.max(-40, Math.min(40, S.flyPos.z))
}

export function lookAtOrigin() {
  S._flyForward.set(0, 0, 0).sub(S.flyPos)
  if (S._flyForward.lengthSq() < 1e-8) S._flyForward.set(0, 0, -1)
  S._flyForward.normalize()
  S.flyPitch = Math.asin(Math.max(-1, Math.min(1, S._flyForward.y)))
  S.flyYaw = Math.atan2(-S._flyForward.x, -S._flyForward.z)
}

export function resetFreeView() {
  S.flyPos.set(0, 0.5, 3)
  lookAtOrigin()
}

export function updateFlyMovement(dt) {
  S._flyMove.set(0, 0, 0)
  S._flyForward.set(0, 0, -1).applyEuler(S.camera.rotation)
  S._flyRight.set(1, 0, 0).applyEuler(S.camera.rotation)
  if (S.flyKeys.KeyW || S.flyKeys.ArrowUp) S._flyMove.add(S._flyForward)
  if (S.flyKeys.KeyS || S.flyKeys.ArrowDown) S._flyMove.sub(S._flyForward)
  if (S.flyKeys.KeyD || S.flyKeys.ArrowRight) S._flyMove.add(S._flyRight)
  if (S.flyKeys.KeyA || S.flyKeys.ArrowLeft) S._flyMove.sub(S._flyRight)
  if (S.flyKeys.KeyE) S._flyMove.y += 1
  if (S.flyKeys.KeyQ) S._flyMove.y -= 1
  if (S._flyMove.lengthSq() > 0) {
    const speed = FLY_SPEED * ((S.flyKeys.ShiftLeft || S.flyKeys.ShiftRight) ? FLY_BOOST : 1)
    S._flyMove.normalize().multiplyScalar(speed * dt)
    S.flyPos.add(S._flyMove)
    clampFlyPos()
  }
}

export function handleResize() {
  if (S._resizeRAF) return
  S._resizeRAF = requestAnimationFrame(() => {
    S._resizeRAF = 0
    if (!S.container || !S.renderer || !S.camera) return
    const w = S.container.clientWidth, h = S.container.clientHeight
    if (w > 0 && h > 0) { S.camera.aspect = w / h; S.camera.updateProjectionMatrix(); S.renderer.setSize(w, h) }
  })
}

export function animate() {
  S.animationId = requestAnimationFrame(animate)
  if (!S.container || S.container.clientWidth < 2 || S.container.clientHeight < 2) { S.lastFrameTime = performance.now(); return }
  const now = performance.now()
  const dt = Math.min(0.05, Math.max(0, (now - S.lastFrameTime) / 1000))
  S.lastFrameTime = now

  if (S.freeCamMode) {
    S.camera.rotation.set(S.flyPitch, S.flyYaw, 0)
    updateFlyMovement(dt)
    S.camera.position.copy(S.flyPos)
  } else {
    if (S.autoRotate) S.targetRotY += 0.005
    S.rotX += (S.targetRotX - S.rotX) * 0.1; S.rotY += (S.targetRotY - S.rotY) * 0.1; S.camDist += (S.targetCamDist - S.camDist) * 0.1
    S.camPanX += (S.targetPanX - S.camPanX) * 0.18; S.camPanY += (S.targetPanY - S.camPanY) * 0.18
    S.meshLeft.rotation.x = S.rotX; S.meshLeft.rotation.y = S.rotY
    S.meshRight.rotation.x = S.rotX; S.meshRight.rotation.y = S.rotY
    if (S.customModelGroup) { S.customModelGroup.rotation.x = S.rotX; S.customModelGroup.rotation.y = S.rotY }
    S.camera.position.set(S.camPanX, 0.5 + S.camPanY, S.camDist)
    S.camera.rotation.set(0, 0, 0)
  }

  S.camera.updateMatrixWorld()
  if (S.parallaxShadow > 0.0) {
    let lDir = null
    if (S.skySunLight && S.currentEnvMode === 'sky') lDir = S.skySunLight.position
    else { for (const c of S.lightGroup.children) { if (c.isDirectionalLight) { lDir = c.position; break } } }
    if (lDir) {
      S._lightDirTmp.copy(lDir).normalize().transformDirection(S.camera.matrixWorldInverse)
      for (const m of [S.meshLeft, S.meshRight]) { if (m && m.material && m.material.userData.shaderRefs) m.material.userData.shaderRefs.uHeightLightDir.value.copy(S._lightDirTmp) }
    }
  }
  S.renderer.render(S.scene, S.camera)
}

