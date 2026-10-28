/**
 * matoga - 节点关系窗口：layout
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 从 node-rel.js 按职责搬出，逻辑未改。
 */
import { COL, M, ROW } from './consts.js'
import { maxDepthOf } from './forest.js'
import { S } from '././state.js'

/* ── 布局（水平 tidy tree）──────────────── */
export function layoutForest(forest){
  let y = 0
  forest.forEach((tn, i) => {
    if (i > 0) y += M.rootGap
    y = layoutNode(tn, y)
  })
  const width = Math.max(...forest.map(maxDepthOf), 0) * COL + M.nodeW
  return { width, height: y }
}

export function layoutNode(tn, top){
  const kids = tn.children
  if (!kids.length || S.collapsed.has(tn.id) || tn.ref){
    tn.x = tn.depth * COL
    tn.y = top + ROW / 2
    return top + ROW
  }
  let cur = top
  kids.forEach(c => { cur = layoutNode(c, cur) })
  tn.x = tn.depth * COL
  tn.y = (kids[0].y + kids[kids.length - 1].y) / 2
  return cur
}

