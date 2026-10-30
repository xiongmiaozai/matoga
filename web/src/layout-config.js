/**
 * matoga - 布局配置纯函数（无 DOM / Golden-Layout 实例依赖，可单测）
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 */

function componentKey(componentType) {
  if (componentType === undefined || componentType === null) return null
  if (typeof componentType === 'string') return componentType
  if (typeof componentType === 'object' && typeof componentType.id === 'string') return componentType.id
  return String(componentType)
}

function walk(node, seen, out) {
  if (!node || typeof node !== 'object') return null
  if (node.type === 'component') {
    const key = componentKey(node.componentType)
    if (key === null) return node
    if (seen.has(key)) { out.duplicates++; return null }
    seen.add(key)
    return node
  }
  if (Array.isArray(node.content)) {
    const kept = node.content.map((c) => walk(c, seen, out)).filter(Boolean)
    if (!kept.length) return null
    return { ...node, content: kept }
  }
  return node
}

function dedupeComponents(node) {
  return walk(node, new Set(), { duplicates: 0 })
}

function hasDuplicateComponents(node) {
  const seen = new Set()
  let found = false
  ;(function visit(n) {
    if (!n || typeof n !== 'object' || found) return
    if (n.type === 'component') {
      const key = componentKey(n.componentType)
      if (key !== null) {
        if (seen.has(key)) { found = true; return }
        seen.add(key)
      }
    }
    if (Array.isArray(n.content)) for (const c of n.content) visit(c)
  })(node)
  return found
}

function toIdSet(allowedIds) {
  if (allowedIds instanceof Set) return allowedIds
  if (Array.isArray(allowedIds)) return new Set(allowedIds)
  return new Set()
}

function sanitizeWalk(node, allowed, seen) {
  if (!node || typeof node !== 'object') return null
  if (node.type === 'component') {
    const key = componentKey(node.componentType)
    if (key === null || !allowed.has(key) || seen.has(key)) return null
    seen.add(key)
    return node
  }
  if (node.type === 'row' || node.type === 'column' || node.type === 'stack') {
    const content = Array.isArray(node.content) ? node.content : []
    const kept = content.map((c) => sanitizeWalk(c, allowed, seen)).filter(Boolean)
    if (!kept.length) return null
    return { ...node, content: kept }
  }
  return null
}

function sanitizeLayoutConfig(node, allowedIds) {
  return sanitizeWalk(node, toIdSet(allowedIds), new Set())
}

const LAYOUT_VERSION = 1
const PANEL_ID_ALIASES = { leftSidebar: 'folderCard' }

function migrateComponentIds(node) {
  if (!node || typeof node !== 'object') return node
  if (node.type === 'component') {
    const key = componentKey(node.componentType)
    if (key && Object.prototype.hasOwnProperty.call(PANEL_ID_ALIASES, key)) {
      return { ...node, componentType: PANEL_ID_ALIASES[key] }
    }
    return node
  }
  if (Array.isArray(node.content)) {
    return { ...node, content: node.content.map(migrateComponentIds) }
  }
  return node
}

function migrateLayoutConfig(cfg) {
  if (!cfg || typeof cfg !== 'object') return cfg
  const root = cfg.root || cfg
  if (!root || typeof root !== 'object') return cfg
  const migrated = migrateComponentIds(root)
  const out = cfg.root ? { ...cfg, root: migrated } : { root: migrated }
  out.__v = LAYOUT_VERSION
  return out
}

export { dedupeComponents, hasDuplicateComponents, sanitizeLayoutConfig, migrateLayoutConfig, LAYOUT_VERSION }