/**
 * matoga - 节点关系窗口：actions
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 从 node-rel.js 按职责搬出，逻辑未改。
 */
import { S } from '././state.js'
import { render } from './render.js'
import { fitView } from './interact.js'
import { buildForest } from './forest.js'
import { layoutForest } from './layout.js'

export function actToggleDir() {
  S.dir = S.dir === 'down' ? 'up' : 'down'
  S.collapsed.clear()
  render()
  fitView()
}
export function actExpandAll() {
  S.collapsed.clear()
  render()
}
export function actCollapseAll() {
  const ids = new Set()
  const walk = tn => {
    if (tn.totalKids > 0 && !tn.ref) ids.add(tn.id)
    tn.children.forEach(walk)
  }
  if (S.tree) S.tree.forest.forEach(walk)
  S.collapsed = ids
  render()
}
export function actFit() {
  fitView()
}

/* ── 初始化 ─────────────────────────────── */
export { buildForest, layoutForest }
