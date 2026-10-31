/**
 * matoga - 节点关系窗口：render
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 从 node-rel.js 按职责搬出，逻辑未改。
 */
import { getGraphInfo, focusNodeInCanvas } from '../node-canvas.js'
import { t, onLocaleChange } from '../i18n.js'
import { viewEl } from './consts.js'
import { S } from '././state.js'
import { buildForest } from './forest.js'
import { layoutForest } from './layout.js'
import { renderSvg } from './svg.js'

/* ── 主渲染 ─────────────────────────────── */
export function render() {
  const box = viewEl()
  if (!box) return
  const graph = getGraphInfo()
  S.tree = buildForest(graph, S.dir)
  layoutForest(S.tree.forest) // 布局赋坐标（x/y）
  S.graphMeta = {
    nodes: graph.nodes.length,
    edges: graph.edges.length,
    depth: S.tree.maxDepth,
    roots: S.tree.forest.length
  }
  box.innerHTML = ''

  if (graph.nodes.length === 0) {
    const empty = document.createElement('div')
    empty.className = 'nr-empty'
    empty.textContent = t('noderel.empty')
    box.appendChild(empty)
    updateStatusBar()
    return
  }

  const wrap = document.createElement('div')
  wrap.className = 'nr-scroll'
  wrap.appendChild(renderSvg())
  box.appendChild(wrap)

  const status = document.createElement('div')
  status.className = 'nr-status'
  status.id = 'nrStatus'
  box.appendChild(status)
  updateStatusBar()
}

export function updateStatusBar() {
  const s = document.getElementById('nrStatus')
  if (!s || !S.graphMeta) return
  const m = S.graphMeta
  s.innerHTML =
    `<span>${t('noderel.statNodes', { n: m.nodes })}</span>` +
    `<span>${t('noderel.statEdges', { n: m.edges })}</span>` +
    `<span>${t('noderel.statDepth', { n: m.depth })}</span>` +
    `<span>${t('noderel.statRoots', { n: m.roots })}</span>` +
    `<span class="nr-dir">${t(S.dir === 'down' ? 'noderel.dirDown' : 'noderel.dirUp')}</span>`
}
