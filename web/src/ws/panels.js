/**
 * matoga - 工作区：面板注册与布局根
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 从 workspace.js 按职责搬出，逻辑未改。
 */
import { $ } from '../core.js'
import { S } from './state.js'
import { createPanelClone } from './clone.js'

export function extractPanels() {
  const sidebarInner = document.querySelector('.sidebar-left .sidebar-inner')
  const cards = sidebarInner ? sidebarInner.querySelectorAll('.panel-card') : []
  S.panelEls = {
    folderCard: $('folderCard'),
    compareSettings: cards[0],
    actions: cards[1],
    compare: document.querySelector('.center'),
    modelCategory: $('modelCategoryPanelWrap'),
    chart: $('chartPanelWrap'),
    preview: $('previewPanelWrap'),
    material3d: $('material3dPanelWrap'),
    detail: $('detailPanelWrap'),
    nodeCanvas: $('nodeCanvasPanelWrap'),
    nodeLibrary: $('nodeLibraryPanelWrap'),
    assetLibrary: $('assetLibraryPanelWrap'),

    uvEditor: $('uvEditorPanelWrap'),

  }
  S.panelHomes = Object.values(S.panelEls)
    .filter(Boolean)
    .map((el) => ({ el, parent: el.parentElement, next: el.nextElementSibling }))
}

export function restorePanelsToClassic() {
  for (const { el, parent, next } of S.panelHomes) {
    try {
      if (!parent || !el.isConnected) continue
      if (!el.parentElement || !el.parentElement.closest('#S.layoutRoot')) continue
      el.classList.remove('gl-panel-content')
      el.style.display = ''
      const anchor = next && next.parentElement === parent ? next : null
      parent.insertBefore(el, anchor)
    } catch {}
  }
}

export function reconcileOrphanPanels() {
  for (const { el, parent, next } of S.panelHomes) {
    try {
      if (el.isConnected || !parent) continue
      el.classList.remove('gl-panel-content')
      el.style.display = ''
      const anchor = next && next.parentElement === parent ? next : null
      parent.insertBefore(el, anchor)
    } catch {}
  }
}

export function createLayoutRoot() {
  const ws = $('workspace')
  if (!ws) throw new Error('workspace not found')
  S.layoutRoot = document.createElement('div')
  S.layoutRoot.id = 'S.layoutRoot'
  S.layoutRoot.className = 'S.layout-root'
  ws.parentNode.insertBefore(S.layoutRoot, ws)

  S.barEl = document.createElement('div')
  S.barEl.className = 'workspace-bar'
  S.layoutRoot.parentNode.insertBefore(S.barEl, S.layoutRoot)
}

export function registerComponents() {
  for (const def of S.panelDefs) {
    S.layout.registerComponentFactoryFunction(def.id, (container) => {
      const original = S.panelEls[def.id]
      if (!original) return
      const inUse = original.isConnected && original.parentElement && original.parentElement.closest('.lm_content')
      if (!inUse) {
        container.element.appendChild(original)
        original.style.display = ''
        original.classList.add('gl-panel-content')
      } else {
        const clone = createPanelClone(original)
        container.element.appendChild(clone)
        clone.style.display = ''
      }
    })
  }
}


export function findComponentItem(item, id) {
  if (!item) return null
  const ct = item.componentType
  if (ct !== undefined && ct !== null && (ct === id || ct.id === id)) return item
  for (const c of item.contentItems || []) {
    const r = findComponentItem(c, id)
    if (r) return r
  }
  return null
}

export function focusPanel(id) {
  if (!S.layout || !S.layout.rootItem) return false
  const target = findComponentItem(S.layout.rootItem, id)
  if (!target) return false
  let child = target
  let p = target.parent
  while (p) {
    if (p.type === 'stack') { try { p.setActiveContentItem(child) } catch {} }
    child = p
    p = p.parent
  }
  return true
}

