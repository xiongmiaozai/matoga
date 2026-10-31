/**
 * matoga - 面板清单 API
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 运行时扫描 web/src/panels/<id>/manifest.json，返回可用面板清单。
 * 前端 panel-loader 据此动态加载每个面板的 HTML / CSS / JS。
 *
 * 面板层级三字段：
 *   level  (number)      z-index 层级深度，0=常驻 / 10=浮层 / 20=全屏编辑器 / 30=模态
 *   parent (string|null) 父面板 id，建立树状关系（子面板可挂到父面板 host 内）
 *   group  (string|null) 分组名，供面板管理 UI 按组折叠
 * 后端据此计算 zIndex 并构建 tree / groups 一并返回。
 */

const express = require('express')
const fs = require('fs')
const path = require('path')
const { WEB_ROOT } = require('../paths')
const router = express.Router()

const PANELS_DIR = path.join(WEB_ROOT, 'src', 'panels')

// z-index 计算：level 越大越在上层，order 在同层内微调。
// 范围 100~3199，避开面板内部元素的高 z-index（如右键菜单 9999）。
const LEVEL_BASE = 100
const LEVEL_STEP = 100

// 面板清单缓存：运行时面板几乎不变，用 mtime 签名判断是否需要重新扫描。
// 每次请求仅做 readdirSync + 逐 manifest statSync（轻量），内容不变时直接返回缓存，
// 避免每次请求都 readFileSync + JSON.parse 所有 manifest。
let _cache = null // { panels, tree, groups, sig }

function computeSig() {
  let entries = []
  try { entries = fs.readdirSync(PANELS_DIR, { withFileTypes: true }) } catch (e) { return '' }
  const parts = []
  for (const ent of entries) {
    if (!ent.isDirectory()) continue
    const mfPath = path.join(PANELS_DIR, ent.name, 'manifest.json')
    try {
      const st = fs.statSync(mfPath)
      parts.push(`${ent.name}:${st.mtimeMs}`)
    } catch (e) { /* manifest 缺失，跳过 */ }
  }
  return parts.join('|')
}

function computeZIndex(level, order) {
  return LEVEL_BASE + level * LEVEL_STEP + order
}

// 按 parent 构建树：返回顶级节点数组，每个节点含 children 数组。
function buildTree(panels) {
  const byId = new Map(panels.map((p) => [p.id, { ...p, children: [] }]))
  const roots = []
  for (const p of panels) {
    const node = byId.get(p.id)
    if (p.parent && byId.has(p.parent) && p.parent !== p.id) {
      byId.get(p.parent).children.push(node)
    } else {
      roots.push(node)
    }
  }
  return roots
}

// 按 group 聚合：返回 { groupName: [panelId, ...] }，未分组归入 __ungrouped__。
function buildGroups(panels) {
  const groups = new Map()
  for (const p of panels) {
    const g = p.group || '__ungrouped__'
    if (!groups.has(g)) groups.set(g, [])
    groups.get(g).push(p.id)
  }
  return Object.fromEntries(groups)
}

function scanPanels() {
  const panels = []
  let entries = []
  try { entries = fs.readdirSync(PANELS_DIR, { withFileTypes: true }) } catch (e) { /* dir 缺失 → 空清单 */ }

  for (const ent of entries) {
    if (!ent.isDirectory()) continue
    const mfPath = path.join(PANELS_DIR, ent.name, 'manifest.json')
    if (!fs.existsSync(mfPath)) continue
    try {
      const mf = JSON.parse(fs.readFileSync(mfPath, 'utf8'))
      const base = `/src/panels/${ent.name}`
      const order = typeof mf.order === 'number' ? mf.order : 999
      const level = typeof mf.level === 'number' ? mf.level : 0
      panels.push({
        id: mf.id || ent.name,
        title: mf.title || ent.name,
        icon: mf.icon || '',
        htmlUrl: mf.html ? `${base}/${mf.html}` : null,
        jsUrl: mf.js ? `${base}/${mf.js}` : null,
        cssUrl: mf.css ? `${base}/${mf.css}` : null,
        mount: mf.mount || 'body',
        order,
        level,
        parent: (typeof mf.parent === 'string' && mf.parent) || null,
        group: (typeof mf.group === 'string' && mf.group) || null,
        zIndex: computeZIndex(level, order),
        dynamic: !!mf.dynamic,
        deps: Array.isArray(mf.deps) ? mf.deps : [],
      })
    } catch (e) { console.error('[panels] manifest 损坏，已跳过:', mfPath, e.message) }
  }

  panels.sort((a, b) => (a.order - b.order) || String(a.id).localeCompare(b.id))
  return panels
}

function loadPanels() {
  const sig = computeSig()
  if (_cache && _cache.sig === sig) return _cache
  const panels = scanPanels()
  _cache = { panels, tree: buildTree(panels), groups: buildGroups(panels), sig }
  return _cache
}

router.get('/', (req, res) => {
  const { panels, tree, groups } = loadPanels()
  res.json({ ok: true, panels, tree, groups })
})

module.exports = router