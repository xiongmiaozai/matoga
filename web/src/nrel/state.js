/**
 * matoga - 节点关系窗口：模块状态
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 从 node-rel.js 原样搬出。
 *
 * 这些状态会被多个子模块读写，而 ESM 的导入绑定只读（对导入的 let 赋值会抛
 * "Assignment to constant variable"），因此统一挂在一个状态对象上，读写都走属性访问。
 */
export const S = {
  initialized: false,
  dir: 'down', // 'down' 数据流向下游 | 'up' 构成关系向上游
  collapsed: new Set(), // 已折叠的节点 id
  activeId: null, // 当前选中（联动）节点 id
  tree: null, // 最近一次构建的森林
  graphMeta: null, // 统计信息
  view: { x: 0, y: 0, zoom: 1 },
  refreshTimer: null
}
