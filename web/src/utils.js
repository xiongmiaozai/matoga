/**
 * matoga - 材质贴图对比工具
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 */

import { $, IMG_EXTS, TEX_SUFFIXES, ROLES, ignoreChk, ignoreInput } from './core.js'
import { t } from './i18n.js'

export function formatSize(bytes) {
  if (!bytes) return '—'
  const units = ['B', 'KB', 'MB', 'GB']
  let i = 0, n = bytes
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++ }
  return n.toFixed(n < 10 ? 1 : 0) + ' ' + units[i]
}

export function formatDate(ms) {
  if (!ms) return '—'
  const d = new Date(ms)
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}


export function isImageFile(name) {
  const dot = name.lastIndexOf('.')
  if (dot < 0) return false
  return IMG_EXTS.has(name.slice(dot + 1).toLowerCase())
}

export function fileUrl(p) {
  return '/api/file/raw?path=' + encodeURIComponent(p)
}

export function apiUrl(p) {
  return (typeof window !== 'undefined' && window.matogaCore && window.matogaCore.url) ? window.matogaCore.url(p) : p
}

/* 资产库贴图跨面板拖拽：自定义 MIME（JSON { name, url, path }），供 UV 编辑器等接收方直接使用 */
export const TEX_DRAG_MIME = 'text/matoga-tex'

export function setTexDragData(dt, tex) {
  if (!dt || !tex || typeof tex.url !== 'string' || !tex.url) return false
  try {
    dt.setData(TEX_DRAG_MIME, JSON.stringify({ name: tex.name || '', url: tex.url, path: tex.path || null }))
    return true
  } catch { return false }
}

export function getTexDragData(dt) {
  if (!dt) return null
  try {
    const raw = dt.getData(TEX_DRAG_MIME)
    if (!raw) return null
    const tex = JSON.parse(raw)
    return (tex && typeof tex.url === 'string' && tex.url) ? tex : null
  } catch { return null }
}

export function escAttr(s) {
  return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
}

export function relPath(base, full) {
  const b = base.replace(/\\/g, '/').replace(/\/+$/, '')
  const f = full.replace(/\\/g, '/')
  if (f.startsWith(b + '/')) return f.slice(b.length + 1)
  if (f.startsWith(b)) return f.slice(b.length)
  return f
}

export function joinPath(base, rel) {
  const b = base.replace(/\\/g, '/').replace(/\/+$/, '')
  const r = rel.replace(/\\/g, '/').replace(/^\/+/, '')
  return b + '/' + r
}

export function openPreview(src, name) {
  $('previewImg').src = src
  $('previewCaption').textContent = name || ''
  $('previewModal').classList.add('show')
}

export function closePreview() {
  $('previewModal').classList.remove('show')
  $('previewImg').src = ''
}

export function parseTexGroup(name) {
  if (!isImageFile(name)) return { groupKey: name, role: 'file' }
  const dot = name.lastIndexOf('.')
  const base = name.slice(0, dot)
  for (const [suf, role] of TEX_SUFFIXES) {
    if (base.endsWith(suf)) return { groupKey: base.slice(0, -suf.length), role }
  }
  return { groupKey: base, role: 'main' }
}

export function buildGroups(entries) {
  const groups = new Map()
  for (const e of entries) {
    let key, role
    if (e.isDirectory) { key = e.name; role = 'dir' }
    else { const p = parseTexGroup(e.name); key = p.groupKey; role = p.role }
    if (!groups.has(key)) groups.set(key, {})
    groups.get(key)[role] = e
  }
  return groups
}

export function groupRoles(g) { return ROLES.filter(r => g && g[r]) }
export function hasAny(g) { return !!(g && (g.main || g.normal || g.specular || g.file || g.dir)) }

export function leftRoles(g) { return g._lr || (g._lr = groupRoles(g.left)) }
export function rightRoles(g) { return g._rr || (g._rr = groupRoles(g.right)) }

export function materialKind(lg, rg) {
  const lr = groupRoles(lg), rr = groupRoles(rg)
  if (lr.length && !rr.length) return 'miss'
  if (!lr.length && rr.length) return 'extra'
  let miss = false, diff = false
  for (const r of ROLES) {
    const le = lg && lg[r], re = rg && rg[r]
    if (le && !re) miss = true
    else if (le && re && le.size !== re.size) diff = true
  }
  if (miss) return 'partial'
  if (diff) return 'diff'
  return 'have'
}

export function singleKind(lg, rg) {
  const le = lg && (lg.file || lg.dir)
  const re = rg && (rg.file || rg.dir)
  if (le && !re) return 'miss'
  if (!le && re) return 'extra'
  if (le && re) return le.size !== re.size ? 'diff' : 'have'
  return 'have'
}

export function subKind(le, re) {
  if (le && !re) return 'miss'
  if (!le && re) return 'extra'
  if (le && re) return le.size !== re.size ? 'diff' : 'have'
  return 'have'
}

export function mainEntryOf(g) {
  if (g.isMaterial) return (g.left && g.left.main) || (g.right && g.right.main)
  return (g.left && (g.left.file || g.left.dir)) || (g.right && (g.right.file || g.right.dir))
}

export function folderOf(g) {
  if (g._folder !== undefined) return g._folder
  const idx = g.key.lastIndexOf('/')
  return (g._folder = idx >= 0 ? g.key.slice(0, idx) : t('render.rootFolder'))
}

export function modelTypeOf(g) {
  const m = g.key.match(/^assets\/[^/]+\/models\/([^/]+)\//)
  if (m) return m[1]
  if (/^assets\/[^/]+\/items\//.test(g.key)) return 'item'
  return null
}

/* ── 内容分类（block / item）：按 MC 资源包路径约定判定，供资源库卡片标记 ──
    textures/block|item/ 与 models/block|item/ 覆盖贴图与旧版模型，
    assets/<ns>/items/ 为 1.21.4+ 物品定义；路径段边界匹配，
    兼容磁盘绝对路径与 pack:/packmodel: 前缀路径 */
const CONTENT_KIND_PATH_RES = [
  [/(?:^|\/)textures\/block\//, 'block'],
  [/(?:^|\/)textures\/item\//, 'item'],
  [/(?:^|\/)models\/block\//, 'block'],
  [/(?:^|\/)models\/item\//, 'item'],
  [/(?:^|\/)assets\/[^/]+\/items\//, 'item'],
]

export function contentKindOfPath(p) {
  if (!p || typeof p !== 'string') return null
  for (const [re, kind] of CONTENT_KIND_PATH_RES) {
    if (re.test(p)) return kind
  }
  return null
}

export function modelBaseNameOf(g) {
  const idx = g.key.lastIndexOf('/')
  const base = idx >= 0 ? g.key.slice(idx + 1) : g.key
  return base.replace(/\.json$/i, '')
}

export function groupTypeOf(g) {
  if (g.isMaterial) return 'material'
  if (g.isModel) return 'model'
  if (g.isDir) return 'dir'
  return 'file'
}

export function groupContentKind(g) {
  return contentKindOfPath(g.key)
}

export function groupTagOf(g, customTags) {
  return (customTags && customTags[g.key]) || null
}

export function getIgnorePatterns() {
  const patterns = []
  if (ignoreChk.checked) patterns.push('.DS_Store', 'Thumbs.db', 'desktop.ini', '.git', 'node_modules', '__pycache__', '*_backup_*')
  const custom = ignoreInput.value.trim()
  if (custom) patterns.push(...custom.split(',').map(s => s.trim()).filter(Boolean))
  return patterns.length ? patterns : null
}