/**
 * matoga - MC 模型：NodeCanvasClipboard
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 从 mc-model-viewer.js 按领域搬出（正文逐字未改）。
 * 职责：剪贴板（复制/剪切/粘贴）
 */

import { uid } from '../node-canvas/math.js'

/* 主文件函数（注入） */
let _toast = (...a) => undefined
let _pushHistory = (...a) => undefined
let _deleteNode = (...a) => undefined
let _renderNode = (...a) => undefined
let _renderEdges = (...a) => undefined
let _updateStats = (...a) => undefined
let _evaluate = (...a) => undefined
let _refreshSelection = (...a) => undefined

/* 模块状态：只读用 getter；可写用 get/set 成对（§2.2） */
let _get_state = () => undefined
let _get_$ = () => undefined
let _get__clipboard = () => undefined
let _set__clipboard = () => {}

export function setHooks(h) {
  if (h.toast) _toast = h.toast
  if (h.pushHistory) _pushHistory = h.pushHistory
  if (h.deleteNode) _deleteNode = h.deleteNode
  if (h.renderNode) _renderNode = h.renderNode
  if (h.renderEdges) _renderEdges = h.renderEdges
  if (h.updateStats) _updateStats = h.updateStats
  if (h.evaluate) _evaluate = h.evaluate
  if (h.refreshSelection) _refreshSelection = h.refreshSelection
  if (h.get_state) _get_state = h.get_state
  if (h.get_$) _get_$ = h.get_$
  if (h.get__clipboard) _get__clipboard = h.get__clipboard
  if (h.set__clipboard) _set__clipboard = h.set__clipboard
}

export function cutSelection() {
  if (_get_state().selected.size === 0) {
    _toast('未选中节点')
    return
  }
  copySelection()
  _pushHistory()
  _get_state().selected.forEach(id => _deleteNode(id))
}

export function copySelection() {
  if (_get_state().selected.size === 0) {
    _toast('未选中节点')
    return
  }
  const nodes = [],
    edges = []
  const idMap = new Map()
  _get_state().selected.forEach(id => {
    const n = _get_state().nodes.get(id)
    if (!n) return
    const newId = uid()
    idMap.set(id, newId)
    nodes.push({
      id: newId,
      type: n.type,
      x: n.x,
      y: n.y,
      props: JSON.parse(JSON.stringify(n.props)),
      title: n.title || null,
      collapsed: !!n.collapsed
    })
  })
  _get_state().edges.forEach(e => {
    if (idMap.has(e.from.node) && idMap.has(e.to.node)) {
      edges.push({ from: idMap.get(e.from.node), fp: e.from.port, to: idMap.get(e.to.node), tp: e.to.port })
    }
  })
  _set__clipboard({ nodes, edges })
  _toast(`已复制 ${nodes.length} 个节点`)
}

export function pasteClipboard(wx, wy) {
  if (!_get__clipboard()) {
    _toast('剪贴板为空')
    return
  }
  _pushHistory()
  let minX = Infinity,
    minY = Infinity
  _get__clipboard().nodes.forEach(nd => {
    minX = Math.min(minX, nd.x)
    minY = Math.min(minY, nd.y)
  })
  const dx = wx != null && wy != null ? wx - minX : 30
  const dy = wx != null && wy != null ? wy - minY : 30
  const idMap = new Map()
  const newNodes = []
  _get__clipboard().nodes.forEach(nd => {
    const id = uid()
    idMap.set(nd.id, id)
    const node = {
      id,
      type: nd.type,
      x: nd.x + dx,
      y: nd.y + dy,
      props: JSON.parse(JSON.stringify(nd.props)),
      title: nd.title || null,
      collapsed: !!nd.collapsed,
      el: null
    }
    _get_state().nodes.set(id, node)
    _renderNode(node)
    newNodes.push(id)
  })
  _get__clipboard().edges.forEach(ed => {
    const fromId = idMap.get(ed.from),
      toId = idMap.get(ed.to)
    if (fromId && toId) {
      const eid = 'e' + Math.random().toString(36).slice(2, 9)
      _get_state().edges.set(eid, { id: eid, from: { node: fromId, port: ed.fp }, to: { node: toId, port: ed.tp } })
    }
  })
  _renderEdges()
  _updateStats()
  _evaluate()
  _get_state().selected.clear()
  newNodes.forEach(id => _get_state().selected.add(id))
  _refreshSelection()
  _toast(`已粘贴 ${newNodes.length} 个节点`)
}
