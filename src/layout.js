/**
 * matoga - 材质贴图对比工具
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 */

import { $ } from './core.js'

const MIN_LEFT = 240, MAX_LEFT = 560
const MIN_RIGHT = 320, MAX_RIGHT = 680
let layoutState = { leftW: 360, rightW: 460, collapsedLeft: false, panels: {} }

function saveLayout() {
  window.api.setConfig({ layout: layoutState })
}

function updateCollapseBtnPos() {
  const btn = $('collapseLeftBtn')
  const sidebar = $('sidebarLeft')
  if (!btn || !sidebar) return
  if (sidebar.classList.contains('collapsed')) {
    btn.style.left = '0px'
  } else {
    btn.style.left = (sidebar.offsetWidth - 11) + 'px'
  }
}

function setupResizer(resizer, side) {
  let startX = 0, startW = 0
  resizer.addEventListener('mousedown', (e) => {
    if (side === 'left' && $('sidebarLeft').classList.contains('collapsed')) return
    e.preventDefault()
    startX = e.clientX
    const el = side === 'left' ? $('sidebarLeft') : $('sidebarRight')
    startW = el.offsetWidth
    resizer.classList.add('dragging')
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    const btn = $('collapseLeftBtn')
    if (side === 'left' && btn) btn.style.transition = 'none'
    const onMove = (ev) => {
      let w
      if (side === 'left') { w = startW + (ev.clientX - startX); w = Math.max(MIN_LEFT, Math.min(MAX_LEFT, w)) }
      else { w = startW - (ev.clientX - startX); w = Math.max(MIN_RIGHT, Math.min(MAX_RIGHT, w)) }
      const el2 = side === 'left' ? $('sidebarLeft') : $('sidebarRight')
      el2.style.width = w + 'px'
      layoutState[side === 'left' ? 'leftW' : 'rightW'] = w
      if (side === 'left') updateCollapseBtnPos()
    }
    const onUp = () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      resizer.classList.remove('dragging')
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      if (side === 'left' && btn) btn.style.transition = ''
      saveLayout()
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  })
}

function setupLeftCollapse() {
  const btn = $('collapseLeftBtn')
  const sidebar = $('sidebarLeft')
  if (!btn || !sidebar) return
  btn.addEventListener('click', () => {
    sidebar.classList.toggle('collapsed')
    layoutState.collapsedLeft = sidebar.classList.contains('collapsed')
    btn.textContent = layoutState.collapsedLeft ? '⇥' : '⇤'
    if (layoutState.collapsedLeft) {
      sidebar.style.width = ''
    } else {
      sidebar.style.width = layoutState.leftW + 'px'
    }
    updateCollapseBtnPos()
    saveLayout()
  })
}

