/**
 * matoga - 材质 3D 视口：loading
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 从 material3d.js 原样搬出，逻辑未改。
 */
import { S, FLY_KEYS, FLY_SPEED, FLY_BOOST } from './state.js'

export function _loadingEls() {
  if (S.container) {
    const el = S.container.querySelector('.m3d-loading')
    return el ? [el] : []
  }
  return document.querySelectorAll('.m3d-loading')
}

export function showLoading(text) {
  _loadingEls().forEach(el => {
    const t = el.querySelector('.m3d-loading-text')
    if (t && text) t.textContent = text
    el.classList.add('show')
  })
}
export function hideLoading() { _loadingEls().forEach(el => el.classList.remove('show')) }
export function setLoadingProgress(pct) {
  _loadingEls().forEach(el => {
    const f = el.querySelector('.m3d-loading-fill')
    if (f) f.style.width = Math.round(pct * 100) + '%'
  })
}




