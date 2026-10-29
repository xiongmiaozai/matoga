/**
 * matoga - 材质 3D 视口：hdr
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 从 material3d.js 原样搬出，逻辑未改。
 */

import * as THREE from 'three'

import { S, FLY_KEYS, FLY_SPEED, FLY_BOOST } from './state.js'
import { loadEnvTexture, extFromUrl } from '../hdr-env-loader.js'
import { applyHDREnvMode, ensureRotatedTexture, scheduleSkyBake, setEnvMode, updateSkySunPosition } from './sky.js'

export async function loadHDREnv(filePath) {
  if (!S.initialized || !filePath) return
  window.dispatchEvent(new CustomEvent('material3d:hdrLoading', { detail: { url: filePath } }))
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

export function setHdrRotation(val) {
  S.hdrRotation = val
  if (!S.initialized || S.currentEnvMode !== 'hdri') return
  if (S.hdrUsage === 'env' || S.hdrUsage === 'both') {
    S.scene.environmentRotation.set(0, S.hdrRotation * Math.PI / 180, 0)
  }
  if (S.hdrUsage === 'bg' || S.hdrUsage === 'both') {
    if (S.hdrRotateTimer) clearTimeout(S.hdrRotateTimer)
    S.hdrRotateTimer = setTimeout(() => {
      S.hdrRotateTimer = null
      if (S.currentEnvMode === 'hdri' && (S.hdrUsage === 'bg' || S.hdrUsage === 'both')) {
        ensureRotatedTexture()
        S.scene.background = S.hdrTextureRotated || S.hdrTextureOriginal
      }
    }, 80)
  }
}

export function setHdrUsage(mode) { if (!['both', 'env', 'bg'].includes(mode)) return; S.hdrUsage = mode; if (S.initialized && S.currentEnvMode === 'hdri') applyHDREnvMode() }
export function getHdrInfo() { return S.hdrInfo }
