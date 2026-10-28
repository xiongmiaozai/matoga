/**
 * matoga - 节点关系窗口：forest
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 从 node-rel.js 按职责搬出，逻辑未改。
 */
import { S } from '././state.js'

/* ── 树构建 ─────────────────────────────── */
export function buildForest(graph, dir){
  const { nodes, edges, defs } = graph
  const nodeById = new Map(nodes.map(n => [n.id, n]))
  const order = new Map(nodes.map((n, i) => [n.id, i]))
  const fallbackDef = { title: '?', group: '', color: '#9a9a9a', inputs: [], outputs: [] }

  // 邻接表：父 -> 子（附带挂载端口信息）
  const children = new Map()
  const asChild = new Map()
  nodes.forEach(n => { children.set(n.id, []); asChild.set(n.id, 0) })
  edges.forEach(e => {
    const p = dir === 'down' ? e.from.node : e.to.node
    const c = dir === 'down' ? e.to.node : e.from.node
    if (!nodeById.has(p) || !nodeById.has(c) || p === c) return
    children.get(p).push({ childId: c, inPort: e.to.port, outPort: e.from.port })
    asChild.set(c, (asChild.get(c) || 0) + 1)
  })

  const expanded = new Set()
  function buildNode(id, depth, inPort, outPort){
    const raw = nodeById.get(id)
    const def = defs[raw.type] || fallbackDef
    const kids = (children.get(id) || []).slice()
      .sort((a, b) => (order.get(a.childId) || 0) - (order.get(b.childId) || 0))
    const ref = expanded.has(id)
    expanded.add(id)
    const childNodes = []
    if (!ref && !S.collapsed.has(id)){
      kids.forEach(k => childNodes.push(buildNode(k.childId, depth + 1, k.inPort, k.outPort)))
    }
    return {
      id, depth, ref,
      title: raw.title || def.title,
      type: raw.type, def,
      inPort, outPort,
      children: childNodes,
      totalKids: kids.length,
      descendantCount: null,
    }
  }

  // 根 = 不作为子出现的节点（down：入度 0 源节点；up：出度 0 输出节点）
  const roots = nodes.filter(n => asChild.get(n.id) === 0).map(n => n.id)
  const forest = []
  roots.forEach(id => forest.push(buildNode(id, 0, null, null)))
  // 兜底：未被任何树覆盖的节点（成环 / 无法从根到达）单独成根
  nodes.forEach(n => {
    if (!expanded.has(n.id)) forest.push(buildNode(n.id, 0, null, null))
  })

  // 统计隐藏后代数（用于折叠徽章）
  function countDesc(tn){
    if (tn.descendantCount !== null) return tn.descendantCount
    let n = 0
    tn.children.forEach(c => { n += 1 + countDesc(c) })
    tn.descendantCount = n
    return n
  }
  forest.forEach(countDesc)

  let maxDepth = 0
  const walk = (tn) => { maxDepth = Math.max(maxDepth, tn.depth); tn.children.forEach(walk) }
  forest.forEach(walk)

  return { forest, maxDepth, expandedCount: expanded.size }
}


export function maxDepthOf(tn){
  if (!tn.children.length) return tn.depth
  return Math.max(...tn.children.map(maxDepthOf))
}
