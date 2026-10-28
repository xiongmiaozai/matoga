/**
 * matoga - 节点关系窗口：svg
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 从 node-rel.js 按职责搬出，逻辑未改。
 */
import { t, onLocaleChange } from '../i18n.js'
import { M, el, trunc } from './consts.js'
import { S } from '././state.js'
import { applyView } from './interact.js'

export function renderNodeSvg(tn){
  const g = el('g', {
    class: 'nr-node' + (tn.ref ? ' ref' : '') + (S.activeId === tn.id ? ' active' : ''),
    'data-id': tn.id,
    'data-act': 'node',
    transform: `translate(${tn.x},${tn.y - M.nodeH / 2})`,
  })
  const tip = el('title')
  tip.textContent = tn.outPort && tn.inPort
    ? `${tn.def.title} · ${tn.outPort} → ${tn.inPort}`
    : `${tn.def.title}${tn.def.group ? ' · ' + tn.def.group : ''}`
  g.appendChild(tip)

  g.appendChild(el('rect', { class: 'nr-box', width: M.nodeW, height: M.nodeH, rx: 6 }))
  g.appendChild(el('rect', { class: 'nr-accent', x: 0, y: 0, width: 4, height: M.nodeH, fill: tn.def.color }))

  const title = el('text', { class: 'nr-title', x: 12, y: 17 })
  title.textContent = trunc(tn.title, 15)
  g.appendChild(title)

  const sub = el('text', { class: 'nr-sub', x: 12, y: 31 })
  if (tn.inPort) sub.textContent = S.dir === 'down' ? ('→ ' + tn.inPort) : ((tn.outPort || '') + ' →')
  else sub.textContent = tn.def.group || tn.type
  g.appendChild(sub)

  const badge = el('text', { class: 'nr-type-badge', x: M.nodeW - 8, y: 17, 'text-anchor': 'end' })
  badge.textContent = trunc(tn.type, 8)
  g.appendChild(badge)

  if (tn.ref){
    const rb = el('text', { class: 'nr-ref-badge', x: M.nodeW - 8, y: 31, 'text-anchor': 'end' })
    rb.textContent = '↻ ' + t('noderel.ref')
    g.appendChild(rb)
  }

  // 折叠切换按钮（有子级且非引用节点）
  if (tn.totalKids > 0 && !tn.ref){
    const tgl = el('g', {
      class: 'nr-toggle' + (S.collapsed.has(tn.id) ? ' closed' : ''),
      'data-id': tn.id,
      'data-act': 'toggle',
      transform: `translate(${M.nodeW + 8},${M.nodeH / 2 - 8})`,
    })
    tgl.appendChild(el('rect', { class: 'nr-toggle-box', width: 16, height: 16, rx: 3 }))
    const sign = el('text', { class: 'nr-toggle-sign', x: 8, y: 12, 'text-anchor': 'middle' })
    sign.textContent = S.collapsed.has(tn.id) ? '+' : '−'
    tgl.appendChild(sign)
    const tTip = el('title')
    tTip.textContent = t(S.collapsed.has(tn.id) ? 'noderel.expandOne' : 'noderel.collapseOne')
    tgl.appendChild(tTip)
    g.appendChild(tgl)
  }

  // 折叠时的隐藏后代计数
  if (S.collapsed.has(tn.id) && tn.descendantCount > 0){
    const cb = el('text', { class: 'nr-fold-count', x: M.nodeW + 34, y: 24 })
    cb.textContent = '+' + tn.descendantCount
    g.appendChild(cb)
  }
  return g
}

export function renderEdgeSvg(parent, child){
  const x1 = parent.x + M.nodeW + (parent.totalKids > 0 && !parent.ref ? 26 : 4)
  const y1 = parent.y
  const x2 = child.x
  const y2 = child.y
  const dx = Math.max(24, (x2 - x1) * 0.5)
  const p = el('path', {
    class: 'nr-edge' + (child.ref ? ' ref' : ''),
    d: `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`,
    stroke: child.def.color,
    'data-child': child.id,
  })
  const tip = el('title')
  tip.textContent = `${parent.title} ${parent.outPort ? parent.outPort + ' → ' : ''}${child.inPort || ''} ${child.title}`.replace(/\s+/g, ' ').trim()
  p.appendChild(tip)
  return p
}

export function renderSvg(){
  const frag = document.createDocumentFragment()
  const svg = el('svg', { class: 'nr-svg' })
  const world = el('g', { class: 'nr-world' })

  const { forest } = S.tree
  const edges = []
  const nodes = []
  const walk = (tn) => {
    nodes.push(tn)
    tn.children.forEach(c => { edges.push([tn, c]); walk(c) })
  }
  forest.forEach(walk)
  edges.forEach(([p, c]) => world.appendChild(renderEdgeSvg(p, c)))
  nodes.forEach(tn => world.appendChild(renderNodeSvg(tn)))

  applyView(world)
  svg.appendChild(world)
  frag.appendChild(svg)
  return frag
}

