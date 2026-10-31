/**
 * matoga - MC 模型：NodeCanvasPersist
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 从 mc-model-viewer.js 按领域搬出（正文逐字未改）。
 * 职责：节点项目持久化（拓扑/Comfy转换/保存加载）
 */

import { NODE_DEFS } from '../node-canvas/node-defs.js'
import { uiPrompt } from '../ui-dialog.js'

/* 主文件函数（注入） */
let _defaultProps = (...a) => undefined
let _toast = (...a) => undefined
let _saveNodeProject = (...a) => undefined
let __restore = (...a) => undefined
let _pushHistory = (...a) => undefined
let __resetSavedState = (...a) => undefined

/* 模块状态：只读用 getter；可写用 get/set 成对（§2.2） */
let _get_state = () => undefined
let _get_GRAPH_VERSION = () => undefined
let _get__history = () => undefined
let _get_$ = () => undefined
let _get__currentProject = () => undefined
let _set__currentProject = () => {}
let _get__suspendAutoSave = () => undefined
let _set__suspendAutoSave = () => {}

export function setHooks(h) {
  if (h.defaultProps) _defaultProps = h.defaultProps
  if (h.toast) _toast = h.toast
  if (h.saveNodeProject) _saveNodeProject = h.saveNodeProject
  if (h._restore) __restore = h._restore
  if (h.pushHistory) _pushHistory = h.pushHistory
  if (h._resetSavedState) __resetSavedState = h._resetSavedState
  if (h.get_state) _get_state = h.get_state
  if (h.get_GRAPH_VERSION) _get_GRAPH_VERSION = h.get_GRAPH_VERSION
  if (h.get__history) _get__history = h.get__history
  if (h.get_$) _get_$ = h.get_$
  if (h.get__currentProject) _get__currentProject = h.get__currentProject
  if (h.set__currentProject) _set__currentProject = h.set__currentProject
  if (h.get__suspendAutoSave) _get__suspendAutoSave = h.get__suspendAutoSave
  if (h.set__suspendAutoSave) _set__suspendAutoSave = h.set__suspendAutoSave
}

export function _topoOrder() {
  const ids = [..._get_state().nodes.keys()]
  const indeg = new Map(),
    succ = new Map()
  ids.forEach(id => {
    indeg.set(id, 0)
    succ.set(id, [])
  })
  _get_state().edges.forEach(e => {
    if (_get_state().nodes.has(e.from.node) && _get_state().nodes.has(e.to.node)) {
      indeg.set(e.to.node, indeg.get(e.to.node) + 1)
      succ.get(e.from.node).push(e.to.node)
    }
  })
  const queue = ids.filter(id => indeg.get(id) === 0)
  const order = [],
    seen = new Set()
  while (queue.length) {
    const id = queue.shift()
    if (seen.has(id)) continue
    seen.add(id)
    order.push(id)
    succ.get(id).forEach(t => {
      indeg.set(t, indeg.get(t) - 1)
      if (indeg.get(t) === 0) queue.push(t)
    })
  }
  ids.forEach(id => {
    if (!seen.has(id)) order.push(id)
  })
  return order
}

export function _maxIdNum(map) {
  let max = 0
  map.forEach((_, id) => {
    if (id) max = Math.max(max, parseInt(id.slice(1), 36) || 0)
  })
  return max
}

export function _widgetArrayToProps(type, arr) {
  const keys = Object.keys(_defaultProps(type))
  const p = {}
  arr.forEach((v, i) => {
    if (i < keys.length) p[keys[i]] = v
  })
  return p
}

export function _coerceProps(nd) {
  const w = nd.widgets_values
  if (w && typeof w === 'object' && !Array.isArray(w)) return JSON.parse(JSON.stringify(w))
  if (Array.isArray(w)) return _widgetArrayToProps(nd.type, w)
  if (nd.props && typeof nd.props === 'object') return JSON.parse(JSON.stringify(nd.props))
  return _defaultProps(nd.type)
}

