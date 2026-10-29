/**
 * matoga - 材质 3D 视口：lighting
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 从 material3d.js 原样搬出，逻辑未改。
 */

import * as THREE from 'three'

import { S, FLY_KEYS, FLY_SPEED, FLY_BOOST } from './state.js'

export const LIGHT_PRESETS = {
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

export function createEnvTexture(presetKey) {
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

export function cloneLightConfig(config) {
  return {
    ambient: { color: config.ambient.color, intensity: config.ambient.intensity },
    lights: config.lights.map(l => ({ color: l.color, intensity: l.intensity, pos: [l.pos[0], l.pos[1], l.pos[2]] })),
    bg: config.bg
  }
}

export function rebuildLights(config) {
  if (!S.lightGroup) return
  while (S.lightGroup.children.length) S.lightGroup.remove(S.lightGroup.children[0])
  const ambient = new THREE.AmbientLight(config.ambient.color, config.ambient.intensity)
  S.lightGroup.add(ambient)
  for (const l of config.lights) {
    const dir = new THREE.DirectionalLight(l.color, l.intensity)
    dir.position.set(l.pos[0], l.pos[1], l.pos[2])
    dir.castShadow = true
    dir.shadow.mapSize.set(1024, 1024)
    dir.shadow.camera.left = -3; dir.shadow.camera.right = 3
    dir.shadow.camera.top = 3; dir.shadow.camera.bottom = -3
    dir.shadow.camera.near = 0.1; dir.shadow.camera.far = 15
    S.lightGroup.add(dir)
  }
}


export function applyLightPreset(presetKey) {
  if (!S.initialized || !LIGHT_PRESETS[presetKey]) return
  S.currentLightPreset = presetKey
  const preset = LIGHT_PRESETS[presetKey]
  S.customLightConfig = cloneLightConfig(preset)
  rebuildLights(preset)
  if (S.currentEnvMode === 'custom') {
    if (S.envTexture) S.envTexture.dispose()
    S.envTexture = createEnvTexture(presetKey)
    if (S.pmremTexture) S.pmremTexture.dispose()
    S.pmremTexture = S.pmrem.fromEquirectangular(S.envTexture)
    S.scene.environment = S.pmremTexture.texture
    S.scene.background = new THREE.Color(preset.bg)
  }
  if (S.scene) S.scene.environmentIntensity = S.envIntensity; for (const m of [S.meshLeft, S.meshRight]) { if (m) m.material.envMapIntensity = S.envIntensity }
}

export function applyCustomLightConfig(config) {
  if (!S.initialized || !config || !config.ambient || !Array.isArray(config.lights)) return
  S.customLightConfig = cloneLightConfig(config)
  rebuildLights(S.customLightConfig)
  if (S.currentEnvMode === 'custom') {
    S.scene.background = new THREE.Color(S.customLightConfig.bg)
  }
  if (S.scene) S.scene.environmentIntensity = S.envIntensity; for (const m of [S.meshLeft, S.meshRight]) { if (m) m.material.envMapIntensity = S.envIntensity }
}

