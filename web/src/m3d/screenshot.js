/**
 * matoga - 材质 3D 视口：screenshot
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 从 material3d.js 原样搬出，逻辑未改。
 */
import { S, FLY_KEYS, FLY_SPEED, FLY_BOOST } from './state.js'
import { animate, handleResize, lookAtOrigin, setupControls } from './controls.js'

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
