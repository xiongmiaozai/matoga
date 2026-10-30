/**
 * matoga - 节点关系窗口：interact
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 从 node-rel.js 按职责搬出，逻辑未改。
 */

import { cssEsc } from './consts.js'

import { getGraphInfo, focusNodeInCanvas } from '../node-canvas.js'
import { M, viewEl } from './consts.js'
import { S } from '././state.js'
import { layoutForest } from './layout.js'
import { render } from './render.js'

export function applyView(world){
  world.setAttribute('transform', `translate(${S.view.x},${S.view.y}) scale(${S.view.zoom})`)
}


/* ── 视图操作 ────────────────────────────── */
export function fitView(){
  const svg = viewEl() && viewEl().querySelector('.nr-svg')
  if (!svg || !S.tree || !S.tree.forest.length) return
  const box = viewEl().querySelector('.nr-scroll')
  if (!box) return
  const { width, height } = layoutForest(S.tree.forest)
  const w = width + M.pad * 2, h = height + M.pad * 2
  const cw = box.clientWidth || 300, ch = box.clientHeight || 200
  const zoom = Math.min(Math.min(cw / w, ch / h), 1.2)
  S.view.zoom = Math.max(zoom, 0.15)
  S.view.x = (cw - w * S.view.zoom) / 2 + M.pad * S.view.zoom
  S.view.y = (ch - h * S.view.zoom) / 2 + M.pad * S.view.zoom
  const world = svg.querySelector('.nr-world')
  if (world) applyView(world)
}

export function zoomAt(svg, factor, cx, cy){
  const r = svg.getBoundingClientRect()
  const px = cx - r.left, py = cy - r.top
  const { x, y, zoom } = S.view
  const wx = (px - x) / zoom, wy = (py - y) / zoom
  const nz = Math.min(2.5, Math.max(0.15, zoom * factor))
  S.view.zoom = nz
  S.view.x = px - wx * nz
  S.view.y = py - wy * nz
  const world = svg.querySelector('.nr-world')
  if (world) applyView(world)
}

/* ── 交互 ───────────────────────────────── */
export function onCanvasClick(e){
  const toggle = e.target.closest('[data-act="toggle"]')
  if (toggle){
    e.stopPropagation()
    const id = toggle.getAttribute('data-id')
    if (S.collapsed.has(id)) S.collapsed.delete(id)
    else S.collapsed.add(id)
    render()
    return
  }
  const node = e.target.closest('[data-act="node"]')
  if (node){
    const id = node.getAttribute('data-id')
    S.activeId = id
    focusNodeInCanvas(id)
    render()
  }
}

export function bindInteractions(){
  const box = viewEl()
  if (!box) return

  box.addEventListener('click', onCanvasClick)

  // hover：高亮同 id 的所有副本（引用节点联动提示）
  box.addEventListener('pointerover', (e) => {
    const node = e.target.closest('[data-act="node"]')
    if (!node) return
    const id = node.getAttribute('data-id')
    box.querySelectorAll('.nr-node.hl').forEach(x => x.classList.remove('hl'))
    box.querySelectorAll(`.nr-node[data-id="${cssEsc(id)}"]`).forEach(x => x.classList.add('hl'))
  })
  box.addEventListener('pointerout', (e) => {
    if (e.target.closest('[data-act="node"]')) {
      box.querySelectorAll('.nr-node.hl').forEach(x => x.classList.remove('hl'))
    }
  })

  // 滚轮缩放（以指针为锚）
  box.addEventListener('wheel', (e) => {
    const svg = e.target.closest('.nr-svg')
    if (!svg) return
    e.preventDefault()
    zoomAt(svg, e.deltaY < 0 ? 1.12 : 1 / 1.12, e.clientX, e.clientY)
  }, { passive: false })

  // 空白拖拽平移
  let pan = null
  box.addEventListener('pointerdown', (e) => {
    const svg = e.target.closest('.nr-svg')
    if (!svg) return
    if (e.target.closest('[data-act="node"],[data-act="toggle"]')) return
    pan = { sx: e.clientX, sy: e.clientY, vx: S.view.x, vy: S.view.y, svg }
    svg.classList.add('grabbing')
    svg.setPointerCapture && svg.setPointerCapture(e.pointerId)
  })
  box.addEventListener('pointermove', (e) => {
    if (!pan) return
    S.view.x = pan.vx + (e.clientX - pan.sx)
    S.view.y = pan.vy + (e.clientY - pan.sy)
    applyView(pan.svg.querySelector('.nr-world'))
  })
  const endPan = () => {
    if (pan && pan.svg) pan.svg.classList.remove('grabbing')
    pan = null
  }
  box.addEventListener('pointerup', endPan)
  box.addEventListener('pointercancel', endPan)
}

