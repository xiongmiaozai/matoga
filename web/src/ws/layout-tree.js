/**
 * matoga - 材质贴图对比工具
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 布局配置树的纯函数工具。
 *
 * 从 workspace.js 抽出：这些函数只处理普通 JSON 对象，不依赖 Golden-Layout
 * 实例、不触碰 DOM，因此 Vue + dockview 迁移时可直接复用。
 */

import { DEFAULT_LAYOUT } from './panel-defs.js'

/**
 * 深度遍历布局配置树，对每个节点调用 fn。
 * @param {object} node 布局节点（含 type / content / contentItems）
 * @param {(n: object) => void} fn
 */
export function walkConfig(node, fn) {
  if (!node || typeof node !== 'object') return
  fn(node)
  const children = Array.isArray(node.content) ? node.content : node.contentItems
  if (Array.isArray(children)) for (const c of children) walkConfig(c, fn)
}

/**
 * 收集配置树里出现过的组件类型。
 * @param {object} node
 * @param {Set<string>} [out]
 * @returns {Set<string>}
 */
export function collectComponentTypes(node, out) {
  const set = out instanceof Set ? out : new Set()
  walkConfig(node, (n) => {
    if (n.type === 'component' && n.componentType) set.add(n.componentType)
  })
  return set
}

/**
 * 统计每种组件出现次数（用于「已打开」标记）。
 * @param {object} node
 * @returns {Record<string, number>}
 */
export function countComponentTypes(node) {
  const counts = {}
  walkConfig(node, (n) => {
    if (n.type === 'component' && n.componentType) {
      counts[n.componentType] = (counts[n.componentType] || 0) + 1
    }
  })
  return counts
}

/**
 * 判断布局配置是否「完整」：至少含 2 个不同组件。
 * 少于 2 个视为无效/半成品，不落盘、不激活。
 * @param {object} config
 * @returns {boolean}
 */
export function isConfigComplete(config) {
  if (!config) return false
  const root = config.root || config
  if (!root || typeof root !== 'object') return false
  return collectComponentTypes(root).size >= 2
}

/**
 * 深拷贝默认布局，返回 `{ root }` 形式的完整配置。
 * @returns {{root: object}}
 */
export function getDefaultConfig() {
  return { root: JSON.parse(JSON.stringify(DEFAULT_LAYOUT)) }
}