export function _graphToComfy() {
  const order = _topoOrder()
  const orderIdx = new Map()
  order.forEach((id, i) => orderIdx.set(id, i))
  const outLinks = new Map(),
    inLink = new Map()
  _get_state().edges.forEach((e, id) => {
    if (!_get_state().nodes.has(e.from.node) || !_get_state().nodes.has(e.to.node)) return
    const fk = e.from.node + ':' + e.from.port
    if (!outLinks.has(fk)) outLinks.set(fk, [])
    outLinks.get(fk).push(id)
    inLink.set(e.to.node + ':' + e.to.port, id)
  })
  const nodes = []
  _get_state().nodes.forEach(n => {
    const def = NODE_DEFS[n.type] || { inputs: [], outputs: [] }
    const inputs = def.inputs.map(p => ({ name: p.n, type: p.t, link: inLink.get(n.id + ':' + p.n) ?? null }))
    const outputs = def.outputs.map(p => ({ name: p.n, type: p.t, links: outLinks.get(n.id + ':' + p.n) || [] }))
    const size = n.el ? { 0: n.el.offsetWidth, 1: n.el.offsetHeight } : { 0: 220, 1: 80 }
    nodes.push({
      id: n.id,
      type: n.type,
      pos: [n.x, n.y],
      size,
      flags: {},
      order: orderIdx.get(n.id) ?? 0,
      mode: 0,
      inputs,
      outputs,
      properties: { title: n.title || null, collapsed: !!n.collapsed },
      widgets_values: JSON.parse(JSON.stringify(n.props || {}))
    })
  })
  const links = []
  _get_state().edges.forEach((e, id) => {
    if (!_get_state().nodes.has(e.from.node) || !_get_state().nodes.has(e.to.node)) return
    const fDef = NODE_DEFS[_get_state().nodes.get(e.from.node).type]
    const fPort = fDef && fDef.outputs.find(p => p.n === e.from.port)
    links.push([id, e.from.node, e.from.port, e.to.node, e.to.port, fPort ? fPort.t : 'any'])
  })
  return {
    last_node_id: _maxIdNum(_get_state().nodes),
    last_link_id: _maxIdNum(_get_state().edges),
    nodes,
    links,
    groups: [],
    config: {},
    extra: {},
    version: _get_GRAPH_VERSION()
  }
}

export async function saveGraph() {
  if (_get_state().nodes.size === 0) {
    _toast('画布为空')
    return
  }
  let name = _get__currentProject() ? _get__currentProject().name : null
  if (!name) {
    const input = await uiPrompt({ title: '保存到节点项目', label: '项目名称', value: '未命名材质图' })
    if (input === null) return
    name = input.trim()
    if (!name) {
      _toast('项目名不能为空')
      return
    }
  }
  try {
    const data = await _saveNodeProject(name, _get__currentProject() ? _get__currentProject().id : undefined)
    _toast('已保存到节点项目: ' + name + '（' + (data.dir || data.id) + '）')
  } catch (e) {
    _toast('保存失败: ' + e.message)
  }
}

export function _applyComfy(data) {
  const nodes = (data.nodes || [])
    .filter(nd => NODE_DEFS[nd.type])
    .map(nd => {
      const pos = Array.isArray(nd.pos) ? nd.pos : [nd.x ?? 0, nd.y ?? 0]
      const pr = nd.properties || {}
      return {
        id: nd.id,
        type: nd.type,
        x: pos[0],
        y: pos[1],
        props: _coerceProps(nd),
        title: pr.title || null,
        collapsed: !!pr.collapsed
      }
    })
  const nodeIds = new Set(nodes.map(n => n.id))
  const edges = (data.links || [])
    .map(lnk => {
      if (Array.isArray(lnk)) {
        const [id, fn, fp, tn, tp] = lnk
        return { id, from: { node: fn, port: fp }, to: { node: tn, port: tp } }
      }
      return { id: lnk.id, from: lnk.from, to: lnk.to }
    })
    .filter(e => nodeIds.has(e.from.node) && nodeIds.has(e.to.node))
  __restore({ nodes, edges })
}

export function loadGraphJSON(json) {
  try {
    const data = typeof json === 'string' ? JSON.parse(json) : json
    if (!data || !Array.isArray(data.nodes)) throw new Error('格式无效')
    _pushHistory()
    _get__history().suspend = true
    _set__suspendAutoSave(true)
    _set__currentProject(null)
    if (Array.isArray(data.links)) _applyComfy(data)
    else __restore({ nodes: data.nodes, edges: data.edges || [] })
    _get__history().suspend = false
    _set__suspendAutoSave(false)
    __resetSavedState()
    _toast(`已加载 ${data.nodes.length} 个节点`)
  } catch (e) {
    _get__history().suspend = false
    _set__suspendAutoSave(false)
    _toast('加载失败: ' + e.message)
  }
}
