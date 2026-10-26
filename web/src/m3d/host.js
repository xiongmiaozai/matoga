/**
 * matoga - 材质 3D 视口：host
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 从 material3d.js 原样搬出，逻辑未改。
 */
import { S, FLY_KEYS, FLY_SPEED, FLY_BOOST } from './state.js'
import { handleResize } from './controls.js'
import { initMaterial3D } from '../material3d.js'

export function isHostVisible(el) {
  if (!el || !el.isConnected) return false
  const r = el.getBoundingClientRect()
  return r.width > 1 && r.height > 1
}

export function findVisibleHost() {
  for (const h of S.hosts) { if (isHostVisible(h)) return h }
  return null
}

export function activeHost() {
  return (S.renderer && S.renderer.domElement.parentElement) || null
}

export function refreshHostHints() {
  const active = S.initialized ? activeHost() : null
  for (const h of S.hosts) {
    h.classList.toggle('m3d-host-active', h === active)
    const hint = h.querySelector('.m3d-host-empty')
    if (hint) hint.style.display = (S.initialized && h !== active) ? '' : 'none'
  }
}

export function moveViewportWidgets(target) {
  document.querySelectorAll('.m3d-hud-bar, .m3d-params-overlay').forEach(w => {
    if (w.parentElement !== target) target.appendChild(w)
  })
}

export function setContainer(el) {
  if (!el || el === S.container) { refreshHostHints(); return }
  S.container = el
  if (S.renderer) { el.appendChild(S.renderer.domElement); moveViewportWidgets(el); handleResize() }
  refreshHostHints()
}

export function activateMaterial3DHost(el) {
  if (!el || !S.hosts.has(el)) return
  if (!S.initialized) { initMaterial3D(el); return }
  setContainer(el)
}

export function reevaluateActiveHost() {
  if (!S.initialized) return
  const active = activeHost()
  if (active && isHostVisible(active)) return
  const visible = findVisibleHost()
  if (visible) setContainer(visible)
}

export function ensureHostObserver() {
  if (S.hostObserver) return S.hostObserver
  S.hostObserver = new IntersectionObserver((entries) => {
    if (!S.initialized) return
    for (const entry of entries) {
      if (entry.isIntersecting && isHostVisible(entry.target)) setContainer(entry.target)
    }
    reevaluateActiveHost()
  })
  return S.hostObserver
}

if (typeof window !== 'undefined') {
  window.addEventListener('resize', () => {
    if (S._hostReevalRAF) return
    S._hostReevalRAF = requestAnimationFrame(() => {
      S._hostReevalRAF = 0
      reevaluateActiveHost()
    })
  })
}

export function registerMaterial3DHost(el) {
  if (!el || S.hosts.has(el)) return
  S.hosts.add(el)
  ensureHostObserver().observe(el)
  if (S.containerResizeObserver) S.containerResizeObserver.observe(el)
  el.addEventListener('pointerdown', () => { if (S.initialized) setContainer(el) }, true)
  if (S.initialized) {
    const active = activeHost()
    if ((!active || !isHostVisible(active)) && isHostVisible(el)) setContainer(el)
    else refreshHostHints()
  } else { refreshHostHints() }
}

