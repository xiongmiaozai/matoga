/**
 * matoga - node canvas state
 * Copyright (c) 2026 芝世 (xiongmiaozai). MIT
 *
 * The single mutable store for the node graph editor. Kept in its own module
 * so every other canvas module can share the same instance without importing
 * the editor itself.
 *
 * Shape (do not reassign `state` - mutate its fields):
 *   nodes      Map<id, {id, type, x, y, props, el}>
 *   edges      Map<id, {id, from:{node,port}, to:{node,port}}>
 *   selected   Set<nodeId>
 *   selectedEdge  id | null
 *   viewport   {x, y, zoom}
 *   dragging   {kind:'node'|'pan'|'edge'|'box', ...} | null
 */

export const state = {
  nodes: new Map(),
  edges: new Map(),
  selected: new Set(),
  selectedEdge: null,
  viewport: { x: 0, y: 0, zoom: 1 },
  dragging: null,
}