function makePanelFloatable(panel) {
  const head = panel.querySelector('.panel-head')
  if (!head) return
  let dragInfo = null
  head.addEventListener('mousedown', (e) => {
    if (!panel.classList.contains('floating')) return
    if (e.target.closest('.panel-tool')) return
    dragInfo = { startX: e.clientX, startY: e.clientY, left: panel.offsetLeft, top: panel.offsetTop }
    document.body.style.userSelect = 'none'
    const onMove = (ev) => {
      if (!dragInfo) return
      panel.style.left = (dragInfo.left + ev.clientX - dragInfo.startX) + 'px'
      panel.style.top = (dragInfo.top + ev.clientY - dragInfo.startY) + 'px'
    }
    const onUp = () => {
      dragInfo = null
      document.body.style.userSelect = ''
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  })
}

function setupPanelActions(panel) {
  const key = panel.dataset.panel
  panel.querySelectorAll('.panel-tool').forEach(btn => {
    btn.addEventListener('click', () => {
      const act = btn.dataset.panelAction
      if (act === 'collapse') {
        panel.classList.toggle('collapsed')
        layoutState.panels[key] = layoutState.panels[key] || {}
        layoutState.panels[key].collapsed = panel.classList.contains('collapsed')
        saveLayout()
      } else if (act === 'float') {
        panel.classList.toggle('floating')
        if (panel.classList.contains('floating')) {
          const r = panel.getBoundingClientRect()
          panel.style.left = Math.max(20, r.left) + 'px'
          panel.style.top = Math.max(20, r.top) + 'px'
        } else {
          panel.style.left = ''
          panel.style.top = ''
          panel.style.width = ''
          panel.style.height = ''
        }
        layoutState.panels[key] = layoutState.panels[key] || {}
        layoutState.panels[key].floating = panel.classList.contains('floating')
        saveLayout()
      }
    })
  })
}

function setupPanelReorder() {
  const container = $('sidebarRight')
  if (!container) return
  container.querySelectorAll('.panel-head').forEach(head => {
    head.addEventListener('dragstart', (e) => {
      const panel = head.closest('.panel')
      if (panel.classList.contains('floating')) { e.preventDefault(); return }
      e.dataTransfer.effectAllowed = 'move'
      e.dataTransfer.setData('text/plain', panel.dataset.panel)
      panel.classList.add('dragging-self')
    })
    head.addEventListener('dragend', () => {
      const panel = head.closest('.panel')
      panel.classList.remove('dragging-self')
    })
    head.draggable = true
  })
  container.addEventListener('dragover', (e) => {
    const panel = e.target.closest('.panel')
    if (!panel || panel.classList.contains('floating')) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
  })
  container.addEventListener('drop', (e) => {
    const panel = e.target.closest('.panel')
    if (!panel) return
    e.preventDefault()
    const srcKey = e.dataTransfer.getData('text/plain')
    if (!srcKey || srcKey === panel.dataset.panel) return
    const src = container.querySelector(`.panel[data-panel="${srcKey}"]`)
    if (!src) return
    const rect = panel.getBoundingClientRect()
    const after = e.clientY > rect.top + rect.height / 2
    if (after && panel.nextSibling) container.insertBefore(src, panel.nextSibling)
    else container.insertBefore(src, panel)
    saveOrder()
  })
}

function saveOrder() {
  const container = $('sidebarRight')
  if (!container) return
  const order = [...container.querySelectorAll('.panel[data-panel]')].map(p => p.dataset.panel)
  layoutState.order = order
  saveLayout()
}

export async function initLayout() {
  const cfg = await window.api.getConfig()
  if (cfg.layout) layoutState = Object.assign(layoutState, cfg.layout)
  if (layoutState.leftW < 360) layoutState.leftW = 360
  if (layoutState.rightW < 460) layoutState.rightW = 460

  const left = $('sidebarLeft'), right = $('sidebarRight')
  if (left) {
    if (layoutState.collapsedLeft) {
      left.classList.add('collapsed')
      const cb = $('collapseLeftBtn'); if (cb) cb.textContent = '⇥'
    } else {
      left.style.width = layoutState.leftW + 'px'
    }
  }
  if (right) right.style.width = layoutState.rightW + 'px'

  document.querySelectorAll('.resizer').forEach(r => setupResizer(r, r.dataset.resize))
  setupLeftCollapse()
  updateCollapseBtnPos()

  document.querySelectorAll('.panel[data-panel]').forEach(panel => {
    setupPanelActions(panel)
    makePanelFloatable(panel)
    const key = panel.dataset.panel
    const ps = layoutState.panels[key]
    if (ps) {
      if (ps.collapsed) panel.classList.add('collapsed')
      if (ps.floating) { panel.classList.add('floating'); panel.style.left = '40px'; panel.style.top = '80px' }
    }
  })
  setupPanelReorder()

  if (layoutState.order) {
    const container = $('sidebarRight')
    if (container) {
      for (const key of layoutState.order) {
        const p = container.querySelector(`.panel[data-panel="${key}"]`)
        if (p) container.appendChild(p)
      }
    }
  }
}